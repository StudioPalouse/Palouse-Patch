// Shared vocabulary and validation used by the API, the UI and (later) MCP.
// Keep this file free of server-only imports so the web bundle can use it.
import { z } from "zod";

export const LIFECYCLES = ["evaluating", "pilot", "active", "sunsetting", "retired"] as const;
export const CRITICALITIES = ["low", "medium", "high", "critical"] as const;
export const OWNER_ROLES = ["business", "technical", "admin", "champion"] as const;
export const USE_CASE_STATUSES = ["idea", "active", "retired"] as const;
export const ARTIFACT_TYPES = [
  "flow",
  "app",
  "form",
  "workflow",
  "bot",
  "agent",
  "report",
  "integration",
  "other",
] as const;
export const ARTIFACT_STATUSES = ["draft", "active", "deprecated", "retired"] as const;
export const ENVIRONMENTS = ["development", "test", "production"] as const;

export const LABELS: Record<string, string> = {
  evaluating: "Evaluating",
  pilot: "Pilot",
  active: "Active",
  sunsetting: "Sunsetting",
  retired: "Retired",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
  business: "Business owner",
  technical: "Technical owner",
  admin: "Administrator",
  champion: "Champion",
  idea: "Idea",
  draft: "Draft",
  deprecated: "Deprecated",
  development: "Development",
  test: "Test",
  production: "Production",
};

export const label = (value: string) => LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);

/** Empty strings from forms become null so optional columns stay clean. */
const optionalText = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\//i.test(v), "Must start with http:// or https://");

const optionalId = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null));

const name = (max = 200) => z.string().trim().min(1, "Required").max(max);

export const teamInput = z.object({
  name: name(),
  description: optionalText(),
});

export const personInput = z.object({
  name: name(),
  email: z
    .string()
    .trim()
    .max(320)
    .nullish()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+$/.test(v), "Invalid email"),
  title: optionalText(200),
  teamId: optionalId,
});

export const systemInput = z.object({
  name: name(),
  vendor: optionalText(200),
  category: optionalText(100),
  description: optionalText(),
  url: optionalUrl,
  lifecycle: z.enum(LIFECYCLES).default("active"),
  criticality: z.enum(CRITICALITIES).default("medium"),
  isPlatform: z.boolean().default(false),
});

export const systemOwnerInput = z.object({
  personId: z.string().min(1),
  role: z.enum(OWNER_ROLES),
});

export const useCaseInput = z.object({
  title: name(300),
  description: optionalText(),
  businessValue: optionalText(),
  status: z.enum(USE_CASE_STATUSES).default("active"),
  teamId: optionalId,
  systemIds: z.array(z.string()).default([]),
  artifactIds: z.array(z.string()).default([]),
});

export const artifactInput = z.object({
  systemId: z.string().min(1, "Choose the platform this was built on"),
  name: name(300),
  type: z.enum(ARTIFACT_TYPES).default("other"),
  description: optionalText(),
  externalUrl: optionalUrl,
  externalId: optionalText(500),
  environment: z.enum(ENVIRONMENTS).nullish().transform((v) => v ?? null),
  status: z.enum(ARTIFACT_STATUSES).default("active"),
  ownerId: optionalId,
});

export const apiTokenInput = z.object({
  name: name(100),
  expiresInDays: z.number().int().min(1).max(3650).nullish(),
});

export type TeamInput = z.input<typeof teamInput>;
export type PersonInput = z.input<typeof personInput>;
export type SystemInput = z.input<typeof systemInput>;
export type SystemOwnerInput = z.input<typeof systemOwnerInput>;
export type UseCaseInput = z.input<typeof useCaseInput>;
export type ArtifactInput = z.input<typeof artifactInput>;

// ---------------------------------------------------------------------------
// AI governance: council review stages, tool requests, inventory and adoption.
// ---------------------------------------------------------------------------

export const RISK_TIERS = ["low", "medium", "high"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];
export const AI_REQUEST_KINDS = ["new_tool", "feature", "agent"] as const;
export const AI_REQUEST_STATUSES = ["in_review", "changes_requested", "approved", "rejected", "withdrawn"] as const;
export const AI_STEP_STATUSES = ["waiting", "active", "approved", "rejected"] as const;
export const REVIEW_RULES = ["any", "all"] as const;
export const TRAINING_ANSWERS = ["unknown", "no", "yes"] as const;
export const AI_CAPABILITY_STATUSES = ["approved", "restricted", "prohibited"] as const;
export const ROLLOUT_STATUSES = ["not_started", "piloting", "adopted", "paused"] as const;
export const AI_DECISIONS = ["approve", "request_changes", "reject"] as const;

Object.assign(LABELS, {
  new_tool: "New tool",
  feature: "AI feature in an existing system",
  agent: "Agent",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  waiting: "Waiting",
  any: "Any one reviewer",
  all: "All reviewers",
  unknown: "Unknown",
  no: "No",
  yes: "Yes",
  restricted: "Restricted",
  prohibited: "Prohibited",
  not_started: "Not started",
  piloting: "Piloting",
  adopted: "Adopted",
  paused: "Paused",
  approve: "Approve",
  request_changes: "Request changes",
  reject: "Reject",
});

/**
 * Yes/no intake questions. The risk tier is computed from the answers rather
 * than argued about, and decides which council stages a request goes through.
 */
export const AI_RISK_QUESTIONS = [
  { key: "personalData", label: "Will it process personal data about employees, customers or the public?" },
  { key: "confidentialData", label: "Will it process confidential business data (financials, contracts, source code, customer records)?" },
  { key: "writeAccess", label: "Can it take actions in other systems (send messages, create or change records, run code)?" },
  { key: "autonomous", label: "Can it act without a person reviewing each action?" },
  { key: "customerFacing", label: "Will its output reach customers or the public directly?" },
  { key: "peopleDecisions", label: "Will it inform decisions about people (hiring, performance, credit, eligibility)?" },
] as const;
export type RiskQuestionKey = (typeof AI_RISK_QUESTIONS)[number]["key"];
export type RiskAnswers = Record<RiskQuestionKey, boolean> & { trainsOnData: (typeof TRAINING_ANSWERS)[number] };

export const tierRank = (t: string) => Math.max(0, RISK_TIERS.indexOf(t as RiskTier));

export function assessRisk(a: RiskAnswers): { tier: RiskTier; reasons: string[] } {
  const high: string[] = [];
  const medium: string[] = [];
  const sensitive = a.personalData || a.confidentialData;
  if (a.peopleDecisions) high.push("Informs decisions about people");
  if (a.autonomous && a.writeAccess) high.push("Acts in other systems without human review");
  if (sensitive && a.trainsOnData !== "no")
    high.push(a.trainsOnData === "yes" ? "Sensitive data may be used to train the vendor's models" : "Sensitive data, and it's unknown whether the vendor trains on it");
  if (a.personalData) medium.push("Processes personal data");
  if (a.confidentialData) medium.push("Processes confidential data");
  if (a.writeAccess) medium.push("Can take actions in other systems");
  if (a.autonomous) medium.push("Acts without reviewing each action");
  if (a.customerFacing) medium.push("Output reaches customers or the public");
  if (a.trainsOnData === "yes") medium.push("Vendor trains on customer data");
  if (high.length) return { tier: "high", reasons: [...high, ...medium.filter((r) => !high.includes(r))] };
  if (medium.length) return { tier: "medium", reasons: medium };
  return { tier: "low", reasons: ["No sensitive data, no actions in other systems, human in the loop"] };
}

const yesNo = z.boolean().default(false);
const count = z.number().int().min(0).max(10_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const aiRequestInput = z
  .object({
    title: name(),
    vendor: optionalText(200),
    url: optionalUrl,
    kind: z.enum(AI_REQUEST_KINDS).default("new_tool"),
    systemId: optionalId,
    teamId: optionalId,
    capability: name(300),
    businessCase: z.string().trim().min(1, "Required").max(5000),
    dataDescription: optionalText(),
    expectedUsers: count.nullish().transform((v) => v ?? null),
    estimatedCost: optionalText(200),
    personalData: yesNo,
    confidentialData: yesNo,
    writeAccess: yesNo,
    autonomous: yesNo,
    customerFacing: yesNo,
    peopleDecisions: yesNo,
    trainsOnData: z.enum(TRAINING_ANSWERS).default("unknown"),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "new_tool" && !v.systemId)
      ctx.addIssue({ code: "custom", path: ["systemId"], message: "Choose the system this runs in" });
  });

export const aiReviewStageInput = z.object({
  name: name(100),
  description: optionalText(1000),
  rule: z.enum(REVIEW_RULES).default("any"),
  minTier: z.enum(RISK_TIERS).default("low"),
  memberUserIds: z.array(z.string()).default([]),
});

export const aiDecisionInput = z
  .object({
    decision: z.enum(AI_DECISIONS),
    comment: optionalText(),
    conditions: optionalText(),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== "approve" && !v.comment)
      ctx.addIssue({ code: "custom", path: ["comment"], message: "Tell the requester why" });
  });

export const aiCommentInput = z.object({ comment: z.string().trim().min(1, "Required").max(5000) });

export const aiProfileInput = z.object({
  riskTier: z.enum(RISK_TIERS).default("medium"),
  reviewDueAt: isoDate.nullish().or(z.literal("")).transform((v) => v || null),
  targetUsers: count.nullish().transform((v) => v ?? null),
  conditions: optionalText(),
  notes: optionalText(),
});

export const aiCapabilityInput = z.object({
  name: name(300),
  status: z.enum(AI_CAPABILITY_STATUSES).default("approved"),
  notes: optionalText(),
});

export const usageSnapshotInput = z.object({
  recordedOn: isoDate,
  activeUsers: count,
  licensedSeats: count.nullish().transform((v) => v ?? null),
});

export const rolloutInput = z.object({ status: z.enum(ROLLOUT_STATUSES) });

export type AiRequestInput = z.input<typeof aiRequestInput>;
export type AiReviewStageInput = z.input<typeof aiReviewStageInput>;
export type AiDecisionInput = z.input<typeof aiDecisionInput>;
export type AiProfileInput = z.input<typeof aiProfileInput>;
export type AiCapabilityInput = z.input<typeof aiCapabilityInput>;
export type UsageSnapshotInput = z.input<typeof usageSnapshotInput>;
