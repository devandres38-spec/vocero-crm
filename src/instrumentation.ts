/**
 * Hook de arranque de Next. El trabajo real vive en instrumentation-node.ts
 * (import dinámico condicionado al runtime para que el bundler edge no
 * intente resolver dependencias de Node como `postgres`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const {
      checkRls,
      checkMediaDir,
      cleanupOrphanRuns,
      encryptLegacySecrets,
      resumeDispatch,
      resumeWebhooks,
    } = await import("./instrumentation-node");
    // 075 — Primero: en producción, un usuario de base que se salta el RLS no arranca.
    await checkRls();
    await checkMediaDir();
    await cleanupOrphanRuns();
    await encryptLegacySecrets();
    resumeDispatch();
    resumeWebhooks();
  }
}
