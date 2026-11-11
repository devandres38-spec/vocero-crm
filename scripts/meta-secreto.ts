/**
 * 073 — `pnpm meta:secreto -- --organizacion <id> --canal whatsapp|instagram|messenger|todos [--app <app_id>]`
 *
 * Registra (o cambia) el App Secret de la app de Meta de un negocio, por canal:
 * con él se verifica la firma de sus webhooks (D14 de Aliantis). Solo lo corre
 * Andres, como `privacidad:sembrar` y `avisos:grupo`.
 *
 * El secreto NUNCA va como argumento (quedaría en el historial de la terminal):
 * se escribe cuando lo pide, sin eco, o llega por la entrada estándar
 * (`… < archivo`). Se guarda cifrado y solo se muestran sus últimos 4.
 * `todos` guarda el mismo secreto en los tres canales (una sola app).
 * Se bundlea con esbuild (alias @ → ./src), como seed:demo.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { PG_CONNECTION_OPTIONS } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  appSecretValido,
  CANALES_META,
  guardarAppSecret,
  ultimos4,
  type CanalMeta,
} from "@/server/whatsapp/app-secret";

const USO =
  "Uso: pnpm meta:secreto -- --organizacion <id> --canal whatsapp|instagram|messenger|todos [--app <app_id>]\n" +
  "     (el secreto se escribe cuando lo pide, sin eco, o llega por la entrada estándar)";

const argumentos = process.argv.slice(2);
if (argumentos[0] === "--") argumentos.shift();
const { values } = parseArgs({
  args: argumentos,
  options: {
    organizacion: { type: "string" },
    canal: { type: "string" },
    app: { type: "string" },
  },
});
const organizationId = values.organizacion;
const canal = values.canal;
if (!organizationId || !canal) {
  console.error(USO);
  process.exit(1);
}
const canales: readonly CanalMeta[] | null =
  canal === "todos"
    ? CANALES_META
    : (CANALES_META as readonly string[]).includes(canal)
      ? [canal as CanalMeta]
      : null;
if (!canales) {
  console.error(`[meta] Canal desconocido: ${canal}.\n${USO}`);
  process.exit(1);
}
const appId = values.app?.trim() || null;
if (appId !== null && !/^[0-9]{5,25}$/.test(appId)) {
  console.error(`[meta] El id de la app debe ser un número.\n${USO}`);
  process.exit(1);
}

/** Las variables del `.env` que el entorno no trae (el cifrado necesita ENCRYPTION_KEY). */
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

/** Lee el secreto sin eco si hay terminal; si no, toda la entrada estándar. */
async function leerSecreto(): Promise<string> {
  const entrada = process.stdin;
  if (!entrada.isTTY) {
    const partes: Buffer[] = [];
    for await (const parte of entrada) partes.push(Buffer.from(parte));
    return Buffer.concat(partes).toString("utf8").trim();
  }
  process.stdout.write("App Secret (no se verá al escribirlo): ");
  entrada.setRawMode(true);
  entrada.resume();
  return new Promise((resolver, rechazar) => {
    let valor = "";
    const alLeer = (dato: Buffer) => {
      for (const caracter of dato.toString("utf8")) {
        if (caracter === "\r" || caracter === "\n") {
          entrada.setRawMode(false);
          entrada.pause();
          entrada.off("data", alLeer);
          process.stdout.write("\n");
          resolver(valor.trim());
          return;
        }
        if (caracter === "\u0003") {
          entrada.setRawMode(false);
          rechazar(new Error("cancelado"));
          return;
        }
        if (caracter === "\u007f" || caracter === "\b") valor = valor.slice(0, -1);
        else valor += caracter;
      }
    };
    entrada.on("data", alLeer);
  });
}

cargarEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[meta] DATABASE_URL no está definida");
  process.exit(1);
}

let secreto: string;
try {
  secreto = (await leerSecreto()).toLowerCase();
} catch {
  console.error("[meta] Cancelado; la base no cambió.");
  process.exit(1);
}
if (!appSecretValido(secreto)) {
  // Sin repetir el valor: podría ser el secreto con un error de dedo.
  console.error(
    "[meta] Eso no parece un App Secret de Meta (32 caracteres hexadecimales). La base no cambió.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, ...PG_CONNECTION_OPTIONS });
const db = drizzle(sql, { schema });
try {
  const [org] = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) {
    console.error(`[meta] No existe la organización ${organizationId}.`);
    process.exitCode = 1;
  } else {
    await guardarAppSecret(db, { organizationId, canales, secreto, appId });
    console.log(
      `[meta] ${org.name}: App Secret …${ultimos4(secreto)} registrado para ${canales.join(", ")}.` +
        " Sus webhooks se verifican con él desde ya.",
    );
  }
} catch (err) {
  console.error(
    "[meta] No se pudo registrar:",
    err instanceof Error ? err.message : "error desconocido",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
