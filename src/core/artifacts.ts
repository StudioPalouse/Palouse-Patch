import { and, asc, eq } from "drizzle-orm";
import { artifacts, people, systems, useCaseArtifacts, useCases } from "../db/schema.ts";
import { artifactInput, type ArtifactInput } from "../shared/domain.ts";
import { diff, recordAudit } from "./audit.ts";
import type { Ctx } from "./context.ts";
import { notFound } from "./errors.ts";
import { assertInOrg, textSearch } from "./util.ts";

export async function listArtifacts(
  ctx: Ctx,
  opts: { q?: string; systemId?: string; ownerId?: string; type?: string; status?: string } = {},
) {
  const rows = await ctx.db
    .select({ artifact: artifacts, systemName: systems.name, ownerName: people.name })
    .from(artifacts)
    .innerJoin(systems, eq(systems.id, artifacts.systemId))
    .leftJoin(people, eq(people.id, artifacts.ownerId))
    .where(
      and(
        eq(artifacts.organizationId, ctx.orgId),
        opts.systemId ? eq(artifacts.systemId, opts.systemId) : undefined,
        opts.ownerId ? eq(artifacts.ownerId, opts.ownerId) : undefined,
        opts.type ? eq(artifacts.type, opts.type) : undefined,
        opts.status ? eq(artifacts.status, opts.status) : undefined,
        textSearch(opts.q, artifacts.name, artifacts.description, artifacts.externalId),
      ),
    )
    .orderBy(asc(artifacts.name));
  return rows.map((r) => ({ ...r.artifact, systemName: r.systemName, ownerName: r.ownerName }));
}

export async function getArtifact(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select({ artifact: artifacts, systemName: systems.name, ownerName: people.name })
    .from(artifacts)
    .innerJoin(systems, eq(systems.id, artifacts.systemId))
    .leftJoin(people, eq(people.id, artifacts.ownerId))
    .where(and(eq(artifacts.id, id), eq(artifacts.organizationId, ctx.orgId)));
  if (!row) throw notFound("Artifact");
  const linked = await ctx.db
    .select({ id: useCases.id, title: useCases.title, status: useCases.status })
    .from(useCaseArtifacts)
    .innerJoin(useCases, eq(useCases.id, useCaseArtifacts.useCaseId))
    .where(eq(useCaseArtifacts.artifactId, id))
    .orderBy(asc(useCases.title));
  return { ...row.artifact, systemName: row.systemName, ownerName: row.ownerName, useCases: linked };
}

export async function createArtifact(ctx: Ctx, input: ArtifactInput) {
  const data = artifactInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    await assertInOrg(tx, systems, ctx.orgId, [data.systemId], "system");
    await assertInOrg(tx, people, ctx.orgId, [data.ownerId], "owner");
    const [row] = await tx.insert(artifacts).values({ ...data, organizationId: ctx.orgId }).returning();
    await recordAudit(tx, ctx, {
      action: "create",
      entityType: "artifact",
      entityId: row!.id,
      summary: `Created artifact "${row!.name}"`,
    });
    return row!;
  });
}

export async function updateArtifact(ctx: Ctx, id: string, input: ArtifactInput) {
  const data = artifactInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const before = await tx.query.artifacts.findFirst({
      where: and(eq(artifacts.id, id), eq(artifacts.organizationId, ctx.orgId)),
    });
    if (!before) throw notFound("Artifact");
    await assertInOrg(tx, systems, ctx.orgId, [data.systemId], "system");
    await assertInOrg(tx, people, ctx.orgId, [data.ownerId], "owner");
    const [row] = await tx.update(artifacts).set(data).where(eq(artifacts.id, id)).returning();
    await recordAudit(tx, ctx, {
      action: "update",
      entityType: "artifact",
      entityId: id,
      summary: `Updated artifact "${row!.name}"`,
      changes: diff(before, row!),
    });
    return row!;
  });
}

export async function deleteArtifact(ctx: Ctx, id: string) {
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(artifacts)
      .where(and(eq(artifacts.id, id), eq(artifacts.organizationId, ctx.orgId)))
      .returning();
    if (!row) throw notFound("Artifact");
    await recordAudit(tx, ctx, {
      action: "delete",
      entityType: "artifact",
      entityId: id,
      summary: `Deleted artifact "${row.name}"`,
    });
  });
}
