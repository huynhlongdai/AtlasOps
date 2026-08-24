import { ApprovalStore, type ApprovalStatus } from "./approval.js";
import { AuditLogger } from "./audit.js";
import { AtlasOpsError, ServerInventory } from "./config.js";
import { EncryptedCredentialStore } from "./credential-store.js";
import { DeploymentStore } from "./deployment.js";
import { SshExecutor } from "./ssh.js";

export interface DoctorCheck { id: string; status: "pass" | "warn" | "fail"; message: string; }

export class ControlPlaneService {
  constructor(
    private readonly inventory: ServerInventory,
    private readonly ssh: SshExecutor,
    private readonly approvals: ApprovalStore,
    private readonly deployments: DeploymentStore,
    private readonly audit: AuditLogger,
    private readonly credentials: EncryptedCredentialStore,
    private readonly configuredProviders: () => string[]
  ) {}

  listServers() {
    return this.inventory.list().map(({ id, displayName, environment, tags, allowedReadPaths, allowedWritePaths, writePolicy }) => ({ id, displayName, environment, tags, allowedReadPaths, allowedWritePaths, writePolicy }));
  }

  async serverHealth(serverId: string) {
    const target = this.inventory.require(serverId);
    const result = await this.ssh.execFixed(target, "printf '%s\\n' '---hostname---'; hostname; printf '%s\\n' '---uptime---'; uptime; printf '%s\\n' '---memory---'; free -h; printf '%s\\n' '---disk---'; df -hP; printf '%s\\n' '---containers---'; docker ps --format '{{.Names}}|{{.Status}}' 2>/dev/null || true");
    if (result.exitCode !== 0) throw new AtlasOpsError("HEALTH_FAILED", result.stderr.trim() || "Server health command failed");
    return { serverId, checkedAt: new Date().toISOString(), output: result.stdout, truncated: result.truncated };
  }

  listApprovals(status?: ApprovalStatus) { return this.approvals.list(status); }
  approve(id: string, operator: string) { return this.approvals.approve(id, operator); }
  reject(id: string, operator: string) { return this.approvals.reject(id, operator); }
  listAudit(limit?: number) { return this.audit.list(limit); }
  listDeployments(serverId?: string) { return this.deployments.list(serverId); }
  listCredentials() { return this.credentials.list(); }
  setCredential(name: string, value: string) { return this.credentials.set(name, value); }
  deleteCredential(name: string) { return this.credentials.delete(name); }

  async doctor(): Promise<DoctorCheck[]> {
    const servers = this.inventory.list(); const providers = this.configuredProviders();
    const checks: DoctorCheck[] = [
      { id: "servers", status: servers.length ? "pass" : "warn", message: servers.length ? `${servers.length} server(s) configured` : "No managed servers configured" },
      { id: "providers", status: providers.length ? "pass" : "warn", message: providers.length ? `Configured providers: ${providers.join(", ")}` : "No first-party AI provider API key configured; MCP mode is still available" },
      { id: "bearer", status: (process.env.ATLASOPS_BEARER_TOKEN ?? "").length >= 24 ? "pass" : "fail", message: "MCP/API bearer token length check" },
      { id: "master_key", status: process.env.ATLASOPS_MASTER_KEY ? "pass" : "warn", message: process.env.ATLASOPS_MASTER_KEY ? "Encrypted credential store master key configured" : "ATLASOPS_MASTER_KEY not configured; vault: credentials cannot be used" },
      { id: "public_bind", status: ["127.0.0.1", "localhost", "::1"].includes(process.env.ATLASOPS_HOST ?? "127.0.0.1") ? "pass" : ((process.env.ATLASOPS_ALLOWED_HOSTS ?? "").trim() ? "pass" : "fail"), message: "HTTP bind / allowed-host policy" }
    ];
    return checks;
  }
}
