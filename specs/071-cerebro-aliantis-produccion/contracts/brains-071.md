# Contrato `/api/brains/*` y `/api/bot/profile` — delta de la 071

Normativo junto con [`070/contracts/brains.md`](../../070-cerebro-multiorg/contracts/brains.md).
Todo es **aditivo**: ningún campo se renombra ni cambia de tipo, y
`contextVersion` sigue en `2`.

## 1. Campos nuevos del perfil del agente

`serializeBotProfile().profile` (viaja en `GET /api/bot/profile` → `profile` y
en `GET /api/brains/context` → `agent`):

```jsonc
"treatment": "tu" | "usted" | "neutro",   // default "tu"
"stallEnabled": true | false              // default true
```

Solo en `GET /api/brains/context` → `agent`:

```jsonc
"agendaEnabled": true | false   // = módulo agenda del negocio (techo ∧ organización)
```

### Reglas para el cerebro

- Campo ausente → default (`tu`, `true`; `agendaEnabled` ausente → el cerebro
  decide con su sonda, como en la 070).
- Valor desconocido de `treatment` → `tu`.
- El cerebro **ignora** claves que no conoce en todo el contexto.

## 2. Cabecera de organización

`X-Vocero-Organization` acepta el **slug o el id** (ya era así en la 070).
Desde la 071 Nea `multiorg` manda el **id**: un cambio de slug no invalida las
peticiones en vuelo ni las de los workers que despiertan tarde.

## 3. `/health` de Nea (lo lee `salud.ts`)

Se añade, sin tocar `status`, `version`, `mode`, `llm`:

```jsonc
"queues": { "inboxPending": 0, "inboxStarted": 0, "pendingSends": 0, "oldestInboxSeconds": 0 } | null
```

El cuerpo completo se mantiene < 1 KB (el CRM lee como mucho 4 KB).

## 4. `POST /vocero/ensayo` (Nea)

| Caso | Respuesta |
|---|---|
| Sin hueco (`ENSAYO_CONCURRENCY`) | 429 `{"error":"ocupado"}` |
| Pasa `ENSAYO_TIMEOUT_SECONDS` | 200 `{"ok":false,"error":"tiempo_agotado","turns":[…ya hechos]}` |

## 5. Reservado para la 072 (no se implementa aquí)

Para que la 071 no tenga que reescribirse:

- Herramientas dinámicas: llegarán como `tools: [{name, description,
  parameters (JSON Schema), clave}]` **top-level** en el contexto y se
  ejecutarán por `POST /api/brains/tools/{name}`. Nea 071 las ignora; su
  registro de `ToolSpec` es el punto de enchufe.
- Campos personalizados: llegarán en `contact.customFields` y como esquema de
  la ficha; Nea 071 aísla el esquema de `update_ficha` en `esquema_de_ficha(context)`.
- Vertical Pack: puede fijar `agent.role` a claves nuevas del registro de roles;
  un cerebro que no conozca la clave cae a `calificador`.
