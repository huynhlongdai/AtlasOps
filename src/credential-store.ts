import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AtlasOpsError } from "./config.js";

interface EncryptedEntry { iv: string; tag: string; ciphertext: string; updatedAt: string; }
interface VaultDatabase { version: 1; entries: Record<string, EncryptedEntry>; }

function validName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) throw new AtlasOpsError("INVALID_SECRET_NAME", "Invalid secret name");
  return name;
}
function masterKeyFromEnvironment(): Buffer {
  const raw = process.env.ATLASOPS_MASTER_KEY?.trim();
  if (!raw) throw new AtlasOpsError("MASTER_KEY_MISSING", "ATLASOPS_MASTER_KEY is required for vault: secrets");
  const key = /^[a-fA-F0-9]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new AtlasOpsError("MASTER_KEY_INVALID", "ATLASOPS_MASTER_KEY must encode exactly 32 bytes as base64 or 64 hexadecimal characters");
  return key;
}

export interface SecretProvider { resolve(reference: string): Promise<string>; }

export class EncryptedCredentialStore implements SecretProvider {
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string, private readonly keyProvider: () => Buffer = masterKeyFromEnvironment) {}
  private async load(): Promise<VaultDatabase> {
    try { return JSON.parse(await readFile(this.filePath, "utf8")) as VaultDatabase; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: {} }; throw error; }
  }
  private async save(db: VaultDatabase): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`, { mode: 0o600 }); await rename(tmp, this.filePath);
  }
  private serialize<T>(fn: () => Promise<T>): Promise<T> { const result = this.chain.then(fn, fn); this.chain = result.then(() => undefined, () => undefined); return result; }

  async set(name: string, value: string): Promise<void> {
    validName(name); if (!value) throw new AtlasOpsError("EMPTY_SECRET", "Secret value must not be empty");
    await this.serialize(async () => {
      const db = await this.load(); const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.keyProvider(), iv);
      cipher.setAAD(Buffer.from(`atlasops:v1:${name}`, "utf8")); const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      db.entries[name] = { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"), updatedAt: new Date().toISOString() };
      await this.save(db);
    });
  }
  async resolve(reference: string): Promise<string> {
    const name = validName(reference); const entry = (await this.load()).entries[name]; if (!entry) throw new AtlasOpsError("SECRET_NOT_FOUND", `Encrypted secret not found: ${name}`);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.keyProvider(), Buffer.from(entry.iv, "base64"));
      decipher.setAAD(Buffer.from(`atlasops:v1:${name}`, "utf8")); decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, "base64")), decipher.final()]).toString("utf8");
    } catch { throw new AtlasOpsError("SECRET_DECRYPT_FAILED", `Could not decrypt secret: ${name}`); }
  }
  async list(): Promise<Array<{ name: string; updatedAt: string }>> { return Object.entries((await this.load()).entries).map(([name, entry]) => ({ name, updatedAt: entry.updatedAt })).sort((a, b) => a.name.localeCompare(b.name)); }
  async delete(name: string): Promise<void> { await this.serialize(async () => { const db = await this.load(); delete db.entries[validName(name)]; await this.save(db); }); }
}

export class HashicorpVaultProvider implements SecretProvider {
  constructor(private readonly address = process.env.VAULT_ADDR ?? "", private readonly token = process.env.VAULT_TOKEN ?? "") {}
  async resolve(reference: string): Promise<string> {
    if (!this.address || !this.token) throw new AtlasOpsError("VAULT_NOT_CONFIGURED", "VAULT_ADDR and VAULT_TOKEN are required for hashicorp: secrets");
    const hash = reference.lastIndexOf("#"); if (hash <= 0 || hash === reference.length - 1) throw new AtlasOpsError("INVALID_SECRET_REF", "HashiCorp reference must be path#field");
    const secretPath = reference.slice(0, hash); const field = reference.slice(hash + 1);
    if (!/^[A-Za-z0-9_./-]+$/.test(secretPath) || !/^[A-Za-z0-9_.-]+$/.test(field)) throw new AtlasOpsError("INVALID_SECRET_REF", "Invalid HashiCorp path or field");
    const base = this.address.replace(/\/+$/, ""); const response = await fetch(`${base}/v1/${secretPath}`, { headers: { "x-vault-token": this.token } });
    const json = await response.json() as Record<string, any>;
    if (!response.ok) throw new AtlasOpsError("VAULT_REQUEST_FAILED", `HashiCorp Vault returned ${response.status}`);
    const data = json?.data?.data ?? json?.data; const value = data?.[field];
    if (typeof value !== "string" || !value) throw new AtlasOpsError("SECRET_NOT_FOUND", `HashiCorp field not found: ${field}`);
    return value;
  }
}
