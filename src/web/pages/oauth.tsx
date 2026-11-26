import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, ErrorBanner, Field, Input, Loading } from "../components/ui.tsx";
import { authClient, oauthRedirect } from "../lib/auth.ts";
import { slugify } from "../lib/format.ts";
import { Shell } from "./auth.tsx";

/**
 * Pages Patch's OAuth server sends the user to while an MCP client (Claude,
 * VS Code...) connects. Their query string is signed by the server; the auth
 * client sends it back with each call, so don't rewrite the URL.
 */

const query = () => new URLSearchParams(window.location.search);

const SCOPE_TEXT: Record<string, string> = {
  "patch:read": "Read your organization's catalog: systems, owners, use cases, artifacts and AI rulings",
  "patch:write": "Make changes in Patch on your behalf",
  offline_access: "Stay connected without asking you to sign in again",
};

/** Turn an auth client result into the next location, or an error message. */
async function go(result: Promise<{ data: unknown; error: { message?: string } | null }>, fallback: string) {
  const { data, error } = await result;
  if (error) throw new Error(error.message ?? fallback);
  const url = oauthRedirect(data);
  if (!url) throw new Error(fallback);
  window.location.href = url;
}

function useOrgs() {
  return useQuery({
    queryKey: ["oauth", "orgs"],
    queryFn: async () => {
      const [orgs, session] = await Promise.all([authClient.organization.list(), authClient.getSession()]);
      if (orgs.error) throw new Error(orgs.error.message ?? "Could not load your organizations");
      return { orgs: orgs.data ?? [], activeId: session.data?.session.activeOrganizationId ?? null };
    },
  });
}

/** Post-login step: choose which org the client connects to (or create the first one). */
export function OAuthOrganizationPage() {
  const orgs = useOrgs();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");

  async function choose(organizationId: string) {
    setBusy(true);
    setError(null);
    try {
      const active = await authClient.organization.setActive({ organizationId });
      if (active.error) throw new Error(active.error.message ?? "Could not choose that organization");
      await go(authClient.oauth2.continue({ postLogin: true }), "Could not continue connecting");
    } catch (err) {
      setBusy(false);
      setError((err as Error).message);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.organization.create({ name, slug: `${slugify(name) || "org"}-${Math.random().toString(36).slice(2, 6)}` });
    if (error || !data) {
      setBusy(false);
      return setError(error?.message ?? "Could not create organization");
    }
    await choose(data.id);
  }

  if (orgs.isPending) return <Shell title="Choose an organization"><Loading /></Shell>;
  const list = orgs.data?.orgs ?? [];

  if (list.length === 0)
    return (
      <Shell title="Name your organization">
        <p className="mb-4 text-sm text-stone-500">You need an organization in Patch before an assistant can connect to it.</p>
        <form onSubmit={create} className="space-y-4">
          <ErrorBanner error={error ?? orgs.error} />
          <Field label="Organization name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating…" : "Continue"}
          </Button>
        </form>
      </Shell>
    );

  return (
    <Shell title="Choose an organization">
      <p className="mb-4 text-sm text-stone-500">The assistant you're connecting will only see this organization. You can connect others later.</p>
      <ErrorBanner error={error ?? orgs.error} />
      <ul className="space-y-2">
        {list.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => choose(o.id)}
              className="flex w-full items-center justify-between rounded-lg border border-stone-200 px-4 py-3 text-left text-sm font-medium text-stone-800 hover:border-leaf-600 hover:bg-stone-50 disabled:opacity-50"
            >
              {o.name}
              {o.id === orgs.data?.activeId && <span className="text-xs font-normal text-stone-500">Current</span>}
            </button>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

/** Consent: show who's asking, for which org and what access, then allow or deny. */
export function OAuthConsentPage() {
  const params = query();
  const clientId = params.get("client_id") ?? "";
  const requested = (params.get("scope") ?? "").split(" ").filter(Boolean);
  const canChooseWrite = requested.includes("patch:write") && requested.includes("patch:read");
  const [allowWrite, setAllowWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const orgs = useOrgs();
  const client = useQuery({
    queryKey: ["oauth", "client", clientId],
    queryFn: async () => {
      const { data, error } = await authClient.oauth2.publicClient({ query: { client_id: clientId } });
      if (error) throw new Error(error.message ?? "Unknown application");
      return data;
    },
    enabled: !!clientId,
  });

  // Same rule as the server: the active org if you belong to it, else your only org.
  const list = orgs.data?.orgs ?? [];
  const org = list.find((o) => o.id === orgs.data?.activeId) ?? (list.length === 1 ? list[0] : undefined);

  // A client id that's a URL is a client metadata document: its domain is the one thing a client can't fake.
  let domain: string | undefined;
  try {
    if (clientId.startsWith("https://")) domain = new URL(clientId).hostname;
  } catch {}
  const name = client.data?.client_name || domain || "An application";
  const granted = requested.filter((s) => s !== "patch:write" || !canChooseWrite || allowWrite);
  const shown = granted.filter((s) => SCOPE_TEXT[s]);

  async function decide(accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      await go(authClient.oauth2.consent(accept ? { accept, scope: granted.join(" ") } : { accept }), "Could not finish connecting");
    } catch (err) {
      setBusy(false);
      setError((err as Error).message);
    }
  }

  if (client.isPending || orgs.isPending) return <Shell title="Connect to Patch"><Loading /></Shell>;

  return (
    <Shell title={`Connect ${name} to Patch`}>
      <ErrorBanner error={error ?? client.error ?? orgs.error} />
      <p className="text-sm text-stone-600">
        <span className="font-medium text-stone-900">{name}</span> wants to access{" "}
        <span className="font-medium text-stone-900">{org?.name ?? "your organization"}</span> as you.
      </p>
      <p className="mt-1 text-xs text-stone-500">
        {domain ? `Identified by ${domain}.` : "This application named itself; only continue if you just asked it to connect to Patch."}
      </p>

      <div className="mt-5 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">It will be able to</p>
        <ul className="space-y-1.5 text-sm text-stone-700">
          {shown.map((s) => (
            <li key={s} className="flex gap-2">
              <span aria-hidden className="text-leaf-700">✓</span>
              {SCOPE_TEXT[s]}
            </li>
          ))}
        </ul>
        {canChooseWrite && (
          <label className="mt-3 flex items-start gap-2 rounded-lg border border-stone-200 p-3 text-sm text-stone-700">
            <input type="checkbox" className="mt-0.5" checked={allowWrite} onChange={(e) => setAllowWrite(e.target.checked)} />
            <span>
              Also allow changes
              <span className="block text-xs text-stone-500">Leave this off to connect read-only.</span>
            </span>
          </label>
        )}
      </div>

      <p className="mt-5 text-xs text-stone-500">It can do only what you can do in Patch, and loses access if you leave the organization.</p>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => decide(false)}>
          Deny
        </Button>
        <Button className="flex-1" disabled={busy || !org} onClick={() => decide(true)}>
          {busy ? "Connecting…" : "Allow"}
        </Button>
      </div>
    </Shell>
  );
}
