import { Hono } from "hono";
import * as artifacts from "../core/artifacts.ts";
import { listAudit } from "../core/audit.ts";
import * as people from "../core/people.ts";
import { search } from "../core/search.ts";
import * as systems from "../core/systems.ts";
import * as teams from "../core/teams.ts";
import * as tokens from "../core/tokens.ts";
import * as useCases from "../core/use-cases.ts";
import { AppError } from "../core/errors.ts";
import { ctxOf, requireOrg, type Env } from "./context.ts";

const str = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
const bool = (v: string | undefined) => (v === undefined ? undefined : v === "true");

async function body(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return (await c.req.json()) as any;
  } catch {
    throw new AppError(400, "bad_request", "Request body must be JSON");
  }
}

/** REST API v1. Thin: parse the request, call core, return JSON. */
export const api = new Hono<Env>()
  .use("*", requireOrg)

  .get("/me", (c) => {
    const ctx = ctxOf(c);
    return c.json({ orgId: ctx.orgId, role: ctx.role, actor: ctx.actor });
  })
  .get("/search", async (c) => c.json({ data: await search(ctxOf(c), c.req.query("q") ?? "") }))
  .get("/activity", async (c) => {
    const before = str(c.req.query("before"));
    return c.json({
      data: await listAudit(ctxOf(c), {
        entityType: str(c.req.query("entityType")),
        entityId: str(c.req.query("entityId")),
        before: before ? new Date(before) : undefined,
        limit: Number(c.req.query("limit") ?? 50),
      }),
    });
  })

  // Systems
  .get("/systems", async (c) =>
    c.json({
      data: await systems.listSystems(ctxOf(c), {
        q: str(c.req.query("q")),
        lifecycle: str(c.req.query("lifecycle")),
        isPlatform: bool(c.req.query("isPlatform")),
      }),
    }),
  )
  .post("/systems", async (c) => c.json({ data: await systems.createSystem(ctxOf(c), await body(c)) }, 201))
  .get("/systems/:id", async (c) => c.json({ data: await systems.getSystem(ctxOf(c), c.req.param("id")) }))
  .put("/systems/:id", async (c) =>
    c.json({ data: await systems.updateSystem(ctxOf(c), c.req.param("id"), await body(c)) }),
  )
  .delete("/systems/:id", async (c) => {
    await systems.deleteSystem(ctxOf(c), c.req.param("id"));
    return c.body(null, 204);
  })
  .post("/systems/:id/owners", async (c) =>
    c.json({ data: await systems.addSystemOwner(ctxOf(c), c.req.param("id"), await body(c)) }, 201),
  )
  .delete("/systems/:id/owners/:ownershipId", async (c) => {
    await systems.removeSystemOwner(ctxOf(c), c.req.param("id"), c.req.param("ownershipId"));
    return c.body(null, 204);
  })

  // Use cases
  .get("/use-cases", async (c) =>
    c.json({
      data: await useCases.listUseCases(ctxOf(c), {
        q: str(c.req.query("q")),
        status: str(c.req.query("status")),
        teamId: str(c.req.query("teamId")),
        systemId: str(c.req.query("systemId")),
      }),
    }),
  )
  .post("/use-cases", async (c) => c.json({ data: await useCases.createUseCase(ctxOf(c), await body(c)) }, 201))
  .get("/use-cases/:id", async (c) => c.json({ data: await useCases.getUseCase(ctxOf(c), c.req.param("id")) }))
  .put("/use-cases/:id", async (c) =>
    c.json({ data: await useCases.updateUseCase(ctxOf(c), c.req.param("id"), await body(c)) }),
  )
  .delete("/use-cases/:id", async (c) => {
    await useCases.deleteUseCase(ctxOf(c), c.req.param("id"));
    return c.body(null, 204);
  })

  // Artifacts
  .get("/artifacts", async (c) =>
    c.json({
      data: await artifacts.listArtifacts(ctxOf(c), {
        q: str(c.req.query("q")),
        systemId: str(c.req.query("systemId")),
        ownerId: str(c.req.query("ownerId")),
        type: str(c.req.query("type")),
        status: str(c.req.query("status")),
      }),
    }),
  )
  .post("/artifacts", async (c) => c.json({ data: await artifacts.createArtifact(ctxOf(c), await body(c)) }, 201))
  .get("/artifacts/:id", async (c) => c.json({ data: await artifacts.getArtifact(ctxOf(c), c.req.param("id")) }))
  .put("/artifacts/:id", async (c) =>
    c.json({ data: await artifacts.updateArtifact(ctxOf(c), c.req.param("id"), await body(c)) }),
  )
  .delete("/artifacts/:id", async (c) => {
    await artifacts.deleteArtifact(ctxOf(c), c.req.param("id"));
    return c.body(null, 204);
  })

  // People
  .get("/people", async (c) =>
    c.json({
      data: await people.listPeople(ctxOf(c), { q: str(c.req.query("q")), teamId: str(c.req.query("teamId")) }),
    }),
  )
  .post("/people", async (c) => c.json({ data: await people.createPerson(ctxOf(c), await body(c)) }, 201))
  .get("/people/:id", async (c) => c.json({ data: await people.getPerson(ctxOf(c), c.req.param("id")) }))
  .put("/people/:id", async (c) =>
    c.json({ data: await people.updatePerson(ctxOf(c), c.req.param("id"), await body(c)) }),
  )
  .delete("/people/:id", async (c) => {
    await people.deletePerson(ctxOf(c), c.req.param("id"));
    return c.body(null, 204);
  })

  // Teams
  .get("/teams", async (c) => c.json({ data: await teams.listTeams(ctxOf(c), { q: str(c.req.query("q")) }) }))
  .post("/teams", async (c) => c.json({ data: await teams.createTeam(ctxOf(c), await body(c)) }, 201))
  .get("/teams/:id", async (c) => c.json({ data: await teams.getTeam(ctxOf(c), c.req.param("id")) }))
  .put("/teams/:id", async (c) => c.json({ data: await teams.updateTeam(ctxOf(c), c.req.param("id"), await body(c)) }))
  .delete("/teams/:id", async (c) => {
    await teams.deleteTeam(ctxOf(c), c.req.param("id"));
    return c.body(null, 204);
  })

  // API tokens (for the calling user)
  .get("/tokens", async (c) => c.json({ data: await tokens.listApiTokens(ctxOf(c)) }))
  .post("/tokens", async (c) => {
    const ctx = ctxOf(c);
    if (ctx.actor.type === "token") throw new AppError(403, "forbidden", "Tokens cannot create tokens");
    return c.json({ data: await tokens.createApiToken(ctx, await body(c)) }, 201);
  })
  .delete("/tokens/:id", async (c) => {
    await tokens.revokeApiToken(ctxOf(c), c.req.param("id"));
    return c.body(null, 204);
  });
