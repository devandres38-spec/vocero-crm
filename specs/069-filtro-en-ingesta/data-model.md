# 069 — Modelo de datos

Una migración aditiva, `0028_marcas_privacidad.sql`, generada con `pnpm db:generate`. No toca filas existentes.

## Columna nueva en `message`

| Columna | Tipo | Nota |
| --- | --- | --- |
| `privacy_flags` | `text[]` NULL | Las marcas del filtro del mensaje entrante (`salud`, `urgencia`, `sintoma`, `condicion`, `medicamento`, `sin_revisar`, `correo`, `telefono`, `documento`, `tarjeta`). `NULL`: sin marcas. Lo saliente siempre `NULL` |

La spec 067 reservaba esta columna dentro de su migración (que ya había pasado a la `0028` por la 068). Ahora va sola aquí, y lo demás de la 067 (`consent`, `button_id`, `buttons`, `client_message_id`) pasa a la **`0029`** (corregido en `../067-contrato-aliantis/data-model.md` y `tasks.md`).

## `webhook_event.payload`

Sin cambio de esquema: guarda la copia filtrada. Cada mensaje de paciente lleva además `_privacidad: string[]` (sus marcas), que es metadato de Vocero, no de Meta.
