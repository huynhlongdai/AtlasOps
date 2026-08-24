# Changelog

## 1.0.0-rc.1

Control Center release candidate: browser dashboard, separate web authentication, scrypt password hashes, viewer/operator/admin RBAC, CSRF-protected HttpOnly sessions, server health and doctor checks, agent workspace, approval inbox, audit and deployment views, user/team administration, provider/model settings, AES-256-GCM local credential vault, HashiCorp Vault references, Docker production packaging and upgrade guidance.

The first-party agent remains diagnostic/read-only; controlled writes and deployments continue through the approval-gated control plane. Arbitrary model-facing shell remains unavailable.

## 0.4.0-alpha.1

First-party multi-provider agent release: OpenAI Responses, Anthropic Messages and Gemini Interactions adapters; provider-neutral tool calls; persistent sessions; authenticated agent REST + SSE lifecycle endpoints; read-only diagnostic agent tools; provider usage tracking and optional operator-configured cost estimates. MCP, approval and deployment control planes remain available and provider API keys stay on the AtlasOps gateway.

## 0.3.0-alpha.1

Deployment engine release: deployment preflight, persistent history, clean-repo rollback guard, git fast-forward-only updates, Docker Compose deployment, service verification, optional loopback health checks, automatic rollback on failed verification, and approval-gated manual rollback.

## 0.2.0-alpha.1

Controlled actions release: persistent one-time approvals, local operator CLI, per-server/per-tool write policy, separate write-path allowlists, restart container/service, safe file write with backup/hash verification, Docker Compose pull/up with verification, and approval-linked audit events. Arbitrary model-facing shell remains unavailable.

## 0.1.0-alpha.1

Initial public alpha core: MCP v2 stdio/HTTP, multi-server inventory, SSH key isolation and host-key verification, read-only server/Docker/systemd/file/git tools, path allowlisting, bearer auth, JSONL audit, Docker and CI.
