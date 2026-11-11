import { z } from "zod";
import {
  MAX_TEXT_CHARS_ANY_CHANNEL,
  TEXT_TOO_LONG_ANY_CHANNEL,
} from "@/server/channels/capabilities";

/**
 * 070 — Límites de los botones de WhatsApp, los de `aliantis-core`
 * (`src/whatsapp/sender.ts`) y la 067 (§2): de 1 a 3, `id` de 1 a 256,
 * `title` de 1 a 20, ids y títulos únicos, y con botones el texto hasta 1024.
 * Estimación: Meta puede cambiarlos.
 */
export const MAX_BOTONES = 3;
export const MAX_ID_BOTON = 256;
export const MAX_TITULO_BOTON = 20;
export const MAX_TEXTO_CON_BOTONES = 1024;

const boton = z.object({
  id: z.string().min(1).max(MAX_ID_BOTON),
  title: z.string().min(1).max(MAX_TITULO_BOTON),
});

export const bodySchema = z
  .object({
    conversationId: z.string().min(1),
    // 022: el tope de aquí es el del canal que más admite; el de cada canal
    // lo comprueba el envío y sale como el mismo 422 `invalid_body` de siempre.
    text: z
      .string()
      .min(1)
      .max(MAX_TEXT_CHARS_ANY_CHANNEL, TEXT_TOO_LONG_ANY_CHANNEL),
    buttons: z.array(boton).min(1).max(MAX_BOTONES).optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.buttons) return;
    if (body.text.length > MAX_TEXTO_CON_BOTONES) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: `Con botones, el texto admite hasta ${MAX_TEXTO_CON_BOTONES} caracteres`,
      });
    }
    if (new Set(body.buttons.map((b) => b.id)).size !== body.buttons.length) {
      ctx.addIssue({
        code: "custom",
        path: ["buttons"],
        message: "Los ids de los botones se repiten",
      });
    }
    if (
      new Set(body.buttons.map((b) => b.title)).size !== body.buttons.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["buttons"],
        message: "Los títulos de los botones se repiten",
      });
    }
  });
