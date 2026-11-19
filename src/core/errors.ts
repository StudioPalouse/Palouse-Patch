export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} not found`);
export const forbidden = (message = "You do not have permission to do that") =>
  new AppError(403, "forbidden", message);
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);

type PgError = { code?: string; constraint_name?: string; cause?: unknown };

function pgError(err: unknown): PgError | undefined {
  let e = err as PgError | undefined;
  // drizzle wraps driver errors; walk the cause chain to find the pg code
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    e = e.cause as PgError | undefined;
  }
  return undefined;
}

/** Translate common Postgres constraint errors into friendly API errors. */
export function mapDbError(err: unknown, messages: { unique?: string; foreignKey?: string } = {}): never {
  const pg = pgError(err);
  if (pg?.code === "23505") throw conflict(messages.unique ?? "That already exists");
  if (pg?.code === "23503") throw conflict(messages.foreignKey ?? "This record is still referenced elsewhere");
  throw err;
}
