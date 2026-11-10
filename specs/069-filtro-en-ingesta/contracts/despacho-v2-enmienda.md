# Contrato — Enmienda 069 al despacho v2

Sobre `specs/067-contrato-aliantis/contracts/despacho-v2.md`. Solo agrega; la regla de compatibilidad es la misma: cada llave viaja **solo si aplica**, al final del objeto que la contiene.

## `messages[].privacyFlags` (ya definida en la 067; desde aquí se manda)

- Se llena desde `message.privacy_flags`. Solo si el mensaje tiene marcas.
- Va al final del mensaje, después de `location` o `contacts` si existen.
- `text` ya viene filtrado. El cerebro vuelve a filtrar como defensa y une sus marcas con estas.

## `organization.privacyProfileHash` (nueva)

```json
"organization": { "id": "org_…", "slug": "mi-negocio", "privacyProfileHash": "678b2aee…(64 hex)" }
```

- La huella del perfil de privacidad con el que Vocero filtró (spec 068, `contracts/perfil-privacidad.md`). Solo si el negocio tiene un perfil legible.
- Va después de `slug`.
- **Qué hace el cerebro:** la compara con la huella de su configuración (`perfilExportado(config).huella`). Si no cuadra, deja un aviso en el log con las dos huellas y sin contenido, y sigue: vuelve a filtrar con la suya. Remedio: exportar el perfil del cerebro y registrarlo en Vocero.

## Lo que no cambia

La firma, las cabeceras, los reintentos, `conversation.deleted` y el cuerpo gemelo de `tests/unit/despacho-contrato.test.ts`.
