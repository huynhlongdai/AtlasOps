import type { Application, NextFunction, Request, Response } from "express";
import { z } from "zod/v4";
import type { AtlasApp } from "./app.js";
import { UserStore, WebSessionManager, roleAllows, type UserRole, type WebSession } from "./control-auth.js";
import { secureTokenEquals } from "./security.js";

interface ControlLocals { webSession?: WebSession; }
function cookieValue(req: Request, name: string): string | undefined {
  const source = req.headers.cookie ?? "";
  for (const part of source.split(";")) { const [key, ...rest] = part.trim().split("="); if (key === name) return decodeURIComponent(rest.join("=")); }
  return undefined;
}
function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || !value) throw new Error(`Missing route parameter: ${name}`);
  return value;
}
function currentSession(res: Response): WebSession | undefined { return (res.locals as ControlLocals).webSession; }
function errorResponse(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_request", details: error.issues }); return; }
  res.status(400).json({ error: "control_error", message: error instanceof Error ? error.message : "Unknown Control Center error" });
}

export async function registerControlRoutes(app: Application, atlas: AtlasApp, options: { secureCookie: boolean }): Promise<void> {
  const users = new UserStore(process.env.ATLASOPS_USERS_FILE ?? "./data/users.json");
  await users.bootstrapFromEnvironment();
  const sessions = new WebSessionManager();
  const cookieName = "atlasops_session";

  const loadActiveSession = async (req: Request, res: Response): Promise<WebSession | undefined> => {
    const token = cookieValue(req, cookieName); const session = sessions.get(token);
    if (!session) return undefined;
    const activeUser = await users.getActiveUser(session.user.id);
    if (!activeUser) { sessions.delete(token); return undefined; }
    session.user = activeUser;
    (res.locals as ControlLocals).webSession = session;
    return session;
  };
  const requireSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try { if (!(await loadActiveSession(req, res))) { res.status(401).json({ error: "authentication_required" }); return; } next(); }
    catch (error) { next(error); }
  };
  const requireRole = (role: UserRole) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await loadActiveSession(req, res);
      if (!session) { res.status(401).json({ error: "authentication_required" }); return; }
      if (!roleAllows(session.user.role, role)) { res.status(403).json({ error: "forbidden" }); return; }
      next();
    } catch (error) { next(error); }
  };
  const requireCsrf = (req: Request, res: Response, next: NextFunction): void => {
    const session = currentSession(res); const received = req.header("x-atlasops-csrf") ?? "";
    if (!session || !received || !secureTokenEquals(received, session.csrf)) { res.status(403).json({ error: "csrf_failed" }); return; }
    next();
  };
  const cookie = (token: string, maxAge: number) => `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.secureCookie ? "; Secure" : ""}`;

  app.post("/api/auth/login", async (req, res) => {
    try {
      const body = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(512) }).parse(req.body);
      const user = await users.authenticate(body.username, body.password);
      if (!user) { res.status(401).json({ error: "invalid_credentials" }); return; }
      const session = sessions.create(user); res.setHeader("set-cookie", cookie(session.token, 8 * 60 * 60)); res.json({ user, csrf: session.csrf });
    } catch (error) { errorResponse(res, error); }
  });
  app.post("/api/auth/logout", requireSession, requireCsrf, (req, res) => { sessions.delete(cookieValue(req, cookieName)); res.setHeader("set-cookie", cookie("", 0)); res.json({ ok: true }); });
  app.get("/api/auth/me", requireSession, (_req, res) => { const session = currentSession(res)!; res.json({ user: session.user, csrf: session.csrf }); });

  app.get("/api/dashboard", requireRole("viewer"), async (_req, res) => {
    try {
      const [approvals, audit, deployments, doctor, settings] = await Promise.all([atlas.control.listApprovals("pending"), atlas.control.listAudit(20), atlas.control.listDeployments(), atlas.control.doctor(), atlas.settings.get()]);
      res.json({ servers: atlas.control.listServers(), pendingApprovals: approvals, audit, deployments: deployments.slice(0, 20), providers: atlas.configuredProviders(), doctor, settings });
    } catch (error) { errorResponse(res, error); }
  });
  app.get("/api/servers", requireRole("viewer"), (_req, res) => res.json({ servers: atlas.control.listServers() }));
  app.get("/api/servers/:id/health", requireRole("viewer"), async (req, res) => { try { res.json(await atlas.control.serverHealth(routeParam(req, "id"))); } catch (error) { errorResponse(res, error); } });
  app.get("/api/doctor", requireRole("viewer"), async (_req, res) => { try { res.json({ checks: await atlas.control.doctor() }); } catch (error) { errorResponse(res, error); } });

  app.get("/api/approvals", requireRole("operator"), async (req, res) => { try { const status = typeof req.query.status === "string" ? req.query.status as any : undefined; res.json({ approvals: await atlas.control.listApprovals(status) }); } catch (error) { errorResponse(res, error); } });
  app.post("/api/approvals/:id/approve", requireRole("operator"), requireCsrf, async (req, res) => { try { const session = currentSession(res)!; res.json(await atlas.control.approve(routeParam(req, "id"), session.user.username)); } catch (error) { errorResponse(res, error); } });
  app.post("/api/approvals/:id/reject", requireRole("operator"), requireCsrf, async (req, res) => { try { const session = currentSession(res)!; res.json(await atlas.control.reject(routeParam(req, "id"), session.user.username)); } catch (error) { errorResponse(res, error); } });

  app.get("/api/audit", requireRole("viewer"), async (req, res) => { try { const limit = Math.min(Number(req.query.limit ?? 200) || 200, 2000); res.json({ events: await atlas.control.listAudit(limit) }); } catch (error) { errorResponse(res, error); } });
  app.get("/api/deployments", requireRole("viewer"), async (req, res) => { try { res.json({ deployments: await atlas.control.listDeployments(typeof req.query.serverId === "string" ? req.query.serverId : undefined) }); } catch (error) { errorResponse(res, error); } });
  app.get("/api/providers", requireRole("viewer"), async (_req, res) => { res.json({ providers: atlas.configuredProviders(), settings: await atlas.settings.get() }); });
  app.patch("/api/settings", requireRole("admin"), requireCsrf, async (req, res) => {
    try {
      const body = z.object({ defaultProvider: z.enum(["openai", "anthropic", "gemini"]).optional(), defaultModel: z.string().min(1).max(200).optional() }).parse(req.body);
      const patch = { ...(body.defaultProvider !== undefined ? { defaultProvider: body.defaultProvider } : {}), ...(body.defaultModel !== undefined ? { defaultModel: body.defaultModel } : {}) };
      res.json(await atlas.settings.update(patch));
    } catch (error) { errorResponse(res, error); }
  });

  app.post("/api/agent/run", requireRole("viewer"), requireCsrf, async (req, res) => {
    try {
      const body = z.object({ prompt: z.string().min(1).max(100_000), provider: z.enum(["openai", "anthropic", "gemini"]).optional(), model: z.string().min(1).max(200).optional(), sessionId: z.string().uuid().optional(), maxTurns: z.number().int().min(1).max(20).optional() }).parse(req.body);
      const settings = await atlas.settings.get(); const provider = body.provider ?? settings.defaultProvider; const model = body.model ?? settings.defaultModel;
      if (!provider || !model) { res.status(400).json({ error: "provider_and_model_required" }); return; }
      res.json(await atlas.runAgent({ provider, model, prompt: body.prompt, ...(body.sessionId ? { sessionId: body.sessionId } : {}), ...(body.maxTurns ? { maxTurns: body.maxTurns } : {}) }));
    } catch (error) { errorResponse(res, error); }
  });

  app.get("/api/users", requireRole("admin"), async (_req, res) => res.json({ users: await users.listUsers(), teams: await users.listTeams() }));
  app.post("/api/teams", requireRole("admin"), requireCsrf, async (req, res) => { try { const { name } = z.object({ name: z.string().min(1).max(64) }).parse(req.body); res.json({ name: await users.createTeam(name) }); } catch (error) { errorResponse(res, error); } });
  app.post("/api/users", requireRole("admin"), requireCsrf, async (req, res) => { try { const body = z.object({ username: z.string(), password: z.string(), role: z.enum(["admin", "operator", "viewer"]), team: z.string().default("default") }).parse(req.body); res.json(await users.createUser(body.username, body.password, body.role, body.team)); } catch (error) { errorResponse(res, error); } });
  app.patch("/api/users/:id", requireRole("admin"), requireCsrf, async (req, res) => { try { const { disabled } = z.object({ disabled: z.boolean() }).parse(req.body); res.json(await users.setDisabled(routeParam(req, "id"), disabled)); } catch (error) { errorResponse(res, error); } });

  app.get("/api/credentials", requireRole("admin"), async (_req, res) => { try { res.json({ credentials: await atlas.control.listCredentials() }); } catch (error) { errorResponse(res, error); } });
  app.put("/api/credentials/:name", requireRole("admin"), requireCsrf, async (req, res) => { try { const { value } = z.object({ value: z.string().min(1).max(100_000) }).parse(req.body); const name = routeParam(req, "name"); await atlas.control.setCredential(name, value); res.json({ ok: true, name }); } catch (error) { errorResponse(res, error); } });
  app.delete("/api/credentials/:name", requireRole("admin"), requireCsrf, async (req, res) => { try { await atlas.control.deleteCredential(routeParam(req, "name")); res.json({ ok: true }); } catch (error) { errorResponse(res, error); } });
}
