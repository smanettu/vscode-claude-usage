# Claude Usage — VS Code Extension

## What This Project Is

A lightweight VS Code extension that displays Claude Code (Pro/Max plan) usage limits directly in the VS Code status bar, so you don't have to keep checking the browser.

**How it works:**
- A status bar item shows `Claude: X% | Y%` (5-hour session | 7-day weekly usage)
- Hovering shows a rich tooltip with blue progress bars and reset timers
- Clicking opens a usage QuickPick; clicking during an error/rate-limit state forces an immediate retry
- Background turns yellow at 70%, red at 90%
- Polls every 60 seconds; focus events are debounced to 30s to avoid multi-window spam

## Architecture

Single-file extension (`src/extension.ts`, ~400 lines). Zero runtime dependencies.

```
src/extension.ts    — All logic: keychain auth, API fetch, tooltip, status bar
package.json        — VS Code extension manifest
tsconfig.json       — TypeScript config
.vscode/launch.json — F5 debug config
```

### Data source

- **Endpoint**: `GET https://api.anthropic.com/api/oauth/usage`
- **Auth**: OAuth token from macOS Keychain under `"Claude Code-credentials"`
- **Header**: `anthropic-beta: oauth-2025-04-20`
- **Response shape**:
  ```json
  {
    "five_hour": { "utilization": 6.0, "resets_at": "2025-11-04T04:59:59Z" },
    "seven_day": { "utilization": 35.0, "resets_at": "2025-11-06T03:59:59Z" }
  }
  ```
- **Important**: This is an undocumented API. It could break without notice.

### Token retrieval (macOS only)

```bash
security find-generic-password -s "Claude Code-credentials" -w
```

Returns JSON containing `claudeAiOauth.accessToken` and `claudeAiOauth.refreshToken`.

### Token refresh & rate limiting

On a 429, the extension automatically refreshes the OAuth token:

- **Endpoint**: `POST https://console.anthropic.com/v1/oauth/token`
- **Client ID**: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- **Body**: `{ grant_type: "refresh_token", refresh_token, client_id }`
- Rate limits are per-access-token, so a fresh token gets a fresh quota window.
- Refresh tokens are one-time use (rotation). Both new `accessToken` and `refreshToken` are written back to keychain atomically (`security add-generic-password -U`) so Claude Code picks them up too.
- If refresh fails, the extension falls back to exponential backoff.

## Development

```bash
# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Debug: press F5 in VS Code (launches Extension Development Host)

# Package for local install
npx @vscode/vsce package
code --install-extension vscode-claude-usage-*.vsix
```

## Key VS Code APIs Used

- `window.createStatusBarItem()` — the always-visible status bar item
- `vscode.MarkdownString` with `supportHtml = true` — rich tooltip with progress bars
- `commands.registerCommand()` — refresh command
- Node built-in `https` — API calls (no fetch, no axios)
- Node built-in `child_process.execSync` — keychain access

## Constraints

- Do not run `sudo` or `brew` commands
- Ask before running `pod install` or native build commands
- Prefer small, reviewable edits and always show diffs
- If unsure, ask rather than guessing
- This extension targets **macOS only** (uses macOS Keychain via `security` CLI)
- This extension targets **VS Code only** (no other IDEs)
- Keep everything in a single `src/extension.ts` unless complexity clearly demands splitting
- Zero runtime dependencies — use only Node built-ins and the `vscode` API
- The usage API is undocumented — always wrap calls in try/catch with clear error states

## Shell Commands Policy

- Never auto-run shell commands
- Always propose commands and wait for approval
- User will run commands manually in the VS Code integrated terminal

## Known Risks & Limitations

1. **Undocumented API** — `api.anthropic.com/api/oauth/usage` is not in official docs
2. **Token expiration** — OAuth tokens expire; the extension auto-refreshes via the refresh token on 429s and clears caches on 401s
3. **Keychain prompt** — First run may trigger macOS "allow access?" dialog (one-time)
4. **Tooltip HTML** — `background-color` in MarkdownString has limited support; Unicode blocks (`\u2588`) are the fallback
