/**
 * 076 — El superadministrador de Aliantis (el panel `/admin` de Andres).
 *
 *   pnpm superadmin:alta -- --correo <correo> --nombre "<nombre>"
 *   pnpm superadmin:alta -- --reiniciar-segundo-factor --correo <correo>
 *
 * En producción, dentro del contenedor:
 *
 *   docker exec -it <contenedor> node superadmin.mjs --correo <correo> --nombre "<nombre>"
 *
 * Exige `DATABASE_MIGRATIONS_URL` (el dueño de las tablas): la app no puede
 * dar el superadmin. La contraseña la genera el comando y la muestra UNA sola
 * vez, aquí; no va a ningún registro. Al entrar por primera vez, el panel
 * pide activar el segundo factor con un QR.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";
import { newId } from "@/lib/db/ids";
import {
  crearSuperadmin,
  reiniciarSegundoFactor,
  SuperadminError,
  urlDelDueno,
  type SqlDelDueno,
} from "./lib/superadmin";

const USO = [
  'Uso: pnpm superadmin:alta -- --correo <correo> --nombre "<nombre>"',
  "     pnpm superadmin:alta -- --reiniciar-segundo-factor --correo <correo>",
].join("\n");

/** Las variables del `.env` que el entorno no trae (sin imprimir ninguna). */
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

const argumentos = process.argv.slice(2);
if (argumentos[0] === "--") argumentos.shift();
let values: { correo?: string; nombre?: string; "reiniciar-segundo-factor"?: boolean };
try {
  ({ values } = parseArgs({
    args: argumentos,
    options: {
      correo: { type: "string" },
      nombre: { type: "string" },
      "reiniciar-segundo-factor": { type: "boolean" },
    },
  }));
} catch (err) {
  console.error(`[superadmin] ${err instanceof Error ? err.message : err}\n${USO}`);
  process.exit(1);
}
const reiniciar = values["reiniciar-segundo-factor"] === true;
if (!values.correo || (!reiniciar && !values.nombre)) {
  console.error(USO);
  process.exit(1);
}

cargarEnv();
let url: string;
try {
  url = urlDelDueno(process.env);
} catch (err) {
  console.error(`[superadmin] ${(err as Error).message}`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
try {
  const db = sql as unknown as SqlDelDueno;
  if (reiniciar) {
    await reiniciarSegundoFactor(db, values.correo);
    console.log(
      `[superadmin] Segundo factor reiniciado para ${values.correo} y sus sesiones cerradas.\n` +
        "  Al entrar otra vez, el panel pide activarlo con un QR nuevo."
    );
  } else {
    const s = await crearSuperadmin(
      db,
      { correo: values.correo, nombre: values.nombre! },
      {
        id: () => newId("user"),
        idCuenta: () => newId("account"),
        contrasena: () => randomBytes(18).toString("base64url"),
        hash: hashPassword,
      }
    );
    console.log(
      [
        `[superadmin] Superadministrador creado: ${s.correo}`,
        `  contraseña:  ${s.contrasena}`,
        "",
        "  La contraseña no se vuelve a mostrar. Entra en /login: el panel te pedirá",
        "  activar el segundo factor (TOTP) con un QR antes de mostrar nada más.",
      ].join("\n")
    );
  }
} catch (err) {
  if (err instanceof SuperadminError) console.error(`[superadmin] ${err.message}. La base no cambió.`);
  else console.error("[superadmin] No se pudo completar:", err instanceof Error ? err.message : "error desconocido");
  process.exitCode = 1;
} finally {
  await sql.end();
}
