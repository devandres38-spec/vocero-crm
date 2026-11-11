/**
 * 076 (bloque I, D16 de Aliantis) — El panel de Andres de punta a punta,
 * contra la app real (next dev) y Postgres real, con la app bajo RLS:
 *
 * 1. `pnpm superadmin:alta` (con la URL del dueño) crea el superadmin; sin
 *    ella, el comando se niega.
 * 2. Sin segundo factor, `/admin` solo deja activarlo; el API responde 403.
 * 3. Activa el TOTP (el código se calcula aquí desde el secreto, RFC 6238) y
 *    se cierran todas sus sesiones.
 * 4. Login en dos pasos; «confiar en este dispositivo», rechazado.
 * 5. Alta de un negocio desde el panel: la contraseña una vez; el dueño debe
 *    cambiarla antes de usar las páginas.
 * 6. Pausar: el dueño pierde la sesión y no entra (403); activar: entra.
 * 7. Restablecer su contraseña: la vieja deja de servir, la nueva sirve.
 * 8. Quitar al último dueño: 409.
 * 9. Candado D16: con un mensaje centinela sembrado en el negocio, ninguna
 *    página ni respuesta del panel lo trae; los conteos sí lo cuentan.
 * 10. El gasto llega del cerebro (uno de mentira en :3261 que VERIFICA la
 *     firma derivada) y se ve en el resumen.
 * 11. Un usuario de negocio no ve el panel (404).
 * 12. Capturas de /admin, /admin/negocios y el detalle a 390 y 1280 px.
 *
 * Lo corre `.github/workflows/e2e.yml`. Sale con código 1 si algún check falla.
 * Nunca imprime una contraseña ni un secreto.
 */
import { spawnSync } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import http from "node:http";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const SUPER = `super-${RUN}@aliantis.test`;
const DUENO = `dueno-panel-${RUN}@e2e.test`;
const NOMBRE = `Clínica Panel ${RUN}`;
const CENTINELA = `CENTINELA-PANEL-${RUN}`;
const CAPTURAS = process.env.CAPTURAS_DIR ?? "e2e-capturas";

let failures = 0;
let checks = 0;
function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

/** Un navegador mínimo: su frasco de cookies (el segundo factor usa dos). */
function cliente() {
  const frasco = new Map();
  async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      redirect: "manual",
      ...opts,
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(frasco.size ? { cookie: [...frasco].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(opts.headers ?? {}),
      },
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [par, ...attrs] = c.split(";");
      const i = par.indexOf("=");
      const nombre = par.slice(0, i).trim();
      const valor = par.slice(i + 1).trim();
      const borrar = !valor || attrs.some((a) => /max-age=0\b/i.test(a.trim()));
      if (borrar) frasco.delete(nombre);
      else frasco.set(nombre, valor);
    }
    let json = null;
    let texto = "";
    try {
      texto = await res.clone().text();
      json = JSON.parse(texto);
    } catch {}
    return { res, json, texto };
  }
  api.cookies = () => [...frasco].map(([name, value]) => ({ name, value, url: BASE }));
  return api;
}

/** RFC 6238: SHA-1, 30 s, 6 dígitos, secreto en base32 (el del otpauth://). */
function totp(base32, ahora = Date.now()) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32.replace(/=+$/, "").toUpperCase()) bits += alfabeto.indexOf(c).toString(2).padStart(5, "0");
  const llave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(ahora / 30000)));
  const h = createHmac("sha1", llave).update(contador).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}

/** Un cerebro de mentira en :3261: /health y /vocero/gasto, que verifica la firma derivada. */
function cerebroDeMentira(gastoDe) {
  const llave = createHmac("sha256", process.env.BOT_API_KEY ?? "").update("aliantis:panel:gasto:v1").digest("hex");
  const pedidos = { validos: 0, invalidos: 0 };
  const servidor = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (d) => (cuerpo += d));
    req.on("end", () => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true, status: "ok", version: "e2e" }));
      }
      if (req.url === "/vocero/gasto" && req.method === "POST") {
        const esperada = Buffer.from(`sha256=${createHmac("sha256", llave).update(cuerpo).digest("hex")}`);
        const recibida = Buffer.from(String(req.headers["x-vocero-signature"] ?? ""));
        const valida = esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
        if (!valida) {
          pedidos.invalidos++;
          res.writeHead(401);
          return res.end("{}");
        }
        pedidos.validos++;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ en: new Date().toISOString(), negocios: gastoDe() }));
      }
      res.writeHead(404);
      res.end();
    });
  });
  return { servidor, pedidos };
}

function superadminAlta(args, env) {
  const r = spawnSync("pnpm", ["superadmin:alta", "--", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const contrasena = /contraseña:\s+(\S+)/.exec(salida)?.[1] ?? null;
  return { status: r.status, contrasena, sinSecretos: salida.replace(/contraseña:\s+\S+/g, "contraseña: ***") };
}

async function entrar(api, correo, contrasena) {
  return api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: correo, password: contrasena }) });
}

let negocioId = null;

async function main() {
  console.log("== 1. el superadmin, por comando ==");
  const sinDueno = superadminAlta(["--correo", SUPER, "--nombre", "Andres E2E"], { DATABASE_MIGRATIONS_URL: "" });
  ok("sin DATABASE_MIGRATIONS_URL, el comando se niega", sinDueno.status !== 0, sinDueno.sinSecretos.slice(-300));
  const alta = superadminAlta(["--correo", SUPER, "--nombre", "Andres E2E"], {
    DATABASE_MIGRATIONS_URL: process.env.DATABASE_URL,
  });
  ok("con la URL del dueño, lo crea y muestra la contraseña una vez", alta.status === 0 && !!alta.contrasena, alta.sinSecretos.slice(-300));
  const [fila] = await sql`select u.id, s.totp_activado_en from "user" u join superadministrador s on s.user_id = u.id where u.email = ${SUPER}`;
  ok("queda en superadministrador, sin TOTP y sin negocio", fila && fila.totp_activado_en === null);
  const [{ m }] = await sql`select count(*)::int as m from member where user_id = ${fila?.id ?? ""}`;
  ok("no es miembro de ningún negocio", m === 0);

  console.log("== 2. sin segundo factor, solo activarlo ==");
  const yo = cliente();
  const e1 = await entrar(yo, SUPER, alta.contrasena);
  ok("entra con la contraseña (aún sin 2FA)", e1.res.status === 200 && !e1.json?.twoFactorRedirect, String(e1.res.status));
  const raiz = await yo("/");
  ok("la raíz lo manda a /admin", [302, 303, 307, 308].includes(raiz.res.status) && /\/admin$/.test(raiz.res.headers.get("location") ?? ""), raiz.res.headers.get("location"));
  const panel0 = await yo("/admin");
  ok("/admin lo manda a activar el segundo factor", /\/admin\/segundo-factor/.test(panel0.res.headers.get("location") ?? ""), String(panel0.res.status));
  const api0 = await yo("/api/admin/negocios", { method: "POST", body: "{}" });
  ok("el API del panel: 403 sin segundo factor", api0.res.status === 403, String(api0.res.status));
  const habilitarHttp = await yo("/api/auth/two-factor/enable", { method: "POST", body: JSON.stringify({ password: alta.contrasena }) });
  ok("/two-factor/enable por HTTP: 404 (solo por dentro)", habilitarHttp.res.status === 404, String(habilitarHttp.res.status));

  console.log("== 3. activar el TOTP ==");
  const mala = await yo("/api/admin/segundo-factor", { method: "POST", body: JSON.stringify({ accion: "iniciar", contrasena: "no-es-la-contrasena" }) });
  ok("con la contraseña equivocada no empieza", mala.res.status === 400, String(mala.res.status));
  const ini = await yo("/api/admin/segundo-factor", { method: "POST", body: JSON.stringify({ accion: "iniciar", contrasena: alta.contrasena }) });
  const secreto = ini.json?.secreto ?? "";
  ok("devuelve el QR (SVG), el secreto y 10 códigos de respaldo", ini.res.status === 200 && /<svg/.test(ini.json?.qr ?? "") && secreto.length > 10 && ini.json?.codigosDeRespaldo?.length === 10, String(ini.res.status));
  ok("sin caché", (ini.res.headers.get("cache-control") ?? "").includes("no-store"));
  const ver = await yo("/api/admin/segundo-factor", { method: "POST", body: JSON.stringify({ accion: "verificar", codigo: totp(secreto) }) });
  ok("el primer código lo activa", ver.res.status === 200, `${ver.res.status} ${ver.texto.slice(0, 200)}`);
  const [act] = await sql`select u.two_factor_enabled, s.totp_activado_en from "user" u join superadministrador s on s.user_id = u.id where u.email = ${SUPER}`;
  ok("queda activado y marcado", act?.two_factor_enabled === true && act?.totp_activado_en !== null);
  const [{ n: sesiones }] = await sql`select count(*)::int as n from session where user_id = ${fila.id}`;
  ok("todas sus sesiones se cerraron", sesiones === 0, String(sesiones));

  console.log("== 4. login en dos pasos ==");
  const a = cliente();
  const p1 = await entrar(a, SUPER, alta.contrasena);
  ok("la contraseña sola ya no abre sesión: pide el código", p1.res.status === 200 && p1.json?.twoFactorRedirect === true, p1.texto.slice(0, 200));
  const confiar = await a("/api/auth/two-factor/verify-totp", { method: "POST", body: JSON.stringify({ code: totp(secreto), trustDevice: true }) });
  ok("«confiar en este dispositivo»: 400", confiar.res.status === 400, String(confiar.res.status));
  const p2 = await a("/api/auth/two-factor/verify-totp", { method: "POST", body: JSON.stringify({ code: totp(secreto) }) });
  ok("con el código, entra", p2.res.status === 200, `${p2.res.status} ${p2.texto.slice(0, 200)}`);
  // El registro y no el resumen: el resumen guardaría 60 s un gasto sin el negocio de la prueba.
  const registro0 = await a("/admin/registro");
  ok("el panel abre", registro0.res.status === 200 && registro0.texto.includes("Registro"), String(registro0.res.status));

  console.log("== 5. alta de un negocio desde el panel ==");
  const altaWeb = await a("/api/admin/negocios", { method: "POST", body: JSON.stringify({ nombre: NOMBRE, correo: DUENO, duenoNombre: "Dueña Panel" }) });
  negocioId = altaWeb.json?.organizationId ?? null;
  const duenoId = altaWeb.json?.userId ?? null;
  const contrasenaAlta = altaWeb.json?.contrasena ?? "";
  ok("201 con la contraseña (24) y el id", altaWeb.res.status === 201 && contrasenaAlta.length === 24 && !!negocioId, String(altaWeb.res.status));
  const repetida = await a("/api/admin/negocios", { method: "POST", body: JSON.stringify({ nombre: "Otro", correo: DUENO, duenoNombre: "X" }) });
  ok("el mismo correo otra vez: 409", repetida.res.status === 409, String(repetida.res.status));
  const sinOrigen = await a("/api/admin/negocios", { method: "POST", headers: { origin: "https://malo.example" }, body: JSON.stringify({ nombre: "X", correo: `x-${RUN}@e2e.test`, duenoNombre: "X" }) });
  ok("desde otro origen: 403", sinOrigen.res.status === 403, String(sinOrigen.res.status));
  const [reg] = await sql`select accion, detalle::text as d from registro_panel where negocio_id = ${negocioId} and accion = 'alta_negocio'`;
  ok("anotado en el registro, sin la contraseña", reg && !reg.d.includes(contrasenaAlta), JSON.stringify(reg));

  const dueno = cliente();
  const d1 = await entrar(dueno, DUENO, contrasenaAlta);
  ok("el dueño entra con la contraseña del alta", d1.res.status === 200, String(d1.res.status));
  const bandeja = await dueno("/inbox");
  ok("pero las páginas lo mandan a /cuenta (la contraseña la puso otra persona)", /\/cuenta$/.test(bandeja.res.headers.get("location") ?? ""), bandeja.res.headers.get("location"));
  const apiDueno = await dueno("/api/contacts");
  ok("el API del negocio no se bloquea (el cerebro y los webhooks no tienen sesión)", apiDueno.res.status === 200, String(apiDueno.res.status));
  const corta = await dueno("/api/cuenta/contrasena", { method: "POST", body: JSON.stringify({ actual: contrasenaAlta, nueva: "corta" }) });
  ok("una nueva de menos de 12: 422", corta.res.status === 422, String(corta.res.status));
  const httpCambio = await dueno("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: contrasenaAlta, newPassword: "una-frase-larga-de-la-duena" }) });
  ok("/change-password por HTTP: 404", httpCambio.res.status === 404, String(httpCambio.res.status));
  const PROPIA = `una-frase-larga-de-la-duena-${RUN}`;
  const cambio = await dueno("/api/cuenta/contrasena", { method: "POST", body: JSON.stringify({ actual: contrasenaAlta, nueva: PROPIA }) });
  ok("cambia su contraseña", cambio.res.status === 200, `${cambio.res.status} ${cambio.texto.slice(0, 200)}`);
  const bandeja2 = await dueno("/inbox");
  ok("y ya entra a las páginas", bandeja2.res.status === 200, `${bandeja2.res.status} ${bandeja2.res.headers.get("location")}`);

  console.log("== 9. candado D16: un mensaje centinela en el negocio ==");
  await sql`insert into contact (id, organization_id, name, wa_identity) values (${`ct_pn_${RUN}`}, ${negocioId}, ${`Paciente ${CENTINELA}`}, ${`57300${RUN.slice(-6).replace(/\D/g, "1")}`})`;
  await sql`insert into conversation (id, organization_id, contact_id, last_inbound_at) values (${`cv_pn_${RUN}`}, ${negocioId}, ${`ct_pn_${RUN}`}, now() at time zone 'UTC')`;
  await sql`insert into message (id, organization_id, conversation_id, direction, type, text) values (${`msg_pn_${RUN}`}, ${negocioId}, ${`cv_pn_${RUN}`}, 'in', 'text', ${CENTINELA})`;
  const paginas = ["/admin", "/admin/negocios", `/admin/negocios/${negocioId}`, "/admin/registro"];
  const conCentinela = [];
  for (const p of paginas) {
    const r = await a(p);
    if (r.res.status !== 200) conCentinela.push(`${p}: ${r.res.status}`);
    else if (r.texto.includes(CENTINELA)) conCentinela.push(`${p}: trae el centinela`);
  }
  ok("ninguna página del panel trae el texto ni el nombre del paciente", conCentinela.length === 0, conCentinela.join(" | "));
  const detalle = await a(`/admin/negocios/${negocioId}`);
  ok(
    "pero el conteo sí lo cuenta (1 conversación)",
    /Conversaciones<\/p><p[^>]*>1<\/p>/.test(detalle.texto),
    (detalle.texto.match(/Conversaciones<\/p>.{0,120}/) ?? [""])[0]
  );

  console.log("== 10. el gasto, leído del cerebro con la firma derivada ==");
  ok("el cerebro de mentira recibió pedidos firmados bien y ninguno mal", cerebro.pedidos.validos >= 1 && cerebro.pedidos.invalidos === 0, JSON.stringify(cerebro.pedidos));
  const resumen = await a("/admin");
  ok("el resumen muestra el gasto del negocio frente a su tope", resumen.texto.includes("US$ 0.75") && resumen.texto.includes("US$ 2.00"), "sin el gasto");

  console.log("== 6. pausar y activar ==");
  const malNombre = await a(`/api/admin/negocios/${negocioId}/pausa`, { method: "POST", body: JSON.stringify({ pausar: true, confirmacion: "otro" }) });
  ok("sin el nombre exacto, no pausa (422)", malNombre.res.status === 422, String(malNombre.res.status));
  const pausa = await a(`/api/admin/negocios/${negocioId}/pausa`, { method: "POST", body: JSON.stringify({ pausar: true, confirmacion: NOMBRE }) });
  ok("pausa", pausa.res.status === 200 && !!pausa.json?.pausadoEn, String(pausa.res.status));
  const apiPausado = await dueno("/api/contacts");
  ok("el dueño perdió su sesión (401)", apiPausado.res.status === 401, String(apiPausado.res.status));
  const d2 = await entrar(cliente(), DUENO, PROPIA);
  ok("y no entra: 403 con el motivo", d2.res.status === 403 && /pausado/i.test(d2.texto), `${d2.res.status} ${d2.texto.slice(0, 150)}`);
  const activa = await a(`/api/admin/negocios/${negocioId}/pausa`, { method: "POST", body: JSON.stringify({ pausar: false, confirmacion: NOMBRE }) });
  ok("activa", activa.res.status === 200 && activa.json?.pausadoEn === null, String(activa.res.status));
  const d3 = await entrar(cliente(), DUENO, PROPIA);
  ok("y vuelve a entrar con su contraseña", d3.res.status === 200, String(d3.res.status));

  console.log("== 7. restablecer y 8. quitar ==");
  const rest = await a(`/api/admin/negocios/${negocioId}/usuarios/${duenoId}/contrasena`, { method: "POST", body: "{}" });
  const nueva = rest.json?.contrasena ?? "";
  ok("restablece: una nueva de 24, sin caché", rest.res.status === 200 && nueva.length === 24 && (rest.res.headers.get("cache-control") ?? "").includes("no-store"), String(rest.res.status));
  ok("la vieja ya no sirve", (await entrar(cliente(), DUENO, PROPIA)).res.status !== 200);
  const conNueva = cliente();
  ok("la nueva sí", (await entrar(conNueva, DUENO, nueva)).res.status === 200);
  const [marca] = await sql`select debe_cambiar_contrasena as d from "user" where id = ${duenoId}`;
  ok("y debe cambiarla al entrar", marca?.d === true);
  const quitar = await a(`/api/admin/negocios/${negocioId}/usuarios/${duenoId}`, { method: "DELETE" });
  ok("quitar al último dueño: 409", quitar.res.status === 409, String(quitar.res.status));
  const ajeno = await a(`/api/admin/negocios/${negocioId}/usuarios/usr_no_existe/contrasena`, { method: "POST", body: "{}" });
  ok("restablecer a alguien que no es del negocio: 404", ajeno.res.status === 404, String(ajeno.res.status));

  console.log("== 11. un usuario de negocio no ve el panel ==");
  const operador = cliente();
  await entrar(operador, "e2e@vocero.test", "password-e2e-123");
  const ajenoPanel = await operador("/admin");
  ok("/admin para un dueño de negocio: 404", ajenoPanel.res.status === 404, String(ajenoPanel.res.status));
  const ajenoApi = await operador("/api/admin/negocios", { method: "POST", body: "{}" });
  ok("/api/admin para un dueño de negocio: 404", ajenoApi.res.status === 404, String(ajenoApi.res.status));

  console.log("== 12. capturas ==");
  try {
    const { chromium } = await import("playwright");
    mkdirSync(CAPTURAS, { recursive: true });
    const navegador = await chromium.launch();
    try {
      for (const [ancho, alto] of [
        [390, 844],
        [1280, 800],
      ]) {
        const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto } });
        await ctx.addCookies(a.cookies());
        const pagina = await ctx.newPage();
        for (const [nombre, ruta] of [
          ["resumen", "/admin"],
          ["negocios", "/admin/negocios"],
          ["detalle", `/admin/negocios/${negocioId}`],
        ]) {
          await pagina.goto(`${BASE}${ruta}`, { waitUntil: "networkidle", timeout: 90_000 });
          await pagina.screenshot({ path: `${CAPTURAS}/${nombre}-${ancho}.png`, fullPage: true });
        }
        const sinDesborde = await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        ok(`a ${ancho} px no hay desborde horizontal`, sinDesborde);
        await ctx.close();
      }
      ok("capturas de /admin, /admin/negocios y el detalle a 390 y 1280 px", true);
    } finally {
      await navegador.close();
    }
  } catch (err) {
    ok("capturas", false, String(err).slice(0, 300));
  }
}

const cerebro = cerebroDeMentira(() =>
  negocioId
    ? [
        {
          organizationId: negocioId,
          topeDiarioUsd: 2,
          zonaHoraria: "America/Bogota",
          hoyUsd: 0.75,
          mesUsd: 3.5,
          llamadasHoy: 12,
          fallidasHoy: 1,
          pruebasHoyUsd: 0.05,
        },
      ]
    : []
);

await new Promise((listo) => cerebro.servidor.listen(3261, "127.0.0.1", listo));
main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    cerebro.servidor.close();
    await sql.end();
    console.log(`\n${checks - failures}/${checks} checks en verde`);
    process.exit(failures > 0 ? 1 : 0);
  });
