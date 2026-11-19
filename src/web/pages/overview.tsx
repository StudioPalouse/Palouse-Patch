import { useQuery } from "@tanstack/react-query";
import { Card, LinkButton, PageHeader, TextLink } from "../components/ui.tsx";
import { api, type Artifact, type Person, type System, type UseCase } from "../lib/api.ts";
import { authClient } from "../lib/auth.ts";
import { ActivityFeed } from "./activity.tsx";

function Stat({ label, value, to }: { label: string; value: number | undefined; to: string }) {
  return (
    <TextLink to={to}>
      <div className="rounded-lg border border-stone-200 bg-white p-4 transition hover:border-leaf-500">
        <div className="text-xs font-medium tracking-wide text-stone-500 uppercase">{label}</div>
        <div className="mt-1 text-3xl font-semibold text-stone-900 tabular-nums">{value ?? "–"}</div>
      </div>
    </TextLink>
  );
}

export function OverviewPage() {
  const org = authClient.useActiveOrganization();
  const systems = useQuery({ queryKey: ["systems", "", ""], queryFn: () => api.get<System[]>("/systems") });
  const useCases = useQuery({ queryKey: ["use-cases", "", ""], queryFn: () => api.get<UseCase[]>("/use-cases") });
  const artifacts = useQuery({ queryKey: ["artifacts", "", ""], queryFn: () => api.get<Artifact[]>("/artifacts") });
  const people = useQuery({ queryKey: ["people", ""], queryFn: () => api.get<Person[]>("/people") });

  const unowned = systems.data?.filter((s) => !s.owners?.length && s.lifecycle !== "retired") ?? [];
  const orphanArtifacts = artifacts.data?.filter((a) => !a.ownerId && a.status !== "retired") ?? [];
  const isEmpty = systems.data?.length === 0;

  return (
    <>
      <PageHeader title={org.data?.name ?? "Overview"} subtitle="Your organization's systems at a glance." />
      {isEmpty && (
        <div className="mb-6 rounded-lg border border-leaf-200 bg-leaf-50 p-5">
          <h2 className="font-semibold text-leaf-800">Plant your first seeds</h2>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-stone-700">
            <li>Add the systems your teams rely on most.</li>
            <li>Add the people who own them and assign business and technical owners.</li>
            <li>Describe the use cases each system supports.</li>
            <li>Register artifacts built on platforms like Power Automate, Appian or Nintex.</li>
          </ol>
          <div className="mt-4">
            <LinkButton to="/systems/new">Add a system</LinkButton>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Systems" value={systems.data?.length} to="/systems" />
        <Stat label="Use cases" value={useCases.data?.length} to="/use-cases" />
        <Stat label="Artifacts" value={artifacts.data?.length} to="/artifacts" />
        <Stat label="People" value={people.data?.length} to="/people" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Needs attention">
            {unowned.length === 0 && orphanArtifacts.length === 0 ? (
              <p className="text-sm text-stone-500">Everything active has an owner. Nice.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {unowned.map((s) => (
                  <li key={s.id}>
                    <TextLink to={`/systems/${s.id}`}>{s.name}</TextLink> <span className="text-stone-500">has no owner</span>
                  </li>
                ))}
                {orphanArtifacts.map((a) => (
                  <li key={a.id}>
                    <TextLink to={`/artifacts/${a.id}`}>{a.name}</TextLink> <span className="text-stone-500">({a.systemName}) has no owner</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Recent activity">
          <ActivityFeed limit={10} />
        </Card>
      </div>
    </>
  );
}
