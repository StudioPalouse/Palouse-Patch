import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { ARTIFACT_STATUSES, ARTIFACT_TYPES, ENVIRONMENTS, label } from "../../shared/domain.ts";
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
import { ActivityFeed } from "./activity.tsx";
import { api, qs, type Artifact, type Person, type System } from "../lib/api.ts";
import { useDebounced, useDelete, useEntityForm } from "../lib/hooks.ts";

export function ArtifactsPage() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const debounced = useDebounced(q);
  const artifacts = useQuery({
    queryKey: ["artifacts", debounced, type],
    queryFn: () => api.get<Artifact[]>(`/artifacts${qs({ q: debounced, type })}`),
  });
  return (
    <>
      <PageHeader
        title="Artifacts"
        subtitle="Flows, apps, forms and agents built on your creation platforms."
        actions={<LinkButton to="/artifacts/new">Add artifact</LinkButton>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Filter artifacts…" />
        <div className="w-40">
          <EnumSelect values={ARTIFACT_TYPES} value={type} onChange={setType} allowEmpty emptyLabel="Any type" />
        </div>
      </div>
      {artifacts.isPending ? (
        <Loading />
      ) : artifacts.data?.length === 0 ? (
        <EmptyState title={q || type ? "No artifacts match" : "No artifacts yet"} action={!q && !type && <LinkButton to="/artifacts/new">Add an artifact</LinkButton>}>
          Register what people have built in tools like Power Automate, Appian or Nintex so you know what exists, who owns it and what depends on it.
        </EmptyState>
      ) : (
        <Table head={["Artifact", "Platform", "Owner", "Environment", "Status"]}>
          {artifacts.data?.map((a) => (
            <tr key={a.id} className="hover:bg-stone-50">
              <Td>
                <TextLink to={`/artifacts/${a.id}`}>{a.name}</TextLink>
                <div className="text-xs text-stone-500">{label(a.type)}</div>
              </Td>
              <Td>
                <TextLink to={`/systems/${a.systemId}`}>{a.systemName}</TextLink>
              </Td>
              <Td className="text-stone-600">{a.ownerName ?? <span className="text-amber-700">No owner</span>}</Td>
              <Td className="text-stone-600">{a.environment ? label(a.environment) : ""}</Td>
              <Td>
                <Badge value={a.status} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

export function ArtifactDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const artifact = useQuery({ queryKey: ["artifact", id], queryFn: () => api.get<Artifact>(`/artifacts/${id}`) });
  const del = useDelete(`/artifacts/${id}`, "/artifacts");
  if (artifact.isPending) return <Loading />;
  if (artifact.error) return <ErrorBanner error={artifact.error} />;
  const a = artifact.data;
  return (
    <>
      <PageHeader
        title={a.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge value={a.status} />
            <Badge>{label(a.type)}</Badge>
            {a.environment && <Badge value={a.environment} />}
          </span>
        }
        actions={
          <>
            {a.externalUrl && (
              <a href={a.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center rounded-md border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">
                Open in {a.systemName} ↗
              </a>
            )}
            <LinkButton to={`/artifacts/${id}/edit`} variant="secondary">
              Edit
            </LinkButton>
            <Button variant="danger" onClick={() => confirm(`Delete ${a.name}?`) && del.mutate()}>
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
                ["Platform", <TextLink to={`/systems/${a.systemId}`}>{a.systemName}</TextLink>],
                ["Owner", a.ownerId ? <TextLink to={`/people/${a.ownerId}`}>{a.ownerName}</TextLink> : null],
                ["Link", a.externalUrl && <ExternalLink href={a.externalUrl} />],
                ["External ID", a.externalId && <code className="text-xs">{a.externalId}</code>],
              ]}
            />
            {a.description && <p className="mt-5 text-sm whitespace-pre-wrap text-stone-700">{a.description}</p>}
          </Card>
          <Card title="Supports these use cases">
            {a.useCases?.length ? (
              <ul className="divide-y divide-stone-100">
                {a.useCases.map((u) => (
                  <li key={u.id} className="flex items-center justify-between py-2">
                    <TextLink to={`/use-cases/${u.id}`}>{u.title}</TextLink>
                    <Badge value={u.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">Not linked to any use case. Link it from a use case's edit page.</p>
            )}
          </Card>
        </div>
        <Card title="Recent activity">
          <ActivityFeed entityType="artifact" entityId={id} limit={8} compact />
        </Card>
      </div>
    </>
  );
}

export function ArtifactFormPage() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const existing = useQuery({ queryKey: ["artifact", id], queryFn: () => api.get<Artifact>(`/artifacts/${id}`), enabled: !!id });
  if (id && existing.isPending) return <Loading />;
  return <ArtifactForm id={id} initial={existing.data} />;
}

function ArtifactForm({ id, initial }: { id?: string; initial?: Artifact }) {
  const search = useSearch({ strict: false }) as { systemId?: string };
  const systems = useQuery({ queryKey: ["systems", "", ""], queryFn: () => api.get<System[]>("/systems") });
  const people = useQuery({ queryKey: ["people", ""], queryFn: () => api.get<Person[]>("/people") });
  const platforms = systems.data?.filter((s) => s.isPlatform) ?? [];
  const others = systems.data?.filter((s) => !s.isPlatform) ?? [];
  const f = useEntityForm({
    path: "/artifacts",
    id,
    detailPath: (aid) => `/artifacts/${aid}`,
    initial: {
      systemId: initial?.systemId ?? search.systemId ?? "",
      name: initial?.name ?? "",
      type: initial?.type ?? "flow",
      description: initial?.description ?? "",
      externalUrl: initial?.externalUrl ?? "",
      externalId: initial?.externalId ?? "",
      environment: initial?.environment ?? "",
      status: initial?.status ?? "active",
      ownerId: initial?.ownerId ?? "",
    },
  });
  return (
    <>
      <PageHeader title={id ? `Edit ${initial?.name}` : "Add an artifact"} />
      <form onSubmit={f.submit} className="max-w-2xl space-y-5 rounded-lg border border-stone-200 bg-white p-6">
        <ErrorBanner error={f.error} />
        <Field label="Name" error={f.fieldErrors.name}>
          <Input required autoFocus value={f.values.name} onChange={(e) => f.set("name", e.target.value)} placeholder="Invoice approval flow" />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Built on" error={f.fieldErrors.systemId}>
            <Select required value={f.values.systemId} onChange={(e) => f.set("systemId", e.target.value)}>
              <option value="">Choose a platform…</option>
              {platforms.length > 0 && (
                <optgroup label="Creation platforms">
                  {platforms.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="Other systems">
                  {others.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
          <Field label="Type">
            <EnumSelect values={ARTIFACT_TYPES} value={f.values.type} onChange={(v) => f.set("type", v)} />
          </Field>
          <Field label="Owner">
            <Select value={f.values.ownerId} onChange={(e) => f.set("ownerId", e.target.value)}>
              <option value="">None</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <EnumSelect values={ARTIFACT_STATUSES} value={f.values.status} onChange={(v) => f.set("status", v)} />
          </Field>
          <Field label="Environment">
            <EnumSelect values={ENVIRONMENTS} value={f.values.environment} onChange={(v) => f.set("environment", v)} allowEmpty emptyLabel="Not specified" />
          </Field>
          <Field label="External ID" error={f.fieldErrors.externalId} hint="The ID in the source platform, if any">
            <Input value={f.values.externalId} onChange={(e) => f.set("externalId", e.target.value)} />
          </Field>
        </div>
        <Field label="Link to artifact" error={f.fieldErrors.externalUrl} hint="Direct link into the platform, e.g. the flow's edit page">
          <Input value={f.values.externalUrl} onChange={(e) => f.set("externalUrl", e.target.value)} placeholder="https://" />
        </Field>
        <Field label="Description">
          <Textarea value={f.values.description} onChange={(e) => f.set("description", e.target.value)} rows={4} />
        </Field>
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={f.saving}>
            {f.saving ? "Saving…" : id ? "Save changes" : "Add artifact"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => history.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
