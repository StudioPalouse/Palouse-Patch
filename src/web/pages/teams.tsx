import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, LinkButton, Loading, PageHeader, Row, Table, Td, TextLink, Textarea } from "../components/ui.tsx";
import { api, type Team, type TeamDetail } from "../lib/api.ts";
import { useDelete, useEntityForm } from "../lib/hooks.ts";

export function TeamsPage() {
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api.get<Team[]>("/teams") });
  return (
    <>
      <PageHeader title="Teams" subtitle="Departments and business units." actions={<LinkButton to="/teams/new">Add team</LinkButton>} />
      {teams.isPending ? (
        <Loading />
      ) : teams.data?.length === 0 ? (
        <EmptyState title="No teams yet" action={<LinkButton to="/teams/new">Add a team</LinkButton>}>
          Teams group people and use cases, e.g. Finance, HR or Customer Success.
        </EmptyState>
      ) : (
        <Table head={["Team", "People", "Use cases"]}>
          {teams.data?.map((t) => (
            <Row key={t.id} to={`/teams/${t.id}`}>
              <Td>
                <TextLink to={`/teams/${t.id}`}>{t.name}</TextLink>
                {t.description && <div className="text-xs text-stone-500">{t.description}</div>}
              </Td>
              <Td className="text-stone-600">{t.peopleCount}</Td>
              <Td className="text-stone-600">{t.useCaseCount}</Td>
            </Row>
          ))}
        </Table>
      )}
    </>
  );
}

export function TeamDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const team = useQuery({ queryKey: ["team", id], queryFn: () => api.get<TeamDetail>(`/teams/${id}`) });
  const del = useDelete(`/teams/${id}`, "/teams");
  if (team.isPending) return <Loading />;
  if (team.error) return <ErrorBanner error={team.error} />;
  const t = team.data;
  return (
    <>
      <PageHeader
        title={t.name}
        subtitle={t.description}
        actions={
          <>
            <LinkButton to={`/teams/${id}/edit`} variant="secondary">
              Edit
            </LinkButton>
            <Button variant="danger" onClick={() => confirm(`Delete ${t.name}?`) && del.mutate()}>
              Delete
            </Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="People">
          {t.people.length === 0 ? (
            <p className="text-sm text-stone-500">Nobody assigned yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {t.people.map((p) => (
                <li key={p.id} className="py-2">
                  <TextLink to={`/people/${p.id}`}>{p.name}</TextLink>
                  {p.title && <span className="ml-2 text-xs text-stone-500">{p.title}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Use cases">
          {t.useCases.length === 0 ? (
            <p className="text-sm text-stone-500">No use cases yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {t.useCases.map((u) => (
                <li key={u.id} className="flex items-center justify-between py-2">
                  <TextLink to={`/use-cases/${u.id}`}>{u.title}</TextLink>
                  <Badge value={u.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export function TeamFormPage() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const existing = useQuery({ queryKey: ["team", id], queryFn: () => api.get<TeamDetail>(`/teams/${id}`), enabled: !!id });
  if (id && existing.isPending) return <Loading />;
  return <TeamForm id={id} initial={existing.data} />;
}

function TeamForm({ id, initial }: { id?: string; initial?: Team }) {
  const f = useEntityForm({
    path: "/teams",
    id,
    detailPath: (tid) => `/teams/${tid}`,
    initial: { name: initial?.name ?? "", description: initial?.description ?? "" },
  });
  return (
    <>
      <PageHeader title={id ? `Edit ${initial?.name}` : "Add a team"} />
      <form onSubmit={f.submit} className="max-w-xl space-y-5 rounded-lg border border-stone-200 bg-white p-6">
        <ErrorBanner error={f.error} />
        <Field label="Name" error={f.fieldErrors.name}>
          <Input required autoFocus value={f.values.name} onChange={(e) => f.set("name", e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea value={f.values.description} onChange={(e) => f.set("description", e.target.value)} />
        </Field>
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={f.saving}>
            {f.saving ? "Saving…" : id ? "Save changes" : "Add team"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => history.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
