import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ChevronDown,
  ClipboardCheck,
  History,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Settings,
  Sparkles,
  Sun,
  SunMoon,
  Target,
  User,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, type AiRequest, type SearchHit } from "../lib/api.ts";
import { authClient } from "../lib/auth.ts";
import { entityPath } from "../lib/format.ts";
import { useDebounced } from "../lib/hooks.ts";
import { useTheme, type Theme } from "../lib/theme.ts";
import { label } from "../../shared/domain.ts";

type NavItem = { to: string; label: string; icon: LucideIcon; exact?: boolean; badge?: "awaiting" };
type NavGroup = { id: string; title?: string; items: NavItem[] };

const NAV: NavGroup[] = [
  { id: "home", items: [{ to: "/", label: "Overview", icon: LayoutDashboard, exact: true }] },
  {
    id: "catalog",
    title: "Catalog",
    items: [
      { to: "/systems", label: "Systems", icon: Server },
      { to: "/use-cases", label: "Use cases", icon: Target },
      { to: "/artifacts", label: "Artifacts", icon: Workflow },
    ],
  },
  {
    id: "ai",
    title: "AI governance",
    items: [
      { to: "/ai", label: "AI tools", icon: Sparkles, exact: true },
      { to: "/ai/requests", label: "AI requests", icon: ClipboardCheck, badge: "awaiting" },
    ],
  },
  {
    id: "org",
    title: "Organization",
    items: [
      { to: "/people", label: "People", icon: User },
      { to: "/teams", label: "Teams", icon: Users },
    ],
  },
];
const FOOTER_NAV: NavItem[] = [
  { to: "/activity", label: "Activity", icon: History },
  { to: "/settings", label: "Settings", icon: Settings },
];

const isActive = (item: NavItem, path: string) => (item.exact ? path === item.to : path === item.to || path.startsWith(`${item.to}/`));

/** A boolean or string set remembered in this browser (storage may be blocked). */
function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not persisted; fine for this page view.
    }
  }, [key, value]);
  return [value, setValue] as const;
}

function NavLink({ item, rail, badge, onNavigate }: { item: NavItem; rail: boolean; badge?: number; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: !!item.exact }}
      onClick={onNavigate}
      title={rail ? (badge ? `${item.label} (${badge} waiting for your review)` : item.label) : undefined}
      aria-label={rail ? item.label : undefined}
      className={`relative flex items-center gap-3 rounded-md py-2 text-sm font-medium text-stone-600 hover:bg-white/70 hover:text-stone-900 ${rail ? "justify-center px-0" : "px-3"}`}
      activeProps={{ className: "bg-white text-leaf-800! shadow-xs" }}
    >
      <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={1.75} aria-hidden />
      {!rail && <span className="flex-1 truncate">{item.label}</span>}
      {!!badge &&
        (rail ? (
          <span className="absolute top-1 right-2 h-2 w-2 rounded-full bg-accent ring-2 ring-soil-100" aria-hidden />
        ) : (
          <span className="rounded-full bg-accent px-1.5 text-xs text-on-accent tabular-nums" title="Waiting for your review">
            {badge}
          </span>
        ))}
    </Link>
  );
}

/** Shared by the desktop sidebar (optionally as an icon rail) and the mobile drawer. */
function Sidebar({
  rail,
  orgName,
  awaiting,
  onNavigate,
  onToggleRail,
  onClose,
  footer,
}: {
  rail: boolean;
  footer?: ReactNode;
  orgName?: string;
  awaiting: number;
  onNavigate?: () => void;
  onToggleRail?: () => void;
  onClose?: () => void;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [closed, setClosed] = useStored<string[]>("patch-nav-closed-groups", []);
  const badgeFor = (item: NavItem) => (item.badge === "awaiting" ? awaiting : undefined);

  return (
    <div className="flex h-full flex-col">
      <div className={`flex items-center gap-2 py-5 ${rail ? "justify-center px-2" : "pr-3 pl-5"}`}>
        {rail && onToggleRail ? (
          // Collapsed: the logo is the expand button (shows the expand icon on hover).
          <button
            type="button"
            onClick={onToggleRail}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="group relative flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/70"
          >
            <img src="/favicon.svg" alt="" className="h-7 w-7 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0" />
            <PanelLeftOpen
              className="absolute h-4.5 w-4.5 text-stone-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        ) : (
          <img src="/favicon.svg" alt="Patch" className="h-7 w-7 shrink-0" />
        )}
        {!rail && (
          <div className="min-w-0 flex-1">
            <div className="text-lg leading-tight font-semibold text-leaf-800">Patch</div>
            <div className="truncate text-xs text-stone-500">{orgName}</div>
          </div>
        )}
        {!rail && onToggleRail && (
          <button
            type="button"
            onClick={onToggleRail}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="rounded-md p-1.5 text-stone-500 hover:bg-white/70 hover:text-stone-800"
          >
            <PanelLeftClose className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
          </button>
        )}
        {onClose && (
          <button className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800" onClick={onClose} aria-label="Close menu">
            <X className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
      <nav aria-label="Main" className={`flex-1 overflow-y-auto pb-4 ${rail ? "px-2" : "px-3"}`}>
        {NAV.map((group, gi) => {
          // A group with the current page in it stays open so you can see where you are.
          const open = rail || !group.title || !closed.includes(group.id) || group.items.some((i) => isActive(i, path));
          return (
            <div key={group.id} className={gi > 0 ? "mt-4" : ""}>
              {group.title &&
                (rail ? (
                  <div className="mx-2 mb-2 border-t border-stone-200" aria-hidden />
                ) : (
                  <button
                    type="button"
                    className="group flex w-full items-center justify-between rounded px-3 py-1 text-xs font-semibold tracking-wide text-stone-400 uppercase hover:text-stone-600"
                    aria-expanded={open}
                    onClick={() => setClosed(open ? [...closed, group.id] : closed.filter((id) => id !== group.id))}
                  >
                    {group.title}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
                  </button>
                ))}
              {open && (
                <div className="mt-1 space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink key={item.to} item={item} rail={rail} badge={badgeFor(item)} onNavigate={onNavigate} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className={`space-y-0.5 border-t border-stone-200 py-3 ${rail ? "px-2" : "px-3"}`}>
        {FOOTER_NAV.map((item) => (
          <NavLink key={item.to} item={item} rail={rail} onNavigate={onNavigate} />
        ))}
        {footer}
      </div>
    </div>
  );
}

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
  const [rail, setRail] = useStored("patch-nav-rail", false);

  // The mobile drawer closes on Escape and stops the page behind it scrolling.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [menuOpen]);
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

  const awaitingCount = awaiting.data?.length ?? 0;
  const signOut = async () => {
    await authClient.signOut();
    navigate({ to: "/sign-in" });
  };
  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-stone-200 bg-soil-100 transition-[width] duration-200 lg:block ${rail ? "w-16" : "w-60"}`}
      >
        <Sidebar rail={rail} orgName={org.data?.name} awaiting={awaitingCount} onToggleRail={() => setRail(!rail)} />
      </aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-stone-200 bg-soil-100 shadow-xl">
            <Sidebar
              rail={false}
              orgName={org.data?.name}
              awaiting={awaitingCount}
              onNavigate={() => setMenuOpen(false)}
              onClose={() => setMenuOpen(false)}
              footer={
                // On phones the header is too narrow for these, so they live in the drawer.
                <div className="mt-2 space-y-0.5 border-t border-stone-200 pt-2">
                  <Link
                    to="/settings"
                    hash="account"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-stone-600 hover:bg-white/70 hover:text-stone-900"
                  >
                    <User className="h-4.5 w-4.5 shrink-0" strokeWidth={1.75} aria-hidden />
                    <span className="truncate">{session.data.user.name}</span>
                  </Link>
                  <ThemeToggle full />
                  <button
                    type="button"
                    onClick={signOut}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-stone-600 hover:bg-white/70 hover:text-stone-900"
                  >
                    <LogOut className="h-4.5 w-4.5 shrink-0" strokeWidth={1.75} aria-hidden />
                    Sign out
                  </button>
                </div>
              }
            />
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-200 bg-soil-50/90 px-4 py-3 backdrop-blur sm:px-6">
          <button
            className="relative -ml-1 rounded-md p-1.5 text-stone-600 hover:bg-stone-100 lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
          >
            <Menu className="h-5 w-5" aria-hidden />
            {awaitingCount > 0 && (
              <>
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent ring-2 ring-soil-50" aria-hidden />
                <span className="sr-only">{awaitingCount} requests waiting for your review</span>
              </>
            )}
          </button>
          <GlobalSearch />
          <div className="ml-auto hidden items-center gap-3 text-sm sm:flex">
            <ThemeToggle />
            <Link to="/settings" hash="account" className="text-stone-600 hover:text-stone-900 hover:underline" title="Your account">
              {session.data.user.name}
            </Link>
            <button className="text-stone-500 hover:text-stone-800" onClick={signOut}>
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

const THEMES: { value: Theme; icon: LucideIcon; label: string }[] = [
  { value: "system", icon: SunMoon, label: "System" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
];

/** Cycles system → light → dark. `full` is the labelled row used in the mobile drawer. */
function ThemeToggle({ full = false }: { full?: boolean }) {
  const [theme, setTheme] = useTheme();
  const i = THEMES.findIndex((t) => t.value === theme);
  const current = THEMES[i]!;
  const next = THEMES[(i + 1) % THEMES.length]!;
  return (
    <button
      type="button"
      className={
        full
          ? "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-stone-600 hover:bg-white/70 hover:text-stone-900"
          : "flex items-center gap-1.5 rounded-md px-2 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
      }
      onClick={() => setTheme(next.value)}
      title={`Theme: ${current.label}. Switch to ${next.label.toLowerCase()}.`}
      aria-label={`Theme: ${current.label}. Switch to ${next.label.toLowerCase()}.`}
    >
      <current.icon className={full ? "h-4.5 w-4.5 shrink-0" : "h-4 w-4"} strokeWidth={1.75} aria-hidden />
      <span className={full ? "" : "hidden md:inline"}>{full ? `Theme: ${current.label}` : current.label}</span>
    </button>
  );
}
