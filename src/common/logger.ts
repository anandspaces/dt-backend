export type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function writeLine(level: LogLevel, message: string, fields?: LogFields): void {
  const payload: LogFields = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(fields ?? {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export function logDebug(message: string, fields?: LogFields): void {
  writeLine("debug", message, fields);
}

export function logInfo(message: string, fields?: LogFields): void {
  writeLine("info", message, fields);
}

export function logWarn(message: string, fields?: LogFields): void {
  writeLine("warn", message, fields);
}

export function logError(message: string, fields?: LogFields): void {
  writeLine("error", message, fields);
}
