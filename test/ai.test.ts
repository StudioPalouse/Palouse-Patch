import { describe, expect, it } from "vitest";
import { createStage, listStages, reorderStages } from "../src/core/ai-council.ts";
import { getAiDetails, listInventory, recordUsage, saveAiProfile, setRollout, addCapability } from "../src/core/ai-inventory.ts";
import {
  commentOnRequest,
  createRequest,
  decideRequest,
  getRequest,
  listRequests,
  resubmitRequest,
  withdrawRequest,
} from "../src/core/ai-requests.ts";
import type { Ctx } from "../src/core/context.ts";
import { setNotifier } from "../src/core/notify.ts";
import { createSystem } from "../src/core/systems.ts";
import { createTeam } from "../src/core/teams.ts";
import { db } from "../src/db/client.ts";
import { member, user } from "../src/db/schema.ts";
import { assessRisk } from "../src/shared/domain.ts";
import { makeOrg } from "./helpers.ts";

let n = 0;
async function addMember(owner: Ctx, role: "member" | "admin" = "member"): Promise<Ctx> {
  const id = `ai-user-${Date.now()}-${++n}`;
  await db.insert(user).values({ id, name: `Reviewer ${n}`, email: `${id}@example.com` });
  await db.insert(member).values({ id: `m-${id}`, organizationId: owner.orgId, userId: id, role });
  return { ...owner, role, actor: { type: "user", userId: id, label: `Reviewer ${n}` } };
}

const lowRisk = { title: "Grammar helper", capability: "Suggest wording in drafts", businessCase: "Faster writing", trainsOnData: "no" as const };
const highRisk = { ...lowRisk, title: "Hiring screener", capability: "Rank candidates", peopleDecisions: true };

describe("risk tiers", () => {
  const base = { personalData: false, confidentialData: false, writeAccess: false, autonomous: false, customerFacing: false, peopleDecisions: false, trainsOnData: "no" as const };
  it("computes the tier from the yes/no answers", () => {
    expect(assessRisk(base).tier).toBe("low");
    expect(assessRisk({ ...base, customerFacing: true }).tier).toBe("medium");
    expect(assessRisk({ ...base, writeAccess: true, autonomous: true }).tier).toBe("high");
    expect(assessRisk({ ...base, personalData: true, trainsOnData: "unknown" }).tier).toBe("high");
    expect(assessRisk({ ...base, personalData: true }).tier).toBe("medium");
  });
});

describe("AI council review", () => {
  it("moves through ordered stages, honours 'all' stages, and adds the approved tool to the inventory", async () => {
    const owner = await makeOrg();
    const requester = await addMember(owner);
    const security = await addMember(owner);
    const legal1 = await addMember(owner);
    const legal2 = await addMember(owner);
    const sent: string[] = [];
    setNotifier(async (m) => void sent.push(`${m.to}: ${m.subject}`));

    await createStage(owner, { name: "Security", memberUserIds: [security.actor.userId] });
    await createStage(owner, { name: "Legal", rule: "all", memberUserIds: [legal1.actor.userId, legal2.actor.userId] });

    const req = await createRequest(requester, { ...lowRisk, expectedUsers: 40 });
    expect(sent.some((s) => s.startsWith(security.actor.userId) && s.includes("Security"))).toBe(true);

    // Only the active stage's reviewers can decide.
    await expect(decideRequest(legal1, req.id, { decision: "approve" })).rejects.toMatchObject({ status: 403 });
    await expect(decideRequest(requester, req.id, { decision: "approve" })).rejects.toMatchObject({ status: 403 });
    expect((await listRequests(security, { awaiting: true })).map((r) => r.id)).toEqual([req.id]);

    await decideRequest(security, req.id, { decision: "approve" });
    await decideRequest(legal1, req.id, { decision: "approve", conditions: "No customer data" });
    expect((await getRequest(owner, req.id)).status).toBe("in_review"); // legal2 still to approve
    await expect(decideRequest(legal1, req.id, { decision: "approve" })).rejects.toMatchObject({ status: 409 });
    const done = await decideRequest(legal2, req.id, { decision: "approve" });

    expect(done.status).toBe("approved");
    expect(done.conditions).toBe("No customer data");
    expect(sent.some((s) => s.includes("Approved: Grammar helper"))).toBe(true);
    const detail = await getAiDetails(owner, done.resultSystemId!);
    expect(detail.profile?.riskTier).toBe("low");
    expect(detail.profile?.targetUsers).toBe(40);
    expect(detail.capabilities).toMatchObject([{ name: "Suggest wording in drafts", status: "restricted", notes: "No customer data" }]);
    setNotifier(async () => {});
  });

  it("skips stages below the request's risk tier", async () => {
    const owner = await makeOrg();
    const requester = await addMember(owner);
    const reviewer = await addMember(owner);
    await createStage(owner, { name: "Triage", memberUserIds: [reviewer.actor.userId] });
    await createStage(owner, { name: "Executive", minTier: "high", memberUserIds: [reviewer.actor.userId] });

    const low = await getRequest(owner, (await createRequest(requester, lowRisk)).id);
    expect(low.steps.map((s) => s.name)).toEqual(["Triage"]);
    const high = await getRequest(owner, (await createRequest(requester, highRisk)).id);
    expect(high.riskTier).toBe("high");
    expect(high.steps.map((s) => s.name)).toEqual(["Triage", "Executive"]);
  });

  it("falls back to admin approval when no council is configured", async () => {
    const owner = await makeOrg();
    const requester = await addMember(owner);
    const req = await createRequest(requester, lowRisk);
    const detail = await getRequest(owner, req.id);
    expect(detail.steps[0]).toMatchObject({ name: "Admin approval", status: "active" });
    expect(detail.permissions.canDecide).toBe(true);
    expect((await decideRequest(owner, req.id, { decision: "approve" })).status).toBe("approved");
  });

  it("sends a request back for changes, keeps passed stages, and re-plans on resubmit", async () => {
    const owner = await makeOrg();
    const requester = await addMember(owner);
    const a = await addMember(owner);
    const b = await addMember(owner);
    await createStage(owner, { name: "First", memberUserIds: [a.actor.userId] });
    await createStage(owner, { name: "Second", memberUserIds: [b.actor.userId] });
    const req = await createRequest(requester, lowRisk);
    await decideRequest(a, req.id, { decision: "approve" });

    await expect(decideRequest(b, req.id, { decision: "request_changes" })).rejects.toThrow(); // comment required
    await decideRequest(b, req.id, { decision: "request_changes", comment: "Which data?" });
    expect((await getRequest(requester, req.id)).permissions.canEdit).toBe(true);
    await expect(decideRequest(b, req.id, { decision: "approve" })).rejects.toMatchObject({ status: 409 });
    await expect(resubmitRequest(a, req.id, lowRisk)).rejects.toMatchObject({ status: 403 });

    await resubmitRequest(requester, req.id, { ...lowRisk, dataDescription: "Public docs only" });
    const after = await getRequest(owner, req.id);
    expect(after.status).toBe("in_review");
    expect(after.steps.map((s) => [s.name, s.status])).toEqual([
      ["First", "approved"],
      ["Second", "active"],
    ]);
    await commentOnRequest(b, req.id, { comment: "Thanks" });
    await decideRequest(b, req.id, { decision: "reject", comment: "Duplicate of an approved tool" });
    expect((await getRequest(owner, req.id)).status).toBe("rejected");
    expect((await getRequest(owner, req.id)).events.map((e) => e.type)).toEqual([
      "submitted",
      "approved",
      "changes_requested",
      "resubmitted",
      "comment",
      "rejected",
    ]);
  });

  it("lets the requester withdraw, and keeps council config admin-only", async () => {
    const owner = await makeOrg();
    const requester = await addMember(owner);
    const req = await createRequest(requester, lowRisk);
    expect((await withdrawRequest(requester, req.id)).status).toBe("withdrawn");
    await expect(createStage(requester, { name: "Mine" })).rejects.toMatchObject({ status: 403 });
    const s1 = await createStage(owner, { name: "One" });
    const s2 = await createStage(owner, { name: "Two" });
    await reorderStages(owner, [s2.id, s1.id]);
    expect((await listStages(owner)).map((s) => s.name)).toEqual(["Two", "One"]);
  });

  it("keeps requests and stages inside their org", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const outsider = await addMember(b);
    await expect(createStage(a, { name: "X", memberUserIds: [outsider.actor.userId] })).rejects.toMatchObject({ status: 400 });
    const req = await createRequest(a, lowRisk);
    await expect(getRequest(b, req.id)).rejects.toMatchObject({ status: 404 });
    await expect(decideRequest(b, req.id, { decision: "approve" })).rejects.toMatchObject({ status: 404 });
    expect(await listRequests(b)).toEqual([]);
  });
});

describe("AI inventory and adoption", () => {
  it("tracks capabilities, usage snapshots and team rollout", async () => {
    const owner = await makeOrg();
    const memberCtx = await addMember(owner);
    const copilot = await createSystem(owner, { name: "M365 Copilot" });
    const sales = await createTeam(owner, { name: "Sales" });
    await createTeam(owner, { name: "Finance" });

    await expect(saveAiProfile(memberCtx, copilot.id, { riskTier: "medium" })).rejects.toMatchObject({ status: 403 });
    await expect(recordUsage(owner, copilot.id, { recordedOn: "2026-11-01", activeUsers: 5 })).rejects.toMatchObject({ status: 400 });
    await saveAiProfile(owner, copilot.id, { riskTier: "medium", targetUsers: 200 });
    await addCapability(owner, copilot.id, { name: "Chat in Teams" });
    await addCapability(owner, copilot.id, { name: "Agents with write access", status: "prohibited" });

    // Any member (or an API token) can report usage and rollout.
    await recordUsage(memberCtx, copilot.id, { recordedOn: "2026-10-01", activeUsers: 20, licensedSeats: 100 });
    await recordUsage(memberCtx, copilot.id, { recordedOn: "2026-11-01", activeUsers: 50, licensedSeats: 100 });
    await recordUsage(memberCtx, copilot.id, { recordedOn: "2026-11-01", activeUsers: 60, licensedSeats: 100 }); // same day replaces
    await setRollout(memberCtx, copilot.id, sales.id, { status: "adopted" });

    const { tools, summary } = await listInventory(owner);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "M365 Copilot",
      adoptionRate: 0.6,
      capabilities: { approved: 1, restricted: 0, prohibited: 1 },
      teams: { adopted: 1, total: 2 },
      latestUsage: { recordedOn: "2026-11-01", activeUsers: 60 },
    });
    expect(summary).toMatchObject({ tools: 1, approvedCapabilities: 1, averageAdoption: 0.6 });

    const detail = await getAiDetails(owner, copilot.id);
    expect(detail.usage).toHaveLength(2);
    expect(detail.rollouts.find((r) => r.teamName === "Sales")).toMatchObject({ status: "adopted" });
    expect(detail.rollouts.find((r) => r.teamName === "Finance")).toMatchObject({ status: "not_started" });

    const other = await makeOrg();
    await expect(getAiDetails(other, copilot.id)).rejects.toMatchObject({ status: 404 });
    expect((await listInventory(other)).tools).toEqual([]);
  });
});
