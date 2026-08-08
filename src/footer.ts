import { isAbsolute, relative, resolve, sep, join } from "node:path";
import { readFileSync } from "node:fs";
import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TokenSpeedEngine } from "./engine";

/**
 * Structural subset of pi's Theme used by the footer renderer.
 */
interface ThemeLike {
  fg(color: string, text: string): string;
}

/**
 * Component contract satisfied by the inline footer.
 */
export interface InlineFooter {
  invalidate(): void;
  render(width: number): string[];
  dispose(): void;
}

/**
 * Dependencies for the inline footer component.
 */
export interface InlineFooterDeps {
  getCtx: () => ExtensionContext | null;
  engine: TokenSpeedEngine;
  getTpsSegment: () => string;
  autoCompact: boolean;
  theme: ThemeLike;
  footerData: ReadonlyFooterDataProvider;
}

/**
 * Format token counts for compact footer display (mirrors pi's built-in).
 */
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

/**
 * Replace the home directory with `~` (mirrors pi's built-in).
 */
function formatCwdForFooter(cwd: string, home: string | undefined): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const rel = relative(resolvedHome, resolvedCwd);
  const inside =
    rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (!inside) return cwd;
  return rel === "" ? "~" : `~${sep}${rel}`;
}

function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

/**
 * Read the auto-compact flag from global + project settings (default on).
 * Pi does not expose it on the extension context.
 */
export function readAutoCompact(cwd: string): boolean {
  try {
    const globalPath = join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".pi",
      "agent",
      "settings.json",
    );
    const projectPath = join(cwd, ".pi", "settings.json");
    const read = (p: string): Record<string, unknown> | null => {
      try {
        return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    const g = read(globalPath);
    const p = read(projectPath);
    const compaction = (p?.compaction ?? g?.compaction) as
      | { enabled?: unknown }
      | undefined;
    return compaction?.enabled !== false;
  } catch {
    return true;
  }
}

/**
 * Faithful copy of pi's built-in footer (pwd line, token stats line with
 * context usage, right-aligned model, extension statuses) with the TPS
 * segment appended to the stats line right after the context % block.
 */
export function createInlineFooter(deps: InlineFooterDeps): InlineFooter {
  return {
    invalidate() {},

    dispose() {},

    render(width: number): string[] {
      const ctx = deps.getCtx();
      if (!ctx) return [];

      const session = ctx.sessionManager;
      const theme = deps.theme;

      // Cumulative usage from ALL session entries (mirrors pi's built-in).
      const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
      let latestCacheHitRate: number | undefined;
      for (const entry of session.getBranch()) {
        if (entry.type === "message" && entry.message.role === "assistant") {
          const u = entry.message.usage;
          totals.input += u.input;
          totals.output += u.output;
          totals.cacheRead += u.cacheRead;
          totals.cacheWrite += u.cacheWrite;
          totals.cost += u.cost.total;
          const promptTokens = u.input + u.cacheRead + u.cacheWrite;
          latestCacheHitRate =
            promptTokens > 0 ? (u.cacheRead / promptTokens) * 100 : undefined;
        } else if (
          entry.type === "message" &&
          entry.message.role === "toolResult" &&
          entry.message.usage
        ) {
          const u = entry.message.usage;
          totals.input += u.input;
          totals.output += u.output;
          totals.cacheRead += u.cacheRead;
          totals.cacheWrite += u.cacheWrite;
          totals.cost += u.cost.total;
        } else if (
          (entry.type === "branch_summary" || entry.type === "compaction") &&
          entry.usage
        ) {
          const u = entry.usage;
          totals.input += u.input;
          totals.output += u.output;
          totals.cacheRead += u.cacheRead;
          totals.cacheWrite += u.cacheWrite;
          totals.cost += u.cost.total;
        }
      }

      // Line 1: pwd (+ git branch, session name)
      let pwd = formatCwdForFooter(
        session.getCwd(),
        process.env.HOME || process.env.USERPROFILE,
      );
      const branch = deps.footerData.getGitBranch();
      if (branch) pwd = `${pwd} (${branch})`;
      const sessionName = session.getSessionName();
      if (sessionName) pwd = `${pwd} • ${sessionName}`;
      const pwdLine = truncateToWidth(
        theme.fg("dim", pwd),
        width,
        theme.fg("dim", "..."),
      );

      // Line 2: token stats + context usage + TPS segment + model
      const contextUsage = ctx.getContextUsage();
      const contextWindow =
        contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
      const contextPercentValue = contextUsage?.percent ?? 0;
      const contextPercent =
        contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";
      const autoIndicator = deps.autoCompact ? " (auto)" : "";
      const contextPercentDisplay =
        contextPercent === "?"
          ? `?/${formatTokens(contextWindow)}${autoIndicator}`
          : `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
      const contextPercentStr =
        contextPercentValue > 90
          ? theme.fg("error", contextPercentDisplay)
          : contextPercentValue > 70
            ? theme.fg("warning", contextPercentDisplay)
            : contextPercentDisplay;

      const statsParts: string[] = [];
      if (totals.input) statsParts.push(`↑${formatTokens(totals.input)}`);
      if (totals.output) statsParts.push(`↓${formatTokens(totals.output)}`);
      if (totals.cacheRead) statsParts.push(`R${formatTokens(totals.cacheRead)}`);
      if (totals.cacheWrite) statsParts.push(`W${formatTokens(totals.cacheWrite)}`);
      if (
        (totals.cacheRead > 0 || totals.cacheWrite > 0) &&
        latestCacheHitRate !== undefined
      ) {
        statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
      }
      if (totals.cost) statsParts.push(`$${totals.cost.toFixed(3)}`);
      statsParts.push(contextPercentStr);

      // TPS segment right after the context % block.
      const segment = deps.getTpsSegment();
      if (segment) statsParts.push(segment);

      let statsLeft = statsParts.join(" ");

      // Right side: model name (+ thinking level, + provider when multiple)
      const modelName = ctx.model?.id || "no-model";
      let rightSideWithoutProvider = modelName;
      if (ctx.model?.reasoning) {
        const thinkingLevel = ctx.thinkingLevel || "off";
        rightSideWithoutProvider =
          thinkingLevel === "off"
            ? `${modelName} • thinking off`
            : `${modelName} • ${thinkingLevel}`;
      }
      let rightSide = rightSideWithoutProvider;
      if (deps.footerData.getAvailableProviderCount() > 1 && ctx.model) {
        rightSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
        if (visibleWidth(statsLeft) + 2 + visibleWidth(rightSide) > width) {
          rightSide = rightSideWithoutProvider;
        }
      }

      // Layout: left stats + padding + right-aligned model
      const statsLeftWidth = visibleWidth(statsLeft);
      const rightSideWidth = visibleWidth(rightSide);
      const minPadding = 2;
      let statsLine: string;
      if (statsLeftWidth + minPadding + rightSideWidth <= width) {
        const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
        statsLine = statsLeft + padding + rightSide;
      } else if (statsLeftWidth <= width) {
        const availableForRight = width - statsLeftWidth - minPadding;
        if (availableForRight > 0) {
          const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
          statsLine =
            statsLeft +
            " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(truncatedRight))) +
            truncatedRight;
        } else {
          statsLine = truncateToWidth(statsLeft, width, "...");
        }
      } else {
        statsLine = truncateToWidth(statsLeft, width, "...");
      }

      // Dim left and right separately so internal color codes (context %,
      // TPS segment) survive the wrap.
      const dimStatsLeft = theme.fg("dim", statsLeft);
      const remainder = statsLine.slice(statsLeft.length);
      const dimRemainder = theme.fg("dim", remainder);
      const lines = [pwdLine, dimStatsLeft + dimRemainder];

      // Line 3: extension statuses (pi-free quota, etc.)
      const extensionStatuses = deps.footerData.getExtensionStatuses();
      if (extensionStatuses.size > 0) {
        const sorted = Array.from(extensionStatuses.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, text]) => sanitizeStatusText(text));
        const statusLine = sorted.join(" ");
        lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
      }
      return lines;
    },
  };
}
