import { describe, expect, it } from "vitest";
import { getPerson, linkMemberToPerson, listPeople, createPerson } from "../src/core/people.ts";
import { addSystemOwner, createSystem, getSystem } from "../src/core/systems.ts";
import { db } from "../src/db/client.ts";
import { invitation, member, user } from "../src/db/schema.ts";
import { makeOrg } from "./helpers.ts";

describe("people who haven't joined Patch", () => {
  it("can own systems before they join, and are linked when they do", async () => {
    const owner = await makeOrg();
    const dana = await createPerson(owner, { name: "Dana Ortiz", email: "Dana@Example.com" });
    const crm = await createSystem(owner, { name: "CRM" });
    await addSystemOwner(owner, crm.id, { personId: dana.id, role: "business" });

    expect((await getPerson(owner, dana.id)).access).toBe("none");
    expect((await getSystem(owner, crm.id)).owners[0]).toMatchObject({ name: "Dana Ortiz", access: "none" });

    await db.insert(invitation).values({
      id: `inv-${dana.id}`,
      organizationId: owner.orgId,
      email: "dana@example.com",
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: owner.actor.userId,
    });
    expect((await getPerson(owner, dana.id)).access).toBe("invited");

    // Dana accepts: same email (different case) links to the existing person.
    const userId = `dana-${dana.id}`;
    await db.insert(user).values({ id: userId, name: "Dana O.", email: "dana@EXAMPLE.com" });
    await db.insert(member).values({ id: `m-${userId}`, organizationId: owner.orgId, userId, role: "member" });
    expect(await linkMemberToPerson(db, owner.orgId, { id: userId, name: "Dana O.", email: "dana@EXAMPLE.com" })).toBe(dana.id);
    expect(await linkMemberToPerson(db, owner.orgId, { id: userId, name: "Dana O.", email: "dana@EXAMPLE.com" })).toBe(dana.id);

    const after = await getPerson(owner, dana.id);
    expect(after).toMatchObject({ access: "member", userId, name: "Dana Ortiz" });
    expect(after.systems.map((s) => s.name)).toEqual(["CRM"]);
    expect((await listPeople(owner, { q: "dana" })).length).toBe(1);
  });

  it("adds a new member to the directory when nobody matches", async () => {
    const owner = await makeOrg();
    const id = await linkMemberToPerson(db, owner.orgId, { id: owner.actor.userId, name: "Owner", email: `${owner.actor.userId}@example.com` });
    const p = await getPerson(owner, id!);
    expect(p).toMatchObject({ access: "member", userId: owner.actor.userId });
    const other = await makeOrg();
    await expect(getPerson(other, id!)).rejects.toMatchObject({ status: 404 });
  });
});
