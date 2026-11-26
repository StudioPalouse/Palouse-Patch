import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { jwt } from "better-auth/plugins/jwt";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";
import { config } from "./config.ts";
import { actionEmail, sendMail } from "./mail.ts";
import { linkMemberToPerson } from "../core/people.ts";
import { isBlockedEmailDomain, WORK_EMAIL_MESSAGE } from "../shared/email-domains.ts";

/**
 * OAuth for MCP needs an HTTPS base URL (clients refuse anything else), or
 * localhost for development. Installs on plain HTTP keep API tokens only.
 */
export const mcpOAuthEnabled = (() => {
  const url = new URL(config.baseUrl);
  return url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
})();
if (!mcpOAuthEnabled) {
  console.warn(`OAuth sign-in for MCP clients is off: PATCH_BASE_URL (${config.baseUrl}) must use https. MCP clients can still connect with an API token.`);
}

/** The MCP endpoint's resource identifier: OAuth access tokens are bound to it. */
export const MCP_RESOURCE = `${config.baseUrl}/mcp`;
/** Patch's own scopes. `patch:write` lets a token make changes, like a read and write API token. */
export const MCP_SCOPES = ["patch:read", "patch:write"] as const;
const OIDC_SCOPES = ["openid", "profile", "email", "offline_access"];
/** Access token claim holding the org the token was granted for. */
export const ORG_CLAIM = "org_id";

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

/** Orgs the user belongs to, oldest membership first. */
async function orgIdsOf(userId: string) {
  const rows = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.member.createdAt));
  return rows.map((r) => r.organizationId);
}

/**
 * The org an MCP client is being connected to: the session's active org if the
 * user still belongs to it, or their only org. Users in several orgs choose one
 * on the post-login page first (see `postLogin` below), which makes it active.
 */
async function oauthOrgFor(userId: string, activeOrganizationId: unknown) {
  const orgIds = await orgIdsOf(userId);
  if (typeof activeOrganizationId === "string" && orgIds.includes(activeOrganizationId)) return activeOrganizationId;
  return orgIds.length === 1 ? orgIds[0] : undefined;
}

/** OAuth 2.1 authorization server for the MCP endpoint, so assistants can connect by signing in instead of pasting an API token. */
function mcpOAuthPlugins() {
  return [
    jwt({ disableSettingJwtHeader: true }),
    mcp({
      resource: MCP_RESOURCE,
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      scopes: [...OIDC_SCOPES, ...MCP_SCOPES],
      // MCP clients that predate Client ID Metadata Documents still register
      // themselves. A registered client may ask for any of these scopes; the
      // user approves every client on the consent page, where write access
      // is opt-in (see src/web/pages/oauth.tsx).
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: "infer",
      // A token belongs to one org: the one chosen at consent. Consent is
      // stored per org, so connecting a second org asks again.
      postLogin: {
        page: "/oauth/organization",
        shouldRedirect: async ({ user, session, isContinuation }) => {
          const orgIds = await orgIdsOf(user.id);
          if (orgIds.length === 1) return false;
          if (orgIds.length === 0 || !isContinuation) return true;
          return !orgIds.includes(session.activeOrganizationId as string);
        },
        consentReferenceId: async ({ user, session }) => {
          const orgId = await oauthOrgFor(user.id, session.activeOrganizationId);
          if (!orgId) throw new APIError("FORBIDDEN", { message: "Choose an organization to connect" });
          return orgId;
        },
      },
      customAccessTokenClaims: ({ referenceId }) => (referenceId ? { [ORG_CLAIM]: referenceId } : {}),
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
  ];
}

export const auth = betterAuth({
  baseURL: config.baseUrl,
  basePath: "/api/auth",
  secret: config.authSecret ?? "dev-only-secret-change-me-dev-only-secret",
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // OAuth access tokens are JWTs signed by the jwt plugin. Its own /token
  // endpoint would hand out session JWTs signed with the same key, so it's off.
  disabledPaths: ["/token"],
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
      // Members show up in the People directory (and inherit ownerships made
      // for their email before they joined).
      organizationHooks: {
        afterCreateOrganization: async ({ organization, user }) => void (await linkMemberToPerson(db, organization.id, user)),
        afterAcceptInvitation: async ({ organization, user }) => void (await linkMemberToPerson(db, organization.id, user)),
        afterAddMember: async ({ organization, user }) => void (await linkMemberToPerson(db, organization.id, user)),
      },
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
    ...(mcpOAuthEnabled ? mcpOAuthPlugins() : []),
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
