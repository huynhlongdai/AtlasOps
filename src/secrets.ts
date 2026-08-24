import { readFile } from "node:fs/promises";
import path from "node:path";
import { AtlasOpsError } from "./config.js";

export class SecretResolver {
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
    throw new AtlasOpsError("INVALID_SECRET_REF", "Only env: and file: secret references are supported");
  }
}
