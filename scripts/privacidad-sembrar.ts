/**
 * 068 — `pnpm privacidad:sembrar -- --organizacion <id> [--sin-filtro-salud] <perfil.json>`
 *
 * Registra el perfil de privacidad de un negocio, exportado del cerebro con
 * `npm run privacidad:exportar -- <cliente.yaml> > perfil.json`. Solo lo corre
 * Andres (D5). Muestra perfil, versión y huellas, nunca los términos. Después
 * de registrarlo, borra el archivo: el de un cliente real no se guarda (P2).
 * Se bundlea con esbuild (alias @ → ./src), como seed:demo.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { PG_CONNECTION_OPTIONS } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { sembrarPerfil } from "@/server/privacy/sembrar";

const USO =
  "Uso: pnpm privacidad:sembrar -- --organizacion <id> [--sin-filtro-salud] <perfil.json>";

// pnpm reenvía el «--» de `pnpm privacidad:sembrar -- …`; parseArgs lo leería
// como el fin de las opciones.
const argumentos = process.argv.slice(2);
if (argumentos[0] === "--") argumentos.shift();

const { values, positionals } = parseArgs({
  args: argumentos,
  options: {
    organizacion: { type: "string" },
    "sin-filtro-salud": { type: "boolean", default: false },
  },
  allowPositionals: true,
});
const organizationId = values.organizacion;
const [archivo] = positionals;
if (!organizationId || !archivo) {
  console.error(USO);
  process.exit(1);
}

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

let contenido: string;
try {
  contenido = readFileSync(archivo, "utf8");
} catch {
  console.error(`[privacidad] No se pudo leer ${archivo}`);
  process.exit(1);
}

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[privacidad] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1, ...PG_CONNECTION_OPTIONS });
const db = drizzle(sql, { schema });
try {
  const r = await sembrarPerfil(db, {
    organizationId,
    contenido,
    sinFiltroSalud: values["sin-filtro-salud"] ?? false,
  });
  if (!r.ok) {
    console.error(`[privacidad] Rechazado, la base no cambió.\n${r.error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `[privacidad] ${organizationId}: perfil ${r.perfil} v${r.versionPerfil}, ${r.pais}, ` +
        `${r.conSalud ? "con filtro de salud" : "SIN filtro de salud"}.\n` +
        `  huella anterior: ${r.huellaAnterior ?? "(no tenía)"}\n` +
        `  huella nueva:    ${r.huella}`
    );
  }
} catch (err) {
  console.error(
    "[privacidad] No se pudo registrar:",
    err instanceof Error ? err.message : "error desconocido"
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
