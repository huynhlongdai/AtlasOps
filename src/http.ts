import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { NextFunction, Request, Response } from "express";
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

const atlas = await createAtlasApp();
const handler = createMcpHandler(() => atlas.createMcpServer());
const nodeHandler = toNodeHandler(handler);
const app = createMcpExpressApp({ host, ...(allowedHosts.length ? { allowedHosts } : {}), ...(allowedOrigins.length ? { allowedOrigins } : {}) });
function requireBearer(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? ""; const [scheme, received] = header.split(" ", 2);
  if (scheme !== "Bearer" || !received || !secureTokenEquals(received, token)) { res.status(401).json({ error: "unauthorized" }); return; }
  next();
}
app.get("/healthz", (_req, res) => { res.json({ ok: true, service: "atlasops", version: "0.1.0-alpha.1" }); });
app.all("/mcp", requireBearer, (req, res) => { void nodeHandler(req, res, req.body); });
app.listen(port, host, () => { console.error(`AtlasOps MCP HTTP listening on http://${host}:${port}/mcp`); });
