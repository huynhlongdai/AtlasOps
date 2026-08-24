import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ControlSettingsStore } from "../src/control-settings.js";

test("Control Center provider/model defaults persist", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atlasops-settings-"));
  try {
    const file = path.join(dir, "settings.json"); const store = new ControlSettingsStore(file);
    await store.update({ defaultProvider: "anthropic", defaultModel: "model-x" });
    assert.deepEqual(await new ControlSettingsStore(file).get(), { defaultProvider: "anthropic", defaultModel: "model-x" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
