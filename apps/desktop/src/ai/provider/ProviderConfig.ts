export type ModelProviderName = "mimo" | "openai" | "openrouter";

export type ProviderConfig = {
  selectedProvider: ModelProviderName;
  apiKeys: Record<ModelProviderName, string>;
  models: Record<ModelProviderName, string>;
};

const resolveSelectedProvider = (value: unknown): ModelProviderName => {
  const normalizedValue = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (normalizedValue === "openai" || normalizedValue === "openrouter") {
    return normalizedValue;
  }

  return "mimo";
};

export const providerConfig: ProviderConfig = {
  selectedProvider: resolveSelectedProvider(
    import.meta.env.VITE_MODEL_PROVIDER,
  ),
  apiKeys: {
    mimo: "MIMO_API_KEY",
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  },
  models: {
    mimo: "mimo-v2.5",
    openai: "gpt-4o-mini",
    openrouter: "openai/gpt-4o-mini",
  },
};
