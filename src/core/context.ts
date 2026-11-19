import type { DB } from "../db/client.ts";

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
};

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
