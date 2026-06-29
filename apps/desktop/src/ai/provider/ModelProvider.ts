export interface ModelProvider {
  send(prompt: string): Promise<string>;
}
