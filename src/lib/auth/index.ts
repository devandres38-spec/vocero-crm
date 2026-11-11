import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";
import { dbDeCuentas, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AUTH_RATE_LIMIT, checkRateLimit, clientIp } from "@/lib/rate-limit";
import { antesDeCrearSesion } from "@/server/auth/on-signup";
import { bloqueoDeRuta, pideConfiarDispositivo } from "@/server/auth/registration";

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

const RATE_LIMITED_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  // 076 — El código del segundo factor. Además del límite por IP, Better Auth
  // bloquea la cuenta 15 min tras 10 fallos y limita 3 intentos cada 10 s.
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

function createAuth() {
  const env = getEnv();
  return betterAuth({
    baseURL: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    // 075 — Sus tablas no tienen RLS: van por la base de cuentas, sin negocio.
    database: drizzleAdapter(dbDeCuentas(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
        // 076 — El segundo factor del superadmin (secreto y códigos cifrados).
        twoFactor: schema.twoFactor,
      },
    }),
    user: {
      additionalFields: {
        // 076 — La contraseña la puso otra persona: hay que cambiarla al entrar.
        // `input: false`: nadie la cambia por `/update-user`.
        debeCambiarContrasena: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    // 074 — Nadie crea negocios por el plugin: solo `crearNegocio` (Andres).
    // Sus rutas, además, quedan en 404 en el gancho de abajo.
    plugins: [
      organization({ creatorRole: "owner", allowUserToCreateOrganization: false }),
      // 076 (D16) — TOTP obligatorio para el superadmin del panel. Lo activa él
      // en `/admin/segundo-factor` (la ruta `enable` solo se abre por dentro);
      // reiniciarlo, solo con `superadmin:alta --reiniciar-segundo-factor`.
      twoFactor({ issuer: "Aliantis" }),
    ],
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
        // 076 (respuesta 6 de Andres) — Sin «confiar en este dispositivo»:
        // el panel pide el código siempre.
        if (pideConfiarDispositivo(ctx.path, ctx.body)) {
          throw new APIError("BAD_REQUEST", {
            message: "No se puede confiar en un dispositivo: el código se pide siempre",
          });
        }
        // 074 — Registro público cerrado siempre y las rutas del plugin
        // `organization` en 404 (`registration.ts`). 076 — Las del segundo
        // factor, cerradas salvo verificar el código (y activarlo por dentro).
        const bloqueo = bloqueoDeRuta(ctx.path, isInternalSignup());
        if (bloqueo) {
          throw new APIError(bloqueo.status, { message: bloqueo.message });
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // 076 — Fija el negocio activo; un negocio pausado no entra.
          before: antesDeCrearSesion,
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
