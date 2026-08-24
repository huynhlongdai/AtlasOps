#!/usr/bin/env node

const baseUrl = (process.env.ATLASOPS_ACCEPTANCE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const username = process.env.ATLASOPS_ACCEPTANCE_ADMIN_USER ?? process.env.ATLASOPS_BOOTSTRAP_ADMIN_USER ?? "admin";
const password = process.env.ATLASOPS_ACCEPTANCE_ADMIN_PASSWORD ?? process.env.ATLASOPS_BOOTSTRAP_ADMIN_PASSWORD ?? "";
const mode = process.env.ATLASOPS_ACCEPTANCE_MODE ?? "gateway-only";
const serverId = process.env.ATLASOPS_ACCEPTANCE_SERVER_ID ?? "";
const provider = process.env.ATLASOPS_ACCEPTANCE_PROVIDER ?? "";
const model = process.env.ATLASOPS_ACCEPTANCE_MODEL ?? "";

if (!password) {
  console.error("ATLASOPS_ACCEPTANCE_ADMIN_PASSWORD (or ATLASOPS_BOOTSTRAP_ADMIN_PASSWORD) is required");
  process.exit(2);
}
if (!new Set(["gateway-only", "full"]).has(mode)) {
  console.error("ATLASOPS_ACCEPTANCE_MODE must be gateway-only or full");
  process.exit(2);
}

const results = [];
let cookie = "";
let csrf = "";

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark.padEnd(4)}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function request(path, options = {}) {
  const headers = { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, redirect: "manual" });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  return { response, data };
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : "");
    return true;
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
    return false;
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

await check("gateway health", async () => {
  const { response, data } = await request("/healthz");
  expect(response.ok && data?.ok === true, `HTTP ${response.status}`);
  return data?.version ? `version ${data.version}` : "ok";
});

const loggedIn = await check("Control Center login", async () => {
  const { response, data } = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  expect(response.ok, `HTTP ${response.status}`);
  const setCookie = response.headers.get("set-cookie") ?? "";
  expect(setCookie.includes("atlasops_session="), "session cookie missing");
  cookie = setCookie.split(";", 1)[0];
  csrf = data?.csrf ?? "";
  expect(Boolean(csrf), "CSRF token missing");
  expect(data?.user?.role === "admin", `expected admin, got ${data?.user?.role ?? "unknown"}`);
  return data.user.username;
});

if (loggedIn) {
  await check("authenticated session", async () => {
    const { response, data } = await request("/api/auth/me");
    expect(response.ok && data?.user?.username === username, `HTTP ${response.status}`);
    return `${data.user.username}/${data.user.role}`;
  });

  await check("CSRF protection", async () => {
    const { response } = await request("/api/auth/logout", { method: "POST", body: "{}" });
    expect(response.status === 403, `expected 403, got ${response.status}`);
    return "state-changing request rejected without x-atlasops-csrf";
  });

  await check("dashboard", async () => {
    const { response, data } = await request("/api/dashboard");
    expect(response.ok, `HTTP ${response.status}`);
    expect(Array.isArray(data?.servers), "servers missing");
    expect(Array.isArray(data?.doctor), "doctor results missing");
    return `${data.servers.length} server(s), ${data.doctor.length} doctor check(s)`;
  });

  await check("doctor", async () => {
    const { response, data } = await request("/api/doctor");
    expect(response.ok && Array.isArray(data?.checks), `HTTP ${response.status}`);
    const failures = data.checks.filter((item) => item.status === "fail");
    expect(failures.length === 0, `${failures.length} doctor failure(s)`);
    return `${data.checks.length} checks`;
  });

  await check("credential API does not expose plaintext", async () => {
    const { response, data } = await request("/api/credentials");
    expect(response.ok && Array.isArray(data?.credentials), `HTTP ${response.status}`);
    const serialized = JSON.stringify(data);
    expect(!serialized.includes("ciphertext") && !serialized.includes("plaintext") && !serialized.includes("\"value\""), "credential response contains secret-like fields");
    return `${data.credentials.length} credential metadata item(s)`;
  });

  if (mode === "full") {
    expect(serverId, "ATLASOPS_ACCEPTANCE_SERVER_ID is required in full mode");

    await check("staging server health", async () => {
      const { response, data } = await request(`/api/servers/${encodeURIComponent(serverId)}/health`);
      expect(response.ok, `HTTP ${response.status}`);
      expect(typeof data?.output === "string" && data.output.length > 0, "server health output missing");
      return serverId;
    });

    if (provider && model) {
      await check("first-party provider tool flow", async () => {
        const { response, data } = await request("/api/agent/run", {
          method: "POST",
          headers: { "x-atlasops-csrf": csrf },
          body: JSON.stringify({ provider, model, prompt: `Inspect server ${serverId} using AtlasOps tools and report its health. Do not propose or execute write actions.`, maxTurns: 10 })
        });
        expect(response.ok, `HTTP ${response.status}: ${JSON.stringify(data)}`);
        expect(Array.isArray(data?.trace) && data.trace.some((turn) => Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0), "provider completed without an AtlasOps tool call");
        return `${provider}/${model}, ${data.trace.length} turn(s)`;
      });
    } else {
      record("first-party provider tool flow", true, "SKIP — set ATLASOPS_ACCEPTANCE_PROVIDER and ATLASOPS_ACCEPTANCE_MODEL");
    }
  }

  await check("clean logout", async () => {
    const { response } = await request("/api/auth/logout", { method: "POST", headers: { "x-atlasops-csrf": csrf }, body: "{}" });
    expect(response.ok, `HTTP ${response.status}`);
    return "ok";
  });
}

const passed = results.filter((item) => item.ok).length;
const failed = results.length - passed;
console.log(`\nAtlasOps acceptance: ${passed} passed, ${failed} failed (${mode})`);
if (failed) process.exit(1);
