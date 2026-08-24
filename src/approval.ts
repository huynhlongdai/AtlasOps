import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AtlasOpsError } from "./config.js";

export type ApprovalStatus = "pending" | "approved" | "consumed" | "rejected" | "expired";

export interface ApprovalRecord {
  id: string;
  createdAt: string;
  expiresAt: string;
  tool: string;
  serverId: string;
  actionHash: string;
  status: ApprovalStatus;
  approvedAt?: string;
  approvedBy?: string;
  consumedAt?: string;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`).join(",")}}`;
}

export function actionHash(tool: string, serverId: string, args: unknown): string {
  return createHash("sha256").update(canonicalize({ tool, serverId, args })).digest("hex");
}

export class ApprovalStore {
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string, private readonly ttlMs = 15 * 60 * 1000) {}

  private async load(): Promise<ApprovalRecord[]> {
    try { return JSON.parse(await readFile(this.filePath, "utf8")) as ApprovalRecord[]; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async save(records: ApprovalRecord[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
    await import("node:fs/promises").then(({ rename }) => rename(tmp, this.filePath));
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  async request(tool: string, serverId: string, args: unknown): Promise<ApprovalRecord> {
    return this.serialize(async () => {
      const records = await this.load();
      const hash = actionHash(tool, serverId, args);
      const now = Date.now();
      const reusable = records.find((r) => r.tool === tool && r.serverId === serverId && r.actionHash === hash && r.status === "pending" && Date.parse(r.expiresAt) > now);
      if (reusable) return reusable;
      const record: ApprovalRecord = {
        id: randomUUID(), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + this.ttlMs).toISOString(),
        tool, serverId, actionHash: hash, status: "pending"
      };
      records.push(record); await this.save(records); return record;
    });
  }

  async approve(id: string, operator: string): Promise<ApprovalRecord> {
    return this.serialize(async () => {
      const records = await this.load(); const record = records.find((r) => r.id === id);
      if (!record) throw new AtlasOpsError("APPROVAL_NOT_FOUND", `Unknown approval id: ${id}`);
      if (record.status !== "pending") throw new AtlasOpsError("APPROVAL_INVALID_STATE", `Approval is ${record.status}`);
      if (Date.parse(record.expiresAt) <= Date.now()) { record.status = "expired"; await this.save(records); throw new AtlasOpsError("APPROVAL_EXPIRED", "Approval request expired"); }
      record.status = "approved"; record.approvedAt = new Date().toISOString(); record.approvedBy = operator; await this.save(records); return record;
    });
  }

  async reject(id: string, operator: string): Promise<ApprovalRecord> {
    return this.serialize(async () => {
      const records = await this.load(); const record = records.find((r) => r.id === id);
      if (!record) throw new AtlasOpsError("APPROVAL_NOT_FOUND", `Unknown approval id: ${id}`);
      if (record.status !== "pending") throw new AtlasOpsError("APPROVAL_INVALID_STATE", `Approval is ${record.status}`);
      record.status = "rejected"; record.approvedBy = operator; await this.save(records); return record;
    });
  }

  async consume(id: string, tool: string, serverId: string, args: unknown): Promise<ApprovalRecord> {
    return this.serialize(async () => {
      const records = await this.load(); const record = records.find((r) => r.id === id);
      if (!record) throw new AtlasOpsError("APPROVAL_NOT_FOUND", `Unknown approval id: ${id}`);
      if (record.status !== "approved") throw new AtlasOpsError("APPROVAL_NOT_APPROVED", `Approval is ${record.status}`);
      if (Date.parse(record.expiresAt) <= Date.now()) { record.status = "expired"; await this.save(records); throw new AtlasOpsError("APPROVAL_EXPIRED", "Approval request expired"); }
      if (record.tool !== tool || record.serverId !== serverId || record.actionHash !== actionHash(tool, serverId, args)) throw new AtlasOpsError("APPROVAL_MISMATCH", "Approval does not match this exact action");
      record.status = "consumed"; record.consumedAt = new Date().toISOString(); await this.save(records); return record;
    });
  }

  async list(status?: ApprovalStatus): Promise<ApprovalRecord[]> {
    const records = await this.load();
    return status ? records.filter((r) => r.status === status) : records;
  }
}
