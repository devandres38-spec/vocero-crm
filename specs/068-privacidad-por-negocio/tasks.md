# 068 — Tareas

Dos PRs, en orden, cada uno con su revisión completa, sus sabotajes y `aliantis-core/docs/trabajo/estado.md` al día. Primero el cerebro, porque genera lo que Vocero copia.

## Paso 3.1 — Especificación (este PR)

- [x] T1 `spec.md`, `plan.md`, `data-model.md`, `contracts/perfil-privacidad.md`, `contracts/vectores-gemelos.md` y este archivo, antes del código. `067/data-model.md`: su migración pasa a la `0028`.
- [ ] T2 Andres revisa, responde P1 y P2 y aprueba.

## PR 1 — `aliantis-brain`

- [ ] T3 `libphonenumber-js` fijada en `1.13.15` exacta (sin `^`).
- [ ] T4 `src/privacy/perfil-exportado.ts` + esquema del contrato + `perfil-exportado.test.ts` (los tres clientes de demo).
- [ ] T5 `npm run privacidad:exportar`.
- [ ] T6 `npm run privacidad:vectores` y `test/fixtures/privacidad-vectores.json` (casos de `contracts/vectores-gemelos.md`).
- [ ] T7 `test/unit/privacidad-gemela.test.ts` con la huella del archivo fijada.
- [ ] T8 `npm run revisar` en verde con números; sabotajes 13 (lado cerebro) y 14.

## PR 2 — `vocero-crm`

- [ ] T9 Pruebas primero: copiar el archivo de vectores y escribir `privacidad-gemela`, `privacidad-corpus`, `privacidad-perfil`, `privacidad-repositorio`, `privacidad-sembrar` y `privacidad-frontera` (fallan: el módulo no existe).
- [ ] T10 `libphonenumber-js@1.13.15` exacta; `src/server/privacy/` (los tres archivos copiados, con su origen en el encabezado, + `perfil.ts`).
- [ ] T11 `privacy_profile` en `schema.ts`, prefijo `prv_`, `pnpm db:generate` → `0027_perfil_privacidad.sql`; aplicada con `pnpm db:migrate` sobre la base de desarrollo con datos.
- [ ] T12 `repositorio.ts` (`perfilDePrivacidad`, `guardarPerfil`) y `sembrar.ts`.
- [ ] T13 `scripts/privacidad-sembrar.ts` y `pnpm privacidad:sembrar`; prueba a mano con el perfil exportado de `clientes/demo`: la misma huella en los dos comandos (SC-005).
- [ ] T14 `scripts/seed/perfil-privacidad-demo.json` y el registro en `seed:demo`.
- [ ] T15 `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde con números; sabotajes 1 a 13 y 15.
- [ ] T16 `AGENTS.md` (mapa: `src/server/privacy/`, el comando) y `specs/README.md`. `graphify update .`
