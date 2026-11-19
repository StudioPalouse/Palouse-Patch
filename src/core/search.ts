import { and, asc, eq } from "drizzle-orm";
import { artifacts, people, systems, useCases } from "../db/schema.ts";
import type { Ctx } from "./context.ts";
import { textSearch } from "./util.ts";

export type SearchHit = {
  type: "system" | "use_case" | "artifact" | "person";
  id: string;
  title: string;
  subtitle: string | null;
};

/**
 * Simple cross-entity search. Uses ILIKE today; swap for Postgres full text
 * (and pgvector for semantic search) once catalogs get large.
 */
export async function search(ctx: Ctx, q: string, limit = 10): Promise<SearchHit[]> {
  if (!q.trim()) return [];
  const [s, u, a, p] = await Promise.all([
    ctx.db
      .select({ id: systems.id, title: systems.name, subtitle: systems.vendor })
      .from(systems)
      .where(and(eq(systems.organizationId, ctx.orgId), textSearch(q, systems.name, systems.vendor, systems.category, systems.description)))
      .orderBy(asc(systems.name))
      .limit(limit),
    ctx.db
      .select({ id: useCases.id, title: useCases.title, subtitle: useCases.status })
      .from(useCases)
      .where(and(eq(useCases.organizationId, ctx.orgId), textSearch(q, useCases.title, useCases.description, useCases.businessValue)))
      .orderBy(asc(useCases.title))
      .limit(limit),
    ctx.db
      .select({ id: artifacts.id, title: artifacts.name, subtitle: systems.name })
      .from(artifacts)
      .innerJoin(systems, eq(systems.id, artifacts.systemId))
      .where(and(eq(artifacts.organizationId, ctx.orgId), textSearch(q, artifacts.name, artifacts.description, artifacts.externalId)))
      .orderBy(asc(artifacts.name))
      .limit(limit),
    ctx.db
      .select({ id: people.id, title: people.name, subtitle: people.email })
      .from(people)
      .where(and(eq(people.organizationId, ctx.orgId), textSearch(q, people.name, people.email, people.title)))
      .orderBy(asc(people.name))
      .limit(limit),
  ]);
  return [
    ...s.map((r) => ({ type: "system" as const, ...r })),
    ...u.map((r) => ({ type: "use_case" as const, ...r })),
    ...a.map((r) => ({ type: "artifact" as const, ...r })),
    ...p.map((r) => ({ type: "person" as const, ...r })),
  ];
}
