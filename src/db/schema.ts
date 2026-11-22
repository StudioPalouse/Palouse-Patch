import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
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

// ---------------------------------------------------------------------------
// AI governance
// ---------------------------------------------------------------------------

/** One step in the org's AI council review order. Members are logins. */
export const aiReviewStages = pgTable(
  "ai_review_stages",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    /** "any": one reviewer's approval completes the stage; "all": every reviewer must approve. */
    rule: text("rule").notNull().default("any"),
    /** Only requests at or above this risk tier go through the stage. */
    minTier: text("min_tier").notNull().default("low"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_review_stages_org_idx").on(t.organizationId, t.position)],
);

export const aiReviewStageMembers = pgTable(
  "ai_review_stage_members",
  {
    stageId: text("stage_id")
      .notNull()
      .references(() => aiReviewStages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: orgId(),
  },
  (t) => [primaryKey({ columns: [t.stageId, t.userId] }), index("ai_stage_members_user_idx").on(t.userId)],
);

/** A team member's request to bring an AI tool, feature or agent into the org. */
export const aiRequests = pgTable(
  "ai_requests",
  {
    id: id(),
    organizationId: orgId(),
    title: text("title").notNull(),
    vendor: text("vendor"),
    url: text("url"),
    kind: text("kind").notNull().default("new_tool"),
    /** Existing system the feature or agent runs in. */
    systemId: text("system_id").references(() => systems.id, { onDelete: "set null" }),
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    requesterUserId: text("requester_user_id").references(() => user.id, { onDelete: "set null" }),
    capability: text("capability").notNull(),
    businessCase: text("business_case").notNull(),
    dataDescription: text("data_description"),
    expectedUsers: integer("expected_users"),
    estimatedCost: text("estimated_cost"),
    personalData: boolean("personal_data").notNull().default(false),
    confidentialData: boolean("confidential_data").notNull().default(false),
    writeAccess: boolean("write_access").notNull().default(false),
    autonomous: boolean("autonomous").notNull().default(false),
    customerFacing: boolean("customer_facing").notNull().default(false),
    peopleDecisions: boolean("people_decisions").notNull().default(false),
    trainsOnData: text("trains_on_data").notNull().default("unknown"),
    riskTier: text("risk_tier").notNull(),
    status: text("status").notNull().default("in_review"),
    conditions: text("conditions"),
    /** The inventory system the approved request was added to. */
    resultSystemId: text("result_system_id").references(() => systems.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ai_requests_org_status_idx").on(t.organizationId, t.status),
    index("ai_requests_requester_idx").on(t.requesterUserId),
  ],
);

/** The review order, copied from the council stages when a request is submitted. */
export const aiRequestSteps = pgTable(
  "ai_request_steps",
  {
    id: id(),
    organizationId: orgId(),
    requestId: text("request_id")
      .notNull()
      .references(() => aiRequests.id, { onDelete: "cascade" }),
    stageId: text("stage_id").references(() => aiReviewStages.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    rule: text("rule").notNull().default("any"),
    status: text("status").notNull().default("waiting"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("ai_request_steps_request_idx").on(t.requestId, t.position)],
);

/** Timeline of a request: submissions, decisions and comments. */
export const aiRequestEvents = pgTable(
  "ai_request_events",
  {
    id: id(),
    organizationId: orgId(),
    requestId: text("request_id")
      .notNull()
      .references(() => aiRequests.id, { onDelete: "cascade" }),
    stepId: text("step_id").references(() => aiRequestSteps.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    actorLabel: text("actor_label").notNull(),
    type: text("type").notNull(),
    comment: text("comment"),
    conditions: text("conditions"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_request_events_request_idx").on(t.requestId, t.createdAt)],
);

/** Marks a system as part of the AI inventory, with its governance details. */
export const aiProfiles = pgTable(
  "ai_profiles",
  {
    id: id(),
    organizationId: orgId(),
    systemId: text("system_id")
      .notNull()
      .unique()
      .references(() => systems.id, { onDelete: "cascade" }),
    riskTier: text("risk_tier").notNull().default("medium"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    reviewDueAt: date("review_due_at", { mode: "string" }),
    /** People expected to use it: the adoption denominator when seats are unknown. */
    targetUsers: integer("target_users"),
    conditions: text("conditions"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_profiles_org_idx").on(t.organizationId)],
);

/** An AI capability of a system and whether the council allows it. */
export const aiCapabilities = pgTable(
  "ai_capabilities",
  {
    id: id(),
    organizationId: orgId(),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("approved"),
    notes: text("notes"),
    requestId: text("request_id").references(() => aiRequests.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_capabilities_system_idx").on(t.systemId)],
);

/** Point-in-time usage, entered by hand or pushed through the API. */
export const aiUsageSnapshots = pgTable(
  "ai_usage_snapshots",
  {
    id: id(),
    organizationId: orgId(),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    recordedOn: date("recorded_on", { mode: "string" }).notNull(),
    activeUsers: integer("active_users").notNull(),
    licensedSeats: integer("licensed_seats"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ai_usage_system_day_idx").on(t.systemId, t.recordedOn)],
);

/** How far a team has adopted an AI tool. */
export const aiTeamRollouts = pgTable(
  "ai_team_rollouts",
  {
    organizationId: orgId(),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("not_started"),
    adoptedAt: timestamp("adopted_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.systemId, t.teamId] })],
);
