# Deployment

## Installing AtlasOps

1. Create a dedicated non-root `atlasops` account on each managed server.
2. Obtain and verify the server SSH host-key fingerprint through a trusted channel.
3. Copy `config/servers.example.yaml` to `config/servers.yaml` and `.env.example` to `.env`.
4. Prefer mounted key files such as `credentialRef: file:/run/secrets/prod_ed25519`.
5. Run `docker compose up -d --build` and test `curl http://127.0.0.1:8787/healthz`.

The Compose port is localhost-only. Put TLS/reverse-proxy controls in front of `/mcp` before public exposure.
Remote MCP uses `https://host/mcp` with `Authorization: Bearer <token>`.

## v0.3 deployment engine

AtlasOps deploys an **existing git checkout** and Docker Compose file on a managed server. Both must resolve inside that server's `allowedWritePaths`.

### Preflight

`deployment_preflight` is read-only and verifies:

- repository path and Compose file remain inside write roots after remote `readlink -f`
- git working tree is clean
- current HEAD can be recorded for rollback
- `docker compose config --quiet` succeeds
- expected Compose services can be enumerated
- optional health URL is loopback-only (`localhost`, `127.0.0.1`, `::1`)

A dirty repository is rejected because automatic `git reset --hard` rollback would otherwise destroy uncommitted operator changes.

### Deploy

`deploy_compose` is approval-gated by default:

1. rerun preflight
2. record `beforeHead` and a deployment id
3. `git pull --ff-only` on the current branch
4. record `afterHead`
5. `docker compose up -d`
6. verify every configured service is running
7. optionally call the loopback health URL from the managed server
8. persist deployment status

If steps 3-7 fail, AtlasOps automatically attempts:

1. `git reset --hard <beforeHead>`
2. `docker compose up -d`
3. the same service/health verification

History records distinguish `succeeded`, `rolled_back` and `rollback_failed`.

### Manual rollback

`rollback_deployment` uses a prior deployment id, requires a clean repository and is approval-gated. It restores the recorded `beforeHead`, runs Compose and verifies the restored deployment.

`list_deployments` returns deployment history without SSH credentials or secret material.
