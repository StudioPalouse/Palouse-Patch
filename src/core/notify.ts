/**
 * Outbound notifications from core services. Core stays free of server
 * dependencies: the server installs a delivery function (email via Resend) at
 * startup, and tests run with the default no-op.
 */
export type Notice = { to: string[]; subject: string; intro: string; action: string; path: string };
type Deliver = (notice: Omit<Notice, "to"> & { to: string }) => Promise<void>;

let deliver: Deliver = async () => {};

export function setNotifier(fn: Deliver) {
  deliver = fn;
}

/** Best effort: a failed email never fails the action that triggered it. */
export async function notify(notices: Notice[]) {
  for (const n of notices) {
    for (const to of new Set(n.to.filter(Boolean))) {
      try {
        await deliver({ ...n, to });
      } catch (e) {
        console.error(`[notify] could not deliver "${n.subject}" to ${to}`, e);
      }
    }
  }
}
