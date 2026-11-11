/**
 * 071 — Estado del mock de Telegram (solo entorno de pruebas): lo que el CRM
 * mandó, para que el self-test afirme que un aviso no lleva datos del
 * paciente. Nunca guarda el token.
 */
export type AvisoRecibido = { chatId: string; text: string; at: string };

const globalForMock = globalThis as unknown as {
  __telegramMock?: AvisoRecibido[];
};

export function telegramMockState(): AvisoRecibido[] {
  if (!globalForMock.__telegramMock) globalForMock.__telegramMock = [];
  return globalForMock.__telegramMock;
}

export function resetTelegramMock(): void {
  globalForMock.__telegramMock = [];
}
