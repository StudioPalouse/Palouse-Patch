import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import { createApiToken, revokeApiToken } from "../src/core/tokens.ts";
import { makeOrg } from "./helpers.ts";

const app = createApp();
const call = (path: string, token?: string, init: RequestInit = {}) =>
  app.request(path, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });

describe("REST API", () => {
  it("requires authentication", async () => {
    expect((await call("/api/v1/systems")).status).toBe(401);
    expect((await call("/api/v1/systems", "patch_nope")).status).toBe(401);
  });

  it("works end to end with an API token, scoped to the token's org", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const { token: tokenA } = await createApiToken(a, { name: "a" });
    const { token: tokenB } = await createApiToken(b, { name: "b" });

    const created = await call("/api/v1/systems", tokenA, { method: "POST", body: JSON.stringify({ name: "Jira" }) });
    expect(created.status).toBe(201);
    const { data } = await created.json();

    expect((await call(`/api/v1/systems/${data.id}`, tokenA)).status).toBe(200);
    expect((await call(`/api/v1/systems/${data.id}`, tokenB)).status).toBe(404);

    const list = await (await call("/api/v1/systems", tokenB)).json();
    expect(list.data).toEqual([]);
  });

  it("describes the caller under data, like every other endpoint", async () => {
    const ctx = await makeOrg("admin");
    const { token } = await createApiToken(ctx, { name: "me" });
    const { data } = await (await call("/api/v1/me", token)).json();
    expect(data).toMatchObject({ orgId: ctx.orgId, role: "admin", isCouncil: false });
  });

  it("returns field errors for invalid input", async () => {
    const ctx = await makeOrg();
    const { token } = await createApiToken(ctx, { name: "t" });
    const res = await call("/api/v1/systems", token, { method: "POST", body: JSON.stringify({ name: "", lifecycle: "nope" }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(Object.keys(body.error.fields).sort()).toEqual(["lifecycle", "name"]);
  });

  it("stops accepting a revoked token and forbids tokens minting tokens", async () => {
    const ctx = await makeOrg();
    const t = await createApiToken(ctx, { name: "t" });
    const minted = await call("/api/v1/tokens", t.token, { method: "POST", body: JSON.stringify({ name: "x" }) });
    expect(minted.status).toBe(403);
    await revokeApiToken(ctx, t.id);
    expect((await call("/api/v1/systems", t.token)).status).toBe(401);
  });

  it("serves health and 404s unknown API routes", async () => {
    expect((await call("/healthz")).status).toBe(200);
    expect((await call("/api/nope")).status).toBe(404);
  });
});
