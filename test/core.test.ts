import { describe, expect, it } from "vitest";
import { createArtifact, getArtifact } from "../src/core/artifacts.ts";
import { listAudit } from "../src/core/audit.ts";
import { createPerson } from "../src/core/people.ts";
import { search } from "../src/core/search.ts";
import {
  addSystemOwner,
  createSystem,
  deleteSystem,
  getSystem,
  listSystems,
  updateSystem,
} from "../src/core/systems.ts";
import { createTeam } from "../src/core/teams.ts";
import { createUseCase, getUseCase, updateUseCase } from "../src/core/use-cases.ts";
import { makeOrg } from "./helpers.ts";

describe("systems", () => {
  it("creates, updates and audits with a field diff", async () => {
    const ctx = await makeOrg();
    const s = await createSystem(ctx, { name: "Salesforce", vendor: "Salesforce" });
    await updateSystem(ctx, s.id, { name: "Salesforce", vendor: "Salesforce", lifecycle: "sunsetting" });
    const events = await listAudit(ctx, { entityType: "system", entityId: s.id });
    expect(events.map((e) => e.action)).toEqual(["update", "create"]);
    expect(events[0]!.changes).toEqual({ lifecycle: { from: "active", to: "sunsetting" } });
  });

  it("rejects duplicate names case-insensitively within an org only", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await createSystem(a, { name: "Workday" });
    await expect(createSystem(a, { name: "workday" })).rejects.toMatchObject({ status: 409 });
    await expect(createSystem(b, { name: "Workday" })).resolves.toBeTruthy();
  });

  it("validates input", async () => {
    const ctx = await makeOrg();
    await expect(createSystem(ctx, { name: " ", url: "javascript:alert(1)" })).rejects.toThrow();
  });

  it("blocks deleting a platform that still has artifacts", async () => {
    const ctx = await makeOrg();
    const pa = await createSystem(ctx, { name: "Power Automate", isPlatform: true });
    await createArtifact(ctx, { systemId: pa.id, name: "Flow" });
    await expect(deleteSystem(ctx, pa.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("tenant isolation", () => {
  it("never returns another org's records", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const secret = await createSystem(a, { name: "Secret ERP" });
    expect(await listSystems(b)).toEqual([]);
    expect(await search(b, "Secret")).toEqual([]);
    await expect(getSystem(b, secret.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateSystem(b, secret.id, { name: "pwned" })).rejects.toMatchObject({ status: 404 });
    await expect(deleteSystem(b, secret.id)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to link records across orgs", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const foreignSystem = await createSystem(a, { name: "Foreign" });
    const foreignPerson = await createPerson(a, { name: "Foreign Person" });
    const foreignTeam = await createTeam(a, { name: "Foreign Team" });
    const own = await createSystem(b, { name: "Own", isPlatform: true });

    await expect(createUseCase(b, { title: "X", systemIds: [foreignSystem.id] })).rejects.toMatchObject({ status: 400 });
    await expect(createUseCase(b, { title: "X", teamId: foreignTeam.id })).rejects.toMatchObject({ status: 400 });
    await expect(createArtifact(b, { systemId: foreignSystem.id, name: "X" })).rejects.toMatchObject({ status: 400 });
    await expect(createArtifact(b, { systemId: own.id, name: "X", ownerId: foreignPerson.id })).rejects.toMatchObject({
      status: 400,
    });
    await expect(addSystemOwner(b, own.id, { personId: foreignPerson.id, role: "business" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(createPerson(b, { name: "Y", teamId: foreignTeam.id })).rejects.toMatchObject({ status: 400 });
  });
});

describe("use cases and artifacts", () => {
  it("links systems and artifacts and records link changes", async () => {
    const ctx = await makeOrg();
    const crm = await createSystem(ctx, { name: "CRM" });
    const pa = await createSystem(ctx, { name: "Power Automate", isPlatform: true });
    const owner = await createPerson(ctx, { name: "Grace", email: "GRACE@example.com" });
    expect(owner.email).toBe("grace@example.com");
    const flow = await createArtifact(ctx, { systemId: pa.id, name: "Lead sync", type: "flow", ownerId: owner.id });
    const uc = await createUseCase(ctx, { title: "Lead routing", systemIds: [crm.id], artifactIds: [flow.id] });

    const detail = await getUseCase(ctx, uc.id);
    expect(detail.systems.map((s) => s.name)).toEqual(["CRM"]);
    expect(detail.artifacts.map((a) => a.name)).toEqual(["Lead sync"]);
    expect((await getArtifact(ctx, flow.id)).useCases.map((u) => u.title)).toEqual(["Lead routing"]);

    await updateUseCase(ctx, uc.id, { title: "Lead routing", systemIds: [crm.id, pa.id], artifactIds: [flow.id] });
    const [event] = await listAudit(ctx, { entityType: "use_case", entityId: uc.id });
    expect(Object.keys(event!.changes as object)).toEqual(["systemIds"]);

    const sys = await getSystem(ctx, pa.id);
    expect(sys.artifacts.map((a) => a.ownerName)).toEqual(["Grace"]);
  });

  it("rejects a duplicate owner role and duplicate person email", async () => {
    const ctx = await makeOrg();
    const s = await createSystem(ctx, { name: "HRIS" });
    const p = await createPerson(ctx, { name: "Ann", email: "ann@example.com" });
    await addSystemOwner(ctx, s.id, { personId: p.id, role: "business" });
    await expect(addSystemOwner(ctx, s.id, { personId: p.id, role: "business" })).rejects.toMatchObject({ status: 409 });
    await expect(createPerson(ctx, { name: "Ann 2", email: "Ann@Example.com" })).rejects.toMatchObject({ status: 409 });
  });
});
