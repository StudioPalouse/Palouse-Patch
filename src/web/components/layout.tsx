import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, type AiRequest, type SearchHit } from "../lib/api.ts";
import { authClient } from "../lib/auth.ts";
import { entityPath } from "../lib/format.ts";
import { useDebounced } from "../lib/hooks.ts";
import { useTheme, type Theme } from "../lib/theme.ts";
import { label } from "../../shared/domain.ts";

const nav = [
  { to: "/", label: "Overview", exact: true },
  { to: "/systems", label: "Systems" },
  { to: "/use-cases", label: "Use cases" },
  { to: "/artifacts", label: "Artifacts" },
  { to: "/people", label: "People" },
  { to: "/teams", label: "Teams" },
  { to: "/ai", label: "AI tools", exact: true },
  { to: "/ai/requests", label: "AI requests" },
  { to: "/activity", label: "Activity" },
  { to: "/settings", label: "Settings" },
];

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const results = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<SearchHit[]>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.trim().length > 1,
  });

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search systems, use cases, artifacts, people…"
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm placeholder:text-stone-400 focus:border-leaf-500 focus:ring-2 focus:ring-leaf-200 focus:outline-none"
      />
      {open && debounced.trim().length > 1 && results.data && (
        <div className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-md border border-stone-200 bg-white py-1 shadow-lg">
          {results.data.length === 0 && <div className="px-3 py-2 text-sm text-stone-500">No matches</div>}
          {results.data.map((hit) => (
            <button
              key={`${hit.type}-${hit.id}`}
              onClick={() => {
                setOpen(false);
                setQ("");
                navigate({ to: entityPath(hit.type, hit.id) });
              }}
              className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-leaf-50"
            >
              <span className="truncate font-medium text-stone-800">{hit.title}</span>
              <span className="shrink-0 text-xs text-stone-400">
                {hit.type.replace("_", " ")}
                {hit.subtitle ? ` · ${label(hit.subtitle)}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const session = authClient.useSession();
  const org = authClient.useActiveOrganization();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const awaiting = useQuery({
    queryKey: ["ai-requests", "awaiting"],
    queryFn: () => api.get<AiRequest[]>("/ai/requests?awaiting=me"),
    enabled: !!session.data?.session.activeOrganizationId,
    refetchInterval: 5 * 60_000,
  });

  useEffect(() => {
    if (session.isPending) return;
    if (!session.data) navigate({ to: "/sign-in" });
    else if (!session.data.session.activeOrganizationId) navigate({ to: "/onboarding" });
  }, [session.isPending, session.data, navigate]);

  if (session.isPending || !session.data?.session.activeOrganizationId) return null;

  return (
    <div className="min-h-screen lg:flex">
      <aside className={`${menuOpen ? "block" : "hidden"} border-r border-stone-200 bg-soil-100 lg:block lg:w-60 lg:shrink-0`}>
        <div className="flex items-center gap-2 px-5 py-5">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <div className="min-w-0">
            <div className="text-lg leading-tight font-semibold text-leaf-800">Patch</div>
            <div className="truncate text-xs text-stone-500">{org.data?.name}</div>
          </div>
        </div>
        <nav className="space-y-0.5 px-3 pb-6">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: !!item.exact }}
              onClick={() => setMenuOpen(false)}
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-stone-600 hover:bg-white/70 hover:text-stone-900"
              activeProps={{ className: "bg-white text-leaf-800 shadow-xs" }}
            >
              {item.label}
              {item.to === "/ai/requests" && !!awaiting.data?.length && (
                <span className="rounded-full bg-accent px-1.5 text-xs text-on-accent tabular-nums" title="Waiting for your review">
                  {awaiting.data.length}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-200 bg-soil-50/90 px-4 py-3 backdrop-blur sm:px-6">
          <button className="rounded-md p-1.5 text-stone-600 hover:bg-stone-100 lg:hidden" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
            ☰
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <ThemeToggle />
            <Link to="/settings" hash="account" className="hidden text-stone-600 hover:text-stone-900 hover:underline sm:inline" title="Your account">
              {session.data.user.name}
            </Link>
            <button
              className="text-stone-500 hover:text-stone-800"
              onClick={async () => {
                await authClient.signOut();
                navigate({ to: "/sign-in" });
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const THEMES: { value: Theme; icon: string; label: string }[] = [
  { value: "system", icon: "◐", label: "System" },
  { value: "light", icon: "☀", label: "Light" },
  { value: "dark", icon: "☾", label: "Dark" },
];

/** Cycles system → light → dark. */
function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const i = THEMES.findIndex((t) => t.value === theme);
  const current = THEMES[i]!;
  const next = THEMES[(i + 1) % THEMES.length]!;
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
      onClick={() => setTheme(next.value)}
      title={`Theme: ${current.label}. Switch to ${next.label.toLowerCase()}.`}
      aria-label={`Theme: ${current.label}. Switch to ${next.label.toLowerCase()}.`}
    >
      <span aria-hidden className="w-4 text-center">{current.icon}</span>
      <span className="hidden md:inline">{current.label}</span>
    </button>
  );
}
