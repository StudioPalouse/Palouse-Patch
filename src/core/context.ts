import type { DB } from "../db/client.ts";
import { forbidden } from "./errors.ts";

export type OrgRole = "owner" | "admin" | "member";

export type Actor = {
  type: "user" | "token";
  userId: string;
  /** Human readable, e.g. "Jane Doe" or "Jane Doe (token: CI sync)". */
  label: string;
};

/** Everything a core service needs to act on behalf of someone in one org. */
export type Ctx = {
  db: DB;
  orgId: string;
  role: OrgRole;
  actor: Actor;
  /** Set for read-only API tokens; `db` then refuses every write. */
  readOnly?: boolean;
};

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const WRITES = new Set<PropertyKey>(["insert", "update", "delete", "execute"]);
export const READ_ONLY_MESSAGE = "This token is read-only. Create a token with read and write access to make changes.";

/**
 * Wrap a database handle so every write throws 403, inside transactions too.
 * Core services do all their writes through `ctx.db`, so giving a read-only
 * caller this handle enforces the scope for REST, MCP and anything added later
 * without a check in each service.
 */
export function readOnlyDb<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (WRITES.has(prop)) {
        return () => {
          throw forbidden(READ_ONLY_MESSAGE);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (prop === "transaction" && typeof value === "function") {
        return (fn: (tx: unknown) => unknown, ...rest: unknown[]) =>
          value.call(target, (tx: object) => fn(readOnlyDb(tx)), ...rest);
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
