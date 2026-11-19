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
export type Owner = { id: string; systemId: string; role: string; personId: string; name: string; email: string | null };
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
export type Person = {
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
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  token?: string;
};
