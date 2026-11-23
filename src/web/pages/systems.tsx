import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { CRITICALITIES, LIFECYCLES, OWNER_ROLES, label } from "../../shared/domain.ts";
import {
  Row,
  AccessBadge,
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
import { ActivityFeed } from "./activity.tsx";
import { AiSystemCard } from "../components/ai-cards.tsx";
import { api, qs, type Person, type System, type SystemDetail } from "../lib/api.ts";
import { useDebounced, useDelete, useEntityForm } from "../lib/hooks.ts";

export function SystemsPage() {
  const [q, setQ] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const debounced = useDebounced(q);
  const systems = useQuery({
    queryKey: ["systems", debounced, lifecycle],
    queryFn: () => api.get<System[]>(`/systems${qs({ q: debounced, lifecycle })}`),
  });

  return (
    <>
      <PageHeader
        title="Systems"
        subtitle="The tools and applications your organization runs on."
        actions={<LinkButton to="/systems/new">Add system</LinkButton>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Filter systems…" />
        <div className="w-44">
          <EnumSelect values={LIFECYCLES} value={lifecycle} onChange={setLifecycle} allowEmpty emptyLabel="Any lifecycle" />
        </div>
      </div>
      {systems.isPending ? (
        <Loading />
      ) : systems.data?.length === 0 ? (
        <EmptyState
          title={q || lifecycle ? "No systems match" : "No systems yet"}
          action={!q && !lifecycle && <LinkButton to="/systems/new">Add your first system</LinkButton>}
        >
          Start with the tools people ask about most: your CRM, ERP, collaboration suite and automation platforms.
        </EmptyState>
      ) : (
        <Table head={["Name", "Owners", "Lifecycle", "Criticality", "Use cases", "Artifacts"]}>
          {systems.data?.map((s) => (
            <Row key={s.id} to={`/systems/${s.id}`}>
              <Td>
                <TextLink to={`/systems/${s.id}`}>{s.name}</TextLink>
                <div className="text-xs text-stone-500">
                  {[s.vendor, s.category].filter(Boolean).join(" · ")}
                  {s.isPlatform && <span className="ml-1 text-leaf-700">· Platform</span>}
                </div>
              </Td>
              <Td className="text-stone-600">
                {s.owners?.length ? [...new Set(s.owners.map((o) => o.name))].join(", ") : <span className="text-amber-700">No owner</span>}
              </Td>
              <Td>
                <Badge value={s.lifecycle} />
              </Td>
              <Td>
                <Badge value={s.criticality} />
              </Td>
              <Td className="text-stone-600">{s.useCaseCount}</Td>
              <Td className="text-stone-600">{s.artifactCount}</Td>
            </Row>
          ))}
        </Table>
      )}
    </>
  );
}

const NEW_PERSON = "__new__";

function OwnersCard({ system }: { system: SystemDetail }) {
  const qc = useQueryClient();
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState<string>("business");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const people = useQuery({ queryKey: ["people", ""], queryFn: () => api.get<Person[]>("/people") });
  const creating = personId === NEW_PERSON;
  const add = useMutation({
    mutationFn: async () => {
      // Someone who isn't in Patch yet can be named as an owner straight away.
      const id = creating ? (await api.post<Person>("/people", { name: newName, email: newEmail || null })).id : personId;
      await api.post(`/systems/${system.id}/owners`, { personId: id, role });
    },
    onSuccess: () => {
      setPersonId("");
      setNewName("");
      setNewEmail("");
      qc.invalidateQueries();
    },
  });
  const remove = useMutation({
    mutationFn: (ownershipId: string) => api.del(`/systems/${system.id}/owners/${ownershipId}`),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <Card title="Owners">
      <ErrorBanner error={add.error ?? remove.error} />
      {system.owners.length === 0 ? (
        <p className="mb-4 text-sm text-amber-700">Nobody owns this system yet. Add a business and a technical owner so people know who to ask.</p>
      ) : (
        <ul className="mb-4 divide-y divide-stone-100">
          {system.owners.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <div className="flex items-center gap-2">
                  <TextLink to={`/people/${o.personId}`}>{o.name}</TextLink>
                  {o.access !== "member" && <AccessBadge access={o.access} />}
                </div>
                <div className="text-xs text-stone-500">{label(o.role)}</div>
              </div>
              <Button variant="ghost" onClick={() => remove.mutate(o.id)} disabled={remove.isPending}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (creating ? newName.trim() : personId) add.mutate();
        }}
      >
        <Select value={personId} onChange={(e) => setPersonId(e.target.value)} className="min-w-40 flex-1">
          <option value="">Choose a person…</option>
          {people.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.access === "member" ? "" : " (not in Patch)"}
            </option>
          ))}
          <option value={NEW_PERSON}>+ Someone new…</option>
        </Select>
        <div className="w-44">
          <EnumSelect values={OWNER_ROLES} value={role} onChange={setRole} />
        </div>
        {creating && (
          <div className="flex w-full flex-wrap gap-2">
            <Input autoFocus required placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} className="min-w-40 flex-1" />
            <Input type="email" placeholder="Email (optional)" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="min-w-40 flex-1" />
          </div>
        )}
        <Button type="submit" variant="secondary" disabled={(creating ? !newName.trim() : !personId) || add.isPending}>
          Add owner
        </Button>
      </form>
      {creating && <p className="mt-2 text-xs text-stone-500">They'll be added to People. They don't need to join Patch to be an owner; you can invite them later.</p>}
    </Card>
  );
}

export function SystemDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const system = useQuery({ queryKey: ["system", id], queryFn: () => api.get<SystemDetail>(`/systems/${id}`) });
  const del = useDelete(`/systems/${id}`, "/systems");

  if (system.isPending) return <Loading />;
  if (system.error) return <ErrorBanner error={system.error} />;
  const s = system.data;

  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge value={s.lifecycle} />
            <Badge value={s.criticality}>{label(s.criticality)} criticality</Badge>
            {s.isPlatform && <Badge>Creation platform</Badge>}
          </span>
        }
        actions={
          <>
            <LinkButton to={`/systems/${id}/edit`} variant="secondary">
              Edit
            </LinkButton>
            <Button variant="danger" onClick={() => confirm(`Delete ${s.name}?`) && del.mutate()}>
              Delete
            </Button>
          </>
        }
      />
      <ErrorBanner error={del.error} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Details">
            <DetailList
              items={[
                ["Vendor", s.vendor],
                ["Category", s.category],
                ["Link", s.url && <ExternalLink href={s.url} />],
                ["Lifecycle", label(s.lifecycle)],
              ]}
            />
            {s.description && <p className="mt-5 text-sm whitespace-pre-wrap text-stone-700">{s.description}</p>}
          </Card>
          <AiSystemCard systemId={id} />
          <Card title="Use cases" actions={<LinkButton to={`/use-cases/new?systemId=${id}`} variant="secondary">Add</LinkButton>}>
            {s.useCases.length === 0 ? (
              <p className="text-sm text-stone-500">No use cases linked yet. What is this system used for?</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {s.useCases.map((u) => (
                  <li key={u.id} className="flex items-center justify-between py-2">
                    <TextLink to={`/use-cases/${u.id}`}>{u.title}</TextLink>
                    <Badge value={u.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {(s.isPlatform || s.artifacts.length > 0) && (
            <Card title="Artifacts built here" actions={<LinkButton to={`/artifacts/new?systemId=${id}`} variant="secondary">Add</LinkButton>}>
              {s.artifacts.length === 0 ? (
                <p className="text-sm text-stone-500">No artifacts yet. Register the flows, apps and forms built on {s.name}.</p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {s.artifacts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <TextLink to={`/artifacts/${a.id}`}>{a.name}</TextLink>
                        <div className="text-xs text-stone-500">
                          {label(a.type)}
                          {a.ownerName ? ` · ${a.ownerName}` : ""}
                        </div>
                      </div>
                      <Badge value={a.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <OwnersCard system={s} />
          <Card title="Recent activity">
            <ActivityFeed entityType="system" entityId={id} limit={8} compact />
          </Card>
        </div>
      </div>
    </>
  );
}

export function SystemFormPage() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const existing = useQuery({ queryKey: ["system", id], queryFn: () => api.get<SystemDetail>(`/systems/${id}`), enabled: !!id });
  if (id && existing.isPending) return <Loading />;
  return <SystemForm id={id} initial={existing.data} />;
}

function SystemForm({ id, initial }: { id?: string; initial?: System }) {
  const f = useEntityForm({
    path: "/systems",
    id,
    detailPath: (sid) => `/systems/${sid}`,
    initial: {
      name: initial?.name ?? "",
      vendor: initial?.vendor ?? "",
      category: initial?.category ?? "",
      description: initial?.description ?? "",
      url: initial?.url ?? "",
      lifecycle: initial?.lifecycle ?? "active",
      criticality: initial?.criticality ?? "medium",
      isPlatform: initial?.isPlatform ?? false,
    },
  });
  return (
    <>
      <PageHeader title={id ? `Edit ${initial?.name}` : "Add a system"} />
      <form onSubmit={f.submit} className="max-w-2xl space-y-5 rounded-lg border border-stone-200 bg-white p-6">
        <ErrorBanner error={f.error} />
        <Field label="Name" error={f.fieldErrors.name}>
          <Input required value={f.values.name} onChange={(e) => f.set("name", e.target.value)} placeholder="Salesforce" autoFocus />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Vendor" error={f.fieldErrors.vendor}>
            <Input value={f.values.vendor} onChange={(e) => f.set("vendor", e.target.value)} />
          </Field>
          <Field label="Category" error={f.fieldErrors.category} hint="e.g. CRM, HR, Automation, AI assistant">
            <Input value={f.values.category} onChange={(e) => f.set("category", e.target.value)} />
          </Field>
          <Field label="Lifecycle">
            <EnumSelect values={LIFECYCLES} value={f.values.lifecycle} onChange={(v) => f.set("lifecycle", v)} />
          </Field>
          <Field label="Criticality">
            <EnumSelect values={CRITICALITIES} value={f.values.criticality} onChange={(v) => f.set("criticality", v)} />
          </Field>
        </div>
        <Field label="Link" error={f.fieldErrors.url} hint="Where people sign in or find documentation">
          <Input value={f.values.url} onChange={(e) => f.set("url", e.target.value)} placeholder="https://" />
        </Field>
        <Field label="Description" error={f.fieldErrors.description}>
          <Textarea value={f.values.description} onChange={(e) => f.set("description", e.target.value)} rows={4} />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={f.values.isPlatform} onChange={(e) => f.set("isPlatform", e.target.checked)} className="mt-0.5 h-4 w-4 accent-leaf-700" />
          <span>
            <span className="font-medium text-stone-800">This is a creation platform</span>
            <span className="block text-stone-500">Power Automate, Appian, Nintex and similar tools where people build their own flows, apps or agents.</span>
          </span>
        </label>
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={f.saving}>
            {f.saving ? "Saving…" : id ? "Save changes" : "Add system"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => history.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
