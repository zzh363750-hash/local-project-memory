import type { ModelProvider } from "./ModelProvider";

export class FallbackModelProvider implements ModelProvider {
  private readonly primaryProvider: ModelProvider;
  private readonly fallbackProvider: ModelProvider;

  constructor(
    primaryProvider: ModelProvider,
    fallbackProvider: ModelProvider,
  ) {
    this.primaryProvider = primaryProvider;
    this.fallbackProvider = fallbackProvider;
  }

  async send(prompt: string): Promise<string> {
    try {
      return await this.primaryProvider.send(prompt);
    } catch {
      return this.fallbackProvider.send(prompt);
    }
  }
}
