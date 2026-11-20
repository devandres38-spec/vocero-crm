import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { NotaDto } from "@/lib/notas";
import { publish } from "@/server/events/bus";
import { defineHerramienta } from "@/modulos/tipos";
import { PREFIJO_MARCA } from "./modulo";

/**
 * 072-B (D18) — Las herramientas del módulo `diagnostico`. Solo existen para
 * un negocio con el módulo encendido; el puente (`/api/brains/tools/[name]`)
 * ya comprobó organización, conversación, IA y argumentos antes de llegar
 * aquí, y `organizationId` sale de la credencial.
 */

export const diagnosticoEco = defineHerramienta({
  nombre: "diagnostico_eco",
  descripcion:
    "Herramienta de prueba interna: devuelve el texto recibido y la hora del servidor. Úsala solo si te piden probar el diagnóstico.",
  args: z.object({ texto: z.string().min(1).max(200) }).strict(),
  efecto: "lectura",
  async ejecutar(_ctx, args) {
    return { ok: true, result: { eco: args.texto, recibidoEn: new Date().toISOString() } };
  },
});

export const diagnosticoMarca = defineHerramienta({
  nombre: "diagnostico_marca",
  descripcion:
    "Herramienta de prueba interna: deja una nota interna en esta conversación (el cliente no la ve). Úsala solo si te piden probar el diagnóstico.",
  args: z.object({ motivo: z.string().min(1).max(120) }).strict(),
  efecto: "escritura",
  async ejecutar(ctx, args) {
    // Una nota interna, no un `message`: ni se envía, ni se despacha, ni
    // cuenta como respuesta (ver `conversationNote` en el esquema).
    const [fila] = await getDb()
      .insert(schema.conversationNote)
      .values({
        id: newId("conversationNote"),
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        authorUserId: null,
        texto: `${PREFIJO_MARCA} ${args.motivo}`,
      })
      .returning();
    if (!fila) return { ok: false, error: "no_se_guardo" };
    const nota: NotaDto = {
      id: fila.id,
      conversationId: fila.conversationId,
      texto: fila.texto,
      createdAt: fila.createdAt.toISOString(),
      autor: null,
      puedeBorrar: false,
    };
    publish(ctx.organizationId, { type: "note.new", data: { conversationId: ctx.conversationId, note: nota } });
    return { ok: true, result: { notaId: fila.id } };
  },
});

export const HERRAMIENTAS_DIAGNOSTICO = [diagnosticoEco, diagnosticoMarca];
