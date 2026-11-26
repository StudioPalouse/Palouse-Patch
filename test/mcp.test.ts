import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import * as aiInventory from "../src/core/ai-inventory.ts";
import * as artifacts from "../src/core/artifacts.ts";
import * as people from "../src/core/people.ts";
import * as systems from "../src/core/systems.ts";
import * as useCases from "../src/core/use-cases.ts";
import { createApiToken } from "../src/core/tokens.ts";
import type { Ctx } from "../src/core/context.ts";
import { makeOrg } from "./helpers.ts";

const app = createApp();
let rpcId = 0;

async function rpc(token: string | undefined, method: string, params: Record<string, unknown> = {}) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
}

/** Call a tool and return its parsed JSON result plus the error flag. */
async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc(token, "tools/call", { name, arguments: args });
  if (body.error) throw new Error(`JSON-RPC error: ${body.error.message}`);
  const text: string = body.result.content[0].text;
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { isError: !!body.result.isError, data };
}

/** An org with a small catalog: Power Platform (owned by Ada), an artifact and a use case, plus ChatGPT in the AI inventory. */
async function seed(ctx: Ctx) {
  const ada = await people.createPerson(ctx, { name: "Ada Lovelace", email: "ada@example.com" });
  const power = await systems.createSystem(ctx, { name: "Power Platform", vendor: "Microsoft", isPlatform: true });
  await systems.createSystem(ctx, { name: "Power BI", vendor: "Microsoft" });
  await systems.addSystemOwner(ctx, power.id, { personId: ada.id, role: "technical" });
  const flow = await artifacts.createArtifact(ctx, { systemId: power.id, name: "Invoice approval flow", type: "flow", ownerId: ada.id });
  const uc = await useCases.createUseCase(ctx, { title: "Approve supplier invoices", systemIds: [power.id], artifactIds: [flow.id] });
  const chatgpt = await systems.createSystem(ctx, { name: "ChatGPT Enterprise", vendor: "OpenAI" });
  await aiInventory.saveAiProfile(ctx, chatgpt.id, { riskTier: "medium" });
  await aiInventory.addCapability(ctx, chatgpt.id, { name: "Summarise documents", status: "approved" });
  await aiInventory.addCapability(ctx, chatgpt.id, { name: "Customer data", status: "prohibited" });
  return { ada, power, flow, uc, chatgpt };
}

describe("MCP server", () => {
  it("requires a bearer API token and ignores everything else", async () => {
    const missing = await rpc(undefined, "tools/list");
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toMatch(/^Bearer /);
    expect((await rpc("patch_nope", "tools/list")).status).toBe(401);
  });

  it("is stateless: GET and DELETE are not allowed", async () => {
    const ctx = await makeOrg();
    const { token } = await createApiToken(ctx, { name: "mcp" });
    for (const method of ["GET", "DELETE"]) {
      const res = await app.request("/mcp", { method, headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(405);
    }
  });

  it("initializes and lists read-only tools", async () => {
    const ctx = await makeOrg();
    const { token } = await createApiToken(ctx, { name: "mcp" });
    const init = await rpc(token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("patch");
    expect(init.body.result.instructions).toMatch(/catalog/);

    const { body } = await rpc(token, "tools/list");
    const names = body.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(["find_artifacts", "find_owner", "get_system", "list_ai_tools", "list_systems", "list_use_cases", "search"]);
    for (const t of body.result.tools) expect(t.annotations.readOnlyHint).toBe(true);
  });

  it("answers catalog questions by name, with links back to Patch", async () => {
    const ctx = await makeOrg();
    const s = await seed(ctx);
    const { token } = await createApiToken(ctx, { name: "mcp" });

    const hits = await callTool(token, "search", { query: "invoice" });
    expect(hits.data.map((h: any) => h.type).sort()).toEqual(["artifact", "use_case"]);
    expect(hits.data.find((h: any) => h.type === "artifact").url).toBe(`http://localhost:3000/artifacts/${s.flow.id}`);

    // "Power Platform" matches exactly even though "Power BI" also contains "Power".
    const sys = await callTool(token, "get_system", { system: "power platform" });
    expect(sys.isError).toBe(false);
    expect(sys.data).toMatchObject({ id: s.power.id, name: "Power Platform", url: `http://localhost:3000/systems/${s.power.id}` });
    expect(sys.data.organizationId).toBeUndefined();
    expect(sys.data.owners).toEqual([expect.objectContaining({ name: "Ada Lovelace", role: "technical" })]);
    expect(sys.data.artifacts[0]).toMatchObject({ name: "Invoice approval flow", owner: "Ada Lovelace" });
    expect(sys.data.useCases[0]).toMatchObject({ title: "Approve supplier invoices" });

    const byId = await callTool(token, "get_system", { system: s.power.id });
    expect(byId.data.name).toBe("Power Platform");

    const owners = await callTool(token, "find_owner", { system: "Power Platform" });
    expect(owners.data.owners).toEqual([expect.objectContaining({ name: "Ada Lovelace", email: "ada@example.com", role: "technical" })]);

    const owned = await callTool(token, "find_owner", { person: "ada" });
    expect(owned.data.systems).toEqual([expect.objectContaining({ name: "Power Platform", role: "technical" })]);
    expect(owned.data.artifacts).toEqual([expect.objectContaining({ name: "Invoice approval flow" })]);

    const ucs = await callTool(token, "list_use_cases", { system: "Power Platform" });
    expect(ucs.data.map((u: any) => u.title)).toEqual(["Approve supplier invoices"]);

    const arts = await callTool(token, "find_artifacts", { owner: "Ada Lovelace", type: "flow" });
    expect(arts.data.map((a: any) => a.name)).toEqual(["Invoice approval flow"]);

    const systemsList = await callTool(token, "list_systems", { isPlatform: true });
    expect(systemsList.data.map((x: any) => x.name)).toEqual(["Power Platform"]);
  });

  it("reports the AI inventory and a tool's capability rulings", async () => {
    const ctx = await makeOrg();
    const s = await seed(ctx);
    const { token } = await createApiToken(ctx, { name: "mcp" });

    const all = await callTool(token, "list_ai_tools");
    expect(all.data.tools).toEqual([
      expect.objectContaining({ name: "ChatGPT Enterprise", riskTier: "medium", capabilities: { approved: 1, restricted: 0, prohibited: 1 } }),
    ]);

    const one = await callTool(token, "list_ai_tools", { system: "ChatGPT" });
    expect(one.data.inInventory).toBe(true);
    expect(one.data.system.id).toBe(s.chatgpt.id);
    expect(one.data.capabilities.map((c: any) => [c.name, c.status]).sort()).toEqual([
      ["Customer data", "prohibited"],
      ["Summarise documents", "approved"],
    ]);
  });

  it("returns readable tool errors for ambiguous, unknown and invalid input", async () => {
    const ctx = await makeOrg();
    await seed(ctx);
    const { token } = await createApiToken(ctx, { name: "mcp" });

    const ambiguous = await callTool(token, "get_system", { system: "Power" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.data.matches.map((m: any) => m.name).sort()).toEqual(["Power BI", "Power Platform"]);

    const unknown = await callTool(token, "get_system", { system: "Salesforce" });
    expect(unknown).toEqual({ isError: true, data: "System not found" });

    const both = await callTool(token, "find_owner", {});
    expect(both).toEqual({ isError: true, data: "Pass exactly one of system or person" });
  });

  it("only ever sees the token's own org", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const s = await seed(a);
    const { token: tokenB } = await createApiToken(b, { name: "b" });

    expect((await callTool(tokenB, "search", { query: "Power" })).data).toEqual([]);
    expect(await callTool(tokenB, "get_system", { system: s.power.id })).toEqual({ isError: true, data: "System not found" });
    expect(await callTool(tokenB, "find_owner", { person: s.ada.id })).toEqual({ isError: true, data: "Person not found" });
    expect((await callTool(tokenB, "list_ai_tools")).data.tools).toEqual([]);
  });

  it("works with a read-only token", async () => {
    const ctx = await makeOrg();
    await seed(ctx);
    const { token } = await createApiToken(ctx, { name: "assistant", scope: "read" });
    expect((await callTool(token, "get_system", { system: "Power Platform" })).isError).toBe(false);
  });
});
