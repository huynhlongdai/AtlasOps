import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type DeploymentStatus = "running" | "succeeded" | "failed" | "rolled_back" | "rollback_failed";

export interface DeploymentRecord {
  id: string;
  createdAt: string;
  finishedAt?: string;
  serverId: string;
  repoPath: string;
  composeFile: string;
  beforeHead: string;
  afterHead?: string;
  status: DeploymentStatus;
  healthUrl?: string;
  error?: string;
  rollbackError?: string;
}

export class DeploymentStore {
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  private async load(): Promise<DeploymentRecord[]> {
    try { return JSON.parse(await readFile(this.filePath, "utf8")) as DeploymentRecord[]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }

  private async save(records: DeploymentRecord[]): Promise<void> {
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

  async create(input: Omit<DeploymentRecord, "id" | "createdAt" | "status">): Promise<DeploymentRecord> {
    return this.serialize(async () => {
      const records = await this.load();
      const record: DeploymentRecord = { id: randomUUID(), createdAt: new Date().toISOString(), status: "running", ...input };
      records.push(record); await this.save(records); return record;
    });
  }

  async update(id: string, patch: Partial<Omit<DeploymentRecord, "id" | "createdAt">>): Promise<DeploymentRecord> {
    return this.serialize(async () => {
      const records = await this.load(); const record = records.find((r) => r.id === id);
      if (!record) throw new Error(`Unknown deployment id: ${id}`);
      Object.assign(record, patch); await this.save(records); return record;
    });
  }

  async get(id: string): Promise<DeploymentRecord | undefined> { return (await this.load()).find((r) => r.id === id); }
  async list(serverId?: string): Promise<DeploymentRecord[]> {
    const records = await this.load();
    return (serverId ? records.filter((r) => r.serverId === serverId) : records).slice().reverse();
  }
}
