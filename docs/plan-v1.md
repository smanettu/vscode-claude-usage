# Claude Usage VS Code Extension — v1 Plan

## Context
You're tired of switching to the browser to check Claude Code usage limits. This extension puts that info directly in VS Code's status bar with a rich hover tooltip showing progress bars, matching the Claude web UI aesthetic.

## Data Source
- **Endpoint**: `GET https://api.anthropic.com/api/oauth/usage`
- **Auth**: OAuth token from macOS Keychain (`security find-generic-password -s "Claude Code-credentials" -w`)
- **Required header**: `anthropic-beta: oauth-2025-04-20`
- **Response**: `{ five_hour: { utilization: 6.0, resets_at: "..." }, seven_day: { utilization: 35.0, resets_at: "..." } }`
- **Caveat**: This is an undocumented endpoint (same one the Claude web UI uses). Could break without notice.

## Approach: Status Bar + Rich Hover Tooltip

A status bar item at the bottom of VS Code showing `Claude: 10% | 35%` (session | weekly). Hovering shows a styled tooltip with blue progress bars, reset timers, and labels. Clicking refreshes the data.

**Why this approach over alternatives**:
- **vs. Status Bar only** (text + modal): No visual progress bar, feels clunky
- **vs. Webview panel**: 2-3x more code for a panel you'd need to open manually. Overkill for two numbers + bars
- **This approach**: ~200 lines, visual progress bars in the hover, always visible, zero dependencies

## Implementation Steps

### Step 1: Scaffold the VS Code extension project
Manually create the extension structure (simpler than the Yeoman generator):
```
claude-usage/
  .vscode/launch.json
  src/extension.ts
  package.json
  tsconfig.json
```

### Step 2: Configure `package.json`
- `engines.vscode: "^1.94.0"`
- `activationEvents: ["onStartupFinished"]` (lightweight, activates after VS Code loads)
- Single command: `claude-usage.refresh`
- No runtime dependencies

### Step 3: Implement `src/extension.ts` (single file, ~200 lines)

**Token retrieval** (~15 lines):
- Shell out to `security find-generic-password -s "Claude Code-credentials" -w`
- Parse JSON, extract `claudeAiOauth.accessToken`
- Cache token in memory, re-read on 401

**API fetch** (~35 lines):
- Node built-in `https.request()` to the usage endpoint
- 10s timeout, proper error handling
- Returns typed `UsageResponse`

**Tooltip rendering** (~40 lines):
- `vscode.MarkdownString` with `supportHtml = true`
- Blue progress bars via `<span style="background-color:#3b82f6">` inside `<div style="background-color:#e5e7eb">`
- Fallback: Unicode block characters if HTML rendering is unreliable
- Shows: 5-hour window %, bar, reset time + 7-day window %, bar, reset time

**Status bar + lifecycle** (~50 lines):
- `window.createStatusBarItem(StatusBarAlignment.Right, 100)`
- Text: `$(pulse) Claude: X% | Y%`
- Color-coded background: normal < 70%, yellow warning 70-90%, red error > 90%
- Click triggers refresh command
- Polls every 60 seconds via `setInterval`
- Proper cleanup on deactivate

### Step 4: Build and test
- `npm run compile` (tsc)
- F5 to launch Extension Development Host
- Verify: status bar appears, hover shows bars, click refreshes, error states work

### Step 5: Package for local install
```bash
npx @vscode/vsce package
code --install-extension vscode-claude-usage-0.1.0.vsix
```

## Files to Create

| File | Purpose |
|------|---------|
| `package.json` | Extension manifest, commands, activation events |
| `tsconfig.json` | TypeScript config targeting ES2022/Node |
| `.vscode/launch.json` | Debug config for F5 |
| `src/extension.ts` | All extension logic (~200 lines) |

**Total**: ~250 lines across 4 files. Zero runtime dependencies.

## Known Risks
1. **Undocumented API**: Could break without notice. We wrap everything in try/catch with clear error display.
2. **Token expiration**: OAuth tokens expire. v1 shows an error message; v2 could implement refresh flow.
3. **Keychain prompt**: First run may trigger macOS "allow access?" dialog. One-time only.
4. **Tooltip HTML**: If `background-color` doesn't render well, we fall back to Unicode block chars.

## Verification
1. Press F5 in VS Code to launch Extension Development Host
2. Check bottom status bar shows "Claude: X% | Y%"
3. Hover over it — should see blue progress bars with reset times
4. Click it — should refresh immediately
5. Simulate error: temporarily rename keychain entry — should show "No Token" state
6. Package as .vsix and install in main VS Code to verify it works outside dev mode

## Future Ideas (v2+)
- OAuth token refresh flow (handle expired tokens automatically)
- Configurable poll interval via VS Code settings
- Show Sonnet-only limit (if API provides it)
- Notification when approaching limit (e.g., 80%)
- Linux/Windows support (different credential storage)
