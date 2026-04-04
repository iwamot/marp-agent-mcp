/**
 * Application constants.
 *
 * Theme and version constants are shared between server and client.
 * Other constants are used by either server or client.
 */

// Application version
export const VERSION = "1.0.0";

// Theme configuration
export const THEMES = ["speee", "border", "gradient"] as const;
export type ThemeId = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeId = "speee";

// Validation constants (must match minorun365/marp-agent output_slide.py)
export const MAX_LINES_PER_SLIDE = 9;
export const MAX_DISPLAY_WIDTH_PER_LINE = 48;
export const MAX_TABLE_ROW_WIDTH = 64;

// Marp CLI timeout (2 minutes)
export const MARP_CLI_TIMEOUT_MS = 120000;

// Server tool timeout for client-side calls (2 minutes)
export const SERVER_TOOL_TIMEOUT_MS = 120000;
