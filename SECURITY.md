# Security Policy

AtlasOps controls remote infrastructure, so security defects are release blockers.

## Security invariants

- The model-facing surface never returns private SSH credentials.
- The default toolset has no arbitrary `ssh_exec(command)` capability.
- SSH host-key verification is mandatory per server.
- File reads are limited to explicit absolute roots and re-checked after remote `readlink -f`.
- File writes are limited to separate explicit write roots, backed up before replacement, and verified after replacement.
- HTTP MCP requires a bearer token.
- Public HTTP binds require an allowed-host list.
- Dangerous actions are denied by the policy engine.
- Write actions default to operator approval unless explicitly allowed for a semantic tool.
- The model-facing MCP surface cannot approve its own write requests.
- Approvals are persistent, short-lived, one-time and cryptographically bound to the exact tool/server/action arguments.
- Approval records do not store file plaintext; write-file approvals contain a content hash and byte count.
- Tool executions append an audit event without secret material.

## Threat model

AtlasOps assumes the gateway host and secret store are trusted administration infrastructure. A compromised gateway host can access the SSH credentials available to that gateway and can operate the local approval store. Protect the AtlasOps host as privileged infrastructure.
