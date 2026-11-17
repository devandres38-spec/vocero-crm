# Aprovisionar negocios con IA: servidor MCP (069)

Con `TENANCY=multi` y `PLATFORM_MCP=on`, la plataforma expone un servidor MCP
en `https://<dominio-base>/api/platform/mcp` (Streamable HTTP, sin estado). Un
asistente (Claude, Gemini…) puede crear y configurar un negocio completo con
un `OrganizationBlueprint`, usando los mismos servicios que el panel y la API
REST. Todo queda en la auditoría con la vía `mcp` y el nombre de tu token.

## 1. Crea un token

`/platform/tokens` → nombre (p. ej. «Claude de Ana»), alcance:

- `read`: catálogo, listar, ver y **planificar** Blueprints.
- `read` + `provision`: además crear, aplicar, invitar y suspender.

El token `alp_…` se muestra UNA vez. Revócalo ahí mismo cuando ya no se use.

## 2. Conecta tu cliente

**Claude Code**

```bash
claude mcp add --transport http aliantis https://aliantis.co/api/platform/mcp \
  --header "Authorization: Bearer alp_TU_TOKEN"
```

**Gemini CLI** (`~/.gemini/settings.json`)

```json
{
  "mcpServers": {
    "aliantis": {
      "httpUrl": "https://aliantis.co/api/platform/mcp",
      "headers": { "Authorization": "Bearer alp_TU_TOKEN" }
    }
  }
}
```

**Claude Desktop** (conectores locales, vía el puente `mcp-remote`)

```json
{
  "mcpServers": {
    "aliantis": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://aliantis.co/api/platform/mcp",
               "--header", "Authorization: Bearer alp_TU_TOKEN"]
    }
  }
}
```

Los conectores que exigen OAuth (p. ej. ChatGPT) aún no están soportados.

## 3. Herramientas

| Herramienta | Alcance | Qué hace |
|---|---|---|
| `get_catalog` | read | Valores válidos y JSON Schema del Blueprint. Llámala primero. |
| `list_organizations` | read | Negocios: slug, nombre, estado. |
| `get_organization` | read | Configuración de un negocio (nunca conversaciones). |
| `get_blueprint` | read | Blueprint vigente; aplicarlo tal cual no cambia nada. |
| `plan_blueprint` | read | Dry run: qué cambiaría, advertencias y errores con su ruta. |
| `apply_blueprint` | provision | Crea (sin `idOrSlug`) o aplica cambios. Idempotente. |
| `create_owner_invitation` | provision | Enlace de invitación de un uso (7 días). |
| `suspend_organization` / `reactivate_organization` | provision | Suspender / reactivar. |

No existen, a propósito: abrir accesos de soporte, leer conversaciones o
contactos, borrar negocios ni gestionar tokens.

## Ejemplo de pedido

> «Crea el negocio *Clínica Sol* (slug `clinica-sol`) en México, con agenda de
> lunes a viernes de 8 a 17, citas de 45 minutos, una agente llamada Sofía que
> saluda con calidez y estas preguntas frecuentes…, e invita a
> dueña@clinicasol.mx.»

El asistente llama `get_catalog`, arma el Blueprint, lo revisa con
`plan_blueprint` y lo aplica con `apply_blueprint`; te devuelve el enlace de
invitación para que se lo pases a la dueña.

Reglas del Blueprint: secciones opcionales (las ausentes no se tocan), nunca
secretos (las llaves de IA y de WhatsApp las conecta cada negocio), y nunca
borra datos (una etapa con leads se conserva; el conocimiento solo se borra
con `knowledge.mode: "exact"`).
