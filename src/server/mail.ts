import { config } from "./config.ts";

export type Mail = { to: string; subject: string; text: string; html: string };

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal HTML email: a short message and one call-to-action button. */
export function actionEmail(opts: { to: string; subject: string; intro: string; action: string; url: string; outro?: string }): Mail {
  const outro = opts.outro ?? "If you weren't expecting this email, you can ignore it.";
  const text = `${opts.intro}\n\n${opts.action}: ${opts.url}\n\n${outro}\n`;
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#1c1917;max-width:480px;margin:0 auto;padding:24px">
<p style="font-size:15px;line-height:1.5">${escape(opts.intro)}</p>
<p style="margin:24px 0"><a href="${escape(opts.url)}" style="background:#3f6212;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escape(opts.action)}</a></p>
<p style="font-size:13px;color:#78716c;line-height:1.5">Or paste this link into your browser:<br><a href="${escape(opts.url)}" style="color:#3f6212">${escape(opts.url)}</a></p>
<p style="font-size:13px;color:#78716c">${escape(outro)}</p>
</body></html>`;
  return { to: opts.to, subject: opts.subject, text, html };
}

/**
 * Send an email through Resend. Without RESEND_API_KEY (local dev, tests) the
 * message is logged instead so links can still be followed.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!config.resendApiKey) {
    console.log(`[mail] (not sent, RESEND_API_KEY unset) to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.resendApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: config.mailFrom, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[mail] Resend rejected email to ${mail.to}: ${res.status} ${body}`);
    throw new Error("Could not send email");
  }
}
