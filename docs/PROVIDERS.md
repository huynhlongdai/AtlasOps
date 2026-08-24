# Provider / client integration

AtlasOps speaks MCP rather than a vendor-specific SSH protocol, so the same gateway can be used by multiple AI clients.

## Gemini CLI

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

## Claude / Claude Code

Use AtlasOps as an HTTP or stdio MCP server. Point remote clients at `/mcp` and provide the bearer token as an Authorization header.

## OpenAI / Codex / ChatGPT

Use the same remote `/mcp` endpoint in OpenAI products that support custom/remote MCP servers. Local coding hosts can use the stdio entrypoint. ChatGPT availability and write-action behavior depend on the current plan/workspace; AtlasOps does not bypass those product controls.

## Why no model API key in v0.1

The first release is an infrastructure capability server, not an LLM router. The AI client owns the model session and calls AtlasOps through MCP. A first-party multi-provider agent runtime comes after the safe infrastructure layer is proven.
