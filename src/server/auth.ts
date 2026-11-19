import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";
import { config } from "./config.ts";

export const auth = betterAuth({
  baseURL: config.baseUrl,
  basePath: "/api/auth",
  secret: config.authSecret ?? "dev-only-secret-change-me-dev-only-secret",
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: !config.allowSignup,
    minPasswordLength: 10,
  },
  plugins: [
    organization({
      // Anyone signed in can start an org; on self-hosted installs signups
      // can be closed with PATCH_ALLOW_SIGNUP=false.
      allowUserToCreateOrganization: true,
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
  telemetry: { enabled: false },
});

export type Session = typeof auth.$Infer.Session;
