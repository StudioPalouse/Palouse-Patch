import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { USE_CASE_STATUSES, label } from "../../shared/domain.ts";
import {
  Row,
  Badge,
  Button,
  Card,
  DetailList,
  EmptyState,
  EnumSelect,
  ErrorBanner,
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
import { api, qs, type Artifact, type System, type Team, type UseCase } from "../lib/api.ts";
import { useDebounced, useDelete, useEntityForm } from "../lib/hooks.ts";

export function UseCasesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const debounced = useDebounced(q);
  const useCases = useQuery({
    queryKey: ["use-cases", debounced, status],
    queryFn: () => api.get<UseCase[]>(`/use-cases${qs({ q: debounced, status })}`),
  });

  return (
    <>
      <PageHeader
        title="Use cases"
        subtitle="What the business actually uses its systems for."
        actions={<LinkButton to="/use-cases/new">Add use case</LinkButton>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Filter use cases…" />
        <div className="w-40">
          <EnumSelect values={USE_CASE_STATUSES} value={status} onChange={setStatus} allowEmpty emptyLabel="Any status" />
        </div>
      </div>
      {useCases.isPending ? (
        <Loading />
      ) : useCases.data?.length === 0 ? (
        <EmptyState title={q || status ? "No use cases match" : "No use cases yet"} action={!q && !status && <LinkButton to="/use-cases/new">Add a use case</LinkButton>}>
          A use case describes a job the business does with one or more systems, like "Invoice approvals" or "New hire onboarding".
        </EmptyState>
      ) : (
        <Table head={["Use case", "Systems", "Team", "Status"]}>
          {useCases.data?.map((u) => (
            <Row key={u.id} to={`/use-cases/${u.id}`}>
              <Td>
                <TextLink to={`/use-cases/${u.id}`}>{u.title}</TextLink>
                {u.description && <div className="line-clamp-1 max-w-md text-xs text-stone-500">{u.description}</div>}
              </Td>
              <Td className="text-stone-600">{u.systems?.map((s) => s.name).join(", ") || "None"}</Td>
              <Td className="text-stone-600">{u.teamName ?? ""}</Td>
              <Td>
                <Badge value={u.status} />
              </Td>
            </Row>
          ))}
        </Table>
      )}
    </>
  );
}

export function UseCaseDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const uc = useQuery({ queryKey: ["use-case", id], queryFn: () => api.get<UseCase>(`/use-cases/${id}`) });
  const del = useDelete(`/use-cases/${id}`, "/use-cases");
  if (uc.isPending) return <Loading />;
  if (uc.error) return <ErrorBanner error={uc.error} />;
  const u = uc.data;
  return (
    <>
      <PageHeader
        title={u.title}
        subtitle={<Badge value={u.status} />}
        actions={
          <>
            <LinkButton to={`/use-cases/${id}/edit`} variant="secondary">
              Edit
            </LinkButton>
            <Button variant="danger" onClick={() => confirm(`Delete ${u.title}?`) && del.mutate()}>
              Delete
            </Button>
          </>
        }
      />
      <ErrorBanner error={del.error} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Details">
            <DetailList items={[["Team", u.teamId ? <TextLink to={`/teams/${u.teamId}`}>{u.teamName}</TextLink> : null], ["Status", label(u.status)]]} />
            {u.description && (
              <div className="mt-5">
                <div className="text-xs font-medium tracking-wide text-stone-500 uppercase">Description</div>
                <p className="mt-1 text-sm whitespace-pre-wrap text-stone-700">{u.description}</p>
              </div>
            )}
            {u.businessValue && (
              <div className="mt-5">
                <div className="text-xs font-medium tracking-wide text-stone-500 uppercase">Business value</div>
                <p className="mt-1 text-sm whitespace-pre-wrap text-stone-700">{u.businessValue}</p>
              </div>
            )}
          </Card>
          <Card title="Systems involved">
            {u.systems?.length ? (
              <ul className="divide-y divide-stone-100">
                {u.systems.map((s) => (
                  <li key={s.id} className="py-2">
                    <TextLink to={`/systems/${s.id}`}>{s.name}</TextLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">No systems linked.</p>
            )}
          </Card>
          <Card title="Artifacts">
            {u.artifacts?.length ? (
              <ul className="divide-y divide-stone-100">
                {u.artifacts.map((a) => (
                  <li key={a.id} className="flex justify-between py-2">
                    <TextLink to={`/artifacts/${a.id}`}>{a.name}</TextLink>
                    <span className="text-xs text-stone-500">{label(a.type)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">No artifacts linked.</p>
            )}
          </Card>
        </div>
        <Card title="Recent activity">
          <ActivityFeed entityType="use_case" entityId={id} limit={8} compact />
        </Card>
      </div>
    </>
  );
}

function CheckList<T extends { id: string }>({
  items,
  selected,
  onChange,
  render,
  empty,
}: {
  items: T[] | undefined;
  selected: string[];
  onChange: (ids: string[]) => void;
  render: (item: T) => React.ReactNode;
  empty: string;
}) {
  if (!items?.length) return <p className="text-sm text-stone-500">{empty}</p>;
  return (
    <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-stone-200 p-2">
      {items.map((item) => (
        <label key={item.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-stone-50">
          <input
            type="checkbox"
            className="h-4 w-4 accent-leaf-700"
            checked={selected.includes(item.id)}
            onChange={(e) => onChange(e.target.checked ? [...selected, item.id] : selected.filter((x) => x !== item.id))}
          />
          {render(item)}
        </label>
      ))}
    </div>
  );
}

export function UseCaseFormPage() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const existing = useQuery({ queryKey: ["use-case", id], queryFn: () => api.get<UseCase>(`/use-cases/${id}`), enabled: !!id });
  if (id && existing.isPending) return <Loading />;
  return <UseCaseForm id={id} initial={existing.data} />;
}

function UseCaseForm({ id, initial }: { id?: string; initial?: UseCase }) {
  const search = useSearch({ strict: false }) as { systemId?: string };
  const systems = useQuery({ queryKey: ["systems", "", ""], queryFn: () => api.get<System[]>("/systems") });
  const artifacts = useQuery({ queryKey: ["artifacts", ""], queryFn: () => api.get<Artifact[]>("/artifacts") });
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api.get<Team[]>("/teams") });
  const f = useEntityForm({
    path: "/use-cases",
    id,
    detailPath: (uid) => `/use-cases/${uid}`,
    initial: {
      title: initial?.title ?? "",
      description: initial?.description ?? "",
      businessValue: initial?.businessValue ?? "",
      status: initial?.status ?? "active",
      teamId: initial?.teamId ?? "",
      systemIds: initial?.systems?.map((s) => s.id) ?? (search.systemId ? [search.systemId] : []),
      artifactIds: initial?.artifacts?.map((a) => a.id) ?? [],
    },
  });
  return (
    <>
      <PageHeader title={id ? `Edit ${initial?.title}` : "Add a use case"} />
      <form onSubmit={f.submit} className="max-w-2xl space-y-5 rounded-lg border border-stone-200 bg-white p-6">
        <ErrorBanner error={f.error} />
        <Field label="Title" error={f.fieldErrors.title}>
          <Input required autoFocus value={f.values.title} onChange={(e) => f.set("title", e.target.value)} placeholder="Invoice approvals" />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Status">
            <EnumSelect values={USE_CASE_STATUSES} value={f.values.status} onChange={(v) => f.set("status", v)} />
          </Field>
          <Field label="Team">
            <Select value={f.values.teamId} onChange={(e) => f.set("teamId", e.target.value)}>
              <option value="">None</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Description" error={f.fieldErrors.description}>
          <Textarea value={f.values.description} onChange={(e) => f.set("description", e.target.value)} rows={4} />
        </Field>
        <Field label="Business value" hint="Why it matters: time saved, risk reduced, revenue enabled">
          <Textarea value={f.values.businessValue} onChange={(e) => f.set("businessValue", e.target.value)} />
        </Field>
        <Field label="Systems" error={f.fieldErrors.systemIds}>
          <CheckList items={systems.data} selected={f.values.systemIds} onChange={(ids) => f.set("systemIds", ids)} render={(s) => s.name} empty="No systems yet." />
        </Field>
        <Field label="Artifacts" error={f.fieldErrors.artifactIds}>
          <CheckList
            items={artifacts.data}
            selected={f.values.artifactIds}
            onChange={(ids) => f.set("artifactIds", ids)}
            render={(a) => (
              <span>
                {a.name} <span className="text-xs text-stone-400">({a.systemName})</span>
              </span>
            )}
            empty="No artifacts yet."
          />
        </Field>
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={f.saving}>
            {f.saving ? "Saving…" : id ? "Save changes" : "Add use case"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => history.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
