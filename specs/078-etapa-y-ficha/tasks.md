# 078 — Tareas (bloque J, pasos 5.1 y 5.2)

**Cómo se trabaja:**
- un commit por paso, cada uno con las pruebas de su módulo;
- PRs:
  - `vocero-crm`: código y spec;
  - `aliantis-brain`: spec `014-etapa-y-ficha`;
  - `aliantis-core`: `decisiones.md` y `estado.md`;
  - `aliantis-espacio`: el relevo, si cambia algo.
- Un merge por repo, con la palabra de Andres.
- Lleva la etiqueta `e2e`: toca la base y el contrato.

**Orden pensado para no dejar `main` roto:**
1. Vocero primero (T2 a T6). La ruta vieja (`stage` por nombre) sigue igual.
2. El cerebro (014) llama a `evento` y a la ficha estricta cuando Vocero ya los tiene.

- [x] T1 Spec y estas tareas, con las respuestas de Andres.
- [x] T2 **Migración `0035_etapa_por_eventos.sql`:**
  - la columna `pipeline_stage.evento_bot` (con `CHECK` del catálogo) y el índice único parcial `(organization_id, evento_bot)`;
  - el mapeo por defecto para los negocios que ya existen (por nombre exacto, solo etapas abiertas);
  - `ETAPAS_INICIALES` con el mapeo;
  - `schema.ts` con `pnpm db:generate`;
  - el guardarraíl de la migración;
  - revisar el `ON DELETE` de las etapas.
- [x] T3 **La etapa por evento:**
  - `moverEtapaPorEvento` en `stage.ts`: `sin_etapa`, `ya_esta`, `prueba`, `ai_paused` y `herramienta_apagada`;
  - `POST /api/bot/stage` con `evento` (`stage` se conserva; los dos a la vez dan 422);
  - `docs/openapi.json`;
  - pruebas.
  - **Sabotaje 1.**
- [x] T4 **El mapeo en la interfaz:**
  - `stage-manager.tsx` y `/api/pipeline/stages`: elegir el evento de cada etapa, único por negocio, con el texto «El agente mueve aquí al cliente cuando…»;
  - pruebas de la ruta.
- [x] T5 **La ficha estricta del cerebro:**
  - `FICHA_DEL_CEREBRO` y su validación (`422 clave_no_permitida` e `invalid_body`);
  - `ai_paused`, la herramienta `ficha` y `prueba`;
  - el filtro de privacidad se queda (con salud, el valor no se guarda);
  - el dueño sigue con claves libres;
  - `docs/openapi.json`;
  - pruebas.
  - **Sabotajes 2 y 3.**
- [x] T6 **E2E y RLS:**
  - `e2e-contrato-aliantis` gana etapa y ficha: el evento mueve; `ya_esta`; `sin_etapa`; con una persona, 409; `is_test` no escribe; la clave libre da 422; salud en un valor se omite;
  - `e2e-rls`: la columna y el índice; un negocio no mueve etapas de otro;
  - `tests/e2e/us-contrato-aliantis.md`.
- [ ] T7 **Documentación y revisión:**
  - `AGENTS.md` y el README (el mapeo de etapas);
  - CI y `e2e.yml` en verde;
  - los sabotajes en PRs borrador (uno tras otro), cerrados sin merge.
- [ ] T8 **Core y espacio:**
  - `decisiones.md` (D18 y D12 concretadas, con las respuestas);
  - `estado.md` con las cifras;
  - el relevo, si cambia algo.
