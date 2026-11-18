import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { clientIp } from "@/lib/rate-limit";
import { canjearPase } from "@/server/platform/pase";
import { hostDeHeaders } from "@/server/tenant/host";

/**
 * 069 (staging) — Canje del pase de sesión en el subdominio de un negocio:
 * `GET /api/auth/pase/canjear?t=…`. Valida el pase (firma, vencimiento, host,
 * un solo uso, acceso vigente), crea la sesión de ESTE host y redirige a `/`.
 * Mismo patrón que el callback OAuth de Better Auth (cookie y redirección).
 * Ver `src/server/platform/pase.ts`.
 */
export function pasePlataforma() {
  return {
    id: "pase-plataforma",
    endpoints: {
      canjearPase: createAuthEndpoint("/pase/canjear", { method: "GET" }, async (ctx) => {
        const token = typeof ctx.query?.t === "string" ? ctx.query.t : "";
        const h = ctx.request?.headers ?? ctx.headers;
        const r = await canjearPase(token, h ? hostDeHeaders(h) : null, h ? clientIp(h) : null);
        if (!r.ok) {
          // Sin decir por qué: un pase vencido o ajeno solo lleva al login de
          // este host; sin acceso, a «no perteneces».
          throw ctx.redirect(r.motivo === "sin_acceso" ? "/sin-acceso" : "/login");
        }
        const user = await ctx.context.internalAdapter.findUserById(r.userId);
        const session = user ? await ctx.context.internalAdapter.createSession(r.userId) : null;
        if (!user || !session) throw ctx.redirect("/login");
        await setSessionCookie(ctx, { session, user });
        throw ctx.redirect("/");
      }),
    },
  } satisfies BetterAuthPlugin;
}
