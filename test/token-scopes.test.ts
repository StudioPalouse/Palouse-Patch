import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app.ts";
import * as aiRequests from "../src/core/ai-requests.ts";
import { listAudit } from "../src/core/audit.ts";
import { sendMemberPasswordReset } from "../src/core/members.ts";
import { setNotifier } from "../src/core/notify.ts";
import * as systems from "../src/core/systems.ts";
import { createApiToken, ctxFromApiToken, listApiTokens } from "../src/core/tokens.ts";
import { db } from "../src/db/client.ts";
import { makeOrg } from "./helpers.ts";

const app = createApp();
const call = (path: string, token: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}` } });

describe("API token scopes", () => {
  it("makes new tokens read-only unless write access is asked for", async () => {
    const ctx = await makeOrg();
    const read = await createApiToken(ctx, { name: "default" });
    const write = await createApiToken(ctx, { name: "writer", scope: "write" });
    expect(read.scope).toBe("read");
    expect(write.scope).toBe("write");
    const listed = await listApiTokens(ctx);
    expect(Object.fromEntries(listed.map((t) => [t.name, t.scope]))).toEqual({ default: "read", writer: "write" });
  });

  it("lets a read-only token read but refuses every change over REST", async () => {
    const ctx = await makeOrg();
    const existing = await systems.createSystem(ctx, { name: "Jira" });
    const { token, id } = await createApiToken(ctx, { name: "assistant", scope: "read" });

    expect((await call("/api/v1/systems", token)).status).toBe(200);
    const me = await (await call("/api/v1/me", token)).json();
    expect(me.data.readOnly).toBe(true);

    const created = await call("/api/v1/systems", token, { method: "POST", body: JSON.stringify({ name: "Confluence" }) });
    expect(created.status).toBe(403);
    expect((await created.json()).error.message).toMatch(/read-only/);
    expect((await call(`/api/v1/systems/${existing.id}`, token, { method: "PUT", body: JSON.stringify({ name: "Renamed" }) })).status).toBe(403);
    expect((await call(`/api/v1/systems/${existing.id}`, token, { method: "DELETE" })).status).toBe(403);
    // It can't revoke tokens either, including itself.
    expect((await call(`/api/v1/tokens/${id}`, token, { method: "DELETE" })).status).toBe(403);

    const after = await systems.listSystems(ctx);
    expect(after.map((s) => s.name)).toEqual(["Jira"]);
    expect(await listAudit(ctx, { entityType: "system", entityId: existing.id })).toHaveLength(1);
  });

  it("enforces the scope in core, so writes inside transactions and their notifications never happen", async () => {
    const ctx = await makeOrg();
    const { token } = await createApiToken(ctx, { name: "assistant", scope: "read" });
    const readOnly = (await ctxFromApiToken(db, token))!;
    expect(readOnly.readOnly).toBe(true);

    await expect(systems.createSystem(readOnly, { name: "Slack" })).rejects.toMatchObject({ status: 403 });

    const notifier = vi.fn(async () => {});
    setNotifier(notifier);
    await expect(
      aiRequests.createRequest(readOnly, {
        title: "Copilot",
        capability: "Draft emails",
        businessCase: "Faster replies",
        personalData: false,
        confidentialData: false,
        writeAccess: false,
        autonomous: false,
        customerFacing: false,
        peopleDecisions: false,
        trainsOnData: "no",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(notifier).not.toHaveBeenCalled();
    expect(await aiRequests.listRequests(ctx)).toEqual([]);
  });

  it("never sends a member password reset from a read-only token", async () => {
    const admin = await makeOrg("admin");
    const { token } = await createApiToken(admin, { name: "assistant", scope: "read" });
    const readOnly = (await ctxFromApiToken(db, token))!;
    const send = vi.fn(async () => {});
    await expect(sendMemberPasswordReset(readOnly, admin.actor.userId, send)).rejects.toMatchObject({ status: 403 });
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves write tokens able to change things", async () => {
    const ctx = await makeOrg();
    const { token } = await createApiToken(ctx, { name: "sync", scope: "write" });
    const res = await call("/api/v1/systems", token, { method: "POST", body: JSON.stringify({ name: "Confluence" }) });
    expect(res.status).toBe(201);
  });
});
