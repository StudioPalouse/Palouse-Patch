import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { label } from "../../shared/domain.ts";
import {
  Badge,
  Button,
  Card,
  DetailList,
  EmptyState,
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
} from "../components/ui.tsx";
import { api, qs, type Person, type PersonDetail, type Team } from "../lib/api.ts";
import { useDebounced, useDelete, useEntityForm } from "../lib/hooks.ts";

export function PeoplePage() {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q);
  const people = useQuery({ queryKey: ["people", debounced], queryFn: () => api.get<Person[]>(`/people${qs({ q: debounced })}`) });
  return (
    <>
      <PageHeader title="People" subtitle="System owners, admins and champions. People do not need a Patch login." actions={<LinkButton to="/people/new">Add person</LinkButton>} />
      <div className="mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Filter people…" />
      </div>
      {people.isPending ? (
        <Loading />
      ) : people.data?.length === 0 ? (
        <EmptyState title={q ? "No people match" : "No people yet"} action={!q && <LinkButton to="/people/new">Add a person</LinkButton>} />
      ) : (
        <Table head={["Name", "Title", "Team", "Email"]}>
          {people.data?.map((p) => (
            <tr key={p.id} className="hover:bg-stone-50">
              <Td>
                <TextLink to={`/people/${p.id}`}>{p.name}</TextLink>
              </Td>
              <Td className="text-stone-600">{p.title}</Td>
              <Td className="text-stone-600">{p.teamName}</Td>
              <Td className="text-stone-600">{p.email}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

export function PersonDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const person = useQuery({ queryKey: ["person", id], queryFn: () => api.get<PersonDetail>(`/people/${id}`) });
  const del = useDelete(`/people/${id}`, "/people");
  if (person.isPending) return <Loading />;
  if (person.error) return <ErrorBanner error={person.error} />;
  const p = person.data;
  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={p.title}
        actions={
          <>
            <LinkButton to={`/people/${id}/edit`} variant="secondary">
              Edit
            </LinkButton>
            <Button variant="danger" onClick={() => confirm(`Remove ${p.name}? Their ownerships will be removed too.`) && del.mutate()}>
              Remove
            </Button>
          </>
        }
      />
      <ErrorBanner error={del.error} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Details">
          <DetailList
            items={[
              ["Email", p.email && <a href={`mailto:${p.email}`} className="text-leaf-700 hover:underline">{p.email}</a>],
              ["Team", p.teamId ? <TextLink to={`/teams/${p.teamId}`}>{p.teamName}</TextLink> : null],
            ]}
          />
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card title="Owns">
            {p.systems.length === 0 ? (
              <p className="text-sm text-stone-500">Not an owner of any system.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {p.systems.map((s) => (
                  <li key={s.ownershipId} className="flex items-center justify-between py-2">
                    <TextLink to={`/systems/${s.id}`}>{s.name}</TextLink>
                    <span className="text-xs text-stone-500">{label(s.role)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Artifacts">
            {p.artifacts.length === 0 ? (
              <p className="text-sm text-stone-500">No artifacts.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {p.artifacts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2">
                    <div>
                      <TextLink to={`/artifacts/${a.id}`}>{a.name}</TextLink>
                      <div className="text-xs text-stone-500">{a.systemName}</div>
                    </div>
                    <Badge value={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

export function PersonFormPage() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const existing = useQuery({ queryKey: ["person", id], queryFn: () => api.get<PersonDetail>(`/people/${id}`), enabled: !!id });
  if (id && existing.isPending) return <Loading />;
  return <PersonForm id={id} initial={existing.data} />;
}

function PersonForm({ id, initial }: { id?: string; initial?: Person }) {
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api.get<Team[]>("/teams") });
  const f = useEntityForm({
    path: "/people",
    id,
    detailPath: (pid) => `/people/${pid}`,
    initial: { name: initial?.name ?? "", email: initial?.email ?? "", title: initial?.title ?? "", teamId: initial?.teamId ?? "" },
  });
  return (
    <>
      <PageHeader title={id ? `Edit ${initial?.name}` : "Add a person"} />
      <form onSubmit={f.submit} className="max-w-xl space-y-5 rounded-lg border border-stone-200 bg-white p-6">
        <ErrorBanner error={f.error} />
        <Field label="Name" error={f.fieldErrors.name}>
          <Input required autoFocus value={f.values.name} onChange={(e) => f.set("name", e.target.value)} />
        </Field>
        <Field label="Email" error={f.fieldErrors.email}>
          <Input type="email" value={f.values.email} onChange={(e) => f.set("email", e.target.value)} />
        </Field>
        <Field label="Job title" error={f.fieldErrors.title}>
          <Input value={f.values.title} onChange={(e) => f.set("title", e.target.value)} />
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
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={f.saving}>
            {f.saving ? "Saving…" : id ? "Save changes" : "Add person"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => history.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
