🚀 Try the AI CTO (Beta): https://chatgpt.com/g/g-6a3e74bb85f481918c58bcb73bca3e78-project-cto
# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## MiMo Configuration

The app keeps the UI on the frontend and sends question prompts to the Tauri backend.

### Local development

- Store `MIMO_API_URL` in `src-tauri/.env.local`
- Store `MIMO_API_KEY` in the macOS Keychain under the `appsdesktop` service
- The frontend never reads the API key directly

### Cloud deployment

- Store `MIMO_API_URL` in the backend environment
- Store `MIMO_API_KEY` in the backend environment
- The backend automatically prefers the environment variable and falls back to the Keychain when running locally

### Notes

- `MIMO_MODEL` defaults to `mimo-v2.5`
- The frontend always calls the same `ask_mimo` command

## UI Verification

- Start the Tauri app first and keep it on the default `项目列表` page.
- Run `pnpm verify:ui` to replay the basic UI verification flow.
- The script brings `appsdesktop` to the front, opens the first project, opens the first file preview, and saves screenshots to `/private/tmp/appsdesktop-ui-verify`.
