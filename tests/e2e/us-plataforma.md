# E2E — 069 Modo plataforma (multi-tenant)

Automatizado en `scripts/e2e-plataforma.mjs` (`pnpm test:e2e:plataforma`).
Corre en **staging** con DNS y certificado comodín; no en el equipo local.

## Preparación

- `TENANCY=multi`, `PLATFORM_BASE_DOMAIN`, `PLATFORM_ADMIN_EMAILS` con el
  correo de la prueba, `AGENDA=on`; opcional `PLATFORM_MCP=on`.
- `APP_BASE_URL` (raíz), `E2E_ORG_URL=https://{slug}.<dominio>`,
  `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`.

## Pasos (feliz e infeliz)

1. **Candados**: registro público rechazado; `/api/bot/*` 404; `/api/platform/*`
   404 sin Super-Admin; `/api/auth/organization/create` 404.
2. **Super-Admin**: registro con su correo, sesión, lista de negocios; token
   `alp_` creado (visible una vez).
3. **Negocio A por REST**: Blueprint inválido → 422 con ruta; secreto → 422;
   `dryRun` sin crear; alta 201 con enlace de invitación en su subdominio;
   slug repetido 409; exportar y reaplicar → todo `sin_cambios`.
4. **Negocio B por MCP** (o REST si está apagado): `initialize`, `tools/list`
   sin herramientas de datos personales, `apply_blueprint`; MCP sin token 401.
5. **Invitación y aislamiento**: el dueño acepta (cuenta nueva); el enlace no
   sirve dos veces (410); el dueño entra a A y no ve nada en el host de B;
   el manifest del subdominio lleva la marca del negocio y el de la raíz no.
6. **Módulos**: agenda apagada en A → `/api/calendar/settings` 404.
7. **Suspensión**: 403 `organizacion_suspendida`; al reactivar vuelve.
8. **Soporte**: sin acceso 404; un token no abre accesos; motivo corto 422;
   `lectura` lee y no escribe (`solo_lectura`); credenciales vetadas;
   `configuracion` cambia el agente y no crea contactos (`fuera_de_alcance`);
   al cerrar, 404 otra vez; la auditoría lo registra.
9. **Token revocado** → 401.

## A mano (no automatizable sin navegador)

- La banda «Acceso de soporte — vence HH:MM» se ve en todas las pantallas.
- El login de `{slug}.<dominio>` muestra logo y color del negocio; el de un
  slug inexistente, la marca Aliantis.
- Ajustes → Equipo del dueño muestra «Accesos de soporte» y «Cambios de la
  plataforma».
