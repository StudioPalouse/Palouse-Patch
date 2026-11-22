/**
 * Personal / free email providers. When work email is required, sign-ups from
 * these domains (and their subdomains) are refused. Not exhaustive: extend it
 * with PATCH_BLOCKED_EMAIL_DOMAINS rather than chasing every provider here.
 */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  "gmail.com", "googlemail.com",
  // Microsoft
  "outlook.com", "hotmail.com", "live.com", "msn.com", "passport.com",
  "hotmail.co.uk", "hotmail.fr", "hotmail.de", "hotmail.it", "hotmail.es", "live.co.uk", "live.ca", "outlook.co.uk", "outlook.de", "outlook.fr",
  // Yahoo / AOL / Verizon
  "yahoo.com", "ymail.com", "rocketmail.com", "yahoo.co.uk", "yahoo.ca", "yahoo.com.au", "yahoo.co.in", "yahoo.fr", "yahoo.de", "yahoo.co.jp",
  "aol.com", "aim.com", "verizon.net",
  // Apple
  "icloud.com", "me.com", "mac.com",
  // Privacy-focused
  "proton.me", "protonmail.com", "protonmail.ch", "pm.me", "tutanota.com", "tutanota.de", "tuta.io", "tuta.com", "fastmail.com", "fastmail.fm", "hey.com", "duck.com", "skiff.com",
  // Other large webmail
  "mail.com", "email.com", "gmx.com", "gmx.net", "gmx.de", "gmx.us", "web.de", "zoho.com", "zohomail.com", "yandex.com", "yandex.ru", "ya.ru", "mail.ru", "inbox.ru", "list.ru", "bk.ru",
  "qq.com", "163.com", "126.com", "yeah.net", "sina.com", "naver.com", "daum.net", "hanmail.net", "rediffmail.com",
  "libero.it", "virgilio.it", "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "t-online.de", "seznam.cz", "wp.pl", "o2.pl", "interia.pl",
  "btinternet.com", "sky.com", "virginmedia.com", "comcast.net", "att.net", "sbcglobal.net", "bellsouth.net", "charter.net", "cox.net", "earthlink.net", "shaw.ca", "rogers.com", "sympatico.ca", "bigpond.com", "optusnet.com.au",
  // Common disposable inboxes
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc",
]);

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@").pop() ?? "";
}

/** True if the address is at a blocked domain or any subdomain of one. */
export function isBlockedEmailDomain(email: string, extra: Iterable<string> = []): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  const blocked = new Set([...FREE_EMAIL_DOMAINS, ...[...extra].map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean)]);
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (blocked.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

export const WORK_EMAIL_MESSAGE = "Please sign up with your work email address. Personal email providers aren't accepted.";
