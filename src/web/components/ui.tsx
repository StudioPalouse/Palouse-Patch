import { Link } from "@tanstack/react-router";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { label } from "../../shared/domain.ts";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-hover",
        variant === "secondary" && "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
        variant === "danger" && "border border-red-200 bg-white text-red-700 hover:bg-red-50",
        variant === "ghost" && "text-stone-600 hover:bg-stone-100",
        className,
      )}
    />
  );
}

export function LinkButton({ to, children, variant = "primary" }: { to: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Link
      to={to}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition",
        variant === "primary" ? "bg-accent text-on-accent hover:bg-accent-hover" : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
      )}
    >
      {children}
    </Link>
  );
}

const fieldClass =
  "block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm shadow-xs placeholder:text-stone-400 focus:border-leaf-500 focus:ring-2 focus:ring-leaf-200 focus:outline-none";

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={cx(fieldClass, props.className)} />;
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={3} {...props} className={cx(fieldClass, props.className)} />
);
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={cx(fieldClass, props.className)} />;

export function Field({ label: text, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-stone-700">{text}</span>
      {children}
      {error ? <span className="block text-xs text-red-600">{error}</span> : hint ? <span className="block text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}

/** Select built from a list of enum values, using shared labels. */
export function EnumSelect({
  values,
  value,
  onChange,
  allowEmpty,
  emptyLabel = "None",
}: {
  values: readonly string[];
  value: string | null | undefined;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {values.map((v) => (
        <option key={v} value={v}>
          {label(v)}
        </option>
      ))}
    </Select>
  );
}

const badgeTone: Record<string, string> = {
  active: "bg-leaf-100 text-leaf-800",
  production: "bg-leaf-100 text-leaf-800",
  pilot: "bg-sky-100 text-sky-800",
  evaluating: "bg-violet-100 text-violet-800",
  idea: "bg-violet-100 text-violet-800",
  draft: "bg-stone-100 text-stone-700",
  sunsetting: "bg-amber-100 text-amber-800",
  deprecated: "bg-amber-100 text-amber-800",
  retired: "bg-stone-200 text-stone-600",
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  in_review: "bg-sky-100 text-sky-800",
  changes_requested: "bg-amber-100 text-amber-800",
  approved: "bg-leaf-100 text-leaf-800",
  rejected: "bg-red-100 text-red-800",
  withdrawn: "bg-stone-200 text-stone-600",
  restricted: "bg-amber-100 text-amber-800",
  prohibited: "bg-red-100 text-red-800",
  adopted: "bg-leaf-100 text-leaf-800",
  piloting: "bg-sky-100 text-sky-800",
  paused: "bg-amber-100 text-amber-800",
};

const ACCESS_TEXT = { member: "In Patch", invited: "Invited", none: "Not in Patch" } as const;
const ACCESS_TONE = { member: "bg-leaf-100 text-leaf-800", invited: "bg-sky-100 text-sky-800", none: "bg-stone-100 text-stone-600" } as const;

/** Whether a person in the directory can sign in to Patch. */
export function AccessBadge({ access }: { access?: keyof typeof ACCESS_TEXT }) {
  if (!access) return null;
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", ACCESS_TONE[access])}>{ACCESS_TEXT[access]}</span>
  );
}

export function Badge({ value, children }: { value?: string; children?: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", (value && badgeTone[value]) || "bg-stone-100 text-stone-700")}>
      {children ?? (value ? label(value) : null)}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-stone-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-stone-200 bg-white", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
      <p className="font-medium text-stone-800">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
      <table className="min-w-full divide-y divide-stone-200 text-sm">
        <thead className="bg-stone-50">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-stone-500 uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("px-4 py-3 align-top", className)}>{children}</td>;
}

export function DetailList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium tracking-wide text-stone-500 uppercase">{k}</dt>
          <dd className="mt-1 text-sm text-stone-800">{v ?? <span className="text-stone-400">Not set</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div>;
}

export function Loading() {
  return <div className="py-12 text-center text-sm text-stone-500">Loading…</div>;
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="max-w-xs" />;
}

export function ExternalLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="break-all text-leaf-700 underline-offset-2 hover:underline">
      {children ?? href}
    </a>
  );
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-medium text-stone-900 hover:text-leaf-700 hover:underline">
      {children}
    </Link>
  );
}
