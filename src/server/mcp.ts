import type { Context } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z, ZodError } from "zod";
import { db } from "../db/client.ts";
import * as aiInventory from "../core/ai-inventory.ts";
import * as artifacts from "../core/artifacts.ts";
import type { Ctx } from "../core/context.ts";
import { AppError, notFound } from "../core/errors.ts";
import * as people from "../core/people.ts";
import { search } from "../core/search.ts";
import * as systems from "../core/systems.ts";
import * as teams from "../core/teams.ts";
import { ctxFromApiToken, ctxFromOAuth, isApiToken } from "../core/tokens.ts";
import * as useCases from "../core/use-cases.ts";
import { ARTIFACT_STATUSES, ARTIFACT_TYPES, LIFECYCLES, USE_CASE_STATUSES } from "../shared/domain.ts";
import { requireMcpAuth } from "@better-auth/mcp";
import { auth, MCP_RESOURCE, mcpOAuthEnabled, ORG_CLAIM } from "./auth.ts";
import { config } from "./config.ts";

/**
 * MCP server at /mcp so assistants (Claude, Copilot...) can query Patch.
 *
 * Stateless Streamable HTTP: each POST gets a fresh server bound to the
 * caller's Ctx, so nothing is held in memory between requests and the app can
 * keep auto-stopping. Like the REST API, every tool is a thin call into
 * src/core, which does the org scoping, authorization and audit logging.
 * Callers authenticate with either a Patch API token or an OAuth access token:
 * MCP clients discover Patch's authorization server from the 401 challenge,
 * register (client metadata document or dynamic registration), and the user
 * signs in and picks an org on the consent page. See docs/ARCHITECTURE.md.
 */

const INSTRUCTIONS = `Patch is this organization's catalog of business systems and AI tools: which systems exist, who owns them, what the business uses them for (use cases), what has been built on them (artifacts such as flows, apps and agents), and the AI council's rulings on AI tools.
Start with "search" when you only have a name or keyword. Tools accept a record's id or its name. Every record includes a "url" to its page in Patch; share it when you cite something.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const link = (path: string) => `${config.baseUrl}${path}`;

/** Drop fields an assistant never needs. */
function slim<T extends Record<string, unknown>>(row: T) {
  const { organizationId, ...rest } = row;
  return rest;
}

type Named = { id: string; name: string };

/** A tool result an assistant can't act on yet: several records match the name. */
class Ambiguous extends Error {
  what: string;
  matches: Named[];
  constructor(what: string, matches: Named[]) {
    super(`More than one ${what} matches`);
    this.what = what;
    this.matches = matches;
  }
}

/**
 * Find one record by id or name: an exact (case-insensitive) name wins, then a
 * single partial match. Several partial matches are returned for the assistant
 * to choose from.
 */
async function resolve(what: string, ref: string, byId: (id: string) => Promise<Named>, byName: (q: string) => Promise<Named[]>): Promise<Named> {
  const term = ref.trim();
  if (UUID.test(term)) {
    const { id, name } = await byId(term);
    return { id, name };
  }
  const rows = await byName(term);
  const exact = rows.filter((r) => r.name.toLowerCase() === term.toLowerCase());
  const only = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : undefined;
  if (only) return { id: only.id, name: only.name };
  if (rows.length === 0) throw notFound(what[0]!.toUpperCase() + what.slice(1));
  throw new Ambiguous(what, (exact.length ? exact : rows).slice(0, 20).map((r) => ({ id: r.id, name: r.name })));
}

const systemRef = (ctx: Ctx, ref: string) => resolve("system", ref, (id) => systems.getSystem(ctx, id), (q) => systems.listSystems(ctx, { q }));
const personRef = (ctx: Ctx, ref: string) => resolve("person", ref, (id) => people.getPerson(ctx, id), (q) => people.listPeople(ctx, { q }));
const teamRef = (ctx: Ctx, ref: string) => resolve("team", ref, (id) => teams.getTeam(ctx, id), (q) => teams.listTeams(ctx, { q }));

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const failure = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

/** Run a tool, turning expected errors into tool results the assistant can read and recover from. */
function tool<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return json(await fn(args));
    } catch (err) {
      if (err instanceof Ambiguous)
        return {
          ...json({ ambiguous: true, message: `${err.message}. Call again with one of these ids.`, matches: err.matches }),
          isError: true,
        };
      if (err instanceof AppError) return failure(err.message);
      if (err instanceof ZodError) return failure(err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
      console.error(err);
      return failure("Something went wrong in Patch");
    }
  };
}

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const ref = (what: string) => z.string().min(1).describe(`The ${what}'s id or name`);

export function createMcpServer(ctx: Ctx) {
  const server = new McpServer({ name: "patch", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "search",
    {
      title: "Search Patch",
      description: "Search systems, use cases, artifacts and people by name or keyword. Returns up to 10 of each.",
      inputSchema: { query: z.string().min(1).describe("Words to look for") },
      annotations: readOnly,
    },
    tool(async ({ query }: { query: string }) => {
      const paths = { system: "/systems/", use_case: "/use-cases/", artifact: "/artifacts/", person: "/people/" };
      const hits = await search(ctx, query);
      return hits.map((h) => ({ ...h, url: link(paths[h.type] + h.id) }));
    }),
  );

  server.registerTool(
    "list_systems",
    {
      title: "List systems",
      description: "List the systems (tools and applications) in the catalog, optionally filtered. Includes owners and counts of use cases and artifacts.",
      inputSchema: {
        query: z.string().optional().describe("Match against name, vendor, category or description"),
        lifecycle: z.enum(LIFECYCLES).optional(),
        isPlatform: z.boolean().optional().describe("Only platforms that artifacts are built on (true) or only other systems (false)"),
      },
      annotations: readOnly,
    },
    tool(async (a: { query?: string; lifecycle?: string; isPlatform?: boolean }) => {
      const rows = await systems.listSystems(ctx, { q: a.query, lifecycle: a.lifecycle, isPlatform: a.isPlatform });
      return rows.map((s) => ({
        id: s.id,
        name: s.name,
        vendor: s.vendor,
        category: s.category,
        lifecycle: s.lifecycle,
        criticality: s.criticality,
        isPlatform: s.isPlatform,
        owners: s.owners.map((o) => ({ name: o.name, role: o.role })),
        useCaseCount: s.useCaseCount,
        artifactCount: s.artifactCount,
        url: link(`/systems/${s.id}`),
      }));
    }),
  );

  server.registerTool(
    "get_system",
    {
      title: "Get a system",
      description: "Full details of one system: description, lifecycle, owners, the use cases it supports and the artifacts built on it.",
      inputSchema: { system: ref("system") },
      annotations: readOnly,
    },
    tool(async ({ system }: { system: string }) => {
      const { owners, useCases: ucs, artifacts: arts, ...rest } = await systems.getSystem(ctx, (await systemRef(ctx, system)).id);
      return {
        ...slim(rest),
        url: link(`/systems/${rest.id}`),
        owners: owners.map((o) => ({ personId: o.personId, name: o.name, email: o.email, role: o.role, patchAccess: o.access })),
        useCases: ucs.map((u) => ({ id: u.id, title: u.title, status: u.status, url: link(`/use-cases/${u.id}`) })),
        artifacts: arts.map((x) => ({ id: x.id, name: x.name, type: x.type, status: x.status, owner: x.ownerName, url: link(`/artifacts/${x.id}`) })),
      };
    }),
  );

  server.registerTool(
    "find_owner",
    {
      title: "Find owners",
      description:
        "Who owns a system (its business, technical, admin and champion owners), or, given a person, which systems and artifacts they own. Pass exactly one of system or person.",
      inputSchema: { system: ref("system").optional(), person: ref("person").optional() },
      annotations: readOnly,
    },
    tool(async (a: { system?: string; person?: string }) => {
      if (!!a.system === !!a.person) throw new AppError(400, "bad_request", "Pass exactly one of system or person");
      if (a.system) {
        const s = await systemRef(ctx, a.system);
        const full = await systems.getSystem(ctx, s.id);
        return {
          system: { id: full.id, name: full.name, url: link(`/systems/${full.id}`) },
          owners: full.owners.map((o) => ({
            personId: o.personId,
            name: o.name,
            email: o.email,
            role: o.role,
            patchAccess: o.access,
            url: link(`/people/${o.personId}`),
          })),
        };
      }
      const p = await personRef(ctx, a.person!);
      const full = await people.getPerson(ctx, p.id);
      return {
        person: { id: full.id, name: full.name, email: full.email, title: full.title, team: full.teamName, url: link(`/people/${full.id}`) },
        systems: full.systems.map((s) => ({ id: s.id, name: s.name, role: s.role, url: link(`/systems/${s.id}`) })),
        artifacts: full.artifacts.map((x) => ({ id: x.id, name: x.name, type: x.type, system: x.systemName, url: link(`/artifacts/${x.id}`) })),
      };
    }),
  );

  server.registerTool(
    "list_use_cases",
    {
      title: "List use cases",
      description: "What the business does with its systems. Filter by text, status, team or system.",
      inputSchema: {
        query: z.string().optional().describe("Match against title, description or business value"),
        status: z.enum(USE_CASE_STATUSES).optional(),
        team: ref("team").optional(),
        system: ref("system").optional(),
      },
      annotations: readOnly,
    },
    tool(async (a: { query?: string; status?: string; team?: string; system?: string }) => {
      const teamId = a.team ? (await teamRef(ctx, a.team)).id : undefined;
      const systemId = a.system ? (await systemRef(ctx, a.system)).id : undefined;
      const rows = await useCases.listUseCases(ctx, { q: a.query, status: a.status, teamId, systemId });
      return rows.map((u) => ({ ...slim(u), url: link(`/use-cases/${u.id}`) }));
    }),
  );

  server.registerTool(
    "find_artifacts",
    {
      title: "Find artifacts",
      description: "Things built on platform systems: flows, apps, forms, bots, agents and so on. Filter by text, system, owner, type or status.",
      inputSchema: {
        query: z.string().optional().describe("Match against name or description"),
        system: ref("platform system").optional(),
        owner: ref("owner (person)").optional(),
        type: z.enum(ARTIFACT_TYPES).optional(),
        status: z.enum(ARTIFACT_STATUSES).optional(),
      },
      annotations: readOnly,
    },
    tool(async (a: { query?: string; system?: string; owner?: string; type?: string; status?: string }) => {
      const systemId = a.system ? (await systemRef(ctx, a.system)).id : undefined;
      const ownerId = a.owner ? (await personRef(ctx, a.owner)).id : undefined;
      const rows = await artifacts.listArtifacts(ctx, { q: a.query, systemId, ownerId, type: a.type, status: a.status });
      return rows.map((x) => ({ ...slim(x), url: link(`/artifacts/${x.id}`) }));
    }),
  );

  server.registerTool(
    "list_ai_tools",
    {
      title: "List AI tools",
      description:
        "The AI inventory and the AI council's rulings. Without a system: every AI tool with its risk tier, review dates, capability counts and adoption. With a system: its AI profile, each capability ruled approved, restricted (with conditions) or prohibited, adoption by team, and its AI requests.",
      inputSchema: { system: ref("system").optional() },
      annotations: readOnly,
    },
    tool(async ({ system }: { system?: string }) => {
      if (!system) {
        const inv = await aiInventory.listInventory(ctx);
        return { summary: inv.summary, tools: inv.tools.map((t) => ({ ...t, url: link(`/systems/${t.systemId}`) })) };
      }
      const s = await systemRef(ctx, system);
      const ai = await aiInventory.getAiDetails(ctx, s.id);
      return {
        system: { id: s.id, name: s.name, url: link(`/systems/${s.id}`) },
        inInventory: !!ai.profile,
        profile: ai.profile && slim(ai.profile),
        capabilities: ai.capabilities.map(slim),
        latestUsage: ai.usage[0] ? slim(ai.usage[0]) : null,
        adoptionRate: ai.adoptionRate,
        teamRollout: ai.rollouts,
        requests: ai.requests.map((r) => ({ ...r, url: link(`/ai/requests/${r.id}`) })),
      };
    }),
  );

  return server;
}

const jsonRpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: status === 401 ? -32001 : -32000, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

async function serve(req: Request, ctx: Ctx) {
  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}

/** Either scope lets a client read; `patch:write` implies read. */
const canRead = (required: string, granted: ReadonlySet<string>) => granted.has(required) || (required === "patch:read" && granted.has("patch:write"));

/**
 * OAuth access tokens: JWTs from Patch's own authorization server, checked for
 * signature, issuer, expiry and audience (this endpoint). Missing or invalid
 * tokens get a 401 whose WWW-Authenticate header points at the protected
 * resource metadata, which is how MCP clients discover where to sign in.
 */
async function handleOAuthClaims(req: Request, claims: Record<string, unknown>) {
  const orgId = claims[ORG_CLAIM];
  const clientId = claims.azp ?? claims.client_id;
  if (typeof claims.sub !== "string" || typeof orgId !== "string" || typeof clientId !== "string") {
    return jsonRpcError(401, "This access token isn't for a Patch organization. Reconnect to Patch.", { "www-authenticate": `Bearer error="invalid_token"` });
  }
  const scopes = typeof claims.scope === "string" ? claims.scope.split(" ") : [];
  const ctx = await ctxFromOAuth(db, { userId: claims.sub, orgId, clientId, scopes });
  if (!ctx) return jsonRpcError(403, "You are no longer a member of the organization this connection was made for");
  return serve(req, ctx);
}

// Created only when OAuth is on: requireMcpAuth rejects a non-HTTPS resource URL.
const handleOAuth = mcpOAuthEnabled
  ? requireMcpAuth(auth, handleOAuthClaims, { resource: MCP_RESOURCE, requiredScopes: ["patch:read"], isScopeSatisfied: canRead })
  : undefined;

/** Hono handler for /mcp. */
export async function handleMcp(c: Context) {
  if (c.req.method !== "POST") {
    // Stateless: no server-initiated stream (GET) and no session to end (DELETE).
    return jsonRpcError(405, "Method not allowed", { allow: "POST" });
  }
  // Bearer tokens only: never fall back to the browser session cookie.
  const header = c.req.header("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  if (bearer && isApiToken(bearer)) {
    const ctx = await ctxFromApiToken(db, bearer);
    if (!ctx) return jsonRpcError(401, "Invalid or expired API token", { "www-authenticate": `Bearer realm="Patch", error="invalid_token"` });
    return serve(c.req.raw, ctx);
  }
  if (handleOAuth) return handleOAuth(c.req.raw);
  return jsonRpcError(401, bearer ? "Invalid or expired API token" : "A Patch API token is required (Authorization: Bearer <token>)", {
    "www-authenticate": `Bearer realm="Patch"${bearer ? `, error="invalid_token"` : ""}`,
  });
}
