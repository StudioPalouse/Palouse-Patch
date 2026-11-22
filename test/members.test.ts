import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { listAudit } from "../src/core/audit.ts";
import { sendMemberPasswordReset } from "../src/core/members.ts";
import { db } from "../src/db/client.ts";
import { member, user } from "../src/db/schema.ts";
import { makeOrg } from "./helpers.ts";

let n = 0;
async function addMember(orgId: string, role = "member") {
  const id = `member-user-${Date.now()}-${++n}`;
  await db.insert(user).values({ id, name: `Member ${n}`, email: `${id}@example.com` });
  await db.insert(member).values({ id: `m-${id}`, organizationId: orgId, userId: id, role });
  return id;
}

describe("admin-triggered password reset", () => {
  it("lets an admin send a reset to a member of their org, and audits it", async () => {
    const admin = await makeOrg("admin");
    const target = await addMember(admin.orgId);
    const send = vi.fn(async () => {});

    const result = await sendMemberPasswordReset(admin, target, send);

    expect(send).toHaveBeenCalledWith(`${target}@example.com`);
    expect(result.email).toBe(`${target}@example.com`);
    const [event] = await listAudit(admin, { entityType: "member", entityId: target });
    expect(event?.summary).toMatch(/password reset/);
  });

  it("refuses plain members", async () => {
    const owner = await makeOrg("owner");
    const memberCtx = { ...owner, role: "member" as const };
    const target = await addMember(owner.orgId);
    const send = vi.fn(async () => {});
    await expect(sendMemberPasswordReset(memberCtx, target, send)).rejects.toMatchObject({ status: 403 });
    expect(send).not.toHaveBeenCalled();
  });

  it("cannot reach users outside the org", async () => {
    const a = await makeOrg("owner");
    const b = await makeOrg("owner");
    const outsider = await addMember(b.orgId);
    const send = vi.fn(async () => {});
    await expect(sendMemberPasswordReset(a, outsider, send)).rejects.toMatchObject({ status: 404 });
    expect(send).not.toHaveBeenCalled();
    await db.delete(member).where(eq(member.userId, outsider));
  });
});
