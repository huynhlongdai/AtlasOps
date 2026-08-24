export type Risk = "read" | "write" | "dangerous";
export type Decision = "allow" | "approval_required" | "deny";
export class PolicyEngine {
  decide(risk: Risk): Decision {
    if (risk === "read") return "allow";
    if (risk === "write") return "approval_required";
    return "deny";
  }
}
