/** Minimal logger port used by portable plane code. */
export interface ControlLogger {
  info(obj: Record<string, unknown>, msg: string): void
  warn(obj: Record<string, unknown>, msg: string): void
  error(obj: Record<string, unknown>, msg: string): void
}

/** Default for callers that do not wire a logger (tests, CLI). */
export const noopControlLogger: ControlLogger = {
  info() {},
  warn() {},
  error() {},
}
