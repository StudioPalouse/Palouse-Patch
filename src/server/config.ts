function bool(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  databaseUrl: env.DATABASE_URL ?? "postgres://patch:patch@localhost:5432/patch",
  databasePoolSize: Number(env.DATABASE_POOL_SIZE ?? 5),
  baseUrl: env.PATCH_BASE_URL ?? `http://localhost:${env.PORT ?? 3000}`,
  authSecret: env.BETTER_AUTH_SECRET,
  allowSignup: bool(env.PATCH_ALLOW_SIGNUP, true),
  autoMigrate: bool(env.PATCH_AUTO_MIGRATE, true),
  requireWorkEmail: bool(env.PATCH_REQUIRE_WORK_EMAIL, false),
  blockedEmailDomains: (env.PATCH_BLOCKED_EMAIL_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean),
  resendApiKey: env.RESEND_API_KEY || undefined,
  mailFrom: env.MAIL_FROM || "Patch <patch@palouse.ai>",
  isProduction: env.NODE_ENV === "production",
};

if (config.isProduction && (!config.authSecret || config.authSecret.length < 32)) {
  throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters in production");
}
