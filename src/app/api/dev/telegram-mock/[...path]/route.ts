import { mockGuard } from "@/lib/dev-guard";
import { resetTelegramMock, telegramMockState } from "@/server/dev/telegram-mock-state";

export const dynamic = "force-dynamic";

/**
 * 071 — Telegram de mentira para el self-test (`TELEGRAM_API_BASE_URL`). Tras
 * `mockGuard()`: 404 incondicional en producción.
 *
 * `POST /bot{token}/sendMessage` guarda el aviso; `GET /_state` lo devuelve y
 * `DELETE /_state` lo borra. Un `chat_id` de `-1` responde 400, como un grupo
 * que no existe.
 */
type Ctx = { params: Promise<{ path: string[] }> };

export async function POST(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  if (path.length !== 2 || !path[0]?.startsWith("bot") || path[1] !== "sendMessage") {
    return Response.json({ ok: false, description: "Not Found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as {
    chat_id?: unknown;
    text?: unknown;
  } | null;
  const chatId = String(body?.chat_id ?? "");
  if (chatId === "-1") {
    return Response.json(
      { ok: false, description: "Bad Request: chat not found" },
      { status: 400 }
    );
  }
  const avisos = telegramMockState();
  avisos.push({ chatId, text: String(body?.text ?? ""), at: new Date().toISOString() });
  return Response.json({ ok: true, result: { message_id: avisos.length } });
}

export async function GET(_req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  if (path.join("/") !== "_state") return new Response(null, { status: 404 });
  return Response.json({ avisos: telegramMockState() });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  if (path.join("/") !== "_state") return new Response(null, { status: 404 });
  resetTelegramMock();
  return Response.json({ cleared: true });
}
