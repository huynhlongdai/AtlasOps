# AtlasOps

**Connect infrastructure once. Operate it safely from the AI client you already use.**

AtlasOps is a provider-neutral MCP gateway for infrastructure operations. It lets ChatGPT/OpenAI clients, Claude, Gemini, Codex, Cursor and other MCP-capable hosts inspect and safely operate the same servers without giving the model your private SSH key.

> `v0.2.0-alpha.1` adds controlled write actions behind per-server policy and one-time operator approvals. Arbitrary model-facing shell execution remains intentionally unavailable.

## Features

- Multi-server YAML inventory
- SSH private keys from environment variables or mounted files
- Mandatory SHA-256 SSH host-key pinning
- MCP over stdio and Streamable HTTP
- Bearer authentication for remote MCP
- Read tools: `list_servers`, `server_info`, `docker_ps`, `docker_logs`, `service_status`, `read_file`, `git_status`
- Controlled write tools: `restart_container`, `restart_service`, `write_file`, `compose_pull`, `compose_up`
- Separate read/write path allowlists
- Per-server/per-tool write policy: `allow`, `approval_required`, `deny`
- Persistent one-time approvals bound to an exact action hash
- Local operator CLI for approve/reject; the AI cannot approve its own action
- Safe file replacement with pre-write backup and post-write SHA-256 verification
- Post-action verification for Docker/systemd/Compose operations
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

For remote MCP:

```bash
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
```

Remote endpoint: `/mcp` with `Authorization: Bearer <ATLASOPS_BEARER_TOKEN>`.

## Approval flow

When a write tool is approval-gated, the first call returns `APPROVAL_REQUIRED` with an `approvalId`.

Local installation:

```bash
npm run operator -- list pending
npm run operator -- approve <approvalId> your-name
```

Docker installation:

```bash
docker compose exec atlasops node dist/src/operator.js list pending
docker compose exec atlasops node dist/src/operator.js approve <approvalId> your-name
```

Then retry the **same tool with the same arguments** plus `approvalId`. Approvals are one-time, expire, and cannot be reused for a different action.

See `SECURITY.md`, `docs/APPROVALS.md`, `docs/DEPLOYMENT.md`, `docs/PROVIDERS.md` and `docs/ROADMAP.md`.

## License
MIT
