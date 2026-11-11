/**
 * CLI del seed demo: `pnpm seed:demo -- --organizacion <id>` (local) o
 * `node seed-demo.mjs --organizacion <id>` dentro del contenedor. Acepta
 * --force para recargar aunque haya datos.
 *
 * 074 — El negocio va explícito: con varios negocios, «la primera
 * organización de la tabla» podía ser la de un cliente.
 * Se bundlea con esbuild (alias @ → ./src).
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { crearConexion } from "@/lib/db";
import { conNegocio, trabajoDeFondo } from "@/lib/db/contexto";
import * as schema from "@/lib/db/schema";
import { seedDemo, isDomainEmpty } from "@/server/seed/demo";
import { sembrarPerfilDemo } from "@/server/privacy/demo";

function loadEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[seed] DATABASE_URL no está definida");
  process.exit(1);
}


const argumentos = process.argv.slice(2);
if (argumentos[0] === "--") argumentos.shift();
const { values } = parseArgs({
  args: argumentos,
  options: { organizacion: { type: "string" }, force: { type: "boolean" } },
});
if (!values.organizacion) {
  console.error("Uso: pnpm seed:demo -- --organizacion <id> [--force]");
  await sql.end();
  process.exit(1);
}
const { sql, db } = crearConexion(url);
// 075 — Con el usuario de la app, dentro del negocio (RLS).
await trabajoDeFondo("seed", () =>
  conNegocio(values.organizacion!, async () => {
    const [org] = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, values.organizacion))
      .limit(1);
    if (!org) {
      console.error(`[seed] No existe la organización ${values.organizacion}.`);
      await sql.end();
      process.exit(1);
    }

    const force = values.force === true;
    if (!force && !(await isDomainEmpty(db, org.id))) {
      console.error(
        "[seed] La organización ya tiene datos. Usa --force para recargar la demo."
      );
      await sql.end();
      process.exit(1);
    }

    const result = await seedDemo(db, org.id);
    console.log(
      `[seed] Ferretería El Martillo cargada: ${result.contacts} contactos, ${result.kbEntries} entradas de KB, 1 corrida de ejemplo`
    );
    // 068 — El perfil de privacidad de la demo, solo si no tiene uno.
    const privacidad = await sembrarPerfilDemo(db, org.id);
    console.log(
      !privacidad.ok
        ? `[seed] Perfil de privacidad NO registrado: ${privacidad.error}`
        : "yaTenia" in privacidad
          ? "[seed] Perfil de privacidad: ya tenía uno, no se toca"
          : `[seed] Perfil de privacidad: ${privacidad.perfil} v${privacidad.versionPerfil}, huella ${privacidad.huella}`
    );
    await sql.end();
    process.exit(0);
  })
);
