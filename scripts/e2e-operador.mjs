/**
 * 074 — El operador de los arneses E2E, creado como se crea todo negocio
 * ahora: con `pnpm negocio:alta` (el registro público está cerrado).
 *
 * Después le pone la contraseña fija que usan los arneses (`password-e2e-123`)
 * con `hashPassword` de `better-auth/crypto`, la misma del login. Los arneses
 * intentan registrarse, reciben 403 y entran con esa contraseña.
 *
 * Idempotente: si el operador ya existe, solo fija la contraseña. No imprime
 * la contraseña que genera el alta. Lo corre `.github/workflows/e2e.yml`
 * antes de los arneses. Sale con código 1 si algo falla.
 */
import { spawnSync } from "node:child_process";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";

const CORREO = "e2e@vocero.test";
const CONTRASENA = "password-e2e-123";

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const [ya] = await sql`select id from "user" where email = ${CORREO}`;
  if (!ya) {
  // 075 — El comando corre con el usuario de la app (APP_DATABASE_URL), bajo RLS.
    const r = spawnSync(
      "pnpm",
      ["negocio:alta", "--", "--nombre", "Negocio E2E", "--dueno-correo", CORREO, "--dueno-nombre", "Operador E2E"],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL }, shell: process.platform === "win32" }
    );
    const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    if (r.status !== 0 || !salida.includes("Negocio creado")) {
      // Sin volcar la salida entera: trae la contraseña generada.
      console.error("[e2e-operador] el alta falló:", salida.split("\n").filter((l) => !/contraseña:/.test(l)).join("\n").slice(-600));
      process.exit(1);
    }
    console.log("[e2e-operador] negocio del operador creado con pnpm negocio:alta");
  }
  const hash = await hashPassword(CONTRASENA);
  const filas = await sql`
    update account set password = ${hash}, updated_at = now()
    where provider_id = 'credential' and user_id = (select id from "user" where email = ${CORREO})
    returning id`;
  if (filas.length !== 1) {
    console.error("[e2e-operador] no se pudo fijar la contraseña del operador");
    process.exit(1);
  }
  console.log("[e2e-operador] listo: los arneses entran con su contraseña fija");
} finally {
  await sql.end();
}
