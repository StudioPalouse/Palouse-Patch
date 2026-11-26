import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import { db } from "../src/db/client.ts";
import { member, organization } from "../src/db/schema.ts";
import * as systems from "../src/core/systems.ts";
import { ctxFromOAuth } from "../src/core/tokens.ts";

/**
 * The OAuth flow an MCP client goes through, end to end against the real app:
 * discovery from the 401, dynamic registration, sign in, (org choice,) consent,
 * code exchange with PKCE, MCP calls and refresh.
 */

const app = createApp();
const BASE = "http://localhost:3000";
const RESOURCE = `${BASE}/mcp`;
const REDIRECT = "http://127.0.0.1:33418/callback";
let n = 0;

const req = (path: string, init: RequestInit = {}) => app.request(`${BASE}${path}`, init);

async function signUp() {
  n++;
  const email = `oauth-${Date.now()}-${n}@example.com`;
  const res = await req("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `OAuth User ${n}`, email, password: "correct horse battery" }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const { user } = (await res.json()) as { user: { id: string } };
  return { userId: user.id, cookie };
}

async function addOrg(userId: string, name: string) {
  const id = `org-oauth-${Date.now()}-${++n}`;
  await db.insert(organization).values({ id, name, slug: id });
  await db.insert(member).values({ id: `mem-${id}`, organizationId: id, userId, role: "owner" });
  return id;
}

async function register(body: Record<string, unknown> = {}) {
  const res = await req("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Test Assistant", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", ...body }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { client_id: string; scope?: string };
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** GET /authorize as the signed-in user; returns where the server sends the browser. */
async function authorize(clientId: string, cookie: string, scope: string, challenge: string) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope,
    state: "xyz",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  });
  const res = await req(`/api/auth/oauth2/authorize?${q}`, { headers: { cookie } });
  expect([302, 303]).toContain(res.status);
  return new URL(res.headers.get("location")!, BASE);
}

/** A page POST (consent, continue) carrying the signed query, as the auth client does. */
async function pagePost(path: string, cookie: string, page: URL, body: Record<string, unknown>) {
  const res = await req(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ...body, oauth_query: page.search.slice(1) }),
  });
  const json = (await res.json()) as any;
  expect(res.status, JSON.stringify(json)).toBe(200);
  return new URL(json.url, BASE);
}

async function exchange(clientId: string, code: string, verifier: string) {
  const res = await req("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: RESOURCE }),
  });
  const json = (await res.json()) as any;
  expect(res.status, JSON.stringify(json)).toBe(200);
  return json as { access_token: string; refresh_token?: string; scope: string };
}

const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());

async function mcp(token: string | undefined, method = "tools/list", params: Record<string, unknown> = {}) {
  const res = await req("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
}

/** Full happy path for a user with one org; returns the tokens. */
async function connect(scope = "openid offline_access patch:read") {
  const { userId, cookie } = await signUp();
  const orgId = await addOrg(userId, "Acme");
  const client = await register({ scope });
  const { verifier, challenge } = pkce();
  const consentPage = await authorize(client.client_id, cookie, scope, challenge);
  expect(consentPage.pathname).toBe("/oauth/consent");
  const back = await pagePost("/api/auth/oauth2/consent", cookie, consentPage, { accept: true });
  expect(back.origin + back.pathname).toBe(REDIRECT);
  expect(back.searchParams.get("state")).toBe("xyz");
  const tokens = await exchange(client.client_id, back.searchParams.get("code")!, verifier);
  return { userId, cookie, orgId, client, tokens };
}

describe("MCP over OAuth", () => {
  beforeAll(async () => {
    // Fail fast with a clear message if the discovery wiring is broken.
    expect((await req("/.well-known/oauth-protected-resource")).status).toBe(200);
  });

  it("advertises where to sign in", async () => {
    const challenge = await mcp(undefined);
    expect(challenge.status).toBe(401);
    const header = challenge.headers.get("www-authenticate")!;
    expect(header).toMatch(/^Bearer /);
    const metadataUrl = header.match(/resource_metadata="([^"]+)"/)![1]!;

    const prm = (await (await req(new URL(metadataUrl).pathname)).json()) as any;
    expect(prm.resource).toBe(RESOURCE);
    expect(prm.scopes_supported).toEqual(["patch:read", "patch:write"]);
    const issuer = new URL(prm.authorization_servers[0]);

    for (const path of [`/.well-known/oauth-authorization-server${issuer.pathname}`, `/.well-known/openid-configuration${issuer.pathname}`]) {
      const res = await req(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      const as = (await res.json()) as any;
      expect(as.issuer).toBe(issuer.toString().replace(/\/$/, ""));
      expect(as.registration_endpoint).toBeTruthy();
      expect(as.code_challenge_methods_supported).toContain("S256");
      expect(as.client_id_metadata_document_supported).toBe(true);
    }
  });

  it("connects a client to the user's org, read-only by default", async () => {
    const { userId, orgId, client, tokens } = await connect();
    const c = claims(tokens.access_token);
    expect(c.org_id).toBe(orgId);
    expect(c.sub).toBe(userId);
    expect(c.aud).toContain(RESOURCE);
    expect(tokens.scope.split(" ")).not.toContain("patch:write");

    await systems.createSystem(await ctxFromOAuthOrThrow(userId, orgId, client.client_id, ["patch:write"]), { name: "Salesforce" });
    const listed = await mcp(tokens.access_token, "tools/call", { name: "list_systems", arguments: {} });
    expect(listed.status).toBe(200);
    expect(JSON.parse(listed.body.result.content[0].text).map((s: any) => s.name)).toEqual(["Salesforce"]);

    const ro = await ctxFromOAuthOrThrow(userId, orgId, client.client_id, tokens.scope.split(" "));
    expect(ro.readOnly).toBe(true);
    expect(ro.actor).toMatchObject({ type: "oauth", label: expect.stringContaining("via Test Assistant") });
    await expect(systems.createSystem(ro, { name: "Nope" })).rejects.toThrow(/read-only/);
  });

  it("grants only the scopes the user allows on the consent page", async () => {
    const { userId, cookie } = await signUp();
    await addOrg(userId, "Acme");
    const client = await register();
    const { verifier, challenge } = pkce();
    const consentPage = await authorize(client.client_id, cookie, "openid patch:read patch:write", challenge);
    // "Also allow changes" left unticked: the page sends the requested scopes minus patch:write.
    const back = await pagePost("/api/auth/oauth2/consent", cookie, consentPage, { accept: true, scope: "openid patch:read" });
    const tokens = await exchange(client.client_id, back.searchParams.get("code")!, verifier);
    expect(claims(tokens.access_token).scope.split(" ")).toEqual(["openid", "patch:read"]);
    expect((await mcp(tokens.access_token)).status).toBe(200);
  });

  it("refreshes tokens without losing the org", async () => {
    const { orgId, client, tokens } = await connect();
    expect(tokens.refresh_token).toBeTruthy();
    const res = await req("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token!, client_id: client.client_id, resource: RESOURCE }),
    });
    const refreshed = (await res.json()) as any;
    expect(res.status, JSON.stringify(refreshed)).toBe(200);
    expect(claims(refreshed.access_token).org_id).toBe(orgId);
    expect((await mcp(refreshed.access_token)).status).toBe(200);
  });

  it("asks users in several orgs which one to connect, and scopes the token to it", async () => {
    const { userId, cookie } = await signUp();
    const first = await addOrg(userId, "First");
    const second = await addOrg(userId, "Second");
    await systems.createSystem(await ctxFromOAuthOrThrow(userId, first, "", ["patch:write"]), { name: "Only in first" });

    const client = await register();
    const { verifier, challenge } = pkce();
    const picker = await authorize(client.client_id, cookie, "openid patch:read", challenge);
    expect(picker.pathname).toBe("/oauth/organization");

    const setActive = await req("/api/auth/organization/set-active", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ organizationId: second }),
    });
    expect(setActive.status).toBe(200);
    const consentPage = await pagePost("/api/auth/oauth2/continue", cookie, picker, { postLogin: true });
    expect(consentPage.pathname).toBe("/oauth/consent");
    const back = await pagePost("/api/auth/oauth2/consent", cookie, consentPage, { accept: true });
    const tokens = await exchange(client.client_id, back.searchParams.get("code")!, verifier);

    expect(claims(tokens.access_token).org_id).toBe(second);
    const listed = await mcp(tokens.access_token, "tools/call", { name: "list_systems", arguments: {} });
    expect(JSON.parse(listed.body.result.content[0].text)).toEqual([]);
  });

  it("cuts off a connection when the user leaves the org", async () => {
    const { userId, orgId, tokens } = await connect();
    expect((await mcp(tokens.access_token)).status).toBe(200);
    await db.delete(member).where(and(eq(member.userId, userId), eq(member.organizationId, orgId)));
    expect((await mcp(tokens.access_token)).status).toBe(403);
  });

  it("rejects tokens it didn't issue for this endpoint", async () => {
    const { tokens } = await connect();
    const [h, p, s] = tokens.access_token.split(".");
    const forged = [h, Buffer.from(JSON.stringify({ ...claims(tokens.access_token), org_id: "someone-else" })).toString("base64url"), s].join(".");
    expect((await mcp(forged)).status).toBe(401);
    expect((await mcp("not-a-jwt")).status).toBe(401);
  });

  it("sends the user back with access_denied when they deny", async () => {
    const { userId, cookie } = await signUp();
    await addOrg(userId, "Acme");
    const client = await register();
    const consentPage = await authorize(client.client_id, cookie, "openid patch:read", pkce().challenge);
    const back = await pagePost("/api/auth/oauth2/consent", cookie, consentPage, { accept: false });
    expect(back.searchParams.get("error")).toBe("access_denied");
  });
});

async function ctxFromOAuthOrThrow(userId: string, orgId: string, clientId: string, scopes: string[]) {
  const ctx = await ctxFromOAuth(db, { userId, orgId, clientId, scopes });
  if (!ctx) throw new Error("not a member");
  return ctx;
}
