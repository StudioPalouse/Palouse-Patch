# Patch roadmap

Where Patch is going and what's waiting. Add new ideas under **Investigate** with the question to answer. Move an item to **Shipped** (with the date) once it's merged to main.

## Shipped

| Date | What |
|---|---|
| 2026-11 | MVP catalog: systems, owners, use cases, artifacts, teams, search, activity log, REST API and tokens, Docker and Fly deploy |
| 2026-11 | Email through Resend: invitations, password reset (self-service and admin-triggered) |
| 2026-11 | Work-email-only sign-up (`PATCH_REQUIRE_WORK_EMAIL`) |
| 2026-11 | Dark mode (system, light or dark; saved per browser) |
| 2026-11 | People who haven't joined Patch: name owners before they join, Patch access status, invite from a person, automatic linking on join |
| 2026-11 | AI governance: AI council review stages with risk tiers, AI tool requests, AI inventory (AI profiles on systems), capability rulings, usage snapshots and team rollout |

## Next

1. **MCP server follow-ups.** Read tools with API tokens are built (see Shipped once merged). Still to do:
   - OAuth 2.1 so clients can connect without pasting a token: authorization server through Better Auth, protected-resource metadata, a consent page. A token's org is the one active at consent.
   - Write tools, starting with `request_ai_tool` (through the normal council review). They need a token with write scope.
2. **SSO**: OIDC and SAML.
3. **CSV import and export** for systems, people and the AI inventory.
4. **Database backups**: nightly `pg_dump` from the Fly Postgres machine to object storage, with a tested restore. Deferred 2026-11-22.

## Later

- **Licenses and usage:** contracts, seats, cost, renewal reminders through a Postgres-backed job queue (pg-boss), usage snapshots for all systems, not just AI tools.
- **Rollouts and adoption:** initiatives to roll a system out to teams, stages, champions, training resources and feedback. Builds on the AI team-rollout data.
- **AI governance follow-ups:**
  - Let reviewers override a request's computed risk tier, with a reason, and re-plan its remaining stages.
  - Reminder emails for re-reviews coming due and for requests waiting too long at one stage.
  - Usage integrations (Microsoft 365 Copilot, ChatGPT Enterprise and Claude admin APIs) that post usage snapshots automatically.
  - Customisable intake questions per org.
- Postgres row-level security as defence in depth for multi-tenancy.

## Investigate

### MCP gateway for AI agents

**Question:** should Patch act as an MCP gateway: a single, governed MCP endpoint through which AI agents reach the tools catalogued in Patch? This is separate from the MCP server above, which only exposes Patch's own data.

Why it might fit: Patch already knows which systems exist, who owns them, which AI capabilities the council approved, and under what conditions. A gateway could enforce that, so an agent only reaches tools and capabilities that are approved, and every call is logged against the system and the agent.

To find out:
- Demand: do target customers want the gateway inside their catalog, or would they rather use their identity provider, API gateway or an existing MCP gateway product, with Patch supplying the policy?
- Policy model: how approved capabilities, conditions and risk tiers map to allow and deny rules per agent, user and tool, and whether agents should be registered as artifacts.
- Authentication: OAuth 2.1 for agents, per-user delegation versus service identities, and storing downstream credentials (a secrets vault would be a new dependency).
- Architecture: proxying third-party MCP servers versus hosting connectors, latency, and whether the gateway fits the "one container, cheap to run" goal or needs to be a separate service.
- Audit and adoption: whether gateway traffic can replace hand-entered usage snapshots as the adoption source.
- Security: prompt-injection and tool-poisoning risks of proxying third-party servers, and tenant isolation for hosted customers.
- Build versus integrate: survey existing open source MCP gateways and the current state of the MCP specification before committing.

Outcome wanted: a short recommendation (build, integrate or skip) with a rough scope. Logged 2026-11-22, to pick up after the AI governance features settle.

## Operations housekeeping

- Disconnect the repository from Fly's GitHub integration so it stops opening launch PRs.
- Set `PATCH_ALLOW_SIGNUP=false` on the hosted app once the first teams have signed up.
