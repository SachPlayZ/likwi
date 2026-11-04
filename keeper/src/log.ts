// One-line JSON logs. Bigints are printed as strings.

export type Level = "debug" | "info" | "warn" | "error";
export type Logger = (level: Level, msg: string, fields?: Record<string, unknown>) => void;

export const jsonReplacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

export function jsonLogger(write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  return (level, msg, fields = {}) =>
    write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }, jsonReplacer));
}

/** viem errors carry a readable `shortMessage`; prefer it. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return (e as Error & { shortMessage?: string }).shortMessage ?? e.message;
  return String(e);
}
