/**
 * Open `<dir>/logs/daemon.log` and tee every `console.*` call to it (synchronous writes, 5 MB
 * rotation to `daemon.log.1`). Idempotent. Call as the FIRST thing at startup, passing the app's
 * config dir (e.g. `REPOYETI_HOME` else `~/.repoyeti`). Returns the log-file path, or `null` if
 * file logging could not be set up (the console then behaves exactly as before). Never throws.
 */
export function initFileLogging(dir: string): string | null;

/** The current log-file path, or `null` if file logging isn't active. */
export function logFilePath(): string | null;

/** Undo the console patch and close the file. For tests; the daemon never calls this. */
export function restoreFileLogging(): void;
