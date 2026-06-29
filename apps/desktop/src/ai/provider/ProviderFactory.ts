import type { ModelProvider } from "./ModelProvider";
import { FallbackModelProvider } from "./FallbackModelProvider";
import { MiMoProvider } from "./MiMoProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { OpenRouterProvider } from "./OpenRouterProvider";
import {
  providerConfig,
  type ProviderConfig,
} from "./ProviderConfig";

export class ProviderFactory {
  private constructor() {}

  static requiresClientApiKey(
    config: ProviderConfig = providerConfig,
  ): boolean {
    return config.selectedProvider === "mimo";
  }

  static create(
    apiKey: string,
    config: ProviderConfig = providerConfig,
  ): ModelProvider {
    const mimoProvider = new MiMoProvider(apiKey);

    if (config.selectedProvider === "openai") {
      return new FallbackModelProvider(
        new OpenAIProvider(config.models.openai),
        mimoProvider,
      );
    }

    if (config.selectedProvider === "openrouter") {
      return new FallbackModelProvider(
        new OpenRouterProvider(config.models.openrouter),
        mimoProvider,
      );
    }

    return mimoProvider;
  }
}
