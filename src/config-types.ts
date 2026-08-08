/**
 * Display mode — what information to show in the status bar.
 */
export type DisplayMode = "tps" | "ttft" | "stats" | "full";

/**
 * Where to render the TPS meter:
 * - `status`: separate status line in the footer (default, current behavior)
 * - `inline`: appended to pi's built-in stats line (e.g. after `8.7%/1.0M (auto)`)
 */
export type RenderMode = "status" | "inline";

/**
 * Count strategy — how to count tokens during streaming.
 */
export type CountStrategy = "estimate" | "direct";

/**
 * Behavior for TPS after streaming ends.
 */
export type EndTpsBehavior = "average" | "last";

/**
 * Configuration for the token-speed extension.
 * All fields can be overridden via ~/.pi/agent/settings.json under the "tokenSpeed" key.
 */
export interface TokenSpeedConfig {
  display: DisplayMode;
  renderMode: RenderMode;
  tpsSlow: number;
  tpsMedium: number;
  tpsFast: number;
  tpsBlazing: number;
  colorSlow: string;
  colorMedium: string;
  colorFast: string;
  colorBlazing: string;
  slidingWindow: number;
  useProviderTokens: boolean;
  countStrategy: CountStrategy;
  endTpsBehavior: EndTpsBehavior;
}
