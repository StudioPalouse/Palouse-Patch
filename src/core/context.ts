import type { DB } from "../db/client.ts";
import { forbidden } from "./errors.ts";

export type OrgRole = "owner" | "admin" | "member";

export type Actor = {
  /** `oauth`: an MCP client the user connected by signing in. */
  type: "user" | "token" | "oauth";
  userId: string;
  /** Human readable, e.g. "Jane Doe", "Jane Doe (token: CI sync)" or "Jane Doe (via Claude)". */
  label: string;
};

/** Everything a core service needs to act on behalf of someone in one org. */
export type Ctx = {
  db: DB;
  orgId: string;
  role: OrgRole;
  actor: Actor;
  /** Set for read-only API tokens and OAuth grants; `db` then refuses every write. */
  readOnly?: boolean;
};

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const WRITES = new Set<PropertyKey>(["insert", "update", "delete", "execute"]);
export const READ_ONLY_MESSAGE = "This token is read-only. Create a token with read and write access to make changes.";
export const OAUTH_READ_ONLY_MESSAGE = "This connection is read-only. Reconnect and allow changes (the patch:write scope) to make changes.";

/**
 * Wrap a database handle so every write throws 403, inside transactions too.
 * Core services do all their writes through `ctx.db`, so giving a read-only
 * caller this handle enforces the scope for REST, MCP and anything added later
 * without a check in each service.
 */
export function readOnlyDb<T extends object>(db: T, message = READ_ONLY_MESSAGE): T {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (WRITES.has(prop)) {
        return () => {
          throw forbidden(message);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (prop === "transaction" && typeof value === "function") {
        return (fn: (tx: unknown) => unknown, ...rest: unknown[]) =>
          value.call(target, (tx: object) => fn(readOnlyDb(tx, message)), ...rest);
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
