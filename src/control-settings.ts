import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderId } from "./providers/types.js";

export interface ControlSettings {
  defaultProvider?: ProviderId;
  defaultModel?: string;
}

export class ControlSettingsStore {
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}
  async get(): Promise<ControlSettings> {
    try { return JSON.parse(await readFile(this.filePath, "utf8")) as ControlSettings; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const provider = process.env.ATLASOPS_DEFAULT_PROVIDER as ProviderId | undefined;
      const model = process.env.ATLASOPS_DEFAULT_MODEL;
      return { ...(provider ? { defaultProvider: provider } : {}), ...(model ? { defaultModel: model } : {}) };
    }
  }
  async update(patch: ControlSettings): Promise<ControlSettings> {
    const result = this.chain.then(async () => {
      const current = await this.get();
      const next: ControlSettings = { ...current, ...patch };
      if (next.defaultProvider && !["openai", "anthropic", "gemini"].includes(next.defaultProvider)) throw new Error("Unsupported provider");
      if (next.defaultModel !== undefined && (!next.defaultModel || next.defaultModel.length > 200)) throw new Error("Invalid model id");
      await mkdir(path.dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 }); await rename(tmp, this.filePath); return next;
    }, async () => { throw new Error("Settings update queue failed"); });
    this.chain = result.then(() => undefined, () => undefined); return result;
  }
}
