import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApprovalStore, actionHash } from "../src/approval.js";

async function withStore(fn: (store: ApprovalStore) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atlasops-approval-"));
  try { await fn(new ApprovalStore(path.join(dir, "approvals.json"), 60_000)); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("approval is bound to exact action and can be consumed once", async () => {
  await withStore(async (store) => {
    const args = { container: "api" };
    const pending = await store.request("restart_container", "prod", args);
    assert.equal(pending.status, "pending");
    const approved = await store.approve(pending.id, "tester");
    assert.equal(approved.status, "approved");
    const consumed = await store.consume(pending.id, "restart_container", "prod", args);
    assert.equal(consumed.status, "consumed");
    await assert.rejects(() => store.consume(pending.id, "restart_container", "prod", args));
  });
});

test("approval rejects argument substitution", async () => {
  await withStore(async (store) => {
    const pending = await store.request("restart_container", "prod", { container: "api" });
    await store.approve(pending.id, "tester");
    await assert.rejects(() => store.consume(pending.id, "restart_container", "prod", { container: "db" }), /does not match/);
  });
});

test("action hash is stable across object key order", () => {
  assert.equal(actionHash("x", "s", { a: 1, b: 2 }), actionHash("x", "s", { b: 2, a: 1 }));
});
