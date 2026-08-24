# Controlled-action approvals

AtlasOps v0.2 separates the AI execution surface from the human/operator approval surface.

## Trust boundary

The MCP server may request a write action, but it cannot approve that action. Approval is performed locally on the AtlasOps host with `atlasops-operator` (or `node dist/src/operator.js`).

## Flow

1. AI calls a write tool without `approvalId`.
2. Policy returns `approval_required`.
3. AtlasOps persists a pending approval containing tool, server id, expiration and SHA-256 action hash.
4. AtlasOps returns `APPROVAL_REQUIRED` and the approval id.
5. Operator reviews pending requests locally and approves or rejects one.
6. AI retries the exact same tool/arguments with that approval id.
7. AtlasOps recomputes the action hash, consumes the approval once, executes, verifies and audits the result.

## Commands

```bash
npm run operator -- list pending
npm run operator -- approve <uuid> alice
npm run operator -- reject <uuid> alice
```

With Docker:

```bash
docker compose exec atlasops node dist/src/operator.js list pending
docker compose exec atlasops node dist/src/operator.js approve <uuid> alice
```

## Security properties

- approval is one-time
- default TTL is 15 minutes
- approval is bound to tool + server + normalized action arguments
- file content is represented in approval arguments by SHA-256 + byte count, not plaintext
- secrets and SSH private keys are never approval payloads
- dangerous risk class remains denied
- production writes default to approval unless explicitly configured otherwise

## Policy

Each server may configure `writePolicy`:

```yaml
writePolicy:
  restart_container: approval_required
  restart_service: approval_required
  write_file: deny
  compose_pull: approval_required
  compose_up: approval_required
```

Unspecified write tools default to `approval_required`. `allow` should only be used for specifically reviewed semantic tools on environments where unattended changes are acceptable.
