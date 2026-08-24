# AtlasOps

**Connect infrastructure once. Operate it safely from the AI client you already use.**

AtlasOps is a provider-neutral AI infrastructure operations platform. It exposes one secure infrastructure core through MCP, a first-party multi-provider agent runtime, and a self-hosted Control Center without giving models your private SSH key.

> `v1.0.0-rc.1` adds the Control Center: web authentication/RBAC, server health, agent workspace, approval inbox, audit/deployment views, provider settings, onboarding diagnostics, and encrypted credentials.

## What ships in v1 RC

- Multi-server YAML inventory and mandatory SSH host-key pinning
- MCP over stdio and Streamable HTTP
- OpenAI / Anthropic / Gemini first-party agent adapters
- Persistent agent sessions, lifecycle SSE, usage and optional cost metadata
- Safe read tools plus approval-gated write and deployment tools
- Deployment preflight, verification, history and automatic rollback
- Web Control Center at `/`
- Separate Control Center auth with `viewer`, `operator`, and `admin` roles
- HttpOnly session cookie, SameSite=Strict and CSRF protection
- Approval inbox where operators can approve/reject one-time action-bound requests
- Audit explorer, deployment history, server health and doctor checks
- Admin user/team management and provider/model defaults
- AES-256-GCM local credential vault (`vault:<name>`)
- HashiCorp Vault secret references (`hashicorp:<path>#<field>`)
- No API for retrieving encrypted credential plaintext through the Control Center
- No model-facing arbitrary shell tool

## Quick start

```bash
git clone https://github.com/huynhlongdai/AtlasOps.git
cd AtlasOps
cp config/servers.example.yaml config/servers.yaml
cp .env.example .env
```

Set at minimum:

```env
ATLASOPS_BEARER_TOKEN=<long-random-token>
ATLASOPS_BOOTSTRAP_ADMIN_PASSWORD=<strong-password-at-least-12-chars>
ATLASOPS_ALLOWED_HOSTS=ops.example.com,localhost,127.0.0.1
```

For the local encrypted vault, also configure a 32-byte master key encoded as base64 or hex as documented in `docs/PRODUCTION.md`.

Run:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8787/healthz
```

Open the Control Center through your TLS reverse proxy and sign in with the bootstrap admin account. The bootstrap password is only used to create the first admin when the user store is empty.

## Surfaces

- `/` — Control Center
- `/mcp` — MCP interoperability surface using bearer authentication
- `/agent/run` — first-party agent API using bearer authentication
- `/agent/stream` — agent SSE lifecycle stream using bearer authentication
- `/api/*` — browser Control Center API using its own authenticated session + CSRF
- `/healthz` — health endpoint

## Approval model

Write/deploy actions remain action-bound and one-time. Approval from the Control Center does not expose SSH credentials or arbitrary shell access. The AI/model-facing surface cannot approve its own request.

CLI approval remains available:

```bash
npm run operator -- list pending
npm run operator -- approve <approvalId> your-name
```

## Provider runtime

Configure any subset of:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
ATLASOPS_DEFAULT_PROVIDER=openai
ATLASOPS_DEFAULT_MODEL=your-model-id
```

The first-party agent remains diagnostic/read-only in v1 RC; controlled writes/deployments stay on the approval-gated control plane.

## Documentation

See:

- `SECURITY.md`
- `docs/PRODUCTION.md`
- `docs/UPGRADING.md`
- `docs/APPROVALS.md`
- `docs/DEPLOYMENT.md`
- `docs/PROVIDERS.md`

## License

MIT
