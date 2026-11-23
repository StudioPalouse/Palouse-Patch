import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import {
  AI_REQUEST_KINDS,
  AI_REQUEST_STATUSES,
  AI_RISK_QUESTIONS,
  TRAINING_ANSWERS,
  assessRisk,
  label,
  type RiskAnswers,
} from "../../shared/domain.ts";
import {
  Badge,
  Button,
  Card,
  DetailList,
  EmptyState,
  EnumSelect,
  ErrorBanner,
  ExternalLink,
  Field,
  Input,
  LinkButton,
  Loading,
  PageHeader,
  SearchInput,
  Select,
  Table,
  Td,
  TextLink,
  Textarea,
} from "../components/ui.tsx";
import { api, qs, type AiInventory, type AiRequest, type AiRequestDetail, type Me, type System, type Team } from "../lib/api.ts";
import { percent, timeAgo } from "../lib/format.ts";
import { useDebounced, useEntityForm } from "../lib/hooks.ts";

const riskTone: Record<string, string> = {
  low: "bg-leaf-100 text-leaf-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

export function RiskBadge({ tier }: { tier: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${riskTone[tier] ?? "bg-stone-100"}`}>{label(tier)} risk</span>;
}

export function AdoptionBar({ rate }: { rate: number | null }) {
  if (rate == null) return <span className="text-xs text-stone-400">No usage yet</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-200" role="img" aria-label={`${percent(rate)} adoption`}>
        <div className="h-full rounded-full bg-leaf-600" style={{ width: `${Math.round(rate * 100)}%` }} />
      </div>
      <span className="text-xs text-stone-700 tabular-nums">{percent(rate)}</span>
    </div>
  );
}

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/me") });

function Stat({ label: text, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-xs font-medium tracking-wide text-stone-500 uppercase">{text}</div>
      <div className="mt-1 text-3xl font-semibold text-stone-900 tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

export function AiInventoryPage() {
  const inventory = useQuery({ queryKey: ["ai-inventory"], queryFn: () => api.get<AiInventory>("/ai/inventory") });
  const awaiting = useQuery({ queryKey: ["ai-requests", "awaiting"], queryFn: () => api.get<AiRequest[]>("/ai/requests?awaiting=me") });
  const s = inventory.data?.summary;

  return (
    <>
      <PageHeader
        title="AI tools"
        subtitle="AI tools, features and agents your AI council has approved, and how well they're being adopted."
        actions={
          <>
            <LinkButton to="/ai/requests" variant="secondary">
              All requests
            </LinkButton>
            <LinkButton to="/ai/requests/new">Request an AI tool</LinkButton>
          </>
        }
      />
      {inventory.isPending ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="AI tools in inventory" value={s?.tools ?? 0} hint={s?.reviewsOverdue ? `${s.reviewsOverdue} overdue for re-review` : undefined} />
            <Stat label="Approved capabilities" value={s?.approvedCapabilities ?? 0} />
            <Stat label="Open requests" value={s?.openRequests ?? 0} hint={s?.avgDaysToDecision != null ? `${s.avgDaysToDecision} days to decide on average` : undefined} />
            <Stat label="Average adoption" value={percent(s?.averageAdoption)} hint="Active users vs seats, latest snapshot" />
          </div>

          {!!awaiting.data?.length && (
            <Card title="Waiting for your review" className="mt-6">
              <ul className="divide-y divide-stone-100">
                {awaiting.data.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <TextLink to={`/ai/requests/${r.id}`}>{r.title}</TextLink>
                      <div className="text-xs text-stone-500">
                        {r.currentStep} · requested by {r.requesterName ?? "someone"} {timeAgo(r.submittedAt)}
                      </div>
                    </div>
                    <RiskBadge tier={r.riskTier} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <h2 className="mt-8 mb-3 text-sm font-semibold text-stone-800">Inventory</h2>
          {inventory.data?.tools.length === 0 ? (
            <EmptyState title="No AI tools in the inventory yet" action={<LinkButton to="/ai/requests/new">Request an AI tool</LinkButton>}>
              Approved requests are added here automatically. To register an AI tool you already use, open its system and choose "Add to AI inventory".
            </EmptyState>
          ) : (
            <Table head={["Tool", "Risk", "Capabilities", "Adoption", "Teams adopted", "Re-review"]}>
              {inventory.data?.tools.map((t) => (
                <tr key={t.systemId} className="hover:bg-stone-50">
                  <Td>
                    <TextLink to={`/systems/${t.systemId}`}>{t.name}</TextLink>
                    <div className="text-xs text-stone-500">
                      {[t.vendor, label(t.lifecycle)].filter(Boolean).join(" · ")}
                    </div>
                  </Td>
                  <Td>
                    <RiskBadge tier={t.riskTier} />
                  </Td>
                  <Td className="text-xs text-stone-600">
                    {t.capabilities.approved} approved
                    {t.capabilities.restricted > 0 && <div className="text-amber-700">{t.capabilities.restricted} with conditions</div>}
                    {t.capabilities.prohibited > 0 && <div className="text-red-700">{t.capabilities.prohibited} prohibited</div>}
                  </Td>
                  <Td>
                    <AdoptionBar rate={t.adoptionRate} />
                    {t.latestUsage && (
                      <div className="mt-1 text-xs text-stone-500">
                        {t.latestUsage.activeUsers} active{t.latestUsage.licensedSeats ? ` / ${t.latestUsage.licensedSeats} seats` : ""}
                      </div>
                    )}
                  </Td>
                  <Td className="text-stone-600 tabular-nums">
                    {t.teams.total ? `${t.teams.adopted} / ${t.teams.total}` : "–"}
                    {t.teams.piloting > 0 && <div className="text-xs text-stone-500">{t.teams.piloting} piloting</div>}
                  </Td>
                  <Td className={t.reviewOverdue ? "font-medium text-red-700" : "text-stone-600"}>
                    {t.reviewDueAt ?? "–"}
                    {t.reviewOverdue && <div className="text-xs">Overdue</div>}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </>
  );
}

type Filter = "all" | "mine" | "awaiting";

export function AiRequestsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const debounced = useDebounced(q);
  const requests = useQuery({
    queryKey: ["ai-requests", filter, status, debounced],
    queryFn: () =>
      api.get<AiRequest[]>(
        `/ai/requests${qs({ q: debounced, status, mine: filter === "mine" ? "true" : undefined, awaiting: filter === "awaiting" ? "me" : undefined })}`,
      ),
  });
  const tabs: [Filter, string][] = [
    ["all", "All requests"],
    ["mine", "My requests"],
    ["awaiting", "Waiting for my review"],
  ];

  return (
    <>
      <PageHeader
        title="AI tool requests"
        subtitle="Ask the AI council to review a new tool, an AI feature in a system you already use, or an agent."
        actions={<LinkButton to="/ai/requests/new">Request an AI tool</LinkButton>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-stone-300 bg-white p-0.5 text-sm">
          {tabs.map(([key, text]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded px-3 py-1.5 ${filter === key ? "bg-accent text-on-accent" : "text-stone-600 hover:bg-stone-100"}`}
            >
              {text}
            </button>
          ))}
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Filter requests…" />
        <div className="w-48">
          <EnumSelect values={AI_REQUEST_STATUSES} value={status} onChange={setStatus} allowEmpty emptyLabel="Any status" />
        </div>
      </div>
      {requests.isPending ? (
        <Loading />
      ) : requests.data?.length === 0 ? (
        <EmptyState
          title={filter === "awaiting" ? "Nothing is waiting for you" : "No requests match"}
          action={filter !== "awaiting" && <LinkButton to="/ai/requests/new">Request an AI tool</LinkButton>}
        />
      ) : (
        <Table head={["Request", "Risk", "Status", "Requested by", "Submitted"]}>
          {requests.data?.map((r) => (
            <tr key={r.id} className="hover:bg-stone-50">
              <Td>
                <TextLink to={`/ai/requests/${r.id}`}>{r.title}</TextLink>
                <div className="text-xs text-stone-500">
                  {label(r.kind)}
                  {r.systemName ? ` in ${r.systemName}` : ""} · {r.capability}
                </div>
              </Td>
              <Td>
                <RiskBadge tier={r.riskTier} />
              </Td>
              <Td>
                <Badge value={r.status} />
                {r.currentStep && <div className="mt-1 text-xs text-stone-500">At {r.currentStep}</div>}
                {r.awaitingMe && <div className="mt-1 text-xs font-medium text-leaf-700">Your review</div>}
              </Td>
              <Td className="text-stone-600">
                {r.requesterName ?? "–"}
                {r.teamName && <div className="text-xs text-stone-500">{r.teamName}</div>}
              </Td>
              <Td className="text-stone-600">{timeAgo(r.submittedAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

export function AiRequestFormPage() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const existing = useQuery({ queryKey: ["ai-request", id], queryFn: () => api.get<AiRequestDetail>(`/ai/requests/${id}`), enabled: !!id });
  if (id && existing.isPending) return <Loading />;
  return <AiRequestForm id={id} initial={existing.data} />;
}

function AiRequestForm({ id, initial }: { id?: string; initial?: AiRequestDetail }) {
  const systems = useQuery({ queryKey: ["systems", "", ""], queryFn: () => api.get<System[]>("/systems") });
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api.get<Team[]>("/teams") });
  const f = useEntityForm({
    path: "/ai/requests",
    id,
    detailPath: (rid) => `/ai/requests/${rid}`,
    initial: {
      title: initial?.title ?? "",
      vendor: initial?.vendor ?? "",
      url: initial?.url ?? "",
      kind: initial?.kind ?? "new_tool",
      systemId: initial?.systemId ?? "",
      teamId: initial?.teamId ?? "",
      capability: initial?.capability ?? "",
      businessCase: initial?.businessCase ?? "",
      dataDescription: initial?.dataDescription ?? "",
      expectedUsers: initial?.expectedUsers ?? null,
      estimatedCost: initial?.estimatedCost ?? "",
      personalData: initial?.personalData ?? false,
      confidentialData: initial?.confidentialData ?? false,
      writeAccess: initial?.writeAccess ?? false,
      autonomous: initial?.autonomous ?? false,
      customerFacing: initial?.customerFacing ?? false,
      peopleDecisions: initial?.peopleDecisions ?? false,
      trainsOnData: initial?.trainsOnData ?? "unknown",
    } as Record<string, unknown> & RiskAnswers & { kind: string; systemId: string; teamId: string; expectedUsers: number | null },
  });
  const v = f.values;
  const risk = assessRisk(v);
  const text = (key: string) => ({ value: (v[key] as string) ?? "", onChange: (e: { target: { value: string } }) => f.set(key, e.target.value) });

  return (
    <>
      <PageHeader
        title={id ? `Update ${initial?.title}` : "Request an AI tool"}
        subtitle={id ? "Make the requested changes, then send it back to the council." : "Your AI council reviews every AI tool, feature and agent before it's turned on."}
      />
      <form onSubmit={f.submit} className="grid max-w-5xl gap-6 lg:grid-cols-3">
        <div className="space-y-5 rounded-lg border border-stone-200 bg-white p-6 lg:col-span-2">
          <ErrorBanner error={f.error} />
          <Field label="What are you requesting?">
            <EnumSelect
              values={AI_REQUEST_KINDS}
              value={v.kind}
              onChange={(k) => f.setValues((prev) => ({ ...prev, kind: k, systemId: k === "new_tool" ? "" : prev.systemId }))}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={v.kind === "new_tool" ? "Tool name" : v.kind === "agent" ? "Agent name" : "Feature name"} error={f.fieldErrors.title}>
              <Input required autoFocus {...text("title")} placeholder={v.kind === "feature" ? "Copilot in Outlook" : "ChatGPT Enterprise"} />
            </Field>
            {v.kind === "new_tool" ? (
              <Field label="Vendor" error={f.fieldErrors.vendor}>
                <Input {...text("vendor")} />
              </Field>
            ) : (
              <Field label={v.kind === "agent" ? "Platform it's built on" : "System it's part of"} error={f.fieldErrors.systemId}>
                <Select {...text("systemId")}>
                  <option value="">Choose a system…</option>
                  {systems.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <Field label="What will the AI do?" error={f.fieldErrors.capability} hint="The capability you want approved, in a sentence">
            <Input required {...text("capability")} placeholder="Summarise meeting notes and draft follow-up emails" />
          </Field>
          <Field label="Why do you need it?" error={f.fieldErrors.businessCase} hint="The problem it solves and the value you expect">
            <Textarea required rows={4} {...text("businessCase")} />
          </Field>
          <Field label="What data will it see?" error={f.fieldErrors.dataDescription}>
            <Textarea {...text("dataDescription")} placeholder="Internal meeting transcripts; no customer records" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Team">
              <Select {...text("teamId")}>
                <option value="">None</option>
                {teams.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expected users" error={f.fieldErrors.expectedUsers}>
              <Input
                type="number"
                min={0}
                value={v.expectedUsers ?? ""}
                onChange={(e) => f.set("expectedUsers", e.target.value === "" ? null : Number(e.target.value))}
              />
            </Field>
            <Field label="Estimated cost" error={f.fieldErrors.estimatedCost}>
              <Input {...text("estimatedCost")} placeholder="$30 / user / month" />
            </Field>
          </div>
          <Field label="Website" error={f.fieldErrors.url}>
            <Input type="url" {...text("url")} placeholder="https://" />
          </Field>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-stone-800">Risk questions</h2>
            <p className="mt-1 text-xs text-stone-500">Your answers set the risk tier, which decides which council stages review the request.</p>
            <div className="mt-4 space-y-3">
              {AI_RISK_QUESTIONS.map((q) => (
                <label key={q.key} className="flex items-start gap-2 text-sm text-stone-700">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-leaf-700" checked={!!v[q.key]} onChange={(e) => f.set(q.key, e.target.checked)} />
                  {q.label}
                </label>
              ))}
              <Field label="Does the vendor train its models on your data?">
                <EnumSelect values={TRAINING_ANSWERS} value={v.trainsOnData} onChange={(t) => f.set("trainsOnData", t as RiskAnswers["trainsOnData"])} />
              </Field>
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-5" aria-live="polite">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-800">Risk tier</h2>
              <RiskBadge tier={risk.tier} />
            </div>
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-stone-600">
              {risk.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={f.saving}>
              {f.saving ? "Submitting…" : id ? "Resubmit for review" : "Submit for review"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => history.back()}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}

const eventText: Record<string, string> = {
  submitted: "submitted the request",
  resubmitted: "updated and resubmitted the request",
  approved: "approved",
  changes_requested: "asked for changes",
  rejected: "rejected the request",
  withdrawn: "withdrew the request",
  comment: "commented",
};

const stepDot: Record<string, string> = {
  approved: "bg-leaf-600 border-leaf-600",
  active: "bg-white border-sky-500 ring-4 ring-sky-100",
  rejected: "bg-red-600 border-red-600",
  waiting: "bg-white border-stone-300",
};

function DecisionPanel({ request }: { request: AiRequestDetail }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [conditions, setConditions] = useState("");
  const decide = useMutation({
    mutationFn: (decision: string) => api.post(`/ai/requests/${request.id}/decision`, { decision, comment, conditions }),
    onSuccess: () => {
      setComment("");
      setConditions("");
      qc.invalidateQueries();
    },
  });
  const step = request.steps.find((s) => s.status === "active");
  if (request.permissions.alreadyApproved)
    return (
      <Card title="Your review">
        <p className="text-sm text-stone-600">You approved this stage. {step?.name} needs every reviewer, so it's waiting on the others.</p>
      </Card>
    );
  return (
    <Card title={`Your review: ${step?.name}`}>
      <ErrorBanner error={decide.error} />
      <div className="space-y-3">
        <Field label="Comment" hint="Required to reject or ask for changes">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <Field label="Conditions of approval" hint="Optional. Recorded on the approved capability, for example 'No customer data'">
          <Input value={conditions} onChange={(e) => setConditions(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
            Approve
          </Button>
          <Button variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate("request_changes")}>
            Request changes
          </Button>
          <Button variant="danger" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>
            Reject
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function AiRequestDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [comment, setComment] = useState("");
  const request = useQuery({ queryKey: ["ai-request", id], queryFn: () => api.get<AiRequestDetail>(`/ai/requests/${id}`) });
  const addComment = useMutation({
    mutationFn: () => api.post(`/ai/requests/${id}/comments`, { comment }),
    onSuccess: () => {
      setComment("");
      qc.invalidateQueries({ queryKey: ["ai-request", id] });
    },
  });
  const withdraw = useMutation({
    mutationFn: () => api.post(`/ai/requests/${id}/withdraw`, {}),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (request.isPending) return <Loading />;
  if (request.error) return <ErrorBanner error={request.error} />;
  const r = request.data!;
  const yes = AI_RISK_QUESTIONS.filter((q) => r[q.key]);

  return (
    <>
      <PageHeader
        title={r.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge value={r.status} />
            <RiskBadge tier={r.riskTier} />
            <span>
              {label(r.kind)}
              {r.systemName ? ` in ${r.systemName}` : ""} · requested by {r.requesterName ?? "someone"} {timeAgo(r.submittedAt)}
            </span>
          </span>
        }
        actions={
          <>
            {r.permissions.canEdit && <LinkButton to={`/ai/requests/${id}/edit`}>Update and resubmit</LinkButton>}
            {r.permissions.canWithdraw && (
              <Button variant="ghost" disabled={withdraw.isPending} onClick={() => confirm("Withdraw this request?") && withdraw.mutate()}>
                Withdraw
              </Button>
            )}
          </>
        }
      />
      <ErrorBanner error={withdraw.error} />
      {r.status === "changes_requested" && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          A reviewer asked for changes. {r.permissions.canEdit ? "Update the request to send it back for review." : "Waiting for the requester to update it."}
        </div>
      )}
      {r.status === "approved" && r.resultSystem && (
        <div className="mb-6 rounded-lg border border-leaf-200 bg-leaf-50 px-4 py-3 text-sm text-leaf-900">
          Approved and added to the AI inventory as <TextLink to={`/systems/${r.resultSystem.id}`}>{r.resultSystem.name}</TextLink>.
          {r.conditions && <div className="mt-1">Conditions: {r.conditions}</div>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {r.permissions.canDecide && <DecisionPanel request={r} />}
          <Card title="Request">
            <DetailList
              items={[
                ["Capability", r.capability],
                ["Team", r.teamName],
                ["Vendor", r.vendor],
                ["Website", r.url ? <ExternalLink href={r.url} /> : null],
                ["Expected users", r.expectedUsers],
                ["Estimated cost", r.estimatedCost],
              ]}
            />
            <div className="mt-5 space-y-4 text-sm">
              <div>
                <div className="text-xs font-medium tracking-wide text-stone-500 uppercase">Business case</div>
                <p className="mt-1 whitespace-pre-wrap text-stone-800">{r.businessCase}</p>
              </div>
              {r.dataDescription && (
                <div>
                  <div className="text-xs font-medium tracking-wide text-stone-500 uppercase">Data it will see</div>
                  <p className="mt-1 whitespace-pre-wrap text-stone-800">{r.dataDescription}</p>
                </div>
              )}
            </div>
          </Card>
          <Card title="Risk assessment" actions={<RiskBadge tier={r.riskTier} />}>
            <ul className="list-inside list-disc space-y-1 text-sm text-stone-700">
              {r.risk.reasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <div className="mt-4 text-xs text-stone-500">
              Answered yes: {yes.length ? yes.map((q) => q.label.replace(/\?$/, "")).join("; ") : "none"}. Vendor trains on data: {label(r.trainsOnData).toLowerCase()}.
            </div>
          </Card>
          <Card title="Discussion">
            <ul className="space-y-4">
              {r.events.map((e) => (
                <li key={e.id} className="text-sm">
                  <div className="text-stone-600">
                    <span className="font-medium text-stone-900">{e.actorLabel}</span> {eventText[e.type] ?? e.type}
                    {e.stepId && e.type !== "comment" && ` (${r.steps.find((s) => s.id === e.stepId)?.name ?? "removed stage"})`}{" "}
                    <span className="text-xs text-stone-400">{timeAgo(e.createdAt)}</span>
                  </div>
                  {e.comment && <p className="mt-1 whitespace-pre-wrap text-stone-800">{e.comment}</p>}
                  {e.conditions && <p className="mt-1 text-amber-800">Condition: {e.conditions}</p>}
                </li>
              ))}
            </ul>
            <form
              className="mt-5 flex gap-2 border-t border-stone-100 pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (comment.trim()) addComment.mutate();
              }}
            >
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ask a question or add context…" />
              <Button type="submit" variant="secondary" disabled={addComment.isPending}>
                Comment
              </Button>
            </form>
            <ErrorBanner error={addComment.error} />
          </Card>
        </div>
        <Card title="Review order">
          <ol className="space-y-5">
            {r.steps.map((s) => (
              <li key={s.id} className="flex gap-3">
                <span className={`mt-1 h-3 w-3 shrink-0 rounded-full border-2 ${stepDot[s.status] ?? stepDot.waiting}`} />
                <div className="min-w-0 text-sm">
                  <div className="font-medium text-stone-900">{s.name}</div>
                  <div className="text-xs text-stone-500">
                    {s.status === "active" ? "In review" : label(s.status)} · {label(s.rule).toLowerCase()}
                  </div>
                  <div className="mt-1 text-xs text-stone-600">
                    {s.reviewers.map((rv) => (s.approvedBy.includes(rv.userId) ? `${rv.name} ✓` : rv.name)).join(", ") || "No reviewers"}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <button className="mt-6 text-xs text-stone-500 hover:underline" onClick={() => navigate({ to: "/ai/requests" })}>
            ← All requests
          </button>
        </Card>
      </div>
    </>
  );
}
