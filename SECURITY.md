# Security Policy

AtlasOps controls remote infrastructure, so security defects are release blockers.

## Security invariants

- The model-facing surface never returns private SSH credentials.
- The default toolset has no arbitrary `ssh_exec(command)` capability.
- SSH host-key verification is mandatory per server.
- File reads are limited to explicit absolute roots and re-checked after remote `readlink -f`.
- HTTP MCP requires a bearer token.
- Public HTTP binds require an allowed-host list.
- Write and dangerous actions are not shipped in v0.1.
- Tool executions append an audit event without secret material.

## Threat model

AtlasOps assumes the gateway host and secret store are trusted administration infrastructure. A compromised gateway host can access the SSH credentials available to that gateway.
