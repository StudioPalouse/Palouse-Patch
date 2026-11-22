import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client.ts";
import { invitation } from "../src/db/schema.ts";
import { createApp } from "../src/server/app.ts";
import { config } from "../src/server/config.ts";
import { isBlockedEmailDomain } from "../src/shared/email-domains.ts";
import { makeOrg } from "./helpers.ts";

describe("isBlockedEmailDomain", () => {
  it("blocks free providers, case-insensitively, including subdomains", () => {
    expect(isBlockedEmailDomain("someone@gmail.com")).toBe(true);
    expect(isBlockedEmailDomain("Someone@GMAIL.COM ")).toBe(true);
    expect(isBlockedEmailDomain("x@mail.yahoo.com")).toBe(true);
    expect(isBlockedEmailDomain("x@proton.me")).toBe(true);
  });

  it("allows work domains, including ones that merely contain a free domain's name", () => {
    expect(isBlockedEmailDomain("jo@palouse.io")).toBe(false);
    expect(isBlockedEmailDomain("jo@notgmail.com")).toBe(false);
    expect(isBlockedEmailDomain("jo@gmail.com.example.org")).toBe(false);
    expect(isBlockedEmailDomain("not-an-email")).toBe(false);
  });

  it("honours extra domains", () => {
    expect(isBlockedEmailDomain("a@competitor.com", ["Competitor.com"])).toBe(true);
    expect(isBlockedEmailDomain("a@eu.competitor.com", ["@competitor.com"])).toBe(true);
  });
});

describe("sign-up with PATCH_REQUIRE_WORK_EMAIL", () => {
  const app = createApp();
  const signUp = (email: string) =>
    app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: config.baseUrl },
      body: JSON.stringify({ name: "Test", email, password: "a-long-password-1" }),
    });
  const stamp = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(() => {
    config.requireWorkEmail = true;
  });
  afterAll(() => {
    config.requireWorkEmail = false;
  });

  it("refuses personal addresses with a clear message", async () => {
    const res = await signUp(`p-${stamp()}@gmail.com`);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/work email/i);
  });

  it("accepts work addresses", async () => {
    expect((await signUp(`w-${stamp()}@acme-corp.example`)).status).toBe(200);
  });

  it("lets someone with a pending invitation sign up from a personal address", async () => {
    const org = await makeOrg("owner");
    const email = `Invited-${stamp()}@gmail.com`;
    await db.insert(invitation).values({
      id: `inv-${stamp()}`,
      organizationId: org.orgId,
      email: email.toLowerCase(),
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: org.actor.userId,
    });
    expect((await signUp(email)).status).toBe(200);
  });

  it("does not honour expired invitations", async () => {
    const org = await makeOrg("owner");
    const email = `expired-${stamp()}@gmail.com`;
    await db.insert(invitation).values({
      id: `inv-${stamp()}`,
      organizationId: org.orgId,
      email,
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() - 1000),
      inviterId: org.actor.userId,
    });
    expect((await signUp(email)).status).toBe(400);
  });
});
