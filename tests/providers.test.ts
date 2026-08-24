import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIProvider } from "../src/providers/openai.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { GeminiProvider } from "../src/providers/gemini.js";

const tool = { name: "server_info", description: "inspect server", parameters: { type: "object", properties: { serverId: { type: "string" } }, required: ["serverId"], additionalProperties: false } };

async function withFetch(payload: unknown, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try { await fn(); } finally { globalThis.fetch = original; }
}

test("OpenAI adapter normalizes function calls", async () => {
  await withFetch({ id: "resp_1", output_text: "", output: [{ type: "function_call", call_id: "call_1", name: "server_info", arguments: "{\"serverId\":\"prod\"}" }], usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } }, async () => {
    const turn = await new OpenAIProvider("test").runTurn({ model: "gpt-test", prompt: "inspect", tools: [tool] });
    assert.deepEqual(turn.toolCalls[0], { id: "call_1", name: "server_info", arguments: { serverId: "prod" } });
    assert.equal(turn.usage?.totalTokens, 6);
  });
});

test("Anthropic adapter normalizes tool_use", async () => {
  await withFetch({ id: "msg_1", content: [{ type: "tool_use", id: "tool_1", name: "server_info", input: { serverId: "prod" } }], usage: { input_tokens: 5, output_tokens: 3 } }, async () => {
    const turn = await new AnthropicProvider("test").runTurn({ model: "claude-test", prompt: "inspect", tools: [tool] });
    assert.equal(turn.toolCalls[0]?.name, "server_info");
    assert.equal(turn.usage?.totalTokens, 8);
  });
});

test("Gemini adapter normalizes function_call steps", async () => {
  await withFetch({ id: "interaction_1", output_text: "", steps: [{ type: "function_call", id: "call_1", name: "server_info", arguments: { serverId: "prod" } }] }, async () => {
    const turn = await new GeminiProvider("test").runTurn({ model: "gemini-test", prompt: "inspect", tools: [tool] });
    assert.equal(turn.toolCalls[0]?.id, "call_1");
    assert.equal(turn.toolCalls[0]?.arguments.serverId, "prod");
  });
});
