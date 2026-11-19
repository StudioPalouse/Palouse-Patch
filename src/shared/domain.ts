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
