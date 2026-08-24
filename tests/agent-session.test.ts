import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSessionStore } from "../src/agent-session.js";

test("agent sessions persist provider state and usage", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atlasops-agent-"));
  try {
    const file = path.join(dir, "sessions.json");
    const store = new AgentSessionStore(file);
    const created = await store.create("openai", "gpt-test");
    await store.update(created.id, { providerState: { responseId: "resp_1" }, usage: [{ inputTokens: 10, outputTokens: 5, totalTokens: 15 }] });
    const loaded = await new AgentSessionStore(file).get(created.id);
    assert.equal(loaded?.provider, "openai");
    assert.equal(loaded?.model, "gpt-test");
    assert.deepEqual(loaded?.providerState, { responseId: "resp_1" });
    assert.equal(loaded?.usage[0]?.totalTokens, 15);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
