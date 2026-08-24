import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EncryptedCredentialStore } from "../src/credential-store.js";

test("encrypted credential store round-trips without plaintext at rest", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atlasops-vault-"));
  try {
    const file = path.join(dir, "credentials.enc.json"); const key = Buffer.alloc(32, 7); const store = new EncryptedCredentialStore(file, () => key);
    const secret = "super-sensitive-private-key-material";
    await store.set("prod_ssh", secret);
    assert.equal(await store.resolve("prod_ssh"), secret);
    const raw = await readFile(file, "utf8"); assert.equal(raw.includes(secret), false); assert.equal(raw.includes("prod_ssh"), true);
    assert.deepEqual((await store.list()).map((x) => x.name), ["prod_ssh"]);
    await store.delete("prod_ssh"); await assert.rejects(() => store.resolve("prod_ssh"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("encrypted credential store rejects the wrong master key", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atlasops-vault-"));
  try {
    const file = path.join(dir, "credentials.enc.json"); await new EncryptedCredentialStore(file, () => Buffer.alloc(32, 1)).set("key", "secret");
    await assert.rejects(() => new EncryptedCredentialStore(file, () => Buffer.alloc(32, 2)).resolve("key"), /decrypt/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
