import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Card, ErrorBanner, Field, Input, PageHeader } from "../components/ui.tsx";
import { api, type ApiToken } from "../lib/api.ts";
import { authClient } from "../lib/auth.ts";
import { timeAgo } from "../lib/format.ts";

function TokensCard() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api.get<ApiToken[]>("/tokens") });
  const create = useMutation({
    mutationFn: () => api.post<ApiToken>("/tokens", { name }),
    onSuccess: (t) => {
      setCreated(t.token ?? null);
      setName("");
      qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });
  const active = tokens.data?.filter((t) => !t.revokedAt) ?? [];

  return (
    <Card title="API tokens">
      <p className="mb-4 text-sm text-stone-500">
        Tokens let scripts and integrations use the Patch REST API as you. Send them as <code className="text-xs">Authorization: Bearer &lt;token&gt;</code>.
      </p>
      <ErrorBanner error={create.error ?? revoke.error} />
      {created && (
        <div className="mb-4 rounded-md border border-leaf-200 bg-leaf-50 p-3 text-sm">
          <div className="font-medium text-leaf-800">Copy your new token now. It will not be shown again.</div>
          <code className="mt-2 block break-all rounded bg-white px-2 py-1 text-xs">{created}</code>
        </div>
      )}
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. CMDB sync" className="max-w-xs" />
        <Button type="submit" variant="secondary" disabled={!name.trim() || create.isPending}>
          Create token
        </Button>
      </form>
      {active.length > 0 && (
        <ul className="divide-y divide-stone-100">
          {active.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <div className="font-medium text-stone-800">{t.name}</div>
                <div className="text-xs text-stone-500">
                  <code>{t.prefix}…</code> · created {timeAgo(t.createdAt)}
                  {t.lastUsedAt ? ` · last used ${timeAgo(t.lastUsedAt)}` : " · never used"}
                </div>
              </div>
              <Button variant="ghost" onClick={() => confirm(`Revoke ${t.name}?`) && revoke.mutate(t.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MembersCard() {
  const org = authClient.useActiveOrganization();
  const config = useQuery({ queryKey: ["config"], queryFn: () => fetch("/api/config").then((r) => r.json()) });
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const { error } = await authClient.organization.inviteMember({ email, role: "member" });
    if (error) return setError(error.message ?? "Could not invite");
    setMessage(
      config.data?.mailEnabled
        ? `Invitation sent to ${email}.`
        : `Invitation created for ${email}. Email delivery is not configured; ask them to sign up with this address and open /accept-invitation from the server log.`,
    );
    setEmail("");
    org.refetch();
  }

  return (
    <Card title="Members">
      <ul className="mb-4 divide-y divide-stone-100">
        {org.data?.members.map((m) => (
          <li key={m.id} className="flex items-center justify-between py-2 text-sm">
            <div>
              <div className="font-medium text-stone-800">{m.user.name}</div>
              <div className="text-xs text-stone-500">{m.user.email}</div>
            </div>
            <span className="text-xs text-stone-500 capitalize">{m.role}</span>
          </li>
        ))}
      </ul>
      <ErrorBanner error={error} />
      {message && <p className="mb-3 text-sm text-leaf-800">{message}</p>}
      <form onSubmit={invite} className="flex gap-2">
        <Field label="Invite by email">
          <div className="flex gap-2">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" />
            <Button type="submit" variant="secondary">
              Invite
            </Button>
          </div>
        </Field>
      </form>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <MembersCard />
        <TokensCard />
      </div>
    </>
  );
}
