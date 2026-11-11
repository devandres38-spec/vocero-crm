/**
 * 071 — `pnpm avisos:grupo -- --organizacion <id> --chat <id>`
 *
 * Registra (o cambia) el grupo de Telegram al que llegan los avisos de
 * traspaso de un negocio. Solo lo corre Andres, como `privacidad:sembrar`. El
 * token del bot NO va aquí: es `TELEGRAM_BOT_TOKEN`, en el entorno del
 * despliegue. Los avisos salen solo con `AVISOS=on`.
 * Se bundlea con esbuild (alias @ → ./src), como seed:demo.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { crearConexion } from "@/lib/db";
import { conNegocio, trabajoDeFondo } from "@/lib/db/contexto";
import * as schema from "@/lib/db/schema";

const USO =
  "Uso: pnpm avisos:grupo -- --organizacion <id> --chat <id del grupo, ej. -1001234567890>";

// pnpm reenvía el «--» de `pnpm avisos:grupo -- …`; parseArgs lo leería como
// el fin de las opciones.
const argumentos = process.argv.slice(2);
if (argumentos[0] === "--") argumentos.shift();
const { values } = parseArgs({
  args: argumentos,
  options: { organizacion: { type: "string" }, chat: { type: "string" } },
});
const organizationId = values.organizacion;
const chat = values.chat?.trim();
if (!organizationId || !chat) {
  console.error(USO);
  process.exit(1);
}
if (!/^-?[0-9]{1,20}$/.test(chat)) {
  console.error(
    `[avisos] El id del grupo debe ser un número (los grupos empiezan con -).\n${USO}`,
  );
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

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[avisos] DATABASE_URL no está definida");
  process.exit(1);
}

const { sql, db } = crearConexion(url);
try {
  // 075 — Con el usuario de la app, dentro del negocio (RLS).
  await trabajoDeFondo("avisos-grupo", () =>
    conNegocio(organizationId, async () => {
      const [org] = await db
        .select({ id: schema.organization.id, name: schema.organization.name })
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .limit(1);
      if (!org) {
        console.error(`[avisos] No existe la organización ${organizationId}.`);
        process.exitCode = 1;
      } else {
        await db
          .insert(schema.avisoCanal)
          .values({ organizationId, telegramChatId: chat })
          .onConflictDoUpdate({
            target: schema.avisoCanal.organizationId,
            set: { telegramChatId: chat, updatedAt: new Date() },
          });
        console.log(
          `[avisos] ${org.name}: los avisos de traspaso irán al grupo ${chat}.`,
        );
      }
    })
  );
} catch (err) {
  console.error(
    "[avisos] No se pudo registrar:",
    err instanceof Error ? err.message : "error desconocido",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
