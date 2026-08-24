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
import { ControlPlaneService } from "./control-plane.js";
import { EncryptedCredentialStore } from "./credential-store.js";

export interface AtlasApp {
  createMcpServer(): McpServer;
  runAgent(request: AgentRunRequest, onEvent?: AgentEventSink): Promise<AgentRunResult>;
  configuredProviders(): ProviderId[];
  control: ControlPlaneService;
}

export async function createAtlasApp(): Promise<AtlasApp> {
  const configPath = process.env.ATLASOPS_CONFIG ?? "./config/servers.yaml";
  const auditPath = process.env.ATLASOPS_AUDIT_FILE ?? "./data/audit.jsonl";
  const approvalsPath = process.env.ATLASOPS_APPROVALS_FILE ?? "./data/approvals.json";
  const deploymentsPath = process.env.ATLASOPS_DEPLOYMENTS_FILE ?? "./data/deployments.json";
  const sessionsPath = process.env.ATLASOPS_AGENT_SESSIONS_FILE ?? "./data/agent-sessions.json";
  const credentialsPath = process.env.ATLASOPS_CREDENTIALS_FILE ?? "./data/credentials.enc.json";
  const inventory = await ServerInventory.load(configPath);
  const credentials = new EncryptedCredentialStore(credentialsPath);
  const ssh = new SshExecutor(new SecretResolver(credentials));
  const audit = new AuditLogger(auditPath);
  const approvals = new ApprovalStore(approvalsPath);
  const runtime = new ToolRuntime(inventory, new PolicyEngine(), audit, approvals);
  const deployments = new DeploymentStore(deploymentsPath);
  const providers = ProviderRegistry.fromEnvironment();
  const agent = new AgentRuntime(providers, new AgentToolRegistry(runtime, ssh), new AgentSessionStore(sessionsPath));
  const control = new ControlPlaneService(inventory, ssh, approvals, deployments, audit, credentials, () => providers.list());
  return {
    createMcpServer() {
      const server = new McpServer({ name: "atlasops", version: "1.0.0-rc.1" });
      registerAtlasTools(server, runtime, ssh);
      registerDeploymentTools(server, runtime, ssh, deployments);
      return server;
    },
    runAgent(request, onEvent) { return agent.run(request, onEvent); },
    configuredProviders() { return agent.configuredProviders(); },
    control
  };
}
