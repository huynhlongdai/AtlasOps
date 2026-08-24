# AtlasOps

**Connect infrastructure once. Operate it safely from the AI client you already use.**

AtlasOps is a provider-neutral AI infrastructure operations gateway. It exposes one secure infrastructure core through MCP and through a first-party agent runtime supporting OpenAI, Anthropic and Gemini, without giving models your private SSH key.

> `v0.4.0-alpha.1` adds the first-party multi-provider agent runtime, persistent sessions, lifecycle streaming and usage/cost metadata while preserving the existing MCP, approval and deployment layers.

## Features

- Multi-server YAML inventory
- SSH private keys from environment variables or mounted files
- Mandatory SHA-256 SSH host-key pinning
- MCP over stdio and Streamable HTTP
- First-party OpenAI / Anthropic / Gemini agent adapters
- Authenticated `/agent/run`, `/agent/stream` (SSE) and `/agent/providers`
- Persistent provider sessions, tool traces and usage metadata
- Optional operator-supplied model pricing catalog for `estimatedCostUsd`
- Read tools: `list_servers`, `server_info`, `docker_ps`, `docker_logs`, `service_status`, `read_file`, `git_status`
- Controlled write tools: `restart_container`, `restart_service`, `write_file`, `compose_pull`, `compose_up`
- Deployment tools: `deployment_preflight`, `deploy_compose`, `rollback_deployment`, `list_deployments`
- Separate read/write path allowlists
- Per-server/per-tool write policy: `allow`, `approval_required`, `deny`
- Persistent one-time approvals bound to an exact action hash
- Local operator CLI for approve/reject; the model-facing surface cannot approve itself
- Safe file replacement with pre-write backup and post-write SHA-256 verification
- Deployment preflight, fast-forward-only git updates, verification and automatic rollback
- JSONL audit events including approval ids for controlled writes
- Docker packaging and CI tests
- No model-facing arbitrary shell tool

## Quick start

```bash
git clone https://github.com/huynhlongdai/AtlasOps.git
cd AtlasOps
npm install
cp config/servers.example.yaml config/servers.yaml
cp .env.example .env
npm run build
```

For remote operation:

```bash
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
```

Endpoints use `Authorization: Bearer <ATLASOPS_BEARER_TOKEN>`:

- `/mcp` — MCP interoperability surface
- `/agent/run` — first-party multi-provider agent result
- `/agent/stream` — first-party agent lifecycle as SSE
- `/agent/providers` — configured providers

## First-party agent

Configure at least one API key and optionally defaults:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
ATLASOPS_DEFAULT_PROVIDER=openai
ATLASOPS_DEFAULT_MODEL=your-model-id
```

Example:

```bash
curl -X POST http://127.0.0.1:8787/agent/run \
  -H "Authorization: Bearer $ATLASOPS_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"your-model-id","prompt":"Inspect my configured servers and explain any problems."}'
```

The first-party agent is intentionally read/diagnostic-only in v0.4. Write and deploy capabilities remain behind the approval-gated control plane so adding a provider cannot bypass operator approval.

## Approval flow

When a write/deploy MCP tool is approval-gated, the first call returns `APPROVAL_REQUIRED` with an `approvalId`.

```bash
npm run operator -- list pending
npm run operator -- approve <approvalId> your-name
```

Then retry the **same tool with the same arguments** plus `approvalId`. Approvals are one-time, expire, and cannot be reused for a different action.

See `SECURITY.md`, `docs/APPROVALS.md`, `docs/DEPLOYMENT.md`, `docs/PROVIDERS.md` and `docs/ROADMAP.md`.

## License
MIT
