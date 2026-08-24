export type EnvironmentName = "development" | "staging" | "production";

export interface ServerDefinition {
  id: string;
  displayName: string;
  host: string;
  port: number;
  username: string;
  environment: EnvironmentName;
  credentialRef: string;
  passphraseRef?: string;
  hostKeySha256: string;
  tags: string[];
  allowedReadPaths: string[];
  connectTimeoutMs: number;
  commandTimeoutMs: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
  truncated: boolean;
}

export interface AuditEvent {
  timestamp: string;
  requestId: string;
  tool: string;
  serverId?: string;
  risk: "read" | "write" | "dangerous";
  decision: "allow" | "approval_required" | "deny";
  success: boolean;
  durationMs: number;
  errorCode?: string;
}

export interface ToolSuccess<T> { ok: true; data: T; }
export interface ToolFailure { ok: false; error: { code: string; message: string; }; }
export type ToolResult<T> = ToolSuccess<T> | ToolFailure;
