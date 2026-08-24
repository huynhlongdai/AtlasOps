import assert from "node:assert/strict";
import test from "node:test";
import { PolicyEngine } from "../src/policy.js";
import type { ServerDefinition } from "../src/types.js";

const server = {
  id: "dev", displayName: "Dev", host: "127.0.0.1", port: 22, username: "atlasops", environment: "development",
  credentialRef: "env:KEY", hostKeySha256: "0".repeat(64), tags: [], allowedReadPaths: ["/opt"], allowedWritePaths: ["/opt/app"],
  writePolicy: { restart_container: "allow", write_file: "deny" }, connectTimeoutMs: 1000, commandTimeoutMs: 1000
} satisfies ServerDefinition;

test("policy is fail-closed for non-read operations", () => {
  const p = new PolicyEngine();
  assert.equal(p.decide("read"), "allow");
  assert.equal(p.decide("write"), "approval_required");
  assert.equal(p.decide("dangerous"), "deny");
});

test("explicit semantic write policy overrides default approval gate", () => {
  const p = new PolicyEngine();
  assert.equal(p.decide("write", server, "restart_container"), "allow");
  assert.equal(p.decide("write", server, "write_file"), "deny");
  assert.equal(p.decide("write", server, "compose_up"), "approval_required");
});
