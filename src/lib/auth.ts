import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { isEmailAllowed } from "./access";
import { AI_SETTINGS_COOKIE, LEGACY_GEMINI_KEY_COOKIE } from "./cookie-names";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 giorni

function socialProviders() {
  const providers: Parameters<typeof betterAuth>[0]["socialProviders"] = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    };
  }
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }
  return providers;
}

export type ProviderId = "google" | "github";

export function enabledProviders(): ProviderId[] {
  const configured = Object.keys(socialProviders());
  return (["google", "github"] as const).filter((p) => configured.includes(p));
}

/**
 * Better Auth in modalità stateless: nessun database per l'autenticazione,
 * la sessione vive in un cookie cifrato (JWE). Gli utenti dell'app sono poi
 * registrati in DuckDB tramite l'email (vedi current-user.ts).
 */
function createAuth() {
  return betterAuth({
  appName: "Ankix",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  socialProviders: socialProviders(),
  session: {
    expiresIn: SESSION_MAX_AGE,
    cookieCache: {
      enabled: true,
      strategy: "jwe",
      maxAge: SESSION_MAX_AGE,
      refreshCache: true,
    },
  },
  account: {
    storeStateStrategy: "cookie",
    storeAccountCookie: true,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          if (!isEmailAllowed(user.email)) {
            // Durante il callback OAuth rimanda al login con un messaggio chiaro invece di una pagina 403.
            if (ctx) throw ctx.redirect(`${ctx.context.baseURL.replace(/\/api\/auth$/, "")}/login?error=email_not_allowed`);
            throw new APIError("FORBIDDEN", { message: "email_not_allowed" });
          }
          return { data: user };
        },
      },
    },
  },
  hooks: {
    // All'uscita rimuove anche le chiavi AI personali da questo browser.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-out") {
        for (const name of [AI_SETTINGS_COOKIE, LEGACY_GEMINI_KEY_COOKIE]) {
          ctx.setCookie(name, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
        }
      }
    }),
  },
  telemetry: { enabled: false },
  plugins: [
    nextCookies(),
  ],
});
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __ankixAuth?: Auth };

/** Istanza creata alla prima richiesta (non durante la build, dove i segreti possono mancare). */
export function getAuth(): Auth {
  globalForAuth.__ankixAuth ??= createAuth();
  return globalForAuth.__ankixAuth;
}
