import * as vscode from "vscode";
import * as https from "https";
import { execSync } from "child_process";

// --- Types ---

interface UsageWindow {
  utilization: number;
  resets_at: string;
}

interface UsageResponse {
  five_hour: UsageWindow;
  seven_day: UsageWindow;
  planName?: string;
}


// --- Token ---

let cachedToken: string | null = null;
let cachedPlanName: string | undefined;

function formatPlanName(raw: string | undefined): string | undefined {
  if (!raw) { return undefined; }
  // e.g. "default_claude_max_5x" → "Max 5x", "default_claude_pro" → "Pro"
  const cleaned = raw.replace(/^default_claude_/i, "");
  return cleaned
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getOAuthToken(): string | null {
  if (cachedToken) {
    return cachedToken;
  }
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    const parsed = JSON.parse(raw);
    const oauth = parsed?.claudeAiOauth;
    cachedToken = oauth?.accessToken ?? null;
    cachedPlanName = formatPlanName(oauth?.rateLimitTier ?? oauth?.subscriptionType);
    return cachedToken;
  } catch {
    return null;
  }
}

function clearCachedToken(): void {
  cachedToken = null;
  cachedPlanName = undefined;
}

// --- API ---

function fetchUsage(token: string): Promise<UsageResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/api/oauth/usage",
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": "vscode-claude-usage/0.1.0",
          Accept: "application/json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const raw = JSON.parse(data);
              resolve({
                five_hour: raw.five_hour,
                seven_day: raw.seven_day,
                planName: cachedPlanName,
              });
            } catch {
              reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
            }
          } else if (res.statusCode === 401) {
            clearCachedToken();
            reject(new Error("Token expired — reopen Claude Code to refresh"));
          } else {
            reject(new Error(`API ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.end();
  });
}

// --- Tooltip ---

function formatTimeUntil(isoDate: string): string {
  const diffMs = Math.max(0, new Date(isoDate).getTime() - Date.now());
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function progressBarHtml(percent: number): string {
  const pct = Math.min(100, Math.max(0, percent));
  // Blue filled portion + gray empty portion using inline styles
  const filled = Math.round(pct / 5); // 0-20 blocks
  const empty = 20 - filled;
  const blueBlocks = "\u2588".repeat(filled);
  const grayBlocks = "\u2591".repeat(empty);
  return (
    `<span style="color:#3b82f6;">${blueBlocks}</span>` +
    `<span style="color:#9ca3af;">${grayBlocks}</span>` +
    ` ${Math.round(pct)}%`
  );
}

function buildTooltip(usage: UsageResponse): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = true;

  const fiveHr = usage.five_hour;
  const sevenDay = usage.seven_day;

  md.appendMarkdown(
    usage.planName
      ? `**Claude Code Usage** (${usage.planName})\n\n`
      : `**Claude Code Usage**\n\n`
  );

  md.appendMarkdown(`**Session** (5-hour window)\n\n`);
  md.appendMarkdown(progressBarHtml(fiveHr.utilization) + "\n\n");
  md.appendMarkdown(`Resets in ${formatTimeUntil(fiveHr.resets_at)}\n\n`);

  md.appendMarkdown(`---\n\n`);

  md.appendMarkdown(`**Weekly** (7-day window)\n\n`);
  md.appendMarkdown(progressBarHtml(sevenDay.utilization) + "\n\n");
  md.appendMarkdown(`Resets in ${formatTimeUntil(sevenDay.resets_at)}\n\n`);

  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(`[$(sync) Refresh](command:claude-usage.silentRefresh)\n\n`);

  return md;
}

// --- QuickPick (click display) ---

function progressBarText(percent: number): string {
  const pct = Math.min(100, Math.max(0, percent));
  const filled = Math.round(pct / 5);
  const empty = 20 - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty) + ` ${Math.round(pct)}%`;
}

function showUsageQuickPick(usage: UsageResponse): void {
  const fiveHr = usage.five_hour;
  const sevenDay = usage.seven_day;

  const items: vscode.QuickPickItem[] = [
    {
      label: `$(clock) Session (5-hour window)`,
      detail: `    ${progressBarText(fiveHr.utilization)}    Resets in ${formatTimeUntil(fiveHr.resets_at)}`,
      alwaysShow: true,
    },
    {
      label: `$(calendar) Weekly (7-day window)`,
      detail: `    ${progressBarText(sevenDay.utilization)}    Resets in ${formatTimeUntil(sevenDay.resets_at)}`,
      alwaysShow: true,
    },
    { kind: vscode.QuickPickItemKind.Separator, label: "" },
    {
      label: `$(sync) Refresh`,
      alwaysShow: true,
    },
  ];

  const qp = vscode.window.createQuickPick();
  qp.title = usage.planName
    ? `Claude Code Usage (${usage.planName})`
    : "Claude Code Usage";
  qp.items = items;
  qp.placeholder = "Usage overview";
  qp.canSelectMany = false;

  qp.onDidAccept(() => {
    const selected = qp.selectedItems[0];
    if (selected?.label.includes("Refresh")) {
      qp.dispose();
      updateUsage().then(() => {
        if (lastUsage) {
          showUsageQuickPick(lastUsage);
        }
      });
    } else {
      qp.dispose();
    }
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
}

// --- Status Bar ---

let statusBarItem: vscode.StatusBarItem;
let refreshInterval: ReturnType<typeof setInterval> | undefined;
let lastUsage: UsageResponse | undefined;

function updateStatusBarAppearance(
  usage: UsageResponse
): void {
  const fiveHrPct = Math.round(usage.five_hour.utilization);
  const sevenDayPct = Math.round(usage.seven_day.utilization);
  const maxPct = Math.max(fiveHrPct, sevenDayPct);

  let icon: string;
  if (maxPct >= 90) {
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground"
    );
    icon = "$(warning)";
  } else if (maxPct >= 70) {
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
    icon = "$(alert)";
  } else {
    statusBarItem.backgroundColor = undefined;
    icon = "$(pulse)";
  }

  statusBarItem.text = `${icon} Claude: ${fiveHrPct}% | ${sevenDayPct}%`;
  statusBarItem.tooltip = buildTooltip(usage);
}

async function updateUsage(): Promise<void> {
  const token = getOAuthToken();
  if (!token) {
    statusBarItem.text = "$(warning) Claude: No Token";
    statusBarItem.tooltip =
      "Could not read Claude Code credentials from keychain.\nMake sure Claude Code is installed and you're signed in.";
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
    return;
  }

  try {
    const usage = await fetchUsage(token);
    lastUsage = usage;
    updateStatusBarAppearance(usage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    statusBarItem.text = "$(error) Claude: Error";
    statusBarItem.tooltip = `Failed to fetch usage: ${message}`;
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground"
    );
  }
}

// --- Lifecycle ---

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "claude-usage.refresh";
  statusBarItem.text = "$(loading~spin) Claude";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const refreshCmd = vscode.commands.registerCommand(
    "claude-usage.refresh",
    () => {
      if (lastUsage) {
        showUsageQuickPick(lastUsage);
      } else {
        updateUsage().then(() => {
          if (lastUsage) {
            showUsageQuickPick(lastUsage);
          }
        });
      }
    }
  );
  context.subscriptions.push(refreshCmd);

  const silentRefreshCmd = vscode.commands.registerCommand(
    "claude-usage.silentRefresh",
    () => updateUsage()
  );
  context.subscriptions.push(silentRefreshCmd);

  // Initial fetch
  updateUsage();

  // Poll every 60 seconds
  refreshInterval = setInterval(updateUsage, 60_000);
  context.subscriptions.push({
    dispose: () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    },
  });
}

export function deactivate(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
}
