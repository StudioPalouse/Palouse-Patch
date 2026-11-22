import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";
import { config } from "./config.ts";
import { actionEmail, sendMail } from "./mail.ts";
import { isBlockedEmailDomain, WORK_EMAIL_MESSAGE } from "../shared/email-domains.ts";

/** A pending, unexpired invitation lets someone sign up from any domain. */
async function hasPendingInvitation(email: string) {
  const [row] = await db
    .select({ id: schema.invitation.id })
    .from(schema.invitation)
    .where(
      and(
        eq(sql`lower(${schema.invitation.email})`, email.trim().toLowerCase()),
        eq(schema.invitation.status, "pending"),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return !!row;
}

export const auth = betterAuth({
  baseURL: config.baseUrl,
  basePath: "/api/auth",
  secret: config.authSecret ?? "dev-only-secret-change-me-dev-only-secret",
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: !config.allowSignup,
    minPasswordLength: 10,
    sendResetPassword: async ({ user, url }) => {
      await sendMail(
        actionEmail({
          to: user.email,
          subject: "Reset your Patch password",
          intro: `Someone asked to reset the password for your Patch account (${user.email}). The link expires in one hour.`,
          action: "Reset password",
          url,
          outro: "If you didn't ask for this, you can ignore this email and your password will stay the same.",
        }),
      );
    },
  },
  plugins: [
    organization({
      // Anyone signed in can start an org; on self-hosted installs signups
      // can be closed with PATCH_ALLOW_SIGNUP=false.
      allowUserToCreateOrganization: true,
      sendInvitationEmail: async ({ id, email, organization, inviter }) => {
        await sendMail(
          actionEmail({
            to: email,
            subject: `${inviter.user.name} invited you to ${organization.name} on Patch`,
            intro: `${inviter.user.name} (${inviter.user.email}) invited you to join ${organization.name} on Patch. Sign in or create an account with ${email} to accept.`,
            action: "Accept invitation",
            url: `${config.baseUrl}/accept-invitation/${id}`,
          }),
        );
      },
    }),
  ],
  databaseHooks: {
    session: {
      create: {
        // Drop the user straight into their first org on sign in.
        before: async (session) => {
          const [first] = await db
            .select({ organizationId: schema.member.organizationId })
            .from(schema.member)
            .where(eq(schema.member.userId, session.userId))
            .orderBy(asc(schema.member.createdAt))
            .limit(1);
          return { data: { ...session, activeOrganizationId: first?.organizationId ?? null } };
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email" || !config.requireWorkEmail) return;
      const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
      if (isBlockedEmailDomain(email, config.blockedEmailDomains) && !(await hasPendingInvitation(email))) {
        throw new APIError("BAD_REQUEST", { message: WORK_EMAIL_MESSAGE, code: "WORK_EMAIL_REQUIRED" });
      }
    }),
  },
  telemetry: { enabled: false },
});

export type Session = typeof auth.$Infer.Session;
