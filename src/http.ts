import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod/v4";
import { createAtlasApp } from "./app.js";
import { secureTokenEquals } from "./security.js";

const host = process.env.ATLASOPS_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.ATLASOPS_PORT ?? "8787", 10);
const token = process.env.ATLASOPS_BEARER_TOKEN ?? "";
const allowedHosts = (process.env.ATLASOPS_ALLOWED_HOSTS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const allowedOrigins = (process.env.ATLASOPS_ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("ATLASOPS_PORT must be a valid TCP port");
if (token.length < 24) throw new Error("ATLASOPS_BEARER_TOKEN must be at least 24 characters");
const publicBind = !["127.0.0.1", "localhost", "::1"].includes(host);
if (publicBind && allowedHosts.length === 0) throw new Error("ATLASOPS_ALLOWED_HOSTS is required when binding outside localhost");

const agentRunSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]).optional(),
  model: z.string().min(1).max(200).optional(),
  prompt: z.string().min(1).max(100_000),
  sessionId: z.string().uuid().optional(),
  maxTurns: z.number().int().min(1).max(20).optional()
});

const atlas = await createAtlasApp();
const handler = createMcpHandler(() => atlas.createMcpServer());
const nodeHandler = toNodeHandler(handler);
const app = createMcpExpressApp({ host, ...(allowedHosts.length ? { allowedHosts } : {}), ...(allowedOrigins.length ? { allowedOrigins } : {}) });
function requireBearer(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? ""; const [scheme, received] = header.split(" ", 2);
  if (scheme !== "Bearer" || !received || !secureTokenEquals(received, token)) { res.status(401).json({ error: "unauthorized" }); return; }
  next();
}
function resolveAgentRequest(body: unknown) {
  const parsed = agentRunSchema.parse(body);
  const provider = parsed.provider ?? (process.env.ATLASOPS_DEFAULT_PROVIDER as "openai" | "anthropic" | "gemini" | undefined);
  const model = parsed.model ?? process.env.ATLASOPS_DEFAULT_MODEL;
  if (!provider || !model) throw new Error("Specify provider/model or configure ATLASOPS_DEFAULT_PROVIDER and ATLASOPS_DEFAULT_MODEL");
  return { provider, model, prompt: parsed.prompt, ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}), ...(parsed.maxTurns ? { maxTurns: parsed.maxTurns } : {}) };
}
app.get("/healthz", (_req, res) => { res.json({ ok: true, service: "atlasops", version: "0.4.0-alpha.1" }); });
app.get("/agent/providers", requireBearer, (_req, res) => { res.json({ providers: atlas.configuredProviders() }); });
app.post("/agent/run", requireBearer, async (req, res) => {
  try { res.json(await atlas.runAgent(resolveAgentRequest(req.body))); }
  catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_request", details: error.issues }); return; }
    res.status(500).json({ error: "agent_failed", message: error instanceof Error ? error.message : "Unknown agent error" });
  }
});
app.post("/agent/stream", requireBearer, async (req, res) => {
  try {
    const request = resolveAgentRequest(req.body);
    res.status(200);
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders();
    const send = (event: unknown) => { res.write(`data: ${JSON.stringify(event)}\n\n`); };
    const result = await atlas.runAgent(request, send);
    send({ type: "result", result });
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_request", details: error.issues }); return; }
      res.status(500).json({ error: "agent_failed", message: error instanceof Error ? error.message : "Unknown agent error" });
      return;
    }
    res.write(`data: ${JSON.stringify({ type: "stream.error", message: error instanceof Error ? error.message : "Unknown agent error" })}\n\n`);
    res.end();
  }
});
app.all("/mcp", requireBearer, (req, res) => { void nodeHandler(req, res, req.body); });
app.listen(port, host, () => { console.error(`AtlasOps listening on http://${host}:${port} (MCP /mcp, Agent /agent/run, SSE /agent/stream)`); });
