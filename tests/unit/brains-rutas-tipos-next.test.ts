import { describe, expect, it } from "vitest";

/**
 * 070 — Réplica del chequeo de tipos que `next build` (Next 15) genera para
 * CADA route handler (`next/dist/build/webpack/plugins/next-types-plugin`):
 * el segundo argumento debe ser asignable a `{ params: Promise<SegmentParams> }`.
 *
 * `next build` falló en staging porque `withBrain`/`withBrainAgenda`
 * devolvían `(req, ctx?: C)`: con `ctx` OPCIONAL el tipo es `C | undefined`,
 * que no cabe en `RouteContext`. `next typegen` no lo detecta (su validador es
 * otro), así que aquí se replica el de `build` y lo valida `pnpm typecheck`
 * sin correr el build. Si una ruta de `/api/brains/*` vuelve a romperlo, esta
 * prueba no compila.
 */

/* ---- Copiado de next-types-plugin (Next 15.5) ---------------------------- */
type OmitWithTag<T, K extends keyof never, _M> = Omit<T, K>;
type Diff<Base, T extends Base, Message extends string = ""> = 0 extends 1 & T ? object : OmitWithTag<T, keyof Base, Message>;
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type */
type FirstArg<T extends Function> = T extends (...args: [infer A, any]) => any ? (unknown extends A ? any : A) : never;
type SecondArg<T extends Function> = T extends (...args: [any, infer A]) => any ? (unknown extends A ? any : A) : never;
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type */
type ParamCheck<T> = { __tag__: string; __param_position__: string; __param_type__: T };
function checkFields<_ extends { [k in keyof never]: never }>() {}
/* -------------------------------------------------------------------------- */

type RouteContext<P> = { params: Promise<P> };

// Las dos dinámicas (las que rompieron el build).
type Llm = typeof import("@/app/api/brains/llm/[...ruta]/route");
type Media = typeof import("@/app/api/brains/media/[mediaId]/route");
// 072-B — La tercera dinámica: el puente de herramientas de módulo.
type Tools = typeof import("@/app/api/brains/tools/[name]/route");

checkFields<
  Diff<ParamCheck<RouteContext<{ ruta: string[] }>>, { __tag__: "POST"; __param_position__: "second"; __param_type__: SecondArg<Llm["POST"]> }, "POST">
>();
checkFields<
  Diff<ParamCheck<RouteContext<{ mediaId: string }>>, { __tag__: "GET"; __param_position__: "second"; __param_type__: SecondArg<Media["GET"]> }, "GET">
>();
checkFields<
  Diff<ParamCheck<RouteContext<{ name: string }>>, { __tag__: "POST"; __param_position__: "second"; __param_type__: SecondArg<Tools["POST"]> }, "POST">
>();

// Y las estáticas: su segundo argumento (si lo declaran) también debe caber.
type Estatica = RouteContext<object>;
type Context = typeof import("@/app/api/brains/context/route");
type Messages = typeof import("@/app/api/brains/messages/route");
type Ficha = typeof import("@/app/api/brains/ficha/route");
type Stage = typeof import("@/app/api/brains/stage/route");
type Handoff = typeof import("@/app/api/brains/handoff/route");
type Typing = typeof import("@/app/api/brains/typing/route");
type Slots = typeof import("@/app/api/brains/agenda/slots/route");
type Book = typeof import("@/app/api/brains/agenda/book/route");
type Bookings = typeof import("@/app/api/brains/agenda/bookings/route");
type Cancel = typeof import("@/app/api/brains/agenda/cancel/route");
type Followup = typeof import("@/app/api/brains/agenda/followup/route");

type Ok<F extends (...a: never[]) => unknown> = Diff<
  ParamCheck<Estatica>,
  { __tag__: "M"; __param_position__: "second"; __param_type__: SecondArg<F> },
  "M"
>;
checkFields<Ok<Context["GET"]>>();
checkFields<Ok<Messages["POST"]>>();
checkFields<Ok<Ficha["PUT"]>>();
checkFields<Ok<Stage["POST"]>>();
checkFields<Ok<Handoff["POST"]>>();
checkFields<Ok<Typing["POST"]>>();
checkFields<Ok<Slots["GET"]>>();
checkFields<Ok<Book["POST"]>>();
checkFields<Ok<Book["PATCH"]>>();
checkFields<Ok<Bookings["GET"]>>();
checkFields<Ok<Cancel["POST"]>>();
checkFields<Ok<Followup["POST"]>>();

// El primer argumento, `Request`.
checkFields<
  Diff<ParamCheck<Request>, { __tag__: "POST"; __param_position__: "first"; __param_type__: FirstArg<Llm["POST"]> }, "POST">
>();

describe("tipos de route handlers de /api/brains (como los valida next build)", () => {
  it("compila (el chequeo es de tipos: lo verifica `pnpm typecheck`)", () => {
    expect(true).toBe(true);
  });
});
