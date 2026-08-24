import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { AtlasOpsError } from "./config.js";

const scrypt = promisify(scryptCallback);
export type UserRole = "admin" | "operator" | "viewer";

export interface ControlUser {
  id: string;
  username: string;
  role: UserRole;
  team: string;
  passwordHash: string;
  createdAt: string;
  disabled: boolean;
}
export interface PublicControlUser { id: string; username: string; role: UserRole; team: string; createdAt: string; disabled: boolean; }
interface AuthDatabase { users: ControlUser[]; teams: string[]; }

function publicUser(user: ControlUser): PublicControlUser {
  const { passwordHash: _passwordHash, ...safe } = user; return safe;
}
async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new AtlasOpsError("WEAK_PASSWORD", "Password must be at least 12 characters");
  const salt = randomBytes(16); const derived = await scrypt(password, salt, 32) as Buffer;
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}
async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = encoded.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64"); const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class UserStore {
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}
  private async load(): Promise<AuthDatabase> {
    try { return JSON.parse(await readFile(this.filePath, "utf8")) as AuthDatabase; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { users: [], teams: ["default"] }; throw error; }
  }
  private async save(db: AuthDatabase): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`, { mode: 0o600 }); await rename(tmp, this.filePath);
  }
  private serialize<T>(fn: () => Promise<T>): Promise<T> { const result = this.chain.then(fn, fn); this.chain = result.then(() => undefined, () => undefined); return result; }

  async bootstrapFromEnvironment(): Promise<void> {
    await this.serialize(async () => {
      const db = await this.load(); if (db.users.length) return;
      const username = process.env.ATLASOPS_BOOTSTRAP_ADMIN_USER ?? "admin";
      const password = process.env.ATLASOPS_BOOTSTRAP_ADMIN_PASSWORD;
      if (!password) throw new Error("ATLASOPS_BOOTSTRAP_ADMIN_PASSWORD is required when the Control Center user store is empty");
      db.users.push({ id: randomUUID(), username, role: "admin", team: "default", passwordHash: await hashPassword(password), createdAt: new Date().toISOString(), disabled: false });
      await this.save(db);
    });
  }
  async authenticate(username: string, password: string): Promise<PublicControlUser | undefined> {
    const user = (await this.load()).users.find((u) => u.username === username && !u.disabled);
    if (!user || !(await verifyPassword(password, user.passwordHash))) return undefined;
    return publicUser(user);
  }
  async getActiveUser(id: string): Promise<PublicControlUser | undefined> {
    const user = (await this.load()).users.find((u) => u.id === id && !u.disabled);
    return user ? publicUser(user) : undefined;
  }
  async listUsers(): Promise<PublicControlUser[]> { return (await this.load()).users.map(publicUser); }
  async listTeams(): Promise<string[]> { return [...(await this.load()).teams]; }
  async createTeam(name: string): Promise<string> {
    if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/.test(name)) throw new AtlasOpsError("INVALID_TEAM", "Invalid team name");
    return this.serialize(async () => { const db = await this.load(); if (!db.teams.includes(name)) { db.teams.push(name); await this.save(db); } return name; });
  }
  async createUser(username: string, password: string, role: UserRole, team = "default"): Promise<PublicControlUser> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(username)) throw new AtlasOpsError("INVALID_USERNAME", "Invalid username");
    return this.serialize(async () => {
      const db = await this.load(); if (db.users.some((u) => u.username === username)) throw new AtlasOpsError("USER_EXISTS", "Username already exists");
      if (!db.teams.includes(team)) throw new AtlasOpsError("TEAM_NOT_FOUND", "Unknown team");
      const user: ControlUser = { id: randomUUID(), username, role, team, passwordHash: await hashPassword(password), createdAt: new Date().toISOString(), disabled: false };
      db.users.push(user); await this.save(db); return publicUser(user);
    });
  }
  async setDisabled(id: string, disabled: boolean): Promise<PublicControlUser> {
    return this.serialize(async () => {
      const db = await this.load(); const user = db.users.find((u) => u.id === id); if (!user) throw new AtlasOpsError("USER_NOT_FOUND", "Unknown user");
      if (disabled && !user.disabled && user.role === "admin") {
        const activeAdmins = db.users.filter((u) => u.role === "admin" && !u.disabled).length;
        if (activeAdmins <= 1) throw new AtlasOpsError("LAST_ADMIN", "Refusing to disable the final active admin");
      }
      user.disabled = disabled; await this.save(db); return publicUser(user);
    });
  }
}

export interface WebSession { token: string; csrf: string; user: PublicControlUser; expiresAt: number; }
export class WebSessionManager {
  private readonly sessions = new Map<string, WebSession>();
  constructor(private readonly ttlMs = 8 * 60 * 60 * 1000) {}
  create(user: PublicControlUser): WebSession { const session = { token: randomBytes(32).toString("base64url"), csrf: randomBytes(24).toString("base64url"), user, expiresAt: Date.now() + this.ttlMs }; this.sessions.set(session.token, session); return session; }
  get(token: string | undefined): WebSession | undefined { if (!token) return undefined; const session = this.sessions.get(token); if (!session) return undefined; if (session.expiresAt <= Date.now()) { this.sessions.delete(token); return undefined; } return session; }
  delete(token: string | undefined): void { if (token) this.sessions.delete(token); }
}

export function roleAllows(role: UserRole, required: UserRole): boolean {
  const rank: Record<UserRole, number> = { viewer: 1, operator: 2, admin: 3 }; return rank[role] >= rank[required];
}
