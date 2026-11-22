import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app.ts";
import { config } from "../src/server/config.ts";

const app = createApp();
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: config.baseUrl },
    body: JSON.stringify(body),
  });

afterEach(() => vi.restoreAllMocks());

describe("password reset email", () => {
  it("emails a working reset link (logged when Resend is not configured)", async () => {
    const email = `reset-${Date.now()}@example.com`;
    expect((await post("/api/auth/sign-up/email", { name: "Reset", email, password: "old-password-123" })).status).toBe(200);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await post("/api/auth/request-password-reset", { email, redirectTo: "/reset-password" })).status).toBe(200);
    const sent = log.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith("[mail]") && m.includes(email));
    expect(sent).toContain("Reset your Patch password");

    const token = sent!.match(/reset-password\/([^?\s]+)/)?.[1];
    expect(token).toBeTruthy();
    expect((await post("/api/auth/reset-password", { token, newPassword: "new-password-456" })).status).toBe(200);
    expect((await post("/api/auth/sign-in/email", { email, password: "new-password-456" })).status).toBe(200);
    expect((await post("/api/auth/sign-in/email", { email, password: "old-password-123" })).status).toBe(401);
  });

  it("does not reveal whether an account exists", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await post("/api/auth/request-password-reset", { email: "nobody@example.com", redirectTo: "/reset-password" });
    expect(res.status).toBe(200);
  });
});
