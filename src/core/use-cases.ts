import { and, asc, eq, exists, inArray } from "drizzle-orm";
import {
  artifacts,
  systems,
  teams,
  useCaseArtifacts,
  useCaseSystems,
  useCases,
} from "../db/schema.ts";
import { useCaseInput, type UseCaseInput } from "../shared/domain.ts";
import { diff, recordAudit } from "./audit.ts";
import type { Ctx, Tx } from "./context.ts";
import { notFound } from "./errors.ts";
import { assertInOrg, textSearch } from "./util.ts";

async function linksFor(db: Ctx["db"] | Tx, useCaseIds: string[]) {
  if (useCaseIds.length === 0) return { systemLinks: [], artifactLinks: [] };
  const [systemLinks, artifactLinks] = await Promise.all([
    db
      .select({ useCaseId: useCaseSystems.useCaseId, id: systems.id, name: systems.name })
      .from(useCaseSystems)
      .innerJoin(systems, eq(systems.id, useCaseSystems.systemId))
      .where(inArray(useCaseSystems.useCaseId, useCaseIds))
      .orderBy(asc(systems.name)),
    db
      .select({
        useCaseId: useCaseArtifacts.useCaseId,
        id: artifacts.id,
        name: artifacts.name,
        type: artifacts.type,
      })
      .from(useCaseArtifacts)
      .innerJoin(artifacts, eq(artifacts.id, useCaseArtifacts.artifactId))
      .where(inArray(useCaseArtifacts.useCaseId, useCaseIds))
      .orderBy(asc(artifacts.name)),
  ]);
  return { systemLinks, artifactLinks };
}

export async function listUseCases(
  ctx: Ctx,
  opts: { q?: string; status?: string; teamId?: string; systemId?: string } = {},
) {
  const rows = await ctx.db
    .select({ useCase: useCases, teamName: teams.name })
    .from(useCases)
    .leftJoin(teams, eq(teams.id, useCases.teamId))
    .where(
      and(
        eq(useCases.organizationId, ctx.orgId),
        opts.status ? eq(useCases.status, opts.status) : undefined,
        opts.teamId ? eq(useCases.teamId, opts.teamId) : undefined,
        opts.systemId
          ? exists(
              ctx.db
                .select()
                .from(useCaseSystems)
                .where(
                  and(eq(useCaseSystems.useCaseId, useCases.id), eq(useCaseSystems.systemId, opts.systemId)),
                ),
            )
          : undefined,
        textSearch(opts.q, useCases.title, useCases.description, useCases.businessValue),
      ),
    )
    .orderBy(asc(useCases.title));
  const { systemLinks, artifactLinks } = await linksFor(
    ctx.db,
    rows.map((r) => r.useCase.id),
  );
  return rows.map((r) => ({
    ...r.useCase,
    teamName: r.teamName,
    systems: systemLinks.filter((s) => s.useCaseId === r.useCase.id).map(({ useCaseId, ...s }) => s),
    artifacts: artifactLinks.filter((a) => a.useCaseId === r.useCase.id).map(({ useCaseId, ...a }) => a),
  }));
}

export async function getUseCase(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select({ useCase: useCases, teamName: teams.name })
    .from(useCases)
    .leftJoin(teams, eq(teams.id, useCases.teamId))
    .where(and(eq(useCases.id, id), eq(useCases.organizationId, ctx.orgId)));
  if (!row) throw notFound("Use case");
  const { systemLinks, artifactLinks } = await linksFor(ctx.db, [id]);
  return {
    ...row.useCase,
    teamName: row.teamName,
    systems: systemLinks.map(({ useCaseId, ...s }) => s),
    artifacts: artifactLinks.map(({ useCaseId, ...a }) => a),
  };
}

async function setLinks(tx: Tx, useCaseId: string, systemIds: string[], artifactIds: string[]) {
  await tx.delete(useCaseSystems).where(eq(useCaseSystems.useCaseId, useCaseId));
  await tx.delete(useCaseArtifacts).where(eq(useCaseArtifacts.useCaseId, useCaseId));
  const sIds = [...new Set(systemIds)];
  const aIds = [...new Set(artifactIds)];
  if (sIds.length) await tx.insert(useCaseSystems).values(sIds.map((systemId) => ({ useCaseId, systemId })));
  if (aIds.length)
    await tx.insert(useCaseArtifacts).values(aIds.map((artifactId) => ({ useCaseId, artifactId })));
}

export async function createUseCase(ctx: Ctx, input: UseCaseInput) {
  const { systemIds, artifactIds, ...data } = useCaseInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    await assertInOrg(tx, teams, ctx.orgId, [data.teamId], "team");
    await assertInOrg(tx, systems, ctx.orgId, systemIds, "system");
    await assertInOrg(tx, artifacts, ctx.orgId, artifactIds, "artifact");
    const [row] = await tx.insert(useCases).values({ ...data, organizationId: ctx.orgId }).returning();
    await setLinks(tx, row!.id, systemIds, artifactIds);
    await recordAudit(tx, ctx, {
      action: "create",
      entityType: "use_case",
      entityId: row!.id,
      summary: `Created use case "${row!.title}"`,
    });
    return row!;
  });
}

export async function updateUseCase(ctx: Ctx, id: string, input: UseCaseInput) {
  const { systemIds, artifactIds, ...data } = useCaseInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const before = await tx.query.useCases.findFirst({
      where: and(eq(useCases.id, id), eq(useCases.organizationId, ctx.orgId)),
    });
    if (!before) throw notFound("Use case");
    await assertInOrg(tx, teams, ctx.orgId, [data.teamId], "team");
    await assertInOrg(tx, systems, ctx.orgId, systemIds, "system");
    await assertInOrg(tx, artifacts, ctx.orgId, artifactIds, "artifact");
    const prior = await linksFor(tx, [id]);
    const [row] = await tx.update(useCases).set(data).where(eq(useCases.id, id)).returning();
    await setLinks(tx, id, systemIds, artifactIds);
    const changes: Record<string, unknown> = diff(before, row!);
    const sorted = (ids: string[]) => [...new Set(ids)].sort();
    const beforeSystems = sorted(prior.systemLinks.map((s) => s.id));
    const beforeArtifacts = sorted(prior.artifactLinks.map((a) => a.id));
    if (JSON.stringify(beforeSystems) !== JSON.stringify(sorted(systemIds)))
      changes.systemIds = { from: beforeSystems, to: sorted(systemIds) };
    if (JSON.stringify(beforeArtifacts) !== JSON.stringify(sorted(artifactIds)))
      changes.artifactIds = { from: beforeArtifacts, to: sorted(artifactIds) };
    await recordAudit(tx, ctx, {
      action: "update",
      entityType: "use_case",
      entityId: id,
      summary: `Updated use case "${row!.title}"`,
      changes,
    });
    return row!;
  });
}

export async function deleteUseCase(ctx: Ctx, id: string) {
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(useCases)
      .where(and(eq(useCases.id, id), eq(useCases.organizationId, ctx.orgId)))
      .returning();
    if (!row) throw notFound("Use case");
    await recordAudit(tx, ctx, {
      action: "delete",
      entityType: "use_case",
      entityId: id,
      summary: `Deleted use case "${row.title}"`,
    });
  });
}
