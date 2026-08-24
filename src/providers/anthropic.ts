import type { AIProvider, ProviderTurn, ProviderTurnRequest } from "./types.js";
import { ProviderError } from "./types.js";

interface AnthropicState { messages: Array<Record<string, unknown>>; }

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://api.anthropic.com/v1") {}

  async runTurn(request: ProviderTurnRequest): Promise<ProviderTurn> {
    const prior = (request.state as AnthropicState | undefined)?.messages ?? [];
    const messages = [...prior];
    if (messages.length === 0) messages.push({ role: "user", content: request.prompt ?? "" });
    if (request.toolResults?.length) {
      messages.push({ role: "user", content: request.toolResults.map((item) => ({ type: "tool_result", tool_use_id: item.callId, content: JSON.stringify(item.result) })) });
    }
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 4096,
        messages,
        tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }))
      })
    });
    const json = await response.json() as Record<string, any>;
    if (!response.ok) throw new ProviderError(this.id, json?.error?.message ?? `Anthropic request failed (${response.status})`, response.status);
    const content = Array.isArray(json.content) ? json.content : [];
    messages.push({ role: "assistant", content });
    const toolCalls = content.filter((item: any) => item.type === "tool_use").map((item: any) => ({ id: String(item.id), name: String(item.name), arguments: (item.input ?? {}) as Record<string, unknown> }));
    const text = content.filter((item: any) => item.type === "text").map((item: any) => String(item.text ?? "")).join("\n");
    const usage = json.usage ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens, totalTokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0), raw: json.usage } : undefined;
    return { state: { messages }, text, toolCalls, ...(usage ? { usage } : {}), requestId: String(json.id ?? "") };
  }
}
