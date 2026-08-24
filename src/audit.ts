import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AuditEvent } from "./types.js";

export class AuditLogger {
  constructor(private readonly filename: string) {}
  newRequestId(): string { return randomUUID(); }
  async write(event: AuditEvent): Promise<void> {
    await mkdir(path.dirname(this.filename), { recursive: true });
    await appendFile(this.filename, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
