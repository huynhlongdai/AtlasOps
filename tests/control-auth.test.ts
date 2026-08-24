import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UserStore, WebSessionManager, roleAllows } from "../src/control-auth.js";

test("Control Center bootstraps admin and enforces role hierarchy", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atlasops-users-"));
  const oldUser = process.env.ATLASOPS_BOOTSTRAP_ADMIN_USER; const oldPassword = process.env.ATLASOPS_BOOTSTRAP_ADMIN_PASSWORD;
  try {
    process.env.ATLASOPS_BOOTSTRAP_ADMIN_USER = "rootadmin";
    process.env.ATLASOPS_BOOTSTRAP_ADMIN_PASSWORD = "a-strong-bootstrap-password";
    const store = new UserStore(path.join(dir, "users.json")); await store.bootstrapFromEnvironment();
    const admin = await store.authenticate("rootadmin", "a-strong-bootstrap-password");
    assert.equal(admin?.role, "admin");
    assert.equal(await store.authenticate("rootadmin", "wrong-password"), undefined);
    await assert.rejects(() => store.setDisabled(admin!.id, true), /final active admin/i);

    await store.createTeam("ops"); const operator = await store.createUser("operator1", "another-strong-password", "operator", "ops");
    assert.equal(operator.team, "ops");
    assert.equal(roleAllows("operator", "viewer"), true); assert.equal(roleAllows("viewer", "operator"), false); assert.equal(roleAllows("admin", "operator"), true);

    const sessions = new WebSessionManager(1000); const session = sessions.create(operator); assert.equal(sessions.get(session.token)?.user.username, "operator1");
    assert.equal((await store.getActiveUser(operator.id))?.username, "operator1");
    await store.setDisabled(operator.id, true);
    assert.equal(await store.getActiveUser(operator.id), undefined);
    sessions.delete(session.token); assert.equal(sessions.get(session.token), undefined);
  } finally {
    if (oldUser === undefined) delete process.env.ATLASOPS_BOOTSTRAP_ADMIN_USER; else process.env.ATLASOPS_BOOTSTRAP_ADMIN_USER = oldUser;
    if (oldPassword === undefined) delete process.env.ATLASOPS_BOOTSTRAP_ADMIN_PASSWORD; else process.env.ATLASOPS_BOOTSTRAP_ADMIN_PASSWORD = oldPassword;
    await rm(dir, { recursive: true, force: true });
  }
});
