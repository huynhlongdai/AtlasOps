# Upgrading AtlasOps

## Before every upgrade

1. Record the currently running AtlasOps commit/tag.
2. Back up `data/` and `config/servers.yaml`.
3. Verify you still have the external `ATLASOPS_MASTER_KEY` when using the encrypted credential store.
4. Ensure no infrastructure deployment is actively running.
5. Review the changelog for security or configuration changes.

## Upgrade

```bash
git fetch --tags
git pull --ff-only
docker compose build --pull
docker compose up -d
docker compose ps
curl http://127.0.0.1:8787/healthz
```

Sign in to the Control Center and run the Doctor checks after startup.

## Rolling back AtlasOps itself

AtlasOps application rollback is separate from AtlasOps-managed workload rollback.

If a gateway upgrade fails:

```bash
git checkout <previous-known-good-tag-or-commit>
docker compose build
docker compose up -d
```

Restore the `data/` backup only if the release notes explicitly indicate an incompatible persistent-data change or if the current data was corrupted. Restoring old persistent data can discard approvals, users, deployment records and audit events created after the backup.

## v0.4 to v1 RC

v1 introduces Control Center state and new environment values:

- `ATLASOPS_USERS_FILE`
- `ATLASOPS_CONTROL_SETTINGS_FILE`
- `ATLASOPS_CREDENTIALS_FILE`
- `ATLASOPS_BOOTSTRAP_ADMIN_USER`
- `ATLASOPS_BOOTSTRAP_ADMIN_PASSWORD`
- `ATLASOPS_MASTER_KEY` when local encrypted credentials are used
- `ATLASOPS_COOKIE_SECURE`

On first v1 startup with an empty user store, AtlasOps requires a bootstrap admin password. Once the user store exists, changing or removing that bootstrap environment password does not replace existing user credentials.

Existing MCP, approval, deployment, server inventory and agent-session data remain separate persistent files.
