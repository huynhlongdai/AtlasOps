# AtlasOps

**Connect infrastructure once. Operate it safely from the AI client you already use.**

AtlasOps is a provider-neutral MCP gateway for infrastructure operations. It lets ChatGPT/OpenAI clients, Claude, Gemini, Codex, Cursor and other MCP-capable hosts inspect the same servers without giving the model your private SSH key.

> `v0.1.0-alpha.1` is deliberately read-only: safe observation and diagnosis before controlled write/deploy workflows.

## v0.1 features

- Multi-server YAML inventory
- SSH private keys from environment variables or mounted files
- Mandatory SHA-256 SSH host-key pinning
- MCP over stdio and Streamable HTTP
- Bearer authentication for remote MCP
- `list_servers`, `server_info`, `docker_ps`, `docker_logs`, `service_status`, `read_file`, `git_status`
- File read allowlists with a second check after remote `readlink -f`
- Per-tool JSONL audit events
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

See `SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/PROVIDERS.md` and `docs/ROADMAP.md`.

## License
MIT
