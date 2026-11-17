import { afterEach, describe, expect, it, vi } from "vitest";

/** FR-060/FR-081: registro cerrado tras la 1ª organización, salvo escape. */

let orgCount = 0;

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => Promise.resolve([{ n: orgCount }]),
    }),
  }),
  schema: { organization: {} },
}));

import { isPublicSignupAllowed } from "@/server/auth/registration";

afterEach(() => vi.unstubAllEnvs());

describe("registro público cerrado", () => {
  it("instancia vacía → registro permitido (primer usuario)", async () => {
    orgCount = 0;
    vi.stubEnv("ALLOW_SIGNUP", "");
    expect(await isPublicSignupAllowed()).toBe(true);
  });

  it("ya existe una organización → cerrado", async () => {
    orgCount = 1;
    vi.stubEnv("ALLOW_SIGNUP", "");
    expect(await isPublicSignupAllowed()).toBe(false);
  });

  it("escape ALLOW_SIGNUP=true → permitido aunque exista organización", async () => {
    orgCount = 1;
    vi.stubEnv("ALLOW_SIGNUP", "true");
    expect(await isPublicSignupAllowed()).toBe(true);
  });

  it("otros valores del escape NO abren el registro", async () => {
    orgCount = 1;
    vi.stubEnv("ALLOW_SIGNUP", "1");
    expect(await isPublicSignupAllowed()).toBe(false);
  });
});

describe("069 — registro en modo plataforma", () => {
  it("cerrado siempre, aunque ALLOW_SIGNUP=true y la instancia esté vacía", async () => {
    orgCount = 0;
    vi.stubEnv("TENANCY", "multi");
    vi.stubEnv("ALLOW_SIGNUP", "true");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "ops@agencia.co");
    expect(await isPublicSignupAllowed("alguien@cliente.co")).toBe(false);
    expect(await isPublicSignupAllowed()).toBe(false);
  });

  it("abierto solo a los correos de PLATFORM_ADMIN_EMAILS (normalizados)", async () => {
    vi.stubEnv("TENANCY", "multi");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "ops@agencia.co, otra@agencia.co");
    expect(await isPublicSignupAllowed(" OPS@Agencia.co ")).toBe(true);
    expect(await isPublicSignupAllowed("otra@agencia.co")).toBe(true);
  });

  it("`single` explícito se comporta como siempre", async () => {
    orgCount = 0;
    vi.stubEnv("TENANCY", "single");
    vi.stubEnv("ALLOW_SIGNUP", "");
    expect(await isPublicSignupAllowed()).toBe(true);
  });
});
