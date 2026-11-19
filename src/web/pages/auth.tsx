import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, ErrorBanner, Field, Input } from "../components/ui.tsx";
import { authClient } from "../lib/auth.ts";
import { slugify } from "../lib/format.ts";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <span className="text-2xl font-semibold tracking-tight text-leaf-800">Patch</span>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <h1 className="mb-5 text-lg font-semibold text-stone-900">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

export function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const config = useQuery({ queryKey: ["config"], queryFn: () => fetch("/api/config").then((r) => r.json()) });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error) return setError(error.message ?? "Could not sign in");
    navigate({ to: "/" });
  }

  return (
    <Shell title="Sign in">
      <form onSubmit={submit} className="space-y-4">
        <ErrorBanner error={error} />
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {config.data?.allowSignup && (
        <p className="mt-5 text-center text-sm text-stone-500">
          New here?{" "}
          <Link to="/sign-up" className="font-medium text-leaf-700 hover:underline">
            Create an account
          </Link>
        </p>
      )}
    </Shell>
  );
}

export function SignUpPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signUp.email(form);
    setBusy(false);
    if (error) return setError(error.message ?? "Could not create account");
    navigate({ to: "/" });
  }

  return (
    <Shell title="Create your account">
      <form onSubmit={submit} className="space-y-4">
        <ErrorBanner error={error} />
        <Field label="Name">
          <Input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Work email">
          <Input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" hint="At least 10 characters">
          <Input
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-stone-500">
        Already have an account?{" "}
        <Link to="/sign-in" className="font-medium text-leaf-700 hover:underline">
          Sign in
        </Link>
      </p>
    </Shell>
  );
}

export function OnboardingPage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const base = slugify(name) || "org";
    const { data, error } = await authClient.organization.create({
      name,
      slug: `${base}-${Math.random().toString(36).slice(2, 6)}`,
    });
    if (error || !data) {
      setBusy(false);
      return setError(error?.message ?? "Could not create organization");
    }
    await authClient.organization.setActive({ organizationId: data.id });
    window.location.href = "/";
  }

  return (
    <Shell title="Name your organization">
      <p className="mb-4 text-sm text-stone-500">
        This is the workspace where your team documents systems, owners and use cases.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBanner error={error} />
        <Field label="Organization name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Creating…" : "Continue"}
        </Button>
      </form>
    </Shell>
  );
}
