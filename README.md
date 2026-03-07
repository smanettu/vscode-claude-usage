# Claude Usage — VS Code Extension

A lightweight VS Code extension that shows your Claude Code (Pro/Max) usage limits directly in the status bar.

**Status bar:** `Claude: 38% | 6%` (5-hour session | 7-day weekly)

**Hover:** Rich tooltip with progress bars, reset timers, and your plan name.

**Click:** QuickPick panel with the same info, instantly.

Background turns yellow at 70%, red at 90%. Polls every 60 seconds.

## Requirements

- **macOS** (uses macOS Keychain for authentication)
- **Claude Code CLI** installed and signed in (the official `claude` CLI, not the VS Code extension)
- **VS Code** 1.94.0 or later

No other dependencies. The extension uses zero runtime packages — only Node built-ins and the VS Code API.

## Install

```bash
# Clone and build
git clone <repo-url> && cd vscode-claude-usage
npm install
npm run compile

# Package and install
npx @vscode/vsce package
code --install-extension vscode-claude-usage-0.1.0.vsix
```

After installing, restart VS Code. The usage indicator appears in the bottom status bar.

## How Authentication Works

The extension reads the OAuth token that Claude Code CLI stores in the **macOS Keychain** under the service name `Claude Code-credentials`. It does this by shelling out to:

```bash
security find-generic-password -s "Claude Code-credentials" -w
```

This returns a JSON blob containing an OAuth access token, refresh token, and account metadata (plan type, scopes, etc.). The extension extracts the access token and uses it to call `GET https://api.anthropic.com/api/oauth/usage`.

### Is this secure?

**Reasonably, yes — with caveats:**

- **The token never leaves your machine.** It goes from Keychain → extension process → Anthropic's API over HTTPS. It is not logged, stored on disk, or sent anywhere else.
- **macOS Keychain access control applies.** The first time the extension reads the credential, macOS will show a permission dialog. After you allow it once, subsequent reads are silent.
- **The token is cached in memory only.** It lives in the extension's Node.js process and is cleared when VS Code closes or the extension deactivates.
- **No token refresh flow (yet).** If the token expires, the extension shows an error state. You need to reopen Claude Code CLI to refresh it.

**Caveats:**

- The `security` CLI is called via `child_process.execSync`. Any VS Code extension running in the same process could theoretically read the same keychain entry — this is not unique to this extension, it's a property of how VS Code extensions share a process.
- The usage API endpoint (`/api/oauth/usage`) is **undocumented**. It could change or break without notice.

## Development

```bash
npm run compile    # Build once
npm run watch      # Watch mode
# Press F5 in VS Code to launch Extension Development Host
```

## License

MIT
