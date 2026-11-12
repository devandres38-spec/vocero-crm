import { describe, expect, it, vi } from "vitest";

/**
 * 080 (D3, N9) — Ajustes → IA salió del negocio: sus rutas responden 404 a
 * cualquier sesión (owner, admin y member) y no tocan `ai_credentials`.
 */
const tocadas = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/server/ai/credentials", () => {
  const marca = async () => {
    tocadas.n++;
    return null;
  };
  return {
    getAiCredentialPublic: marca,
    getAiCredentialSecret: marca,
    saveAiCredential: marca,
    deleteAiCredential: marca,
    marcarEstadoPorRespuesta: marca,
  };
});
const sesion = vi.hoisted(() => ({ rol: "owner" }));
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({ userId: "usr_1", organizationId: "org_1", role: sesion.rol }),
  getSessionOrNull: async () => ({ userId: "usr_1", organizationId: "org_1", role: sesion.rol }),
}));
const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
}));
vi.mock("next/navigation", () => ({ notFound, redirect: vi.fn() }));

import * as raiz from "@/app/api/settings/ai/route";
import * as probar from "@/app/api/settings/ai/test/route";
import * as modelos from "@/app/api/settings/ai/models/route";
import AiSettingsPage from "@/app/(app)/settings/ai/page";

describe("080 — Ajustes → IA en 404", () => {
  const handlers = [raiz.GET, raiz.PUT, raiz.DELETE, probar.POST, modelos.POST];

  it("las rutas responden 404 not_found, sin importar quién llame", async () => {
    for (const rol of ["owner", "admin", "member"]) {
      sesion.rol = rol;
      for (const h of handlers) {
        const r = await h(
          new Request("http://crm.test/api/settings/ai", {
            method: "PUT",
            headers: { "content-type": "application/json", origin: "http://crm.test" },
            body: JSON.stringify({ provider: "openrouter", model: "m", token: "sk-or-llave-larga" }),
          })
        );
        expect(r.status, rol).toBe(404);
        expect(((await r.json()) as { error: { code: string } }).error.code).toBe("not_found");
      }
    }
    expect(tocadas.n).toBe(0);
  });

  it("la pantalla llama a notFound()", () => {
    expect(() => AiSettingsPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});
