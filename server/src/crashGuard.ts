/**
 * The last safety net of the process. Node ends a program on any error nobody caught, and the
 * room library goes further: by default it shuts the whole server down on one. For a game
 * server that would turn one bad request, or one bug in a code path nobody has walked yet,
 * into everybody's match ending. Here such an error is written down in plain words and the
 * server carries on; the room loops, which have their own handling, are not affected.
 *
 * The front door (http/guard.ts) keeps the known causes out. This is for the unknown ones.
 */

/** The part of `process` this needs; tests hand in a plain event emitter. */
export interface ErrorSource {
  on(event: 'unhandledRejection' | 'uncaughtException', listener: (err: unknown) => void): unknown;
  off(event: 'unhandledRejection' | 'uncaughtException', listener: (err: unknown) => void): unknown;
}

/** Errors reported in full per minute; a storm of them is summed up in one line instead. */
export const CRASH_REPORTS_PER_MINUTE = 20;

function describe(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

/**
 * Starts catching what would otherwise end the process. `report` receives one message per
 * error (always: it must not be the quiet-able room log). Returns a function that removes the
 * handlers again.
 */
export function installCrashGuard(source: ErrorSource, report: (line: string) => void, now: () => number = Date.now): () => void {
  let windowStart = 0;
  let inWindow = 0;
  const handle = (what: string) => (err: unknown): void => {
    const t = now();
    if (t - windowStart >= 60_000) {
      if (inWindow > CRASH_REPORTS_PER_MINUTE) report(`${inWindow - CRASH_REPORTS_PER_MINUTE} more internal errors in the last minute were not shown.`);
      windowStart = t;
      inWindow = 0;
    }
    inWindow++;
    if (inWindow > CRASH_REPORTS_PER_MINUTE) return;
    report(`An internal error was caught and the server keeps running (${what}). Please pass this on to the developers:\n${describe(err)}`);
  };
  const onRejection = handle('a failed step nobody was waiting for');
  const onException = handle('an error nobody caught');
  source.on('unhandledRejection', onRejection);
  source.on('uncaughtException', onException);
  return () => {
    source.off('unhandledRejection', onRejection);
    source.off('uncaughtException', onException);
  };
}
