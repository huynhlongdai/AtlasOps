import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import type { CommandResult, ServerDefinition } from "./types.js";
import { AtlasOpsError } from "./config.js";
import { SecretResolver } from "./secrets.js";
import { shellQuote } from "./security.js";

const MAX_OUTPUT_BYTES = 512 * 1024;
function collectChunk(current: Buffer[], currentBytes: number, chunk: Buffer | string): { bytes: number; truncated: boolean } {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = Math.max(0, MAX_OUTPUT_BYTES - currentBytes);
  if (remaining > 0) current.push(buf.subarray(0, remaining));
  return { bytes: currentBytes + Math.min(buf.length, remaining), truncated: buf.length > remaining };
}

export class SshExecutor {
  constructor(private readonly secrets: SecretResolver) {}
  private async connect(server: ServerDefinition): Promise<Client> {
    const privateKey = await this.secrets.resolve(server.credentialRef);
    const passphrase = server.passphraseRef ? await this.secrets.resolve(server.passphraseRef) : undefined;
    return await new Promise<Client>((resolve, reject) => {
      const client = new Client(); let settled = false;
      const rejectOnce = (error: Error) => { if (!settled) { settled = true; reject(error); } };
      client.once("ready", () => { if (!settled) { settled = true; resolve(client); } });
      client.once("error", rejectOnce);
      const config: ConnectConfig = {
        host: server.host, port: server.port, username: server.username, privateKey,
        ...(passphrase ? { passphrase } : {}), readyTimeout: server.connectTimeoutMs,
        keepaliveInterval: 10000, keepaliveCountMax: 3, hostHash: "sha256",
        hostVerifier: (hash) => hash.toLowerCase() === server.hostKeySha256
      };
      client.connect(config);
    });
  }

  async execFixed(server: ServerDefinition, command: string): Promise<CommandResult> {
    const client = await this.connect(server);
    try {
      return await new Promise<CommandResult>((resolve, reject) => {
        const timeout = setTimeout(() => { client.end(); reject(new AtlasOpsError("COMMAND_TIMEOUT", "Remote command timed out")); }, server.commandTimeoutMs);
        client.exec(command, (error, stream) => {
          if (error) { clearTimeout(timeout); reject(error); return; }
          const stdout: Buffer[] = []; const stderr: Buffer[] = [];
          let stdoutBytes = 0; let stderrBytes = 0; let truncated = false; let signal: string | undefined;
          stream.on("data", (chunk: Buffer) => { const r = collectChunk(stdout, stdoutBytes, chunk); stdoutBytes = r.bytes; truncated ||= r.truncated; });
          stream.stderr.on("data", (chunk: Buffer) => { const r = collectChunk(stderr, stderrBytes, chunk); stderrBytes = r.bytes; truncated ||= r.truncated; });
          stream.on("exit", (_code: number | undefined, sig: string | undefined) => { signal = sig; });
          stream.once("error", (streamError: Error) => { clearTimeout(timeout); reject(streamError); });
          stream.once("close", (code: number | undefined) => {
            clearTimeout(timeout);
            resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode: code ?? -1, ...(signal ? { signal } : {}), truncated });
          });
        });
      });
    } finally { client.end(); }
  }

  async realpath(server: ServerDefinition, target: string): Promise<string> {
    const result = await this.execFixed(server, `readlink -f -- ${shellQuote(target)}`);
    if (result.exitCode !== 0) throw new AtlasOpsError("PATH_RESOLVE_FAILED", result.stderr.trim() || "Could not resolve remote path");
    const resolved = result.stdout.trim();
    if (!resolved.startsWith("/")) throw new AtlasOpsError("PATH_RESOLVE_FAILED", "Remote realpath was not absolute");
    return resolved;
  }

  async readFile(server: ServerDefinition, target: string, maxBytes: number): Promise<string> {
    const client = await this.connect(server);
    try {
      const sftp = await new Promise<SFTPWrapper>((resolve, reject) => client.sftp((error, wrapper) => error ? reject(error) : resolve(wrapper)));
      const attrs = await new Promise<{ size: number }>((resolve, reject) => sftp.stat(target, (error, stat) => error ? reject(error) : resolve(stat)));
      if (attrs.size > maxBytes) throw new AtlasOpsError("FILE_TOO_LARGE", `File is ${attrs.size} bytes; maxBytes is ${maxBytes}`);
      const content = await new Promise<Buffer>((resolve, reject) => sftp.readFile(target, (error, data) => error ? reject(error) : resolve(data)));
      return content.toString("utf8");
    } finally { client.end(); }
  }
}
