import { readFile } from "node:fs/promises";
import path from "node:path";
import { AtlasOpsError } from "./config.js";
import { EncryptedCredentialStore, HashicorpVaultProvider } from "./credential-store.js";

export class SecretResolver {
  constructor(
    private readonly encrypted = new EncryptedCredentialStore(process.env.ATLASOPS_CREDENTIALS_FILE ?? "./data/credentials.enc.json"),
    private readonly hashicorp = new HashicorpVaultProvider()
  ) {}

  async resolve(ref: string): Promise<string> {
    if (ref.startsWith("env:")) {
      const name = ref.slice(4);
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) throw new AtlasOpsError("INVALID_SECRET_REF", "Invalid environment secret reference");
      const value = process.env[name];
      if (!value) throw new AtlasOpsError("SECRET_NOT_FOUND", `Secret environment variable is not set: ${name}`);
      return value.replace(/\\n/g, "\n");
    }
    if (ref.startsWith("file:")) {
      const filename = ref.slice(5);
      if (!path.isAbsolute(filename)) throw new AtlasOpsError("INVALID_SECRET_REF", "file: secret references must use an absolute path");
      return readFile(filename, "utf8");
    }
    if (ref.startsWith("vault:")) return this.encrypted.resolve(ref.slice(6));
    if (ref.startsWith("hashicorp:")) return this.hashicorp.resolve(ref.slice(10));
    throw new AtlasOpsError("INVALID_SECRET_REF", "Supported secret references: env:, file:, vault:, hashicorp:");
  }
}
