# 067 — Modelo de datos

Una migración aditiva, `0029_contrato_aliantis.sql` (era la `0027`; la tomó la spec 068, y la `0028` la 069 con `message.privacy_flags`, que ya no va aquí), generada con `pnpm db:generate` desde `src/lib/db/schema.ts`. Se aplica al arrancar, sin pasos manuales. No toca filas existentes.

## Tabla nueva: `consent`

| Columna | Tipo | Nota |
| --- | --- | --- |
| `id` | `text` PK | prefijo `cns_` (nuevo en `src/lib/db/ids.ts`) |
| `organization_id` | `text` NOT NULL | FK a `organization`, `on delete cascade` (Principio III) |
| `contact_id` | `text` NOT NULL | FK a `contact`, `on delete cascade`: si el negocio elimina al contacto, se va con él |
| `conversation_id` | `text` NULL | FK a `conversation`, `on delete set null`: el registro sobrevive a la conversación |
| `kind` | `text` NOT NULL | `aviso_privacidad` o `marketing`, con `check` |
| `granted` | `boolean` NOT NULL | |
| `notice_version` | `text` NOT NULL | La versión del aviso que vio la persona |
| `source_message_id` | `text` NULL | Sin FK: el mensaje puede borrarse (`forget`) y el registro debe quedar |
| `created_at` | `timestamp` NOT NULL default now | UTC, como todo el proyecto |

- Índice: `(organization_id, contact_id, kind, created_at)`, para «el último por tipo».
- Índice: `(organization_id, conversation_id, kind, created_at)`, para la regla de `forget`.
- **Solo agregar:** ningún código hace `update` ni `delete` sobre esta tabla (una prueba lo verifica escaneando `src/`, como la bitácora de etapas).

Mismos campos que `consents` de `aliantis-core` (`src/db/schema.ts`), con los nombres e ids de Vocero.

## Columnas nuevas en `message`

| Columna | Tipo | Nota |
| --- | --- | --- |
| `button_id` | `text` NULL | Entrante: el id del botón tocado (`button.payload` o `interactive.*_reply.id`) |
| `buttons` | `jsonb` NULL | Saliente: los botones enviados, `[{ id, title }]` |
| `client_message_id` | `text` NULL | Saliente del cerebro: su llave de idempotencia (T2, 9-nov-2026) |

- Índice **único parcial** `(organization_id, client_message_id) where client_message_id is not null`: es la reserva que impide enviar dos veces el mismo mensaje del cerebro. Se inserta la fila (estado `pending`) antes de llamar a Meta.

- Índice parcial para la regla de seguridad: `(conversation_id, created_at) where direction = 'in' and 'salud' = any(privacy_flags)`. Se decide en la implementación si hace falta; las conversaciones son cortas.

## Sin migración

- **Motivos de traspaso:** `conversation.handoff_reason` es `text` sin `check` en la base (`drizzle/0000_*.sql`). El catálogo vive en `src/server/bot/handoff.ts`; solo cambia el código.
- **Credencial por organización:** se deriva; no se guarda.
- **Presupuesto por organización:** en memoria (`src/lib/rate-limit.ts`), con otra llave.
