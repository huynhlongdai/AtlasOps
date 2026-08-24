import { AgentSessionStore } from "./agent-session.js";
import { AgentToolRegistry } from "./agent-tools.js";
import { ProviderRegistry, type ProviderId, type ProviderToolResult, type ProviderUsage } from "./providers/index.js";

export interface AgentRunRequest {
  provider: ProviderId;
  model: string;
  prompt: string;
  sessionId?: string;
  maxTurns?: number;
}

export type AgentEvent =
  | { type: "run.started"; sessionId: string; provider: ProviderId; model: string }
  | { type: "provider.turn.completed"; turn: number; requestId?: string; text?: string; usage?: ProviderUsage }
  | { type: "tool.started"; turn: number; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool.completed"; turn: number; callId: string; name: string; result: unknown }
  | { type: "run.completed"; sessionId: string; output: string; turns: number }
  | { type: "run.failed"; sessionId: string; message: string };

export interface AgentTraceItem {
  turn: number;
  providerRequestId?: string;
  text?: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown>; result: unknown }>;
  usage?: ProviderUsage;
}

export interface AgentRunResult {
  sessionId: string;
  provider: ProviderId;
  model: string;
  output: string;
  trace: AgentTraceItem[];
  usage: ProviderUsage[];
}

export type AgentEventSink = (event: AgentEvent) => void | Promise<void>;

export class AgentRuntime {
  constructor(private readonly providers: ProviderRegistry, private readonly tools: AgentToolRegistry, private readonly sessions: AgentSessionStore) {}

  configuredProviders(): ProviderId[] { return this.providers.list(); }

  async run(request: AgentRunRequest, onEvent?: AgentEventSink): Promise<AgentRunResult> {
    if (!request.prompt.trim()) throw new Error("prompt must not be empty");
    const maxTurns = Math.max(1, Math.min(request.maxTurns ?? 10, 20));
    const provider = this.providers.get(request.provider);
    let session = request.sessionId ? await this.sessions.get(request.sessionId) : undefined;
    if (!session) session = await this.sessions.create(request.provider, request.model);
    if (session.provider !== request.provider || session.model !== request.model) throw new Error("Existing session provider/model does not match this request");
    await onEvent?.({ type: "run.started", sessionId: session.id, provider: session.provider, model: session.model });

    let state = session.providerState;
    let toolResults: ProviderToolResult[] | undefined;
    const trace: AgentTraceItem[] = [];
    const usage = [...session.usage];
    let finalText = "";

    try {
      for (let turn = 1; turn <= maxTurns; turn++) {
        const response = await provider.runTurn({
          model: request.model,
          tools: this.tools.definitions(),
          ...(state ? { state } : { prompt: request.prompt }),
          ...(toolResults ? { toolResults } : {})
        });
        state = response.state;
        if (response.usage) usage.push(response.usage);
        await onEvent?.({ type: "provider.turn.completed", turn, ...(response.requestId ? { requestId: response.requestId } : {}), ...(response.text ? { text: response.text } : {}), ...(response.usage ? { usage: response.usage } : {}) });
        const traceItem: AgentTraceItem = { turn, toolCalls: [], ...(response.requestId ? { providerRequestId: response.requestId } : {}), ...(response.text ? { text: response.text } : {}), ...(response.usage ? { usage: response.usage } : {}) };
        if (response.text) finalText = response.text;

        if (response.toolCalls.length === 0) {
          trace.push(traceItem);
          await this.sessions.update(session.id, { providerState: state, usage });
          await onEvent?.({ type: "run.completed", sessionId: session.id, output: finalText, turns: turn });
          return { sessionId: session.id, provider: session.provider, model: session.model, output: finalText, trace, usage };
        }

        toolResults = [];
        for (const call of response.toolCalls) {
          await onEvent?.({ type: "tool.started", turn, callId: call.id, name: call.name, arguments: call.arguments });
          const result = await this.tools.execute(call.id, call.name, call.arguments);
          toolResults.push(result);
          traceItem.toolCalls.push({ id: call.id, name: call.name, arguments: call.arguments, result: result.result });
          await onEvent?.({ type: "tool.completed", turn, callId: call.id, name: call.name, result: result.result });
        }
        trace.push(traceItem);
      }

      await this.sessions.update(session.id, { providerState: state, usage });
      throw new Error(`Agent exceeded maxTurns=${maxTurns} without producing a final response`);
    } catch (error) {
      await onEvent?.({ type: "run.failed", sessionId: session.id, message: error instanceof Error ? error.message : "Unknown agent error" });
      throw error;
    }
  }
}
