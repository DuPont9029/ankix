import "server-only";

/** Domini email ammessi (es. "studenti.unimi.it,unimi.it"). Vuoto = qualsiasi account. */
function allowedDomains(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const domains = allowedDomains();
  if (domains.length === 0) return true;
  const domain = email.toLowerCase().split("@").pop() ?? "";
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Email degli amministratori (separate da virgola): vedono il codice TOTP e il QR per l'authenticator. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && adminEmails().includes(email.trim().toLowerCase());
}

/** Con CLASS_TOTP_SECRET impostato, i nuovi utenti devono inserire il codice TOTP della classe. */
export function joinCodeRequired(): boolean {
  return Boolean(process.env.CLASS_TOTP_SECRET?.trim());
}
