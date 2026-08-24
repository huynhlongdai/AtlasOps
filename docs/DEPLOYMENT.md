# Deployment

1. Create a dedicated non-root `atlasops` account on each managed server.
2. Obtain and verify the server SSH host-key fingerprint through a trusted channel.
3. Copy `config/servers.example.yaml` to `config/servers.yaml` and `.env.example` to `.env`.
4. Prefer mounted key files such as `credentialRef: file:/run/secrets/prod_ed25519`.
5. Run `docker compose up -d --build` and test `curl http://127.0.0.1:8787/healthz`.

The Compose port is localhost-only. Put TLS/reverse-proxy controls in front of `/mcp` before public exposure.

Remote MCP uses `https://host/mcp` with `Authorization: Bearer <token>`.
