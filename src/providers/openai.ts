import type { AIProvider, ProviderTurn, ProviderTurnRequest } from "./types.js";
import { ProviderError } from "./types.js";

interface OpenAIState { responseId: string; }

export class OpenAIProvider implements AIProvider {
  readonly id = "openai" as const;
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://api.openai.com/v1") {}

  async runTurn(request: ProviderTurnRequest): Promise<ProviderTurn> {
    const state = request.state as OpenAIState | undefined;
    const input = state
      ? (request.toolResults ?? []).map((item) => ({ type: "function_call_output", call_id: item.callId, output: JSON.stringify(item.result) }))
      : request.prompt ?? "";
    const body: Record<string, unknown> = {
      model: request.model,
      input,
      tools: request.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: true })),
      ...(state ? { previous_response_id: state.responseId } : {})
    };
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = await response.json() as Record<string, any>;
    if (!response.ok) throw new ProviderError(this.id, json?.error?.message ?? `OpenAI request failed (${response.status})`, response.status);
    const output = Array.isArray(json.output) ? json.output : [];
    const toolCalls = output.filter((item: any) => item.type === "function_call").map((item: any) => ({
      id: String(item.call_id ?? item.id), name: String(item.name), arguments: JSON.parse(item.arguments || "{}") as Record<string, unknown>
    }));
    const usage = json.usage ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens, totalTokens: json.usage.total_tokens, raw: json.usage } : undefined;
    return { state: { responseId: String(json.id) }, text: String(json.output_text ?? ""), toolCalls, ...(usage ? { usage } : {}), requestId: String(json.id) };
  }
}
