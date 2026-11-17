import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AUTH_RATE_LIMIT, checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  onUserCreated,
  resolveActiveOrganizationId,
} from "@/server/auth/on-signup";
import { isPublicSignupAllowed } from "@/server/auth/registration";
import { dominioBase, esPlataforma } from "@/lib/tenancy";

/**
 * Contexto interno del proceso: permite que el alta de cuentas de equipo
 * (owner → API) atraviese el gate de registro cerrado. No es alcanzable
 * desde fuera: solo envuelve llamadas server-side.
 */
const globalForSignup = globalThis as unknown as {
  __voceroInternalSignup?: AsyncLocalStorage<boolean>;
};

// En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
// dev) y todas las copias deben compartir el mismo contexto.
function internalSignupContext(): AsyncLocalStorage<boolean> {
  if (!globalForSignup.__voceroInternalSignup) {
    globalForSignup.__voceroInternalSignup = new AsyncLocalStorage<boolean>();
  }
  return globalForSignup.__voceroInternalSignup;
}

export function runInternalSignup<T>(fn: () => Promise<T>): Promise<T> {
  return internalSignupContext().run(true, fn);
}

function isInternalSignup(): boolean {
  return internalSignupContext().getStore() === true;
}

const RATE_LIMITED_PATHS = new Set(["/sign-in/email", "/sign-up/email"]);

/**
 * 069 — El plugin `organization` publica su propia API (`/organization/create`,
 * `/invite-member`, `/accept-invitation`, `/update`…). La app no usa ninguna:
 * las organizaciones las crea el alta (`single`) o la plataforma (`multi`),
 * y las invitaciones tienen su flujo con token hasheado. Abiertas, cualquier
 * usuario podía crearse un negocio —o una segunda membresía que le cambiaba
 * la organización en `single`— saltándose todo eso. Solo queda `set-active`
 * (el selector de empresas), que Better Auth valida contra la membresía.
 */
const ORGANIZATION_PATHS_PERMITIDOS = new Set(["/organization/set-active"]);

export function organizationPathBloqueado(path: string): boolean {
  return path.startsWith("/organization/") && !ORGANIZATION_PATHS_PERMITIDOS.has(path);
}

/**
 * 069 (D3) — En modo plataforma, UNA sesión para todos los subdominios: la
 * cookie vive en el dominio base y los orígenes `https://*.dominio` son de
 * confianza. Que la cookie se comparta NO decide la organización: la decide
 * el host de cada petición, validado contra la membresía (resolverContexto).
 */
function opcionesDePlataforma() {
  const base = dominioBase();
  if (!esPlataforma() || !base) return {};
  return {
    trustedOrigins: [`https://${base}`, `https://*.${base}`],
    advanced: {
      crossSubDomainCookies: { enabled: true, domain: base },
    },
  };
}

function createAuth() {
  const env = getEnv();
  return betterAuth({
    baseURL: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    ...opcionesDePlataforma(),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    plugins: [organization({ creatorRole: "owner" })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Rate limit por IP en login/registro (FR-062): 10 / 10 min → 429.
        if (RATE_LIMITED_PATHS.has(ctx.path)) {
          const ip = clientIp(ctx.headers);
          const result = checkRateLimit(`${ctx.path}:${ip}`, AUTH_RATE_LIMIT);
          if (!result.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Demasiados intentos; espera unos minutos",
            });
          }
        }
        if (organizationPathBloqueado(ctx.path)) {
          throw new APIError("NOT_FOUND");
        }
        // Registro público cerrado tras la primera organización (FR-060);
        // en modo plataforma, cerrado salvo Super-Admins (069).
        if (ctx.path === "/sign-up/email") {
          const email =
            typeof ctx.body?.email === "string" ? ctx.body.email : undefined;
          if (!isInternalSignup() && !(await isPublicSignupAllowed(email))) {
            throw new APIError("FORBIDDEN", {
              message: esPlataforma()
                ? "El registro está cerrado: entra con la invitación de tu negocio"
                : "El registro está cerrado: esta instancia ya tiene su organización",
            });
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await onUserCreated(user.id, user.name, user.email);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const organizationId = await resolveActiveOrganizationId(
              session.userId
            );
            return {
              data: { ...session, activeOrganizationId: organizationId },
            };
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __voceroAuth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.__voceroAuth) globalForAuth.__voceroAuth = createAuth();
  return globalForAuth.__voceroAuth;
}
