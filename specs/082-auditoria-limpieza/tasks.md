# 082 — Bloque AU en Vocero: auditoría y limpieza

La spec del bloque es `aliantis-brain/specs/017-auditoria-limpieza/spec.md` (diagnóstico, alcance, criterios y verificación), aprobada por Andres el 12-nov-2026 con P1 a P9 según las recomendaciones. Aquí, las tareas de este repo:

- [x] **V1** Quitar `@dnd-kit/sortable` (sin uso) y el script `eval:silencios` (su archivo no existe).
- [x] **V2** Spec-Kit sin ramas ni commits automáticos (`auto_execute_hooks: false`, ganchos `git` apagados); fuera los skills `speckit-git-*` y `speckit-taskstoissues`, los agentes `deploy-ops` y `public-site-builder` y `skills-lock.json`.
- [x] **V3** El método de Aliantis en los documentos heredados: nota sobre el «Modo Objetivo» y `/loop-sdd`; `CLAUDE.md`, `AGENTS.md` y el «Primer arranque» del `README.md`.
- [x] **V4** `.env.example` con `aliantis-brain` como cerebro; `NEA_VERSION` y `ALLOWED_WA_IDS`, del servicio `nea` de upstream (el compose se rehace en el bloque S).
- [x] **V5** Textos del dueño: la tarjeta «Quién responde a tus clientes» sin variables de entorno; plantilla de ejemplo sin «la limpieza dental».
- [x] **V6** Pantalla Agente: aviso de que el asistente no usa «Comportamiento» ni la base de conocimiento (P4, opción a), también en «Agregar al conocimiento» del Laboratorio.

**Anotado para el bloque W** (encontrado al construir, fuera del plan): la guía de inicio (`src/server/onboarding/guide.ts`, paso «Conecta tu agente») y el Laboratorio (`lab-client.tsx`, «Cómo conectarlo») todavía le muestran al dueño nombres de variables y la receta del par de upstream.

Verificación: pruebas y eslint de los archivos tocados y `tsc --noEmit` en el PC; el CI en GitHub. Sin `e2e.yml`: no toca webhook, ingesta, despacho, contrato ni base.
