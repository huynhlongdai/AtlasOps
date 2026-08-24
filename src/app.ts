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
import { AgentSessionStore } from "./agent-session.js";
import { AgentToolRegistry } from "./agent-tools.js";
import { AgentRuntime, type AgentEventSink, type AgentRunRequest, type AgentRunResult } from "./agent-runtime.js";
import { ProviderRegistry, type ProviderId } from "./providers/index.js";

export interface AtlasApp {
  createMcpServer(): McpServer;
  runAgent(request: AgentRunRequest, onEvent?: AgentEventSink): Promise<AgentRunResult>;
  configuredProviders(): ProviderId[];
}

export async function createAtlasApp(): Promise<AtlasApp> {
  const configPath = process.env.ATLASOPS_CONFIG ?? "./config/servers.yaml";
  const auditPath = process.env.ATLASOPS_AUDIT_FILE ?? "./data/audit.jsonl";
  const approvalsPath = process.env.ATLASOPS_APPROVALS_FILE ?? "./data/approvals.json";
  const deploymentsPath = process.env.ATLASOPS_DEPLOYMENTS_FILE ?? "./data/deployments.json";
  const sessionsPath = process.env.ATLASOPS_AGENT_SESSIONS_FILE ?? "./data/agent-sessions.json";
  const inventory = await ServerInventory.load(configPath);
  const ssh = new SshExecutor(new SecretResolver());
  const runtime = new ToolRuntime(inventory, new PolicyEngine(), new AuditLogger(auditPath), new ApprovalStore(approvalsPath));
  const deployments = new DeploymentStore(deploymentsPath);
  const agent = new AgentRuntime(ProviderRegistry.fromEnvironment(), new AgentToolRegistry(runtime, ssh), new AgentSessionStore(sessionsPath));
  return {
    createMcpServer() {
      const server = new McpServer({ name: "atlasops", version: "0.4.0-alpha.1" });
      registerAtlasTools(server, runtime, ssh);
      registerDeploymentTools(server, runtime, ssh, deployments);
      return server;
    },
    runAgent(request, onEvent) { return agent.run(request, onEvent); },
    configuredProviders() { return agent.configuredProviders(); }
  };
}
