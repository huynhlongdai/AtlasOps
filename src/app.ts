import { McpServer } from "@modelcontextprotocol/server";
import { ServerInventory } from "./config.js";
import { SecretResolver } from "./secrets.js";
import { SshExecutor } from "./ssh.js";
import { AuditLogger } from "./audit.js";
import { PolicyEngine } from "./policy.js";
import { ToolRuntime } from "./runtime.js";
import { registerAtlasTools } from "./tools.js";
import { ApprovalStore } from "./approval.js";
import { DeploymentStore } from "./deployment.js";
import { registerDeploymentTools } from "./deployment-tools.js";

export interface AtlasApp { createMcpServer(): McpServer; }
export async function createAtlasApp(): Promise<AtlasApp> {
  const configPath = process.env.ATLASOPS_CONFIG ?? "./config/servers.yaml";
  const auditPath = process.env.ATLASOPS_AUDIT_FILE ?? "./data/audit.jsonl";
  const approvalsPath = process.env.ATLASOPS_APPROVALS_FILE ?? "./data/approvals.json";
  const deploymentsPath = process.env.ATLASOPS_DEPLOYMENTS_FILE ?? "./data/deployments.json";
  const inventory = await ServerInventory.load(configPath);
  const ssh = new SshExecutor(new SecretResolver());
  const runtime = new ToolRuntime(inventory, new PolicyEngine(), new AuditLogger(auditPath), new ApprovalStore(approvalsPath));
  const deployments = new DeploymentStore(deploymentsPath);
  return { createMcpServer() {
    const server = new McpServer({ name: "atlasops", version: "0.3.0-alpha.1" });
    registerAtlasTools(server, runtime, ssh);
    registerDeploymentTools(server, runtime, ssh, deployments);
    return server;
  } };
}
