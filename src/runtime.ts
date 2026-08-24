import { performance } from "node:perf_hooks";
import { ApprovalStore } from "./approval.js";
import { AuditLogger } from "./audit.js";
import { AtlasOpsError, ServerInventory } from "./config.js";
import { PolicyEngine, type Risk } from "./policy.js";
import type { ToolResult } from "./types.js";

export class ToolRuntime {
  constructor(readonly inventory: ServerInventory, readonly policy: PolicyEngine, readonly audit: AuditLogger, readonly approvals: ApprovalStore) {}

  private async execute<T>(tool: string, risk: Risk, serverId: string | undefined, decision: "allow" | "approval_required" | "deny", approvalId: string | undefined, fn: () => Promise<T>): Promise<ToolResult<T>> {
    const requestId = this.audit.newRequestId(); const start = performance.now();
    try {
      const data = await fn();
      await this.audit.write({ timestamp: new Date().toISOString(), requestId, tool, ...(serverId ? { serverId } : {}), risk, decision, success: true, durationMs: Math.round(performance.now() - start), ...(approvalId ? { approvalId } : {}) });
      return { ok: true, data };
    } catch (error) {
      const code = error instanceof AtlasOpsError ? error.code : "TOOL_FAILED";
      const message = error instanceof Error ? error.message : "Unknown tool error";
      await this.audit.write({ timestamp: new Date().toISOString(), requestId, tool, ...(serverId ? { serverId } : {}), risk, decision, success: false, durationMs: Math.round(performance.now() - start), errorCode: code, ...(approvalId ? { approvalId } : {}) });
      return { ok: false, error: { code, message } };
    }
  }

  async run<T>(tool: string, risk: Risk, serverId: string | undefined, fn: () => Promise<T>): Promise<ToolResult<T>> {
    const server = serverId ? this.inventory.require(serverId) : undefined;
    const decision = this.policy.decide(risk, server, tool);
    if (decision !== "allow") {
      const requestId = this.audit.newRequestId(); const code = decision === "deny" ? "POLICY_DENIED" : "APPROVAL_REQUIRED";
      await this.audit.write({ timestamp: new Date().toISOString(), requestId, tool, ...(serverId ? { serverId } : {}), risk, decision, success: false, durationMs: 0, errorCode: code });
      return { ok: false, error: { code, message: `Policy decision: ${decision}` } };
    }
    return this.execute(tool, risk, serverId, decision, undefined, fn);
  }

  async runWrite<T>(tool: string, serverId: string, argsForApproval: unknown, approvalId: string | undefined, fn: () => Promise<T>): Promise<ToolResult<T>> {
    const server = this.inventory.require(serverId);
    const decision = this.policy.decide("write", server, tool);
    if (decision === "deny") {
      const requestId = this.audit.newRequestId();
      await this.audit.write({ timestamp: new Date().toISOString(), requestId, tool, serverId, risk: "write", decision, success: false, durationMs: 0, errorCode: "POLICY_DENIED" });
      return { ok: false, error: { code: "POLICY_DENIED", message: "This write action is denied by server policy" } };
    }

    if (decision === "approval_required") {
      if (!approvalId) {
        const approval = await this.approvals.request(tool, serverId, argsForApproval);
        const requestId = this.audit.newRequestId();
        await this.audit.write({ timestamp: new Date().toISOString(), requestId, tool, serverId, risk: "write", decision, success: false, durationMs: 0, errorCode: "APPROVAL_REQUIRED", approvalId: approval.id });
        return { ok: false, error: { code: "APPROVAL_REQUIRED", message: "Operator approval is required. Approve this id locally, then retry the exact action with approvalId.", details: { approvalId: approval.id, expiresAt: approval.expiresAt } } };
      }
      try { await this.approvals.consume(approvalId, tool, serverId, argsForApproval); }
      catch (error) {
        const code = error instanceof AtlasOpsError ? error.code : "APPROVAL_FAILED";
        const message = error instanceof Error ? error.message : "Approval validation failed";
        return { ok: false, error: { code, message } };
      }
    }

    return this.execute(tool, "write", serverId, decision, approvalId, fn);
  }
}
