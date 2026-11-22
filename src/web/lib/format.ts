export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

export const entityPath = (type: string, id: string) =>
  ({ system: `/systems/${id}`, use_case: `/use-cases/${id}`, artifact: `/artifacts/${id}`, person: `/people/${id}`, team: `/teams/${id}`, ai_request: `/ai/requests/${id}`, ai_council: `/settings#ai-council` })[
    type
  ] ?? "/";

export const percent = (rate: number | null | undefined) => (rate == null ? "–" : `${Math.round(rate * 100)}%`);
