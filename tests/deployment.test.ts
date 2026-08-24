import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeploymentStore } from "../src/deployment.js";

test("deployment store persists status transitions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atlasops-deploy-"));
  try {
    const file = path.join(dir, "deployments.json");
    const store = new DeploymentStore(file);
    const created = await store.create({ serverId: "staging", repoPath: "/opt/app", composeFile: "/opt/app/docker-compose.yml", beforeHead: "a".repeat(40) });
    assert.equal(created.status, "running");
    const updated = await store.update(created.id, { status: "succeeded", afterHead: "b".repeat(40), finishedAt: new Date().toISOString() });
    assert.equal(updated.status, "succeeded");
    assert.equal((await new DeploymentStore(file).get(created.id))?.afterHead, "b".repeat(40));
    assert.equal((await store.list("staging")).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
