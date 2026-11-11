/**
 * 074 — Self-test E2E del bloque G: el alta de negocios solo por Andres.
 *
 * 1. El registro público responde 403 y `/register` ya no tiene formulario.
 * 2. Con la sesión del operador, las rutas del plugin `organization`
 *    (`create`, `list`, `delete`…) responden 404 y no se crea nada.
 * 3. `pnpm negocio:alta` (el comando real) crea un segundo negocio: su dueño
 *    entra con la contraseña que mostró el comando, ve sus 5 etapas y no ve
 *    ninguna conversación del operador.
 * 4. El mismo correo, o el del operador, otra vez: error y ninguna fila nueva.
 *
 * Corre DESPUÉS de los demás arneses (el operador ya existe, creado por
 * `scripts/e2e-operador.mjs`) y deshace lo suyo. Guion: tests/e2e/us-alta.md.
 * Lo corre `.github/workflows/e2e.yml`. Sale con código 1 si algún check falla.
 */
import { spawnSync } from "node:child_process";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const CORREO_NUEVO = `alta-${RUN}@e2e.test`;

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

/** Un cliente con su propia cookie: cada dueño, su sesión. */
function cliente() {
  let cookie = "";
  return async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(cookie ? { cookie } : {}),
        ...(opts.headers ?? {}),
      },
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
    let json = null;
    try {
      json = await res.clone().json();
    } catch {}
    return { res, json };
  };
}

function alta(correo, nombre = `Negocio alta ${RUN}`) {
  // 075 — El comando corre con el usuario de la app (APP_DATABASE_URL), bajo RLS.
  const r = spawnSync(
    "pnpm",
    ["negocio:alta", "--", "--nombre", nombre, "--dueno-correo", correo, "--dueno-nombre", "Dueña E2E"],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL }, shell: process.platform === "win32" }
  );
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return {
    status: r.status,
    salida,
    org: /id del negocio:\s+(org_[a-z0-9]+)/.exec(salida)?.[1] ?? null,
    contrasena: /contraseña:\s+(\S+)/.exec(salida)?.[1] ?? null,
  };
}

const contar = async () => {
  const [{ o }] = await sql`select count(*)::int as o from organization`;
  const [{ u }] = await sql`select count(*)::int as u from "user"`;
  return { o, u };
};

async function main() {
  let creado = null;
  try {
    console.log("== Registro público cerrado ==");
    const anonimo = cliente();
    const su = await anonimo("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email: `intruso-${RUN}@e2e.test`, password: "password-123456", name: "Intruso" }),
    });
    ok("registrarse solo → 403", su.res.status === 403, String(su.res.status));
    const [{ n: intruso }] = await sql`select count(*)::int as n from "user" where email = ${`intruso-${RUN}@e2e.test`}`;
    ok("y no queda ningún usuario", intruso === 0);
    const reg = await fetch(`${BASE}/register`);
    const html = await reg.text();
    ok(
      "/register dice que las cuentas las crea Aliantis, sin formulario",
      reg.status === 200 && html.includes("Las cuentas las crea Aliantis") && !/<form/i.test(html),
    );

    console.log("== Rutas del plugin organization cerradas ==");
    const operador = cliente();
    const login = await operador("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: "e2e@vocero.test", password: "password-e2e-123" }),
    });
    ok("el operador entra", login.res.ok, String(login.res.status));
    const antes = await contar();
    const crear = await operador("/api/auth/organization/create", {
      method: "POST",
      body: JSON.stringify({ name: `Colado ${RUN}`, slug: `colado-${RUN}` }),
    });
    ok("organization/create con sesión → 404", crear.res.status === 404, String(crear.res.status));
    const lista = await operador("/api/auth/organization/list");
    ok("organization/list → 404", lista.res.status === 404, String(lista.res.status));
    const borrar = await operador("/api/auth/organization/delete", {
      method: "POST",
      body: JSON.stringify({ organizationId: "cualquiera" }),
    });
    ok("organization/delete → 404", borrar.res.status === 404, String(borrar.res.status));
    ok("y no se creó ningún negocio", (await contar()).o === antes.o);

    console.log("== pnpm negocio:alta ==");
    creado = alta(CORREO_NUEVO);
    ok("el comando crea el negocio", creado.status === 0 && Boolean(creado.org), creado.salida.split("\n")[0]);
    ok("muestra una contraseña fuerte (24 caracteres)", /^[A-Za-z0-9_-]{24}$/.test(creado.contrasena ?? ""));
    const [m] = await sql`select m.role, m.organization_id from member m join "user" u on u.id = m.user_id where u.email = ${CORREO_NUEVO}`;
    ok("su dueño es owner de ESE negocio", m?.role === "owner" && m?.organization_id === creado.org, JSON.stringify(m));

    const dueno = cliente();
    const entra = await dueno("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: CORREO_NUEVO, password: creado.contrasena }),
    });
    ok("el dueño nuevo entra con la contraseña del comando", entra.res.ok, String(entra.res.status));
    const etapas = await dueno("/api/pipeline/stages");
    ok("ve sus 5 etapas", etapas.json?.stages?.length === 5, JSON.stringify(etapas.json)?.slice(0, 200));
    const convs = await dueno("/api/conversations");
    ok(
      "no ve ninguna conversación (las del operador son de otro negocio)",
      Array.isArray(convs.json?.conversations) && convs.json.conversations.length === 0,
      String(convs.json?.conversations?.length),
    );
    const malaClave = await cliente()("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: CORREO_NUEVO, password: "password-e2e-123" }),
    });
    ok("con otra contraseña no entra", !malaClave.res.ok);

    console.log("== Un correo, un negocio ==");
    const antes2 = await contar();
    const repetido = alta(CORREO_NUEVO, `Otro ${RUN}`);
    ok("el mismo correo otra vez → error", repetido.status !== 0 && repetido.salida.includes("Ya existe una cuenta"));
    const delOperador = alta("e2e@vocero.test", `Otro más ${RUN}`);
    ok("el correo del operador → error", delOperador.status !== 0);
    const despues = await contar();
    ok("y ninguna fila nueva", despues.o === antes2.o && despues.u === antes2.u, JSON.stringify({ antes2, despues }));
  } finally {
    if (creado?.org) await sql`delete from organization where id = ${creado.org}`.catch(() => {});
    await sql`delete from "user" where email = ${CORREO_NUEVO}`.catch(() => {});
    await sql.end();
  }
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(() => {
    console.log(`\n${checks - failures}/${checks} checks en verde`);
    process.exit(failures > 0 ? 1 : 0);
  });
