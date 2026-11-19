import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Auth tables (managed by Better Auth: user, session, account, verification,
// plus the organization plugin's organization, member, invitation).
// Column names follow Better Auth's field names; do not rename without
// updating the auth config.
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: createdAt(),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("member_org_user_idx").on(t.organizationId, t.userId)],
);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Patch domain tables. Every tenant-owned row carries organization_id and all
// access goes through src/core, which scopes queries to the caller's org.
// ---------------------------------------------------------------------------

const orgId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

/** Business units / departments. Not tied to logins. */
export const teams = pgTable(
  "teams",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("teams_org_name_idx").on(t.organizationId, sql`lower(${t.name})`)],
);

/** Directory of people (owners, champions). May or may not have a login. */
export const people = pgTable(
  "people",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    email: text("email"),
    title: text("title"),
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("people_org_email_idx")
      .on(t.organizationId, sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    index("people_team_idx").on(t.teamId),
  ],
);

/** A tool or application the business uses. */
export const systems = pgTable(
  "systems",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    vendor: text("vendor"),
    category: text("category"),
    description: text("description"),
    url: text("url"),
    lifecycle: text("lifecycle").notNull().default("active"),
    criticality: text("criticality").notNull().default("medium"),
    /** True for creation platforms (Power Automate, Appian, Nintex...) that host artifacts. */
    isPlatform: boolean("is_platform").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("systems_org_name_idx").on(t.organizationId, sql`lower(${t.name})`)],
);

export const systemOwners = pgTable(
  "system_owners",
  {
    id: id(),
    organizationId: orgId(),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("system_owners_unique_idx").on(t.systemId, t.personId, t.role),
    index("system_owners_person_idx").on(t.personId),
  ],
);

/** What the business uses systems for. */
export const useCases = pgTable(
  "use_cases",
  {
    id: id(),
    organizationId: orgId(),
    title: text("title").notNull(),
    description: text("description"),
    businessValue: text("business_value"),
    status: text("status").notNull().default("active"),
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("use_cases_org_idx").on(t.organizationId)],
);

export const useCaseSystems = pgTable(
  "use_case_systems",
  {
    useCaseId: text("use_case_id")
      .notNull()
      .references(() => useCases.id, { onDelete: "cascade" }),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.useCaseId, t.systemId] }), index("ucs_system_idx").on(t.systemId)],
);

/** Something built on a platform system: a flow, app, form, bot, agent... */
export const artifacts = pgTable(
  "artifacts",
  {
    id: id(),
    organizationId: orgId(),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("other"),
    description: text("description"),
    externalUrl: text("external_url"),
    externalId: text("external_id"),
    environment: text("environment"),
    status: text("status").notNull().default("active"),
    ownerId: text("owner_id").references(() => people.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("artifacts_system_idx").on(t.systemId), index("artifacts_owner_idx").on(t.ownerId)],
);

export const useCaseArtifacts = pgTable(
  "use_case_artifacts",
  {
    useCaseId: text("use_case_id")
      .notNull()
      .references(() => useCases.id, { onDelete: "cascade" }),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.useCaseId, t.artifactId] }), index("uca_artifact_idx").on(t.artifactId)],
);

/** Append-only activity log. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    organizationId: orgId(),
    actorType: text("actor_type").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary").notNull(),
    changes: jsonb("changes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** Personal API tokens for the REST API and MCP. Only a hash is stored. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: id(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);
