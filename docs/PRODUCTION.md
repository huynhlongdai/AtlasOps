# Production deployment

AtlasOps controls infrastructure. Treat the gateway host as privileged administration infrastructure.

## Required secrets

At minimum configure:

- `ATLASOPS_BEARER_TOKEN`: long random token for MCP/agent API clients.
- `ATLASOPS_BOOTSTRAP_ADMIN_PASSWORD`: strong first-login password used only when the user store is empty.
- SSH credentials via mounted `file:` references, environment variables, `vault:` or external vault references.

For the encrypted local credential store configure `ATLASOPS_MASTER_KEY` as exactly 32 bytes encoded as either 64 hexadecimal characters or base64. Store this value outside the repository and outside the persistent `data/` directory.

## Network exposure

Docker Compose binds port 8787 to localhost. Put a TLS reverse proxy in front of AtlasOps. Set `ATLASOPS_ALLOWED_HOSTS` to the public hostname plus any required local hostnames. Keep `ATLASOPS_COOKIE_SECURE=true` behind HTTPS.

Do not expose port 8787 directly to the Internet.

## Persistent data

Back up the complete `data/` directory, including users, approvals, deployment history, sessions, audit data, control settings and encrypted credential metadata. Also back up `config/servers.yaml` separately.

The encrypted credential file is not useful without `ATLASOPS_MASTER_KEY`; back up the key separately using a secret manager.

## First startup

```bash
cp config/servers.example.yaml config/servers.yaml
cp .env.example .env
# edit .env and config/servers.yaml
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8787/healthz
```

Verify the container reports healthy before enabling traffic at the reverse proxy.

## SSH hardening

Use a dedicated non-root account per managed environment. Pin every server host key through `hostKeySha256`. Grant only the sudo/service permissions required by the semantic AtlasOps tools. Avoid giving the AtlasOps SSH account unrestricted root shell access.

## Control Center roles

- `viewer`: read dashboards, server health, audit/deployment views, and use the diagnostic agent workspace.
- `operator`: viewer capabilities plus approval/rejection of controlled actions.
- `admin`: operator capabilities plus user/team, credential and provider-setting administration.

Never share one admin login across a team.

## Secrets

The Control Center has no endpoint to read decrypted local credentials. It can create/list/delete metadata-backed secrets. Provider API keys are gateway environment variables in v1 RC and are not returned to the browser.

For HashiCorp Vault use `VAULT_ADDR`, `VAULT_TOKEN` and secret references of the form `hashicorp:<path>#<field>`.

## Reverse proxy

Terminate TLS at your proxy, forward WebSocket/streaming-friendly HTTP settings, preserve the `Host` header, and do not cache `/api`, `/mcp`, `/agent`, or authentication responses.

## Release acceptance

Before production use:

1. CI must be green for the exact release commit.
2. Back up `data/` and configuration.
3. Run `/healthz` and `/api/doctor` after startup.
4. Test a non-production SSH target first.
5. Confirm approval-required actions cannot execute without an operator approval.
6. Confirm rollback behavior against a staging Compose project before using deployments on production.
