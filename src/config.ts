import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod/v4";
import type { ServerDefinition } from "./types.js";

const rawServerSchema = z.object({
  displayName: z.string().min(1).max(120),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1).max(64),
  environment: z.enum(["development", "staging", "production"]).default("development"),
  credentialRef: z.string().min(5),
  passphraseRef: z.string().min(5).optional(),
  hostKeySha256: z.string().regex(/^[a-f0-9]{64}$/),
  tags: z.array(z.string().min(1).max(64)).default([]),
  allowedReadPaths: z.array(z.string().min(1)).min(1),
  connectTimeoutMs: z.number().int().min(1000).max(120000).default(15000),
  commandTimeoutMs: z.number().int().min(1000).max(120000).default(20000)
});

const configSchema = z.object({
  servers: z.record(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/), rawServerSchema)
});

function validateHost(host: string): void {
  if (host.includes("/") || host.includes("\\") || /\s/.test(host)) throw new Error(`Invalid SSH host: ${host}`);
  if (isIP(host) !== 0) return;
  if (!/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host)) {
    throw new Error(`Invalid SSH hostname: ${host}`);
  }
}

function normalizeAllowedRoot(value: string): string {
  if (!path.posix.isAbsolute(value)) throw new Error(`allowedReadPaths must be absolute POSIX paths: ${value}`);
  const normalized = path.posix.normalize(value);
  if (normalized === "/") throw new Error("Refusing '/' as an allowed read root");
  return normalized.replace(/\/+$/, "");
}

export class ServerInventory {
  private constructor(private readonly byId: Map<string, ServerDefinition>) {}

  static async load(filePath: string): Promise<ServerInventory> {
    const source = await readFile(filePath, "utf8");
    const parsed = configSchema.parse(parse(source));
    const byId = new Map<string, ServerDefinition>();
    for (const [id, raw] of Object.entries(parsed.servers)) {
      validateHost(raw.host);
      byId.set(id, {
        id, displayName: raw.displayName, host: raw.host, port: raw.port, username: raw.username,
        environment: raw.environment, credentialRef: raw.credentialRef,
        ...(raw.passphraseRef ? { passphraseRef: raw.passphraseRef } : {}),
        hostKeySha256: raw.hostKeySha256.toLowerCase(), tags: [...raw.tags],
        allowedReadPaths: raw.allowedReadPaths.map(normalizeAllowedRoot),
        connectTimeoutMs: raw.connectTimeoutMs, commandTimeoutMs: raw.commandTimeoutMs
      });
    }
    return new ServerInventory(byId);
  }

  list(): ServerDefinition[] { return [...this.byId.values()]; }
  require(id: string): ServerDefinition {
    const server = this.byId.get(id);
    if (!server) throw new AtlasOpsError("SERVER_NOT_FOUND", `Unknown server id: ${id}`);
    return server;
  }
}

export class AtlasOpsError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "AtlasOpsError"; }
}
