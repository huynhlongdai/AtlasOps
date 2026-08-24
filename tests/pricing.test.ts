import assert from "node:assert/strict";
import test from "node:test";
import { PricingCatalog } from "../src/pricing.js";

test("pricing catalog estimates cost from provider/model token usage", () => {
  const pricing = new PricingCatalog({ "openai:test-model": { inputPerMillion: 2, outputPerMillion: 8 } });
  const usage = pricing.enrich("openai", "test-model", { inputTokens: 1_000_000, outputTokens: 500_000, totalTokens: 1_500_000 });
  assert.equal(usage.estimatedCostUsd, 6);
});

test("pricing catalog leaves usage unchanged when price is not configured", () => {
  const pricing = new PricingCatalog({});
  assert.deepEqual(pricing.enrich("gemini", "unknown", { inputTokens: 10, outputTokens: 5 }), { inputTokens: 10, outputTokens: 5 });
});
