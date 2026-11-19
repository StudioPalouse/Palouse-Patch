import { and, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "./context.ts";
import { badRequest } from "./errors.ts";

/** Escape LIKE wildcards in user input. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function textSearch(q: string | undefined, ...columns: PgColumn[]): SQL | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  return or(...columns.map((c) => ilike(c, likePattern(term))));
}

type OrgTable = PgTable & { id: PgColumn; organizationId: PgColumn };

/**
 * Ensure referenced ids belong to the caller's org. Without this a client could
 * link records across tenants by guessing ids.
 */
export async function assertInOrg(
  tx: Tx,
  table: OrgTable,
  orgId: string,
  ids: (string | null | undefined)[],
  what: string,
) {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (wanted.length === 0) return;
  const found = await tx
    .select({ id: table.id })
    .from(table as PgTable)
    .where(and(eq(table.organizationId, orgId), inArray(table.id, wanted)));
  if (found.length !== wanted.length) throw badRequest(`Unknown ${what}`);
}
