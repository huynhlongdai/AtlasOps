import type { AIProvider, ProviderTurn, ProviderTurnRequest } from "./types.js";
import { ProviderError } from "./types.js";

interface GeminiState { interactionId: string; }

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://generativelanguage.googleapis.com/v1") {}

  async runTurn(request: ProviderTurnRequest): Promise<ProviderTurn> {
    const state = request.state as GeminiState | undefined;
    const input = state
      ? (request.toolResults ?? []).map((item) => ({ type: "function_result", name: item.name, call_id: item.callId, result: [{ type: "text", text: JSON.stringify(item.result) }] }))
      : request.prompt ?? "";
    const response = await fetch(`${this.baseUrl}/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        input,
        tools: request.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters })),
        ...(state ? { previous_interaction_id: state.interactionId } : {})
      })
    });
    const json = await response.json() as Record<string, any>;
    if (!response.ok) throw new ProviderError(this.id, json?.error?.message ?? `Gemini request failed (${response.status})`, response.status);
    const steps = Array.isArray(json.steps) ? json.steps : [];
    const toolCalls = steps.filter((step: any) => step.type === "function_call").map((step: any) => ({ id: String(step.id), name: String(step.name), arguments: (step.arguments ?? {}) as Record<string, unknown> }));
    const rawUsage = (json.usage ?? json.usage_metadata) as Record<string, unknown> | undefined;
    const usage = rawUsage ? { raw: rawUsage } : undefined;
    return { state: { interactionId: String(json.id) }, text: String(json.output_text ?? ""), toolCalls, ...(usage ? { usage } : {}), requestId: String(json.id) };
  }
}
