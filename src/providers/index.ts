import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAIProvider } from "./openai.js";
import type { AIProvider, ProviderId } from "./types.js";
import { ProviderError } from "./types.js";

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, AIProvider>();

  static fromEnvironment(): ProviderRegistry {
    const registry = new ProviderRegistry();
    const openai = process.env.OPENAI_API_KEY; if (openai) registry.register(new OpenAIProvider(openai, process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"));
    const anthropic = process.env.ANTHROPIC_API_KEY; if (anthropic) registry.register(new AnthropicProvider(anthropic, process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1"));
    const gemini = process.env.GEMINI_API_KEY; if (gemini) registry.register(new GeminiProvider(gemini, process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1"));
    return registry;
  }

  register(provider: AIProvider): void { this.providers.set(provider.id, provider); }
  get(id: ProviderId): AIProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new ProviderError(id, `${id} is not configured on this AtlasOps gateway`);
    return provider;
  }
  list(): ProviderId[] { return [...this.providers.keys()]; }
}

export * from "./types.js";
