import { performance } from "node:perf_hooks";
import { AuditLogger } from "./audit.js";
import { AtlasOpsError, ServerInventory } from "./config.js";
import { PolicyEngine, type Risk } from "./policy.js";
import type { ToolResult } from "./types.js";

export class ToolRuntime {
  constructor(readonly inventory: ServerInventory, readonly policy: PolicyEngine, readonly audit: AuditLogger) {}
  async run<T>(tool: string, risk: Risk, serverId: string | undefined, fn: () => Promise<T>): Promise<ToolResult<T>> {
    const requestId = this.audit.newRequestId(); const start = performance.now(); const decision = this.policy.decide(risk);
    if (decision !== "allow") {
      const code = decision === "deny" ? "POLICY_DENIED" : "APPROVAL_REQUIRED";
      await this.audit.write({ timestamp: new Date().toISOString(), requestId, tool, ...(serverId ? { serverId } : {}), risk, decision, success: false, durationMs: Math.round(performance.now() - start), errorCode: code });
      return { ok: false, error: { code, message: `Policy decision: ${decision}` } };
    }
    try {
      const data = await fn();
      await this.audit.write({ timestamp: new Date().toISOString(), requestId, tool, ...(serverId ? { serverId } : {}), risk, decision, success: true, durationMs: Math.round(performance.now() - start) });
      return { ok: true, data };
    } catch (error) {
      const code = error instanceof AtlasOpsError ? error.code : "TOOL_FAILED";
      const message = error instanceof Error ? error.message : "Unknown tool error";
      await this.audit.write({ timestamp: new Date().toISOString(), requestId, tool, ...(serverId ? { serverId } : {}), risk, decision, success: false, durationMs: Math.round(performance.now() - start), errorCode: code });
      return { ok: false, error: { code, message } };
    }
  }
}
