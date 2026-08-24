import { McpServer } from "@modelcontextprotocol/server";
import { ServerInventory } from "./config.js";
import { SecretResolver } from "./secrets.js";
import { SshExecutor } from "./ssh.js";
import { AuditLogger } from "./audit.js";
import { PolicyEngine } from "./policy.js";
import { ToolRuntime } from "./runtime.js";
import { registerAtlasTools } from "./tools.js";

export interface AtlasApp { createMcpServer(): McpServer; }
export async function createAtlasApp(): Promise<AtlasApp> {
  const configPath = process.env.ATLASOPS_CONFIG ?? "./config/servers.yaml";
  const auditPath = process.env.ATLASOPS_AUDIT_FILE ?? "./data/audit.jsonl";
  const inventory = await ServerInventory.load(configPath);
  const ssh = new SshExecutor(new SecretResolver());
  const runtime = new ToolRuntime(inventory, new PolicyEngine(), new AuditLogger(auditPath));
  return { createMcpServer() { const server = new McpServer({ name: "atlasops", version: "0.1.0-alpha.1" }); registerAtlasTools(server, runtime, ssh); return server; } };
}
