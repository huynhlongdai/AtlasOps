import type { ServerDefinition, WriteDecision } from "./types.js";

export type Risk = "read" | "write" | "dangerous";
export type Decision = "allow" | "approval_required" | "deny";

export class PolicyEngine {
  decide(risk: Risk, server?: ServerDefinition, tool?: string): Decision {
    if (risk === "read") return "allow";
    if (risk === "dangerous") return "deny";
    if (!server || !tool) return "approval_required";

    const explicit: WriteDecision | undefined = server.writePolicy[tool] ?? server.writePolicy["*"];
    if (explicit) return explicit;

    // Production is always approval-gated by default. Development/staging are
    // also gated unless an administrator explicitly opts a semantic tool in.
    return "approval_required";
  }
}
