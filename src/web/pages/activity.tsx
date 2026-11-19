import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loading, PageHeader } from "../components/ui.tsx";
import { api, qs, type AuditEvent } from "../lib/api.ts";
import { entityPath, timeAgo } from "../lib/format.ts";

export function ActivityFeed({
  entityType,
  entityId,
  limit = 50,
  compact,
}: {
  entityType?: string;
  entityId?: string;
  limit?: number;
  compact?: boolean;
}) {
  const events = useQuery({
    queryKey: ["activity", entityType, entityId, limit],
    queryFn: () => api.get<AuditEvent[]>(`/activity${qs({ entityType, entityId, limit: String(limit) })}`),
  });
  if (events.isPending) return <Loading />;
  if (!events.data?.length) return <p className="text-sm text-stone-500">No activity yet.</p>;
  return (
    <ol className="space-y-3">
      {events.data.map((e) => (
        <li key={e.id} className="text-sm">
          {compact || e.action === "delete" ? (
            <span className="text-stone-700">{e.summary}</span>
          ) : (
            <Link to={entityPath(e.entityType, e.entityId)} className="text-stone-700 hover:text-leaf-700 hover:underline">
              {e.summary}
            </Link>
          )}
          <div className="text-xs text-stone-400">
            {e.actorLabel} · {timeAgo(e.createdAt)}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity" subtitle="Every change made in your organization, newest first." />
      <div className="rounded-lg border border-stone-200 bg-white p-5">
        <ActivityFeed limit={100} />
      </div>
    </>
  );
}
