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

const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

let cachedToken: string | null = null;
let cachedRefreshToken: string | null = null;
let cachedPlanName: string | undefined;
let cachedRawCredentials: any = null;

function formatPlanName(raw: string | undefined): string | undefined {
  if (!raw) { return undefined; }
  // e.g. "default_claude_max_5x" → "Max 5x", "default_claude_pro" → "Pro"
  const cleaned = raw.replace(/^default_claude_/i, "");
  return cleaned
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace(/[^\w\s]/g, ""); // strip any non-word chars before use in trusted MarkdownString
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
    cachedRawCredentials = parsed;
    const oauth = parsed?.claudeAiOauth;
    cachedToken = oauth?.accessToken ?? null;
    cachedRefreshToken = oauth?.refreshToken ?? null;
    cachedPlanName = formatPlanName(oauth?.rateLimitTier ?? oauth?.subscriptionType);
    return cachedToken;
  } catch {
    return null;
  }
}

function clearCachedToken(): void {
  cachedToken = null;
  cachedRefreshToken = null;
  cachedPlanName = undefined;
  cachedRawCredentials = null;
}

// --- Token Refresh ---

interface TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

function refreshOAuthToken(refreshToken: string): Promise<TokenRefreshResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
    });

    const req = https.request(
      {
        hostname: "console.anthropic.com",
        path: "/v1/oauth/token",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": `vscode-claude-usage/${vscode.extensions.getExtension("smanettu.vscode-claude-usage")?.packageJSON?.version ?? "0.0.0"}`,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data);
              if (!parsed.access_token) {
                reject(new Error("No access_token in refresh response"));
                return;
              }
              resolve(parsed as TokenRefreshResponse);
            } catch {
              reject(new Error("Invalid JSON from token refresh"));
            }
          } else {
            reject(new Error(`Token refresh failed: ${res.statusCode} ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error("Token refresh timed out"));
    });
    req.write(body);
    req.end();
  });
}

function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

function writeCredentialsToKeychain(newAccess: string, newRefresh: string): void {
  if (!cachedRawCredentials) { return; }
  const updated = { ...cachedRawCredentials };
  if (updated.claudeAiOauth) {
    updated.claudeAiOauth = {
      ...updated.claudeAiOauth,
      accessToken: newAccess,
      refreshToken: newRefresh,
    };
  }
  const json = JSON.stringify(updated);
  // -U: atomic update — no delete/re-add window where credentials are missing
  execSync(
    `security add-generic-password -U -s "Claude Code-credentials" -a "credentials" -w ${escapeShellArg(json)}`,
    { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
  );
  cachedToken = newAccess;
  cachedRefreshToken = newRefresh;
  cachedRawCredentials = updated;
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
          "User-Agent": `vscode-claude-usage/${vscode.extensions.getExtension("smanettu.vscode-claude-usage")?.packageJSON?.version ?? "0.0.0"}`,
          Accept: "application/json",
        },
      },
      (res) => {
        let data = "";
        const MAX_BODY = 10_240; // 10 KB — far above any valid response
        res.on("data", (chunk: Buffer) => {
          data += chunk;
          if (data.length > MAX_BODY) {
            req.destroy(new Error("Response too large"));
          }
        });
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
          } else if (res.statusCode === 429) {
            const retryAfter = res.headers["retry-after"];
            const err = new Error("Rate limited by API");
            (err as any).retryAfterSec = retryAfter ? parseInt(retryAfter, 10) : undefined;
            (err as any).isRateLimit = true;
            reject(err);
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
let consecutiveErrors = 0;
let lastFetchTime = 0;
const BASE_POLL_MS = 60_000;
const FOCUS_DEBOUNCE_MS = 30_000;
const MAX_POLL_MS = 10 * 60_000; // 10 minutes

function reschedule(ms: number): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
  refreshInterval = setInterval(updateUsage, ms);
}

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
  // Skip polling in unfocused windows to avoid multiplied requests
  if (!vscode.window.state.focused) {
    return;
  }

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

  lastFetchTime = Date.now();

  try {
    const usage = await fetchUsage(token);
    lastUsage = usage;
    consecutiveErrors = 0;
    reschedule(BASE_POLL_MS);
    updateStatusBarAppearance(usage);
  } catch (err: any) {
    consecutiveErrors++;
    const message = err instanceof Error ? err.message : String(err);

    if (err.isRateLimit && cachedRefreshToken) {
      // Rate limits are per-access-token — refresh to get a fresh quota
      try {
        const refreshed = await refreshOAuthToken(cachedRefreshToken);
        writeCredentialsToKeychain(refreshed.access_token, refreshed.refresh_token);
        // Retry immediately with the new token
        const usage = await fetchUsage(refreshed.access_token);
        lastUsage = usage;
        consecutiveErrors = 0;
        reschedule(BASE_POLL_MS);
        updateStatusBarAppearance(usage);
        return;
      } catch {
        // Refresh failed — fall through to backoff
      }
    }

    if (err.isRateLimit) {
      clearCachedToken();
      const backoffSec = Math.max(60, err.retryAfterSec || Math.min(60 * 2 ** consecutiveErrors, MAX_POLL_MS / 1000));
      reschedule(backoffSec * 1000);
      statusBarItem.text = "$(warning) Claude: Rate Limited";
      statusBarItem.tooltip = cachedRefreshToken
        ? `Rate limited — token refresh failed, retrying in ${Math.round(backoffSec / 60)}m`
        : `Rate limited — no refresh token, retrying in ${Math.round(backoffSec / 60)}m`;
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    } else {
      // Backoff on any error to avoid hammering a broken endpoint
      const backoffMs = Math.min(BASE_POLL_MS * 2 ** consecutiveErrors, MAX_POLL_MS);
      reschedule(backoffMs);
      statusBarItem.text = "$(error) Claude: Error";
      statusBarItem.tooltip = `Failed to fetch usage: ${message}\nRetrying in ${Math.round(backoffMs / 60_000)}m`;
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
    }
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
      if (consecutiveErrors > 0 || !lastUsage) {
        // Force retry when in error/rate-limited state or no data yet
        consecutiveErrors = 0;
        statusBarItem.text = "$(loading~spin) Claude";
        statusBarItem.backgroundColor = undefined;
        statusBarItem.tooltip = "Retrying…";
        updateUsage().then(() => {
          if (lastUsage) {
            showUsageQuickPick(lastUsage);
          }
        });
      } else {
        showUsageQuickPick(lastUsage);
      }
    }
  );
  context.subscriptions.push(refreshCmd);

  const silentRefreshCmd = vscode.commands.registerCommand(
    "claude-usage.silentRefresh",
    () => updateUsage()
  );
  context.subscriptions.push(silentRefreshCmd);

  // Refresh on focus, but debounce to avoid excessive requests
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused && Date.now() - lastFetchTime >= FOCUS_DEBOUNCE_MS) {
        updateUsage();
      }
    })
  );

  // Initial fetch — updateUsage() will schedule the recurring poll via reschedule()
  updateUsage();
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
