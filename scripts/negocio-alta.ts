/**
 * 074 — `pnpm negocio:alta -- --nombre "<negocio>" --dueno-correo <correo> --dueno-nombre "<nombre>"`
 *
 * Crea un negocio con su dueño (pilar 1 de Aliantis: el alta la hace Andres,
 * no es autoservicio). En una transacción: negocio, dueño, etapas y perfil
 * del agente (`src/server/auth/alta.ts`).
 *
 * La contraseña del dueño la genera el comando (24 caracteres) y se muestra
 * UNA sola vez, aquí: no se guarda en claro en ningún lado ni va al registro.
 * Pásasela al dueño por un canal privado. Cambiarla desde la app llega con el
 * bloque I; mientras tanto, `scripts/reset-password.mjs`.
 *
 * Imprime el id del negocio, el que piden `meta:secreto` y `privacidad:sembrar`.
 * Se bundlea con esbuild (alias @ → ./src), como seed:demo.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { crearConexion } from "@/lib/db";
import { trabajoDeFondo } from "@/lib/db/contexto";
import { AltaError, crearNegocio } from "@/server/auth/alta";

const USO =
  'Uso: pnpm negocio:alta -- --nombre "<negocio>" --dueno-correo <correo> --dueno-nombre "<nombre>"';

const argumentos = process.argv.slice(2);
if (argumentos[0] === "--") argumentos.shift();
let values: { nombre?: string; "dueno-correo"?: string; "dueno-nombre"?: string };
try {
  ({ values } = parseArgs({
    args: argumentos,
    options: {
      nombre: { type: "string" },
      "dueno-correo": { type: "string" },
      "dueno-nombre": { type: "string" },
    },
  }));
} catch (err) {
  console.error(`[alta] ${err instanceof Error ? err.message : err}\n${USO}`);
  process.exit(1);
}
if (!values.nombre || !values["dueno-correo"] || !values["dueno-nombre"]) {
  console.error(USO);
  process.exit(1);
}

/** Las variables del `.env` que el entorno no trae. */
function cargarEnv(): void {
  try {
    for (const linea of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim();
    }
  } catch {
    // Sin .env: todo viene del entorno.
  }
}

cargarEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[alta] DATABASE_URL no está definida");
  process.exit(1);
}

const { sql, db } = crearConexion(url);
try {
  // 075 — Con el usuario de la app; crearNegocio entra al negocio nuevo.
  const n = await trabajoDeFondo("alta", () => crearNegocio(db, {
    nombre: values.nombre,
    correo: values["dueno-correo"],
    duenoNombre: values["dueno-nombre"],
  }));
  console.log(
    [
      `[alta] Negocio creado: ${n.nombre}`,
      `  id del negocio:  ${n.organizationId}`,
      `  dueño:           ${n.correo}`,
      `  contraseña:      ${n.contrasena}`,
      "",
      "  La contraseña no se vuelve a mostrar: pásasela al dueño por un canal privado.",
      "  Siguientes pasos:",
      `    pnpm meta:secreto -- --organizacion ${n.organizationId} --canal todos`,
      `    pnpm privacidad:sembrar -- --organizacion ${n.organizationId} <perfil.json>`,
    ].join("\n")
  );
} catch (err) {
  if (err instanceof AltaError) console.error(`[alta] ${err.message}. La base no cambió.`);
  else
    console.error(
      "[alta] No se pudo crear el negocio:",
      err instanceof Error ? err.message : "error desconocido"
    );
  process.exitCode = 1;
} finally {
  await sql.end();
}
