/**
 * Self-test E2E — 069: modo plataforma (multi-tenant).
 *
 * Conduce una instancia REAL en modo plataforma de punta a punta: dos
 * negocios (uno por REST, otro por MCP si está encendido), invitación y
 * aceptación, aislamiento A↛B, módulos por negocio, suspensión, marca por
 * subdominio, acceso de soporte en dos niveles y tokens. Camino feliz e
 * infeliz.
 *
 * Requisitos (staging, NO en el equipo local):
 *   TENANCY=multi, PLATFORM_BASE_DOMAIN con DNS y certificado comodín,
 *   E2E_ADMIN_EMAIL incluido en PLATFORM_ADMIN_EMAILS, AGENDA=on (opcional:
 *   PLATFORM_MCP=on para la parte MCP).
 *
 * Uso:
 *   APP_BASE_URL=https://aliantis-staging.co \
 *   E2E_ORG_URL='https://{slug}.aliantis-staging.co' \
 *   E2E_ADMIN_EMAIL=ops@agencia.co E2E_ADMIN_PASSWORD=... \
 *   node scripts/e2e-plataforma.mjs
 * Sale con código 1 si algún check falla.
 */
const BASE = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
const ORG_URL = process.env.E2E_ORG_URL ?? "";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
if (!BASE || !ORG_URL.includes("{slug}") || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Faltan APP_BASE_URL, E2E_ORG_URL (con {slug}), E2E_ADMIN_EMAIL o E2E_ADMIN_PASSWORD.");
  process.exit(2);
}

const stamp = Date.now().toString(36);
const SLUG_A = `e2e-a-${stamp}`;
const SLUG_B = `e2e-b-${stamp}`;
const orgUrl = (slug) => ORG_URL.replace("{slug}", slug).replace(/\/+$/, "");

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

/**
 * Un cliente con su propio frasco de cookies (una persona = un frasco), POR
 * HOST, como un navegador con cookies de un host: la sesión de la raíz no
 * viaja a `{slug}.<base>` ni al revés.
 */
function cliente() {
  const frasco = new Map();
  return async function api(url, opts = {}) {
    const { origin, host } = new URL(url);
    const cookie = frasco.get(host) ?? "";
    const res = await fetch(url, {
      ...opts,
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        origin,
        ...(cookie ? { cookie } : {}),
        ...(opts.headers ?? {}),
      },
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) frasco.set(host, set.map((c) => c.split(";")[0]).join("; "));
    let json = null;
    try {
      json = await res.clone().json();
    } catch {}
    return { res, json };
  };
}

const admin = cliente();
const dueno = cliente();
const extrano = cliente();
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
const put = (body) => ({ method: "PUT", body: JSON.stringify(body) });

console.log("\n1 · Candados del modo plataforma");
{
  const r = await extrano(`${BASE}/api/auth/sign-up/email`, post({ name: "Nadie", email: `nadie-${stamp}@e2e.test`, password: "clave-segura-123" }));
  ok("registro público cerrado para un correo cualquiera", r.res.status >= 400, `status ${r.res.status}`);
  const bot = await extrano(`${BASE}/api/bot/profile`, { headers: { "x-api-key": "x".repeat(32) } });
  ok("/api/bot/* responde 404", bot.res.status === 404, `status ${bot.res.status}`);
  const plat = await extrano(`${BASE}/api/platform/organizations`);
  ok("/api/platform/* sin Super-Admin → 404", plat.res.status === 404, `status ${plat.res.status}`);
  const create = await extrano(`${BASE}/api/auth/organization/create`, post({ name: "x", slug: `x-${stamp}` }));
  ok("API propia del plugin organization cerrada", create.res.status === 404, `status ${create.res.status}`);
}

console.log("\n2 · Super-Admin y token");
{
  await admin(`${BASE}/api/auth/sign-up/email`, post({ name: "Ops", email: ADMIN_EMAIL, password: ADMIN_PASSWORD }));
  const login = await admin(`${BASE}/api/auth/sign-in/email`, post({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }));
  ok("el Super-Admin inicia sesión", login.res.ok, `status ${login.res.status}`);
  const lista = await admin(`${BASE}/api/platform/organizations`);
  ok("ve la lista de negocios", lista.res.status === 200, `status ${lista.res.status}`);
}
const tok = await admin(`${BASE}/api/platform/tokens`, post({ name: `e2e-${stamp}`, scopes: ["read", "provision"], expiresInDays: 1 }));
const TOKEN = tok.json?.token ?? "";
ok("crea un token alp_ (se muestra una vez)", /^alp_/.test(TOKEN));
const conToken = (url, opts = {}) => extrano(url, { ...opts, headers: { authorization: `Bearer ${TOKEN}`, ...(opts.headers ?? {}) } });

console.log("\n3 · Negocio A por REST (Blueprint)");
const blueprintA = {
  version: 1,
  organization: { slug: SLUG_A, name: "E2E Ferretería" },
  region: { country: "CO", locale: "es-CO", timezone: "America/Bogota" },
  brand: { name: "E2E Ferretería", accent: "#b45309", currency: "COP" },
  pipeline: { stages: ["Nuevo", "Cotización", "Negociando"] },
  agent: { name: "Ferre", greeting: "¡Hola! ¿En qué te ayudo?" },
  knowledge: { entries: [{ kind: "qa", question: "¿Horario?", answer: "8 a 6" }] },
  owner: { email: `dueno-${stamp}@e2e.test` },
};
let invitacionA = "";
let idA = "";
{
  const malo = await conToken(`${BASE}/api/platform/organizations`, post({ ...blueprintA, brand: { accent: "azul" } }));
  ok("Blueprint inválido → 422 con la ruta exacta", malo.res.status === 422 && JSON.stringify(malo.json).includes("brand.accent"));
  const secreto = await conToken(`${BASE}/api/platform/organizations`, post({ ...blueprintA, agent: { instructions: `usa sk-or-v1-${"a".repeat(30)}` } }));
  ok("un secreto en el Blueprint → 422", secreto.res.status === 422);
  const plan = await conToken(`${BASE}/api/platform/organizations?dryRun=true`, post(blueprintA));
  ok("dryRun devuelve el plan sin crear", plan.res.status === 200 && plan.json?.dryRun === true);
  const r = await conToken(`${BASE}/api/platform/organizations`, post(blueprintA));
  ok("crea el negocio A", r.res.status === 201, `status ${r.res.status} ${JSON.stringify(r.json)}`);
  invitacionA = r.json?.invitation?.url ?? "";
  idA = r.json?.organizationId ?? "";
  ok("devuelve el enlace de invitación en su subdominio", invitacionA.startsWith(`${orgUrl(SLUG_A)}/invitacion/`), invitacionA);
  const repetido = await conToken(`${BASE}/api/platform/organizations`, post(blueprintA));
  ok("el mismo slug otra vez → 409", repetido.res.status === 409);
  const exp = await conToken(`${BASE}/api/platform/organizations/${SLUG_A}/blueprint`);
  const otraVez = await conToken(`${BASE}/api/platform/organizations/${SLUG_A}/blueprint`, put(exp.json));
  ok(
    "aplicar lo exportado → todo sin_cambios (idempotente)",
    otraVez.res.status === 200 && Object.values(otraVez.json?.sections ?? {}).every((s) => s === "sin_cambios"),
    JSON.stringify(otraVez.json?.sections)
  );
}

console.log("\n4 · Negocio B (por MCP si está encendido)");
{
  const bpB = { version: 1, organization: { slug: SLUG_B, name: "E2E Clínica" }, region: { country: "MX", locale: "es-MX", timezone: "America/Mexico_City" } };
  const init = await conToken(`${BASE}/api/platform/mcp`, post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }));
  if (init.res.status === 404) {
    console.log("  (PLATFORM_MCP apagado: B se crea por REST)");
    const r = await conToken(`${BASE}/api/platform/organizations`, post(bpB));
    ok("crea el negocio B por REST", r.res.status === 201);
  } else {
    ok("MCP initialize", init.json?.result?.protocolVersion !== undefined);
    const lista = await conToken(`${BASE}/api/platform/mcp`, post({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    ok("MCP tools/list sin herramientas de datos personales", !/conversation|contact|soporte|support/.test(JSON.stringify(lista.json?.result?.tools?.map((t) => t.name))));
    const r = await conToken(`${BASE}/api/platform/mcp`, post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "apply_blueprint", arguments: { blueprint: bpB } } }));
    ok("crea el negocio B por MCP", r.json?.result?.isError === false, JSON.stringify(r.json));
    const sinToken = await extrano(`${BASE}/api/platform/mcp`, post({ jsonrpc: "2.0", id: 1, method: "ping" }));
    ok("MCP sin token → 401", sinToken.res.status === 401);
  }
}

console.log("\n5 · Invitación, marca por subdominio y aislamiento");
{
  const token = invitacionA.split("/").pop();
  const acepta = await dueno(`${orgUrl(SLUG_A)}/api/invitaciones/aceptar`, post({ token, name: "Dueño E2E", password: "clave-segura-123" }));
  ok("el dueño acepta la invitación (cuenta nueva)", acepta.res.ok, JSON.stringify(acepta.json));
  const usada = await extrano(`${orgUrl(SLUG_A)}/api/invitaciones/aceptar`, post({ token, name: "Otro", password: "clave-segura-123" }));
  ok("la invitación no sirve dos veces", usada.res.status === 410);
  await dueno(`${orgUrl(SLUG_A)}/api/auth/sign-in/email`, post({ email: `dueno-${stamp}@e2e.test`, password: "clave-segura-123" }));
  const enA = await dueno(`${orgUrl(SLUG_A)}/api/conversations`);
  ok("el dueño entra a su negocio", enA.res.status === 200, `status ${enA.res.status}`);
  const enB = await dueno(`${orgUrl(SLUG_B)}/api/conversations`);
  ok("A↛B: el dueño de A no ve nada en el host de B", enB.res.status === 401 || enB.res.status === 404, `status ${enB.res.status}`);
  const manifest = await extrano(`${orgUrl(SLUG_A)}/manifest.webmanifest`);
  ok("el manifest del subdominio lleva la marca del negocio", JSON.stringify(manifest.json ?? {}).includes("E2E Ferretería"));
  const raiz = await extrano(`${BASE}/manifest.webmanifest`);
  ok("el manifest de la raíz es de la plataforma", !JSON.stringify(raiz.json ?? {}).includes("E2E Ferretería"));
}

console.log("\n6 · Módulos por negocio");
{
  await conToken(`${BASE}/api/platform/organizations/${SLUG_A}/blueprint`, put({ version: 1, modules: { agenda: false } }));
  const agenda = await dueno(`${orgUrl(SLUG_A)}/api/calendar/settings`);
  ok("agenda apagada en A → 404 (aunque la instancia la tenga)", agenda.res.status === 404, `status ${agenda.res.status}`);
  await conToken(`${BASE}/api/platform/organizations/${SLUG_A}/blueprint`, put({ version: 1, modules: { agenda: true } }));
}

console.log("\n7 · Suspensión");
{
  await conToken(`${BASE}/api/platform/organizations/${SLUG_A}/suspend`, { method: "POST" });
  const s = await dueno(`${orgUrl(SLUG_A)}/api/conversations`);
  ok("suspendida → 403 organizacion_suspendida", s.res.status === 403 && s.json?.error?.code === "organizacion_suspendida");
  await conToken(`${BASE}/api/platform/organizations/${SLUG_A}/reactivate`, { method: "POST" });
  const r = await dueno(`${orgUrl(SLUG_A)}/api/conversations`);
  ok("reactivada → vuelve a entrar", r.res.status === 200);
}

console.log("\n8 · Acceso de soporte en dos niveles");
{
  const sin = await admin(`${orgUrl(SLUG_A)}/api/conversations`);
  ok("cookies de un host: la sesión de la raíz no viaja al subdominio", sin.res.status === 401, `status ${sin.res.status}`);
  const paseSin = await admin(`${BASE}/api/pase`, post({ organizationId: idA }));
  ok("sin membresía ni soporte no hay pase (403)", paseSin.res.status === 403, `status ${paseSin.res.status}`);
  const porToken = await conToken(`${BASE}/api/platform/organizations/${SLUG_A}/support`, post({ level: "lectura", reason: "E2E ticket 123", hours: 1 }));
  ok("un token no abre accesos de soporte", porToken.res.status === 404);
  const corto = await admin(`${BASE}/api/platform/organizations/${SLUG_A}/support`, post({ level: "lectura", reason: "corto", hours: 1 }));
  ok("motivo corto → 422", corto.res.status === 422);
  const g = await admin(`${BASE}/api/platform/organizations/${SLUG_A}/support`, post({ level: "lectura", reason: "E2E ticket 123", hours: 1 }));
  ok("abre un acceso de lectura", g.res.status === 201);
  const pase = await admin(`${BASE}/api/pase`, post({ organizationId: idA }));
  ok("con soporte vigente: pase al subdominio", pase.res.status === 200 && String(pase.json?.url).startsWith(orgUrl(SLUG_A)));
  const canje = await admin(pase.json?.url);
  ok("el canje crea la sesión del subdominio y lleva a /", canje.res.status === 302 && canje.res.headers.get("location")?.endsWith("/"));
  const otraVez = await extrano(pase.json?.url);
  ok("el pase es de un solo uso", otraVez.res.headers.get("location")?.endsWith("/login") ?? false);
  const sinAcceso = await admin(`${orgUrl(SLUG_A)}/api/conversations`);
  ok("con sesión en el subdominio, el acceso se valida en cada petición", sinAcceso.res.status === 200, `status ${sinAcceso.res.status}`);
  const lee = await admin(`${orgUrl(SLUG_A)}/api/conversations`);
  ok("con acceso: lee", lee.res.status === 200, `status ${lee.res.status}`);
  const escribe = await admin(`${orgUrl(SLUG_A)}/api/agent/profile`, put({ greeting: "hola" }));
  ok("lectura: escribir → 403 solo_lectura", escribe.json?.error?.code === "solo_lectura");
  const ia = await admin(`${orgUrl(SLUG_A)}/api/settings/ai`);
  ok("credenciales vetadas incluso para leer", ia.res.status === 403);
  await admin(`${BASE}/api/platform/support/${g.json?.grantId}`, { method: "DELETE" });
  const cfg = await admin(`${BASE}/api/platform/organizations/${SLUG_A}/support`, post({ level: "configuracion", reason: "E2E ajuste del agente", hours: 1 }));
  const cambia = await admin(`${orgUrl(SLUG_A)}/api/agent/profile`, put({ greeting: "¡Hola desde soporte!" }));
  ok("configuración: cambia el agente", cambia.res.status === 200, `status ${cambia.res.status}`);
  const envia = await admin(`${orgUrl(SLUG_A)}/api/contacts`, post({ name: "X", phone: "3001234567" }));
  ok("configuración: crear contactos → 403 fuera_de_alcance", envia.json?.error?.code === "fuera_de_alcance");
  await admin(`${BASE}/api/platform/support/${cfg.json?.grantId}`, { method: "DELETE" });
  const cerrado = await admin(`${orgUrl(SLUG_A)}/api/conversations`);
  ok("acceso cerrado → 404 otra vez", cerrado.res.status === 404);
  const audit = await admin(`${BASE}/platform/auditoria?accion=soporte_peticion`);
  ok("la auditoría registra las peticiones de soporte", audit.res.status === 200);
}

console.log("\n9 · Revocar el token");
{
  await admin(`${BASE}/api/platform/tokens/${tok.json?.id}`, { method: "DELETE" });
  const r = await conToken(`${BASE}/api/platform/organizations`);
  ok("token revocado → 401", r.res.status === 401);
}

console.log(`\n${checks - failures}/${checks} checks OK`);
if (failures > 0) process.exit(1);
