# Provider / client integration

AtlasOps supports two complementary integration modes:

1. **MCP mode** — an external AI client owns the model session and calls AtlasOps through `/mcp` or stdio.
2. **First-party agent mode** — AtlasOps owns the model/tool loop through `/agent/run` or `/agent/stream` and can use OpenAI, Anthropic or Gemini from the same infrastructure core.

## MCP clients

### Gemini CLI

Gemini CLI supports Streamable HTTP with `httpUrl`:

```json
{
  "mcpServers": {
    "atlasops": {
      "httpUrl": "https://ops.example.com/mcp",
      "headers": {"Authorization": "Bearer ${ATLASOPS_MCP_TOKEN}"},
      "trust": false
    }
  }
}
```

### Claude / Claude Code

Use AtlasOps as an HTTP or stdio MCP server. Point remote clients at `/mcp` and provide the bearer token as an Authorization header.

### OpenAI / Codex / ChatGPT

Use the same remote `/mcp` endpoint in OpenAI products that support custom/remote MCP servers. Local coding hosts can use the stdio entrypoint. Product availability and write-action behavior remain subject to the client/provider controls; AtlasOps does not bypass them.

## First-party agent runtime

Configure any subset of provider keys:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
ATLASOPS_DEFAULT_PROVIDER=openai
ATLASOPS_DEFAULT_MODEL=your-model-id
```

Then call:

```bash
curl -X POST http://127.0.0.1:8787/agent/run \
  -H "Authorization: Bearer $ATLASOPS_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"your-model-id","prompt":"Inspect the configured servers and report anything unhealthy."}'
```

`POST /agent/stream` accepts the same body and emits Server-Sent Events for run/provider/tool lifecycle updates plus a final result event.

`GET /agent/providers` returns only providers whose API key is configured.

### Provider adapters

- OpenAI adapter uses the Responses API and normalizes function calls into AtlasOps' provider-neutral tool-call model.
- Anthropic adapter uses the Messages API and normalizes `tool_use` / `tool_result` blocks.
- Gemini adapter uses the Interactions API and normalizes function call/result steps.

Provider API keys remain on the AtlasOps gateway. They are not inserted into prompts, infrastructure tool arguments, SSH sessions or tool traces.

## First-party agent safety boundary

The v0.4 first-party agent exposes only the read/diagnostic infrastructure tools:

- `list_servers`
- `server_info`
- `docker_ps`
- `docker_logs`
- `service_status`
- `read_file`
- `git_status`

Write and deployment tools remain on the approval-gated MCP/control plane until the Control Center has a first-party Approval Inbox. This avoids creating an alternate path around operator approval.

## Usage and cost metadata

Token usage is persisted per agent session when the provider returns it. AtlasOps intentionally does not ship hard-coded model prices. Operators may provide a current price catalog:

```env
ATLASOPS_MODEL_PRICES_JSON={"openai:model-id":{"inputPerMillion":1.0,"outputPerMillion":2.0}}
```

Rates are USD per one million tokens. When matching token usage and pricing are both available, AtlasOps adds `estimatedCostUsd`; otherwise usage remains available without a cost estimate.
