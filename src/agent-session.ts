import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderId, ProviderUsage } from "./providers/types.js";

export interface AgentSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  provider: ProviderId;
  model: string;
  providerState?: unknown;
  usage: ProviderUsage[];
}

export class AgentSessionStore {
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  private async load(): Promise<AgentSession[]> {
    try { return JSON.parse(await readFile(this.filePath, "utf8")) as AgentSession[]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }

  private async save(records: AgentSession[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.filePath);
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  async create(provider: ProviderId, model: string): Promise<AgentSession> {
    return this.serialize(async () => {
      const records = await this.load(); const now = new Date().toISOString();
      const session: AgentSession = { id: randomUUID(), createdAt: now, updatedAt: now, provider, model, usage: [] };
      records.push(session); await this.save(records); return session;
    });
  }

  async get(id: string): Promise<AgentSession | undefined> { return (await this.load()).find((s) => s.id === id); }

  async update(id: string, patch: Partial<Omit<AgentSession, "id" | "createdAt">>): Promise<AgentSession> {
    return this.serialize(async () => {
      const records = await this.load(); const session = records.find((s) => s.id === id);
      if (!session) throw new Error(`Unknown agent session: ${id}`);
      Object.assign(session, patch, { updatedAt: new Date().toISOString() }); await this.save(records); return session;
    });
  }
}
