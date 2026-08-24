export type ProviderId = "openai" | "anthropic" | "gemini";

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderToolResult {
  callId: string;
  name: string;
  result: unknown;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  raw?: Record<string, unknown>;
}

export interface ProviderTurn {
  state: unknown;
  text: string;
  toolCalls: ProviderToolCall[];
  usage?: ProviderUsage;
  requestId?: string;
}

export interface ProviderTurnRequest {
  model: string;
  tools: AgentToolDefinition[];
  prompt?: string;
  state?: unknown;
  toolResults?: ProviderToolResult[];
}

export interface AIProvider {
  readonly id: ProviderId;
  runTurn(request: ProviderTurnRequest): Promise<ProviderTurn>;
}

export class ProviderError extends Error {
  constructor(public readonly provider: ProviderId, message: string, public readonly status?: number) {
    super(message); this.name = "ProviderError";
  }
}
