import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AI_CAPABILITY_STATUSES, REVIEW_RULES, RISK_TIERS, ROLLOUT_STATUSES, label } from "../../shared/domain.ts";
import { api, type AiDetails, type CouncilStage } from "../lib/api.ts";
import { authClient } from "../lib/auth.ts";
import { percent } from "../lib/format.ts";
import { AdoptionBar, RiskBadge, useMe } from "../pages/ai.tsx";
import { Badge, Button, Card, EnumSelect, ErrorBanner, Field, Input, Select, TextLink, Textarea } from "./ui.tsx";

const today = () => new Date().toISOString().slice(0, 10);

function ProfileForm({ systemId, profile, onDone }: { systemId: string; profile: AiDetails["profile"]; onDone: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    riskTier: profile?.riskTier ?? "medium",
    reviewDueAt: profile?.reviewDueAt ?? "",
    targetUsers: profile?.targetUsers ?? null,
    conditions: profile?.conditions ?? "",
    notes: profile?.notes ?? "",
  });
  const save = useMutation({
    mutationFn: () => api.put(`/systems/${systemId}/ai`, v),
    onSuccess: () => {
      qc.invalidateQueries();
      onDone();
    },
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <ErrorBanner error={save.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Risk tier">
          <EnumSelect values={RISK_TIERS} value={v.riskTier} onChange={(riskTier) => setV({ ...v, riskTier })} />
        </Field>
        <Field label="Re-review by">
          <Input type="date" value={v.reviewDueAt} onChange={(e) => setV({ ...v, reviewDueAt: e.target.value })} />
        </Field>
        <Field label="Expected users" hint="Used when seats are unknown">
          <Input
            type="number"
            min={0}
            value={v.targetUsers ?? ""}
            onChange={(e) => setV({ ...v, targetUsers: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </Field>
      </div>
      <Field label="Conditions of use">
        <Textarea value={v.conditions} onChange={(e) => setV({ ...v, conditions: e.target.value })} placeholder="No customer data; human review before sending" />
      </Field>
      <Field label="Notes">
        <Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {profile ? "Save" : "Add to AI inventory"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** AI governance and adoption for one system. Shown on the system page. */
export function AiSystemCard({ systemId }: { systemId: string }) {
  const qc = useQueryClient();
  const me = useMe();
  const canGovern = me.data?.isCouncil || me.data?.role === "admin" || me.data?.role === "owner";
  const details = useQuery({ queryKey: ["system-ai", systemId], queryFn: () => api.get<AiDetails>(`/systems/${systemId}/ai`) });
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState({ name: "", status: "approved" });
  const [usage, setUsage] = useState({ recordedOn: today(), activeUsers: "", licensedSeats: "" });
  const done = () => qc.invalidateQueries();
  const addCap = useMutation({
    mutationFn: () => api.post(`/systems/${systemId}/ai/capabilities`, cap),
    onSuccess: () => {
      setCap({ name: "", status: "approved" });
      done();
    },
  });
  const setCapStatus = useMutation({
    mutationFn: (c: { id: string; name: string; notes: string | null; status: string }) =>
      api.put(`/systems/${systemId}/ai/capabilities/${c.id}`, { name: c.name, notes: c.notes, status: c.status }),
    onSuccess: done,
  });
  const removeCap = useMutation({ mutationFn: (id: string) => api.del(`/systems/${systemId}/ai/capabilities/${id}`), onSuccess: done });
  const record = useMutation({
    mutationFn: () =>
      api.post(`/systems/${systemId}/ai/usage`, {
        recordedOn: usage.recordedOn,
        activeUsers: Number(usage.activeUsers),
        licensedSeats: usage.licensedSeats === "" ? null : Number(usage.licensedSeats),
      }),
    onSuccess: () => {
      setUsage({ recordedOn: today(), activeUsers: "", licensedSeats: "" });
      done();
    },
  });
  const removeUsage = useMutation({ mutationFn: (id: string) => api.del(`/systems/${systemId}/ai/usage/${id}`), onSuccess: done });
  const rollout = useMutation({
    mutationFn: (r: { teamId: string; status: string }) => api.put(`/systems/${systemId}/ai/rollouts/${r.teamId}`, { status: r.status }),
    onSuccess: done,
  });
  const removeProfile = useMutation({ mutationFn: () => api.del(`/systems/${systemId}/ai`), onSuccess: done });

  const d = details.data;
  if (!d) return null;
  const error = addCap.error ?? setCapStatus.error ?? removeCap.error ?? record.error ?? removeUsage.error ?? rollout.error ?? removeProfile.error;

  if (!d.profile) {
    if (!canGovern && d.requests.length === 0) return null;
    return (
      <Card title="AI governance">
        {editing ? (
          <ProfileForm systemId={systemId} profile={null} onDone={() => setEditing(false)} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-stone-600">
            <span>This system isn't in the AI inventory. Add it if it has AI capabilities your council has reviewed.</span>
            {canGovern && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Add to AI inventory
              </Button>
            )}
          </div>
        )}
        <RequestList requests={d.requests} />
      </Card>
    );
  }

  const p = d.profile;
  const maxUsers = Math.max(1, ...d.usage.map((u) => u.licensedSeats ?? u.activeUsers));
  const history = [...d.usage].reverse().slice(-12);

  return (
    <Card
      title="AI governance and adoption"
      actions={
        canGovern &&
        !editing && (
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              disabled={removeProfile.isPending}
              onClick={() => confirm("Remove this system from the AI inventory? Capabilities, usage and rollout data stay with the system.") && removeProfile.mutate()}
            >
              Remove
            </Button>
          </div>
        )
      }
    >
      <ErrorBanner error={error} />
      {editing ? (
        <ProfileForm systemId={systemId} profile={p} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <RiskBadge tier={p.riskTier} />
          <span className="text-stone-600">Approved {p.approvedAt ? new Date(p.approvedAt).toLocaleDateString() : "–"}</span>
          <span className={p.reviewDueAt && p.reviewDueAt < today() ? "font-medium text-red-700" : "text-stone-600"}>
            Re-review by {p.reviewDueAt ?? "–"}
          </span>
          {p.conditions && <p className="basis-full text-amber-800">Conditions: {p.conditions}</p>}
          {p.notes && <p className="basis-full whitespace-pre-wrap text-stone-600">{p.notes}</p>}
        </div>
      )}

      <h3 className="mt-6 mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">Capabilities</h3>
      {d.capabilities.length === 0 ? (
        <p className="text-sm text-stone-500">No capabilities recorded.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {d.capabilities.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="text-stone-800">{c.name}</div>
                {c.notes && <div className="text-xs text-amber-800">{c.notes}</div>}
                {c.requestId && (
                  <div className="text-xs">
                    <TextLink to={`/ai/requests/${c.requestId}`}>View request</TextLink>
                  </div>
                )}
              </div>
              {canGovern ? (
                <div className="flex shrink-0 items-center gap-1">
                  <div className="w-32">
                    <EnumSelect values={AI_CAPABILITY_STATUSES} value={c.status} onChange={(status) => setCapStatus.mutate({ ...c, status })} />
                  </div>
                  <Button variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => confirm(`Remove "${c.name}"?`) && removeCap.mutate(c.id)}>
                    ✕
                  </Button>
                </div>
              ) : (
                <Badge value={c.status} />
              )}
            </li>
          ))}
        </ul>
      )}
      {canGovern && (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (cap.name.trim()) addCap.mutate();
          }}
        >
          <Input value={cap.name} onChange={(e) => setCap({ ...cap, name: e.target.value })} placeholder="Add a capability, e.g. Code completion" className="min-w-48 flex-1" />
          <div className="w-36">
            <EnumSelect values={AI_CAPABILITY_STATUSES} value={cap.status} onChange={(status) => setCap({ ...cap, status })} />
          </div>
          <Button type="submit" variant="secondary" disabled={addCap.isPending}>
            Add
          </Button>
        </form>
      )}

      <h3 className="mt-6 mb-2 flex items-center justify-between text-xs font-semibold tracking-wide text-stone-500 uppercase">
        <span>Usage</span>
        <AdoptionBar rate={d.adoptionRate} />
      </h3>
      {history.length > 0 && (
        <div className="mb-3">
          <div className="flex h-24 items-end gap-1" role="img" aria-label="Active users over time">
            {history.map((u) => (
              <div key={u.id} className="group relative flex-1" style={{ height: "100%" }}>
                <div className="absolute bottom-0 w-full rounded-t bg-stone-200" style={{ height: `${((u.licensedSeats ?? u.activeUsers) / maxUsers) * 100}%` }} />
                <div className="absolute bottom-0 w-full rounded-t bg-leaf-600" style={{ height: `${(u.activeUsers / maxUsers) * 100}%` }} />
                <div className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 rounded bg-stone-800 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white group-hover:block">
                  {u.recordedOn}: {u.activeUsers}
                  {u.licensedSeats ? ` / ${u.licensedSeats}` : ""}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-stone-400">
            <span>{history[0]!.recordedOn}</span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-leaf-600" />
              active
              <span className="mr-1 ml-3 inline-block h-2 w-2 rounded-sm bg-stone-200" />
              seats
            </span>
            <span>{history.at(-1)!.recordedOn}</span>
          </div>
        </div>
      )}
      {d.usage.length > 0 && (
        <ul className="mb-2 max-h-40 divide-y divide-stone-100 overflow-auto text-sm">
          {d.usage.map((u) => (
            <li key={u.id} className="flex items-center justify-between py-1.5">
              <span className="text-stone-600 tabular-nums">{u.recordedOn}</span>
              <span className="tabular-nums">
                {u.activeUsers} active{u.licensedSeats ? ` / ${u.licensedSeats} seats (${percent(u.activeUsers / u.licensedSeats)})` : ""}
              </span>
              <Button variant="ghost" aria-label="Delete usage record" onClick={() => removeUsage.mutate(u.id)}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (usage.activeUsers !== "") record.mutate();
        }}
      >
        <Field label="Date">
          <Input type="date" required value={usage.recordedOn} onChange={(e) => setUsage({ ...usage, recordedOn: e.target.value })} />
        </Field>
        <Field label="Active users">
          <Input type="number" min={0} required value={usage.activeUsers} onChange={(e) => setUsage({ ...usage, activeUsers: e.target.value })} className="w-28" />
        </Field>
        <Field label="Seats">
          <Input type="number" min={0} value={usage.licensedSeats} onChange={(e) => setUsage({ ...usage, licensedSeats: e.target.value })} className="w-28" />
        </Field>
        <Button type="submit" variant="secondary" disabled={record.isPending}>
          Record usage
        </Button>
      </form>
      <p className="mt-1 text-xs text-stone-500">
        Automate this with <code>POST /api/v1/systems/{systemId}/ai/usage</code> and an API token.
      </p>

      <h3 className="mt-6 mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">Team rollout</h3>
      {d.rollouts.length === 0 ? (
        <p className="text-sm text-stone-500">
          Add <TextLink to="/teams">teams</TextLink> to track rollout by team.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {d.rollouts.map((r) => (
            <li key={r.teamId} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="text-stone-800">{r.teamName}</span>
              <div className="w-36">
                <EnumSelect values={ROLLOUT_STATUSES} value={r.status} onChange={(status) => rollout.mutate({ teamId: r.teamId, status })} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <RequestList requests={d.requests} />
    </Card>
  );
}

function RequestList({ requests }: { requests: AiDetails["requests"] }) {
  if (requests.length === 0) return null;
  return (
    <>
      <h3 className="mt-6 mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">AI requests</h3>
      <ul className="space-y-1 text-sm">
        {requests.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <TextLink to={`/ai/requests/${r.id}`}>{r.capability}</TextLink>
            <Badge value={r.status} />
          </li>
        ))}
      </ul>
    </>
  );
}

type StageDraft = { name: string; description: string; rule: string; minTier: string; memberUserIds: string[] };
const emptyStage: StageDraft = { name: "", description: "", rule: "any", minTier: "low", memberUserIds: [] };

function StageForm({ initial, onSave, onCancel, saving, submitLabel }: { initial: StageDraft; onSave: (s: StageDraft) => void; onCancel?: () => void; saving: boolean; submitLabel: string }) {
  const org = authClient.useActiveOrganization();
  const [v, setV] = useState(initial);
  return (
    <form
      className="space-y-3 rounded-md border border-stone-200 bg-stone-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Stage name">
          <Input required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Security review" />
        </Field>
        <Field label="Who must approve">
          <EnumSelect values={REVIEW_RULES} value={v.rule} onChange={(rule) => setV({ ...v, rule })} />
        </Field>
        <Field label="Applies to">
          <Select value={v.minTier} onChange={(e) => setV({ ...v, minTier: e.target.value })}>
            <option value="low">Every request</option>
            <option value="medium">Medium and high risk</option>
            <option value="high">High risk only</option>
          </Select>
        </Field>
      </div>
      <Field label="Description">
        <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="What this stage checks" />
      </Field>
      <div>
        <div className="mb-1.5 text-sm font-medium text-stone-700">Reviewers</div>
        <div className="max-h-40 space-y-1 overflow-auto rounded-md border border-stone-200 bg-white p-2">
          {org.data?.members.map((m) => (
            <label key={m.userId} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-stone-50">
              <input
                type="checkbox"
                className="h-4 w-4 accent-leaf-700"
                checked={v.memberUserIds.includes(m.userId)}
                onChange={(e) =>
                  setV({ ...v, memberUserIds: e.target.checked ? [...v.memberUserIds, m.userId] : v.memberUserIds.filter((x) => x !== m.userId) })
                }
              />
              {m.user.name} <span className="text-xs text-stone-400">{m.user.email}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

const tierText: Record<string, string> = { low: "every request", medium: "medium and high risk", high: "high risk only" };

/** Settings card: who is on the AI council and the order they review in. */
export function AiCouncilCard() {
  const qc = useQueryClient();
  const me = useMe();
  const isAdmin = me.data?.role === "admin" || me.data?.role === "owner";
  const stages = useQuery({ queryKey: ["ai-council"], queryFn: () => api.get<CouncilStage[]>("/ai/council") });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ai-council"] });
  const create = useMutation({ mutationFn: (s: StageDraft) => api.post("/ai/council/stages", s), onSuccess: () => (setAdding(false), refresh()) });
  const update = useMutation({
    mutationFn: ({ id, ...s }: StageDraft & { id: string }) => api.put(`/ai/council/stages/${id}`, s),
    onSuccess: () => (setEditing(null), refresh()),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/ai/council/stages/${id}`), onSuccess: refresh });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.put("/ai/council/order", { ids }), onSuccess: refresh });
  const list = stages.data ?? [];
  const move = (i: number, by: number) => {
    const ids = list.map((s) => s.id);
    [ids[i], ids[i + by]] = [ids[i + by]!, ids[i]!];
    reorder.mutate(ids);
  };

  return (
    <Card title={<span id="ai-council">AI council</span>} className="lg:col-span-2">
      <p className="mb-4 text-sm text-stone-600">
        AI tool requests go through these stages in order. Each request's risk tier, worked out from the intake questions, decides which stages apply. With no stages set up, admins approve requests.
      </p>
      <ErrorBanner error={create.error ?? update.error ?? remove.error ?? reorder.error} />
      {list.length === 0 && !adding && <p className="mb-4 text-sm text-stone-500">No review stages yet.</p>}
      <ol className="mb-4 space-y-3">
        {list.map((s, i) =>
          editing === s.id ? (
            <li key={s.id}>
              <StageForm
                initial={{ name: s.name, description: s.description ?? "", rule: s.rule, minTier: s.minTier, memberUserIds: s.members.map((m) => m.userId) }}
                onSave={(v) => update.mutate({ ...v, id: s.id })}
                onCancel={() => setEditing(null)}
                saving={update.isPending}
                submitLabel="Save stage"
              />
            </li>
          ) : (
            <li key={s.id} className="flex items-start gap-3 rounded-md border border-stone-200 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-xs font-semibold text-leaf-800">{i + 1}</span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium text-stone-900">{s.name}</div>
                {s.description && <div className="text-stone-600">{s.description}</div>}
                <div className="mt-1 text-xs text-stone-500">
                  {label(s.rule)} · {tierText[s.minTier]} · {s.members.length ? s.members.map((m) => m.name).join(", ") : <span className="text-amber-700">no reviewers (admins will approve)</span>}
                </div>
              </div>
              {isAdmin && (
                <div className="flex shrink-0 items-center">
                  <Button variant="ghost" aria-label="Move up" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>
                    ↑
                  </Button>
                  <Button variant="ghost" aria-label="Move down" disabled={i === list.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>
                    ↓
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(s.id)}>
                    Edit
                  </Button>
                  <Button variant="ghost" onClick={() => confirm(`Remove the "${s.name}" stage? Requests already in review keep their steps.`) && remove.mutate(s.id)}>
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ),
        )}
      </ol>
      {isAdmin &&
        (adding ? (
          <StageForm initial={emptyStage} onSave={(v) => create.mutate(v)} onCancel={() => setAdding(false)} saving={create.isPending} submitLabel="Add stage" />
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add a review stage
          </Button>
        ))}
    </Card>
  );
}
