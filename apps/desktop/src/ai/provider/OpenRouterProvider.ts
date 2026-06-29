import { invoke } from "@tauri-apps/api/core";
import type { ModelProvider } from "./ModelProvider";

type TauriInternals = {
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

const isTauriRuntime =
  typeof window !== "undefined" &&
  typeof (window as Window & { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__?.invoke === "function";

export class OpenRouterProvider implements ModelProvider {
  constructor(private readonly model: string) {}

  send(prompt: string): Promise<string> {
    if (!isTauriRuntime) {
      throw new Error(
        "当前未在 Tauri 桌面环境中运行，请通过 pnpm tauri dev 打开应用",
      );
    }

    return invoke<string>("ask_openrouter", {
      prompt,
      model: this.model,
    });
  }
}
