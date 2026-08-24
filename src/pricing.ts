import type { ProviderId, ProviderUsage } from "./providers/types.js";

interface ModelPrice { inputPerMillion: number; outputPerMillion: number; }

export class PricingCatalog {
  constructor(private readonly prices: Record<string, ModelPrice>) {}

  static fromEnvironment(): PricingCatalog {
    const raw = process.env.ATLASOPS_MODEL_PRICES_JSON;
    if (!raw) return new PricingCatalog({});
    const parsed = JSON.parse(raw) as Record<string, ModelPrice>;
    for (const [key, value] of Object.entries(parsed)) {
      if (!Number.isFinite(value.inputPerMillion) || value.inputPerMillion < 0 || !Number.isFinite(value.outputPerMillion) || value.outputPerMillion < 0) throw new Error(`Invalid model pricing for ${key}`);
    }
    return new PricingCatalog(parsed);
  }

  enrich(provider: ProviderId, model: string, usage: ProviderUsage): ProviderUsage {
    const price = this.prices[`${provider}:${model}`];
    if (!price || usage.inputTokens === undefined || usage.outputTokens === undefined) return usage;
    const estimatedCostUsd = (usage.inputTokens / 1_000_000) * price.inputPerMillion + (usage.outputTokens / 1_000_000) * price.outputPerMillion;
    return { ...usage, estimatedCostUsd };
  }
}
