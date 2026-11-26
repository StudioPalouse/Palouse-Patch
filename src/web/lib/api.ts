export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error ?? {};
    throw new ApiError(res.status, e.code ?? "error", e.message ?? res.statusText, e.fields);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: (path: string) => request<void>("DELETE", path),
};

export const qs = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : "";
};

// Response shapes (kept loose on purpose; the API is the source of truth).
export type Owner = { access?: PatchAccess; id: string; systemId: string; role: string; personId: string; name: string; email: string | null };
export type System = {
  id: string;
  name: string;
  vendor: string | null;
  category: string | null;
  description: string | null;
  url: string | null;
  lifecycle: string;
  criticality: string;
  isPlatform: boolean;
  updatedAt: string;
  owners?: Owner[];
  artifactCount?: number;
  useCaseCount?: number;
};
export type SystemDetail = System & { owners: Owner[]; useCases: UseCase[]; artifacts: Artifact[] };
export type UseCase = {
  id: string;
  title: string;
  description: string | null;
  businessValue: string | null;
  status: string;
  teamId: string | null;
  teamName?: string | null;
  systems?: { id: string; name: string }[];
  artifacts?: { id: string; name: string; type: string }[];
};
export type Artifact = {
  id: string;
  systemId: string;
  name: string;
  type: string;
  description: string | null;
  externalUrl: string | null;
  externalId: string | null;
  environment: string | null;
  status: string;
  ownerId: string | null;
  systemName?: string;
  ownerName?: string | null;
  useCases?: { id: string; title: string; status: string }[];
};
/** member: can sign in; invited: invitation pending; none: named in the catalog only. */
export type PatchAccess = "member" | "invited" | "none";
export type Person = {
  access?: PatchAccess;
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  teamId: string | null;
  teamName?: string | null;
};
export type PersonDetail = Person & {
  systems: (System & { ownershipId: string; role: string })[];
  artifacts: Artifact[];
};
export type Team = { id: string; name: string; description: string | null; peopleCount?: number; useCaseCount?: number };
export type TeamDetail = Team & { people: Person[]; useCases: UseCase[] };
export type AuditEvent = {
  id: string;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
};
export type SearchHit = { type: "system" | "use_case" | "artifact" | "person"; id: string; title: string; subtitle: string | null };
export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "write";
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  token?: string;
};

// AI governance
export type Me = { orgId: string; role: string; actor: { userId: string; label: string }; isCouncil: boolean };
export type CouncilStage = {
  id: string;
  name: string;
  description: string | null;
  position: number;
  rule: string;
  minTier: string;
  members: { userId: string; name: string; email: string }[];
};
export type AiRequest = {
  id: string;
  title: string;
  vendor: string | null;
  url: string | null;
  kind: string;
  systemId: string | null;
  teamId: string | null;
  requesterUserId: string | null;
  capability: string;
  businessCase: string;
  dataDescription: string | null;
  expectedUsers: number | null;
  estimatedCost: string | null;
  personalData: boolean;
  confidentialData: boolean;
  writeAccess: boolean;
  autonomous: boolean;
  customerFacing: boolean;
  peopleDecisions: boolean;
  trainsOnData: string;
  riskTier: string;
  status: string;
  conditions: string | null;
  resultSystemId: string | null;
  submittedAt: string;
  decidedAt: string | null;
  requesterName: string | null;
  teamName: string | null;
  systemName: string | null;
  currentStep?: string | null;
  awaitingMe?: boolean;
};
export type AiRequestDetail = AiRequest & {
  resultSystem: { id: string; name: string } | null;
  risk: { tier: string; reasons: string[] };
  steps: {
    id: string;
    name: string;
    rule: string;
    status: string;
    position: number;
    completedAt: string | null;
    reviewers: { userId: string; name: string }[];
    /** User ids that approved the step in its current round. */
    approvedBy: string[];
  }[];
  events: { id: string; type: string; actorLabel: string; comment: string | null; conditions: string | null; stepId: string | null; createdAt: string }[];
  permissions: { canDecide: boolean; alreadyApproved: boolean; canEdit: boolean; canWithdraw: boolean };
};
export type AiInventory = {
  tools: {
    systemId: string;
    name: string;
    vendor: string | null;
    lifecycle: string;
    riskTier: string;
    approvedAt: string | null;
    reviewDueAt: string | null;
    reviewOverdue: boolean;
    capabilities: { approved: number; restricted: number; prohibited: number };
    latestUsage: { recordedOn: string; activeUsers: number; licensedSeats: number | null } | null;
    adoptionRate: number | null;
    teams: { adopted: number; piloting: number; total: number };
  }[];
  summary: {
    tools: number;
    approvedCapabilities: number;
    openRequests: number;
    decidedRequests: number;
    avgDaysToDecision: number | null;
    averageAdoption: number | null;
    reviewsOverdue: number;
  };
};
export type AiDetails = {
  profile: {
    riskTier: string;
    approvedAt: string | null;
    reviewDueAt: string | null;
    targetUsers: number | null;
    conditions: string | null;
    notes: string | null;
  } | null;
  capabilities: { id: string; name: string; status: string; notes: string | null; requestId: string | null }[];
  usage: { id: string; recordedOn: string; activeUsers: number; licensedSeats: number | null }[];
  adoptionRate: number | null;
  rollouts: { teamId: string; teamName: string; status: string; adoptedAt: string | null }[];
  requests: { id: string; title: string; capability: string; status: string; submittedAt: string }[];
};
