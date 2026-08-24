# AtlasOps v1 GA acceptance

This checklist is the final gate between the v1 release candidate and general availability.

## Automated gate

The exact release commit must pass:

- dependency installation
- strict TypeScript build
- complete automated test suite
- production Docker image build

## Gateway smoke test

On a clean host:

1. Copy `.env.example` and `config/servers.example.yaml`.
2. Configure a long MCP bearer token and bootstrap admin password.
3. Configure a valid `ATLASOPS_ALLOWED_HOSTS` value.
4. Run `docker compose up -d --build`.
5. Confirm the container becomes healthy.
6. Confirm `/healthz` returns `ok: true`.
7. Sign in to the Control Center.
8. Run Doctor and confirm there are no unexpected failures.

## Authentication / RBAC

- viewer cannot open approval administration APIs
- operator can approve/reject but cannot manage users or credentials
- admin can create users/teams and manage encrypted credentials
- final active admin cannot be disabled
- disabling a user invalidates access on the next request
- state-changing browser requests without the CSRF header fail
- MCP bearer credentials are never sent to the browser Control Center

## Credential boundary

- create a `vault:test_secret` entry
- confirm the persisted encrypted credential file does not contain plaintext
- confirm the secret can be resolved by the gateway
- confirm a wrong master key fails decryption
- confirm no Control Center endpoint returns plaintext secret values

## Non-production VPS test

Use a disposable/staging VPS, not a production server.

- create a dedicated non-root AtlasOps SSH account
- verify the SSH host fingerprint through a trusted channel and pin it in config
- confirm `list_servers` does not expose credentials
- confirm `server_info`, `docker_ps`, `docker_logs`, `service_status`, `read_file`, and `git_status` work only within configured boundaries
- confirm a path traversal/symlink escape outside configured roots is denied

## Controlled action test

On staging:

1. Request `restart_container` or `restart_service` where policy requires approval.
2. Confirm the first call creates an approval request and does not execute.
3. Approve from the Control Center as an operator/admin.
4. Retry the exact action with the approval id and confirm it executes once.
5. Confirm changing tool/server/arguments makes that approval unusable.
6. Confirm the consumed approval cannot be replayed.

## Deployment / rollback test

Use a small Docker Compose staging project in an allowed write root.

- preflight rejects a dirty git tree
- deployment records before/after git heads
- update uses fast-forward-only git behavior
- successful Compose deployment is verified
- intentionally failing post-deploy verification triggers rollback to the recorded pre-deploy commit
- manual rollback requires approval
- deployment history and audit events match the actual actions

## Provider acceptance

For each configured provider (OpenAI, Anthropic, Gemini):

- run a diagnostic request that requires at least one AtlasOps read tool
- confirm the provider receives tool results but never SSH/provider credentials
- confirm session continuation works
- confirm usage metadata is persisted
- if model pricing is configured, confirm estimated cost metadata is produced

## GA decision

AtlasOps may be labeled v1.0 GA only after the automated gate is green and the non-production VPS, controlled-action, deployment/rollback, auth/RBAC, credential and at least one provider acceptance path have passed.
