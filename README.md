> Built end-to-end with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — from architecture to implementation.

# Claude Usage — VS Code Extension

Shows your Claude Code (Pro/Max) usage limits directly in the VS Code status bar.

## Install

**From the VS Code Marketplace** *(coming soon)*: search for "Claude Usage" in the Extensions panel.

**Manual install (from source):** requires **macOS**, **Node.js**, and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and signed in.

```bash
git clone https://github.com/your-username/vscode-claude-usage.git
cd vscode-claude-usage
npm install                    # install dev dependencies
npm run compile                # compile TypeScript
npx @vscode/vsce package       # package into .vsix (downloads the tool automatically)
code --install-extension vscode-claude-usage-0.1.0.vsix
```

Restart VS Code after installing. The usage indicator appears in the bottom-right status bar.

## What It Does

- **Status bar** shows `Claude: 38% | 6%` (5-hour session | 7-day weekly usage)
- **Hover** for a tooltip with blue progress bars, reset timers, and your plan name
- **Click** for a QuickPick panel with the same info, instantly
- Background turns yellow at 70%, red at 90%
- Polls every 60 seconds, click to refresh manually

## How Authentication Works

The extension reads the OAuth token that **Claude Code CLI** stores in the macOS Keychain. No API keys or manual configuration needed — if you're signed into Claude Code CLI, it just works.

Specifically, it runs:

```bash
security find-generic-password -s "Claude Code-credentials" -w
```

This returns a JSON blob with an OAuth access token. The extension uses it to call `GET https://api.anthropic.com/api/oauth/usage` over HTTPS.

### Is this secure?

**Yes, with standard caveats:**

- The extension makes exactly one outbound HTTPS connection: to `api.anthropic.com`. No telemetry, no third parties, no other hosts.
- macOS Keychain access control applies. First run triggers a one-time "allow access?" dialog.
- The token is cached in memory only and cleared when VS Code closes.
- The `security` CLI is called via `child_process.execSync`. Any VS Code extension in the same process could theoretically read the same keychain entry — this is how VS Code's extension model works, not specific to this extension.
- The usage API endpoint is **undocumented** and could change without notice.

## Development

```bash
npm run compile    # Build once
npm run watch      # Watch mode
# Press F5 in VS Code to launch Extension Development Host
```

## License

MIT
