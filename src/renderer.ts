import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DisplayMode, type TokenSpeedConfig } from "./config-types";
import { STATUS_KEY } from "./constants";
import { TokenSpeedEngine } from "./engine";
import { createInlineFooter, readAutoCompact } from "./footer";
import { settings } from "./settings";
import { Validator } from "./validation";

/**
 * Renderer for the token-speed meter.
 *
 * Two render modes (config `renderMode`):
 * - `status` (default): updates a status-bar entry via `ctx.ui.setStatus`
 * - `inline`: replaces the footer with a faithful copy of pi's built-in
 *   footer that appends the TPS meter to the stats line, right after the
 *   context usage block.
 */
export class Renderer {
  private ctx: ExtensionContext | null = null;
  private tui: { requestRender(force?: boolean): void } | null = null;
  private autoCompact = true;

  /**
   * Creates a new Renderer bound to an engine.
   */
  constructor(private readonly engine: TokenSpeedEngine) {}

  /**
   * Applies a custom hex color using 24-bit truecolor ANSI escape codes.
   *
   * @param text The text to colorize
   * @param hex The hex color string, e.g. "#abcdef"
   * @returns The colored text, or the original text if hex is invalid.
   */
  private colorHex(text: string, hex: string): string {
    if (!Validator.isValidHex(hex)) return text;

    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
  }

  /**
   * Maps TPS value to a hex color string, or "" for no color.
   *
   * @param config The resolved configuration
   * @param tps The TPS value to colorize
   * @returns The hex color string, or empty string if no color should be applied.
   */
  private getColor(config: TokenSpeedConfig, tps: number | null): string {
    if (tps == null) return "";

    if (tps >= config.tpsBlazing) return config.colorBlazing;
    if (tps >= config.tpsFast) return config.colorFast;
    if (tps >= config.tpsMedium) return config.colorMedium;
    if (tps >= config.tpsSlow) return config.colorSlow;

    return "";
  }

  /**
   * Formats the stats portion: "<x> tok in <y>s".
   *
   * @param tokenCount The number of tokens
   * @param elapsedSeconds The elapsed time in seconds
   * @returns The formatted stats string.
   */
  private formatStats(tokenCount: number, elapsedSeconds: number): string {
    if (elapsedSeconds <= 0) return `${tokenCount} tok`;
    return `${tokenCount} tok in ${elapsedSeconds.toFixed(1)}s`;
  }

  /**
   * Builds a suffix for the status bar after the TPS measurement.
   *
   * @param display Display mode to check against
   * @returns The suffix to append
   */
  private buildSuffix(display: DisplayMode): string {
    const { ttft, tokenCount: tokens, elapsedSeconds: elapsed } = this.engine;

    switch (display) {
      case "tps":
        return `\u200b`;
      case "ttft":
        return ` (TTFT: ${ttft} ms)\u200b`;
      case "stats":
        return ` (${this.formatStats(tokens, elapsed)})\u200b`;
      case "full":
        return ` (${this.formatStats(tokens, elapsed)} · TTFT: ${ttft} ms)\u200b`;
    }
  }

  /**
   * Builds the compact TPS segment shown inline in the footer's stats line.
   * Hidden before the first stream so the stats line stays clean.
   *
   * @returns The colored segment (with a leading space), or "" to hide it.
   */
  private buildInlineSegment(): string {
    const theme = this.ctx?.ui.theme;
    if (!theme) return "";

    const { tps } = this.engine;
    const hasData =
      tps > 0 || this.engine.isStreaming || this.engine.tokenCount > 0;
    if (!hasData) return "";

    const measurement = tps > 0 ? `${tps.toFixed(1)} tok/s` : "-- tok/s";
    const color = this.getColor(settings.getConfig(), tps);
    const displayValue = this.colorHex(measurement, color);

    return ` ${theme.fg("dim", "⚡")} ${displayValue}`;
  }

  /**
   * Renders the first-run placeholder in the status bar.
   *
   * @param ctx The context used by Pi.
   */
  initialize(ctx: ExtensionContext): void {
    this.ctx = ctx;
    this.autoCompact = readAutoCompact(ctx.cwd);
    this.applyMode(ctx);
  }

  /**
   * Applies the configured render mode:
   * - `status`: restores the built-in footer and drives the status bar entry.
   * - `inline`: installs the footer copy with the TPS segment in the stats line.
   *
   * @param ctx The context used by Pi.
   */
  applyMode(ctx: ExtensionContext): void {
    this.ctx = ctx;
    this.autoCompact = readAutoCompact(ctx.cwd);

    const config = settings.getConfig();

    if (config.renderMode === "inline") {
      // Never show the separate status entry while inline is active.
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.setFooter((tui, theme, footerData) => {
        this.tui = tui as { requestRender(force?: boolean): void };
        return createInlineFooter({
          theme: theme as unknown as Parameters<typeof createInlineFooter>[0]["theme"],
          footerData,
          engine: this.engine,
          getCtx: () => this.ctx,
          getTpsSegment: () => this.buildInlineSegment(),
          autoCompact: this.autoCompact,
        });
      });
      this.tui?.requestRender();
      return;
    }

    // Status mode: restore the built-in footer and render via status entry.
    ctx.ui.setFooter(undefined);
    this.update(ctx);
  }

  /**
   * Updates the meter with the given context.
   *
   * @param ctx The context used by Pi.
   */
  update(ctx: ExtensionContext): void {
    this.ctx = ctx;

    if (settings.getConfig().renderMode === "inline") {
      // The footer component reads the engine on every frame.
      this.tui?.requestRender();
      return;
    }

    const config = settings.getConfig();
    const theme = ctx.ui.theme;

    // Render TPS first
    const { tps } = this.engine;
    const value = tps?.toFixed(1);
    const measurement = value ? `${value} tok/s` : "--";

    const color = this.getColor(config, tps);
    const displayValue = this.colorHex(measurement, color);

    // Build the suffix based on display mode
    const suffix = this.buildSuffix(config.display);
    const text = `${theme.fg("dim", "⚡ TPS:")} ${displayValue}${suffix}`;

    ctx.ui.setStatus(STATUS_KEY, text);
  }
}
