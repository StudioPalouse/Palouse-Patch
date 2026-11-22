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
| Auth | Better Auth: email and password, organizations, invitations. SSO (OIDC/SAML) and OAuth for MCP come later |
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
browser / script / (later) MCP client
        │
        ▼
  Hono route  ──►  requireOrg middleware  ──►  core service  ──►  Postgres
                   (session cookie or            (org scoped,
                    bearer API token → Ctx)        validated, audited)
```

`Ctx` carries the org id, the caller's role and an actor (user or API token). Core services take a `Ctx` as their first argument and never trust ids from the client: references to other records are checked with `assertInOrg` so one tenant can never link to another tenant's data.

## Multi-tenancy

Shared database, shared schema. Every tenant table has `organization_id`, and all access goes through `src/core`. Postgres row level security can be added later as defense in depth. A self-hosted install is simply a deployment with one organization.

## Domain model

| Entity | Notes |
|---|---|
| Organization, Member | Managed by Better Auth. Roles: owner, admin, member |
| Team | Department or business unit; not tied to logins |
| Person | Directory entry for owners and champions. Optional link to a user |
| System | A tool or application. Lifecycle (evaluating, pilot, active, sunsetting, retired), criticality, and `isPlatform` for creation platforms |
| SystemOwner | Person + role (business, technical, admin, champion) on a system |
| UseCase | What the business does with one or more systems and artifacts |
| Artifact | Something built on a platform system (flow, app, form, bot, agent...), with external URL and id |
| AuditEvent | Append-only log of every change with a field level diff |
| ApiToken | Personal token for the REST API; only a SHA-256 hash is stored |

## Roadmap

1. **MVP (this release):** catalog, owners, use cases, artifacts, teams, search, activity log, REST API and tokens, Docker and Fly deploy.
2. **Agentic:** MCP server at `/mcp` (Streamable HTTP, OAuth 2.1 plus API tokens), read tools first (`search`, `get_system`, `find_owner`, `list_use_cases`, `find_artifacts`), then write tools. OIDC/SAML SSO. CSV import and export.
3. **Licenses and usage:** contracts, seats, cost, renewal reminders (via a Postgres-backed job queue such as pg-boss), usage snapshots.
4. **Rollouts and adoption:** initiatives to roll a system out to teams, stages, champions, training resources, feedback, adoption metrics, and an AI tool register.

## Hosting

The hosted version runs on Fly.io in the `palouse-patch` organization: one auto-stopping app machine (`palouse-patch`) and one self-managed Postgres machine (`palouse-patch-db`) with a volume. See [operations.md](operations.md).
