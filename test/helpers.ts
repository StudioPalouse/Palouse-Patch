import { db } from "../src/db/client.ts";
import { member, organization, user } from "../src/db/schema.ts";
import type { Ctx, OrgRole } from "../src/core/context.ts";

let n = 0;

/** Create a user who belongs to a fresh org, and return a core context for them. */
export async function makeOrg(role: OrgRole = "owner"): Promise<Ctx> {
  n++;
  const suffix = `${Date.now()}-${n}`;
  const [u] = await db
    .insert(user)
    .values({ id: `user-${suffix}`, name: `User ${n}`, email: `user-${suffix}@example.com` })
    .returning();
  const [o] = await db
    .insert(organization)
    .values({ id: `org-${suffix}`, name: `Org ${n}`, slug: `org-${suffix}` })
    .returning();
  await db.insert(member).values({ id: `mem-${suffix}`, organizationId: o!.id, userId: u!.id, role });
  return { db, orgId: o!.id, role, actor: { type: "user", userId: u!.id, label: u!.name } };
}
