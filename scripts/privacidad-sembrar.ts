/**
 * 068 — `pnpm privacidad:sembrar -- --organizacion <id> [--sin-filtro-salud] [--adjuntos si|no] [--retencion <dias>] <perfil.json>`
 *
 * 070 (D1): `--adjuntos` decide si se guardan los archivos de los pacientes.
 * Sin él: no, si el perfil filtra salud; sí, si no lo filtra.
 *
 * 072 (D1): `--retencion <dias>` (7 a 3650) fija cuántos días se guarda el
 * contenido. Sin él: 90 en un perfil nuevo; uno que ya existía conserva los
 * suyos. Va el mismo número que `retencion_dias` en el `cliente.yaml`.
 *
 * Registra el perfil de privacidad de un negocio, exportado del cerebro con
 * `npm run privacidad:exportar -- <cliente.yaml> > perfil.json`. Solo lo corre
 * Andres (D5). Muestra perfil, versión y huellas, nunca los términos. Después
 * de registrarlo, borra el archivo: el de un cliente real no se guarda (P2).
 * Se bundlea con esbuild (alias @ → ./src), como seed:demo.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { crearConexion } from "@/lib/db";
import { conNegocio, trabajoDeFondo } from "@/lib/db/contexto";
import * as schema from "@/lib/db/schema";
import { sembrarPerfil } from "@/server/privacy/sembrar";

const USO =
  "Uso: pnpm privacidad:sembrar -- --organizacion <id> [--sin-filtro-salud] [--adjuntos si|no] [--retencion <dias>] <perfil.json>";

// pnpm reenvía el «--» de `pnpm privacidad:sembrar -- …`; parseArgs lo leería
// como el fin de las opciones.
const argumentos = process.argv.slice(2);
if (argumentos[0] === "--") argumentos.shift();

const { values, positionals } = parseArgs({
  args: argumentos,
  options: {
    organizacion: { type: "string" },
    "sin-filtro-salud": { type: "boolean", default: false },
    adjuntos: { type: "string" },
    retencion: { type: "string" },
  },
  allowPositionals: true,
});
const organizationId = values.organizacion;
const [archivo] = positionals;
if (!organizationId || !archivo) {
  console.error(USO);
  process.exit(1);
}
if (values.adjuntos !== undefined && values.adjuntos !== "si" && values.adjuntos !== "no") {
  console.error(USO);
  process.exit(1);
}
const adjuntos = values.adjuntos === undefined ? undefined : values.adjuntos === "si";
// 072: el rango lo valida `sembrarPerfil`; aquí solo que sea un número.
if (values.retencion !== undefined && !/^[0-9]+$/.test(values.retencion)) {
  console.error(USO);
  process.exit(1);
}
const retencionDias = values.retencion === undefined ? undefined : Number(values.retencion);

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

const { sql, db } = crearConexion(url);
try {
  // 075 — Con el usuario de la app, dentro del negocio (RLS).
  await trabajoDeFondo("privacidad-sembrar", () =>
    conNegocio(organizationId, async () => {
      const r = await sembrarPerfil(db, {
        organizationId,
        contenido,
        sinFiltroSalud: values["sin-filtro-salud"] ?? false,
        ...(adjuntos === undefined ? {} : { adjuntos }),
        ...(retencionDias === undefined ? {} : { retencionDias }),
      });
      if (!r.ok) {
        console.error(`[privacidad] Rechazado, la base no cambió.\n${r.error}`);
        process.exitCode = 1;
      } else {
        console.log(
          `[privacidad] ${organizationId}: perfil ${r.perfil} v${r.versionPerfil}, ${r.pais}, ` +
            `${r.conSalud ? "con filtro de salud" : "SIN filtro de salud"}, ` +
            `${r.adjuntos ? "guarda adjuntos" : "NO guarda adjuntos"}, ` +
            `borra el contenido a los ${r.retencionDias} días (el mismo número va en retencion_dias del cerebro).\n` +
            `  huella anterior: ${r.huellaAnterior ?? "(no tenía)"}\n` +
            `  huella nueva:    ${r.huella}`
        );
      }
    })
  );
} catch (err) {
  console.error(
    "[privacidad] No se pudo registrar:",
    err instanceof Error ? err.message : "error desconocido"
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
