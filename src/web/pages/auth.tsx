import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, ErrorBanner, Field, Input } from "../components/ui.tsx";
import { authClient, inOAuthFlow, oauthRedirect } from "../lib/auth.ts";
import { slugify } from "../lib/format.ts";
import { isBlockedEmailDomain, WORK_EMAIL_MESSAGE } from "../../shared/email-domains.ts";

/** Where to go after signing in or up: a same-site ?redirect=/path, else home. */
function redirectTarget() {
  const r = new URLSearchParams(window.location.search).get("redirect");
  return r && r.startsWith("/") && !r.startsWith("//") ? r : "/";
}

/** Carry ?redirect across the sign-in / sign-up links. */
function forwardRedirect() {
  const r = redirectTarget();
  return r === "/" ? undefined : { redirect: r };
}

/** Link between sign-in and sign-up that keeps ?redirect, or the whole signed query during an OAuth flow. */
function AuthLink({ to, children }: { to: "/sign-in" | "/sign-up"; children: React.ReactNode }) {
  const className = "font-medium text-leaf-700 hover:underline";
  if (inOAuthFlow())
    return (
      <a href={to + window.location.search} className={className}>
        {children}
      </a>
    );
  return (
    <Link to={to} search={forwardRedirect()} className={className}>
      {children}
    </Link>
  );
}

export function Shell({ title, children }: { title: string; children: React.ReactNode }) {
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const config = useQuery({ queryKey: ["config"], queryFn: () => fetch("/api/config").then((r) => r.json()) });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error) return setError(error.message ?? "Could not sign in");
    window.location.href = oauthRedirect(data) ?? redirectTarget();
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
      {config.data?.mailEnabled && (
        <p className="mt-4 text-center text-sm">
          <Link to="/forgot-password" className="text-stone-500 hover:text-leaf-700 hover:underline">
            Forgot your password?
          </Link>
        </p>
      )}
      {config.data?.allowSignup && (
        <p className="mt-5 text-center text-sm text-stone-500">
          New here?{" "}
          <AuthLink to="/sign-up">Create an account</AuthLink>
        </p>
      )}
    </Shell>
  );
}

export function SignUpPage() {
  const config = useQuery({ queryKey: ["config"], queryFn: () => fetch("/api/config").then((r) => r.json()) });
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  // Invited people may use any address (the server checks the invitation).
  const workEmailOnly = !!config.data?.requireWorkEmail && !redirectTarget().startsWith("/accept-invitation/");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.signUp.email(form);
    setBusy(false);
    if (error) return setError(error.message ?? "Could not create account");
    window.location.href = oauthRedirect(data) ?? redirectTarget();
  }

  return (
    <Shell title="Create your account">
      <form onSubmit={submit} className="space-y-4">
        <ErrorBanner error={error} />
        <Field label="Name">
          <Input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field
          label="Work email"
          hint={workEmailOnly ? "Use your company address; personal providers like Gmail aren't accepted." : undefined}
          error={workEmailOnly && form.email.includes("@") && isBlockedEmailDomain(form.email) ? WORK_EMAIL_MESSAGE : undefined}
        >
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
        <AuthLink to="/sign-in">Sign in</AuthLink>
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

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setBusy(false);
    if (error) return setError(error.message ?? "Could not send reset email");
    setSent(true);
  }

  return (
    <Shell title="Reset your password">
      {sent ? (
        <p className="text-sm text-stone-600">
          If an account exists for <strong>{email}</strong>, we've sent a link to reset its password. Check your inbox.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <ErrorBanner error={error} />
          <p className="text-sm text-stone-500">Enter your email and we'll send you a link to choose a new password.</p>
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="mt-5 text-center text-sm text-stone-500">
        <Link to="/sign-in" className="font-medium text-leaf-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </Shell>
  );
}

export function ResetPasswordPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const linkError = params.get("error");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (error) return setError(error.message ?? "Could not reset password");
    setDone(true);
  }

  return (
    <Shell title="Choose a new password">
      {done ? (
        <p className="text-sm text-stone-600">Your password has been changed.</p>
      ) : !token || linkError ? (
        <p className="text-sm text-stone-600">
          This reset link is invalid or has expired.{" "}
          <Link to="/forgot-password" className="font-medium text-leaf-700 hover:underline">
            Request a new one
          </Link>
          .
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <ErrorBanner error={error} />
          <Field label="New password" hint="At least 10 characters">
            <Input
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Saving…" : "Set password"}
          </Button>
        </form>
      )}
      <p className="mt-5 text-center text-sm text-stone-500">
        <Link to="/sign-in" className="font-medium text-leaf-700 hover:underline">
          {done ? "Sign in" : "Back to sign in"}
        </Link>
      </p>
    </Shell>
  );
}

export function AcceptInvitationPage({ id }: { id: string }) {
  const session = authClient.useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invitation = useQuery({
    queryKey: ["invitation", id],
    enabled: !!session.data,
    retry: false,
    queryFn: async () => {
      const { data, error } = await authClient.organization.getInvitation({ query: { id } });
      if (error) throw new Error(error.message ?? "Invitation not found");
      return data;
    },
  });

  async function respond(accept: boolean) {
    setBusy(true);
    setError(null);
    const { error } = accept
      ? await authClient.organization.acceptInvitation({ invitationId: id })
      : await authClient.organization.rejectInvitation({ invitationId: id });
    if (error) {
      setBusy(false);
      return setError(error.message ?? "Could not update invitation");
    }
    if (accept && invitation.data) await authClient.organization.setActive({ organizationId: invitation.data.organizationId });
    window.location.href = "/";
  }

  if (session.isPending) return null;

  const here = `/accept-invitation/${id}`;
  if (!session.data) {
    return (
      <Shell title="You've been invited">
        <p className="mb-5 text-sm text-stone-600">Sign in, or create an account using the email address the invitation was sent to.</p>
        <div className="space-y-2">
          <Link to="/sign-in" search={{ redirect: here }} className="block">
            <Button className="w-full">Sign in</Button>
          </Link>
          <Link to="/sign-up" search={{ redirect: here }} className="block">
            <Button variant="secondary" className="w-full">
              Create an account
            </Button>
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="You've been invited">
      <ErrorBanner error={error} />
      {invitation.isPending ? (
        <p className="text-sm text-stone-500">Loading invitation…</p>
      ) : invitation.isError || !invitation.data ? (
        <p className="text-sm text-stone-600">
          This invitation is invalid, has expired, or was sent to a different email than the one you're signed in with (
          {session.data.user.email}).
        </p>
      ) : (
        <>
          <p className="mb-5 text-sm text-stone-600">
            <strong>{invitation.data.inviterEmail}</strong> invited you to join <strong>{invitation.data.organizationName}</strong>{" "}
            as a {invitation.data.role}.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => respond(true)} className="flex-1">
              Accept
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => respond(false)}>
              Decline
            </Button>
          </div>
        </>
      )}
    </Shell>
  );
}
