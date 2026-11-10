# 068 — Tareas

Dos PRs, en orden, cada uno con su revisión completa, sus sabotajes y `aliantis-core/docs/trabajo/estado.md` al día. Primero el cerebro, porque genera lo que Vocero copia.

## Paso 3.1 — Especificación (este PR)

- [x] T1 `spec.md`, `plan.md`, `data-model.md`, `contracts/perfil-privacidad.md`, `contracts/vectores-gemelos.md` y este archivo, antes del código. `067/data-model.md`: su migración pasa a la `0028`.
- [x] T2 Andres revisa, responde P1 y P2 y aprueba (2026-11-10: P1 sí, en 3.2; P2 no se guardan).

## PR 1 — `aliantis-brain`

- [x] T3 `libphonenumber-js` fijada en `1.13.15` exacta (sin `^`).
- [x] T4 `src/privacy/perfil-exportado.ts` + esquema del contrato + `perfil-exportado.test.ts` (los tres clientes de demo).
- [x] T5 `npm run privacidad:exportar`.
- [x] T6 `npm run privacidad:vectores` y `test/fixtures/privacidad-vectores.json` (casos de `contracts/vectores-gemelos.md`).
- [x] T7 `test/unit/privacidad-gemela.test.ts` con la huella del archivo fijada.
- [x] T8 `npm run revisar` en verde con números; sabotajes 13 (lado cerebro) y 14. **Hecho** (`aliantis-brain` #17, unido): 1116/1116, 8/8 sabotajes.

## PR 2 — `vocero-crm`

- [x] T9 Pruebas primero: copiar el archivo de vectores y escribir `privacidad-gemela`, `privacidad-corpus`, `privacidad-perfil`, `privacidad-repositorio`, `privacidad-sembrar` y `privacidad-frontera` (fallan: el módulo no existe).
- [x] T10 `libphonenumber-js@1.13.15` exacta; `src/server/privacy/` (los tres archivos copiados, con su origen en el encabezado, + `perfil.ts`).
- [x] T11 `privacy_profile` en `schema.ts`, prefijo `prv_`, `pnpm db:generate` → `0027_perfil_privacidad.sql`; aplicada con `pnpm db:migrate` sobre la base de desarrollo con datos.
- [x] T12 `repositorio.ts` (`perfilDePrivacidad`, `guardarPerfil`) y `sembrar.ts`.
- [x] T13 `scripts/privacidad-sembrar.ts` y `pnpm privacidad:sembrar`; prueba a mano con el perfil exportado de `clientes/demo`: la misma huella en los dos comandos (SC-005).
- [x] T14 `src/server/privacy/perfil-privacidad-demo.json` y el registro solo en el comando `seed:demo`, sin pisar un perfil existente (ver `plan.md`, «La demo»).
- [x] T15 `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde con números; sabotajes 1 a 13 y 15. **Hecho:** 1489/1489 (1454 + 35), 16/16 sabotajes (los del plan más D5 y «la demo no pisa»).
- [x] T16 `AGENTS.md` (mapa: `src/server/privacy/`, el comando) y `specs/README.md`. `graphify update .`
