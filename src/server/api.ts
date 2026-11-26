import { Hono } from "hono";
import * as aiCouncil from "../core/ai-council.ts";
import * as aiInventory from "../core/ai-inventory.ts";
import * as aiRequests from "../core/ai-requests.ts";
import * as artifacts from "../core/artifacts.ts";
import { listAudit } from "../core/audit.ts";
import * as members from "../core/members.ts";
import * as people from "../core/people.ts";
import { search } from "../core/search.ts";
import * as systems from "../core/systems.ts";
import * as teams from "../core/teams.ts";
import * as tokens from "../core/tokens.ts";
import * as useCases from "../core/use-cases.ts";
import { AppError } from "../core/errors.ts";
import { auth } from "./auth.ts";
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

  .get("/me", async (c) => {
    const ctx = ctxOf(c);
    const isCouncil = await aiCouncil.isCouncilMember(ctx.db, ctx.orgId, ctx.actor.userId);
    return c.json({ data: { orgId: ctx.orgId, role: ctx.role, actor: ctx.actor, readOnly: !!ctx.readOnly, isCouncil } });
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

  // AI council (review stages)
  .get("/ai/council", async (c) => c.json({ data: await aiCouncil.listStages(ctxOf(c)) }))
  .post("/ai/council/stages", async (c) => c.json({ data: await aiCouncil.createStage(ctxOf(c), await body(c)) }, 201))
  .put("/ai/council/order", async (c) => {
    await aiCouncil.reorderStages(ctxOf(c), (await body(c))?.ids);
    return c.body(null, 204);
  })
  .put("/ai/council/stages/:id", async (c) =>
    c.json({ data: await aiCouncil.updateStage(ctxOf(c), c.req.param("id"), await body(c)) }),
  )
  .delete("/ai/council/stages/:id", async (c) => {
    await aiCouncil.deleteStage(ctxOf(c), c.req.param("id"));
    return c.body(null, 204);
  })

  // AI tool requests
  .get("/ai/requests", async (c) => {
    const status = str(c.req.query("status"));
    aiRequests.assertKnownStatus(status);
    return c.json({
      data: await aiRequests.listRequests(ctxOf(c), {
        q: str(c.req.query("q")),
        status,
        mine: c.req.query("mine") === "true",
        awaiting: c.req.query("awaiting") === "me",
      }),
    });
  })
  .post("/ai/requests", async (c) => c.json({ data: await aiRequests.createRequest(ctxOf(c), await body(c)) }, 201))
  .get("/ai/requests/:id", async (c) => c.json({ data: await aiRequests.getRequest(ctxOf(c), c.req.param("id")) }))
  .put("/ai/requests/:id", async (c) =>
    c.json({ data: await aiRequests.resubmitRequest(ctxOf(c), c.req.param("id"), await body(c)) }),
  )
  .post("/ai/requests/:id/decision", async (c) =>
    c.json({ data: await aiRequests.decideRequest(ctxOf(c), c.req.param("id"), await body(c)) }),
  )
  .post("/ai/requests/:id/comments", async (c) => {
    await aiRequests.commentOnRequest(ctxOf(c), c.req.param("id"), await body(c));
    return c.body(null, 204);
  })
  .post("/ai/requests/:id/withdraw", async (c) =>
    c.json({ data: await aiRequests.withdrawRequest(ctxOf(c), c.req.param("id")) }),
  )

  // AI inventory and adoption
  .get("/ai/inventory", async (c) => c.json({ data: await aiInventory.listInventory(ctxOf(c)) }))
  .get("/systems/:id/ai", async (c) => c.json({ data: await aiInventory.getAiDetails(ctxOf(c), c.req.param("id")) }))
  .put("/systems/:id/ai", async (c) =>
    c.json({ data: await aiInventory.saveAiProfile(ctxOf(c), c.req.param("id"), await body(c)) }),
  )
  .delete("/systems/:id/ai", async (c) => {
    await aiInventory.removeAiProfile(ctxOf(c), c.req.param("id"));
    return c.body(null, 204);
  })
  .post("/systems/:id/ai/capabilities", async (c) =>
    c.json({ data: await aiInventory.addCapability(ctxOf(c), c.req.param("id"), await body(c)) }, 201),
  )
  .put("/systems/:id/ai/capabilities/:capabilityId", async (c) =>
    c.json({
      data: await aiInventory.updateCapability(ctxOf(c), c.req.param("id"), c.req.param("capabilityId"), await body(c)),
    }),
  )
  .delete("/systems/:id/ai/capabilities/:capabilityId", async (c) => {
    await aiInventory.deleteCapability(ctxOf(c), c.req.param("id"), c.req.param("capabilityId"));
    return c.body(null, 204);
  })
  .post("/systems/:id/ai/usage", async (c) =>
    c.json({ data: await aiInventory.recordUsage(ctxOf(c), c.req.param("id"), await body(c)) }, 201),
  )
  .delete("/systems/:id/ai/usage/:snapshotId", async (c) => {
    await aiInventory.deleteUsage(ctxOf(c), c.req.param("id"), c.req.param("snapshotId"));
    return c.body(null, 204);
  })
  .put("/systems/:id/ai/rollouts/:teamId", async (c) =>
    c.json({ data: await aiInventory.setRollout(ctxOf(c), c.req.param("id"), c.req.param("teamId"), await body(c)) }),
  )

  // Members (admin actions)
  .post("/members/:userId/password-reset", async (c) =>
    c.json({
      data: await members.sendMemberPasswordReset(ctxOf(c), c.req.param("userId"), async (email) => {
        await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
      }),
    }),
  )

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
