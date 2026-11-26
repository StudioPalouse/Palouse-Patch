# Patch architecture

## Goals

1. **One codebase, one container.** The hosted SaaS and self-hosted installs run the same Docker image; only configuration differs.
2. **API first.** The web UI, the public REST API and the MCP server all call the same core services, so authorization, validation and audit logging are written once.
3. **Cheap to run.** Low memory, no Redis or extra services until they are needed. Postgres handles storage, search and (later) background jobs.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node 22, running TypeScript directly via type stripping (no server build step) |
| HTTP | Hono |
| Database | Postgres 16 with Drizzle ORM and SQL migrations in `drizzle/` |
| Auth | Better Auth: email and password, organizations, invitations. API tokens for the REST API and MCP. OAuth 2.1 authorization server for MCP clients (`@better-auth/mcp`, `@better-auth/cimd`). SSO (OIDC/SAML) comes later |
| UI | React SPA (Vite, TanStack Router and Query, Tailwind), served as static files by the same process |
| Validation | Zod schemas in `src/shared/domain.ts`, shared by API and UI |

## Layout

```
src/
  shared/   enums and validation used by server and browser
  db/       schema, client, migrations runner
  core/     domain services: the only code that touches tenant data
  server/   Hono app, auth, REST routes, request context
  web/      React SPA
drizzle/    generated SQL migrations
deploy/     Fly.io config for the hosted database
test/       integration tests against a real Postgres
```

## Request flow

```
browser / script ──► /api/v1 route ──►  requireOrg  ─────────┐
                                        (session cookie or   │
                                         bearer token)       ├─►  Ctx  ──►  core service  ──►  Postgres
AI assistant ──────► /mcp tool ───────►  API token or      ──┘           (org scoped,
                                         OAuth access token
                                                                          validated, audited)
```

The MCP server (`src/server/mcp.ts`) is stateless: each POST builds a fresh MCP server bound to the caller's `Ctx`, so nothing is held in memory between requests. Its tools are thin calls into core, exactly like the REST routes.

`Ctx` carries the org id, the caller's role and an actor (user or API token). Core services take a `Ctx` as their first argument and never trust ids from the client: references to other records are checked with `assertInOrg` so one tenant can never link to another tenant's data.

### OAuth for MCP clients

Patch is its own OAuth 2.1 authorization server (Better Auth's `mcp()` plugin, issuer `/api/auth`) for one protected resource, the `/mcp` endpoint.

1. A client calls `/mcp` without a token and gets a 401 whose `WWW-Authenticate` header points at `/.well-known/oauth-protected-resource`. That names the authorization server, whose metadata is at `/.well-known/oauth-authorization-server/api/auth`.
2. The client registers, either with a client ID metadata document (its `client_id` is an HTTPS URL Patch fetches) or through open dynamic client registration. PKCE is required.
3. The user signs in on `/sign-in`. The page's query string is the signed authorization request, which the auth client sends back so the flow resumes. Users in several orgs choose one on `/oauth/organization` (Better Auth's `postLogin` step). Then `/oauth/consent` shows the client, the org and the access. Write access (`patch:write`) is opt-in there.
4. Consent is stored per org (the consent `reference_id`). The access token is a JWT bound to `/mcp` with the org in an `org_id` claim, and it lasts an hour. Refresh tokens last 30 days.
5. `/mcp` verifies the JWT (signature from the `jwks` table, issuer, audience, expiry, scope), then `ctxFromOAuth` checks live that the user is still a member of `org_id`. The role is read live too. Without `patch:write` the `Ctx` gets the read-only database handle described below. Audit entries read "Jane Doe (via Claude)". The client name is self-declared, except that a metadata document client's id is its URL.

OAuth needs an HTTPS `PATCH_BASE_URL` (or localhost). Otherwise the plugins aren't loaded and `/mcp` accepts API tokens only. Tokens with the `patch_` prefix always take the API token path.

### Read-only tokens

API tokens are scoped `read` or `write`. For a read-only token, `ctxFromApiToken` gives the `Ctx` a database handle (`readOnlyDb` in `src/core/context.ts`) whose `insert`, `update`, `delete` and `execute` throw 403, including inside transactions. Core services do every write through `ctx.db`, so the scope holds for REST, MCP and any future entry point without a check in each service. Side effects that are not database writes, such as sending email, call `requireWritable(ctx)` first.

## Multi-tenancy

Shared database, shared schema. Every tenant table has `organization_id`, and all access goes through `src/core`. Postgres row level security can be added later as defense in depth. A self-hosted install is simply a deployment with one organization.

## Domain model

| Entity | Notes |
|---|---|
| Organization, Member | Managed by Better Auth. Roles: owner, admin, member |
| Team | Department or business unit; not tied to logins |
| Person | Directory entry for owners and champions; doesn't need a login. Linked to a user (by email) when they create, join or are added to the org, and every member gets one. Patch access (member, invited, none) is derived from membership and pending invitations |
| System | A tool or application. Lifecycle (evaluating, pilot, active, sunsetting, retired), criticality, and `isPlatform` for creation platforms |
| SystemOwner | Person + role (business, technical, admin, champion) on a system |
| UseCase | What the business does with one or more systems and artifacts |
| Artifact | Something built on a platform system (flow, app, form, bot, agent...), with external URL and id |
| AuditEvent | Append-only log of every change with a field level diff |
| ApiToken | Personal token for the REST API and MCP server, scoped read or write; only a SHA-256 hash is stored |
| OAuth client, consent, refresh token | Managed by Better Auth's OAuth provider for MCP clients. A consent's `reference_id` is the org it was given for |
| AiReviewStage | One stage of the org's AI council review order: reviewers (logins), an "any one" or "all" rule, and the minimum risk tier it applies to |
| AiRequest | A request to bring in an AI tool, an AI feature of an existing system, or an agent. Intake answers compute a risk tier (low, medium, high) |
| AiRequestStep, AiRequestEvent | The stages copied onto a request when it's submitted, plus its timeline of decisions and comments |
| AiProfile | Puts a system in the AI inventory: risk tier, approval and re-review dates, expected users, conditions |
| AiCapability | An AI capability of a system, ruled approved, restricted or prohibited, optionally linked to the request that approved it |
| AiUsageSnapshot, AiTeamRollout | Adoption: active users vs seats per day (entered by hand or through the API) and each team's rollout status |

### AI governance flow

1. Admins set up the AI council in Settings as ordered stages (for example Security, then Privacy and Legal for medium risk and above, then an executive sponsor for high risk only).
2. Any member submits a request. The yes/no intake answers compute the risk tier (`assessRisk` in `src/shared/domain.ts`), and the applicable stages are copied onto the request as steps.
3. Reviewers for the active step approve, request changes (back to the requester, who resubmits; stages already passed stay passed), or reject. A requester never reviews their own request. A stage with no eligible reviewers falls back to org admins, and with no stages configured an admin approves.
4. When the last step is approved, the request is added to the inventory: its system is linked or created, given an AI profile, and the capability is recorded (restricted if reviewers attached conditions).
5. Reviewers and requesters are emailed at each step through `src/core/notify.ts`, which the server wires to Resend.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Hosting

The hosted version runs on Fly.io in the `palouse-patch` organization: one auto-stopping app machine (`palouse-patch`) and one self-managed Postgres machine (`palouse-patch-db`) with a volume. See [operations.md](operations.md).
