# Modo plataforma (069): desplegar en Coolify

Aliantis corre en dos modos con la MISMA imagen:

- `TENANCY=single` (o sin la variable): una instancia = un negocio. Todo
  igual que en 2.8.
- `TENANCY=multi`: plataforma SaaS. Cada negocio vive en
  `https://{slug}.<dominio-base>`; la agencia los administra en
  `https://<dominio-base>/platform`.

## 1. DNS comodín

En tu proveedor de DNS crea, apuntando a la IP del servidor de Coolify:

| Tipo | Nombre | Valor |
|---|---|---|
| A | `aliantis.co` (raíz, `@`) | IP del servidor |
| A | `*.aliantis.co` (comodín) | IP del servidor |

Comprueba con `dig +short cualquier-cosa.aliantis.co` → debe dar la IP.

## 2. Certificado comodín (Traefik en Coolify)

Let's Encrypt solo emite un certificado `*.aliantis.co` con el reto **DNS-01**
(el HTTP-01 no sirve para comodines):

1. Coolify → Servers → tu servidor → Proxy → configura el *certificate
   resolver* de Traefik con tu proveedor DNS (p. ej. Cloudflare:
   `CF_DNS_API_TOKEN` con permiso de editar la zona).
2. En la aplicación, en **Domains**, pon ambos dominios:
   `https://aliantis.co,https://*.aliantis.co`.
3. Redespliega y verifica: `curl -I https://prueba.aliantis.co/login` responde
   con un certificado válido (aunque el negocio no exista: ese login muestra
   la marca Aliantis).

## 3. Variables

```bash
TENANCY=multi
PLATFORM_BASE_DOMAIN=aliantis.co          # sin https://
PLATFORM_ADMIN_EMAILS=ops@tuagencia.co    # quién puede registrarse como Super-Admin
APP_BASE_URL=https://aliantis.co
# Opcional: servidor MCP para que una IA aprovisione negocios
PLATFORM_MCP=on
# Techo de módulos de la instancia (cada negocio enciende lo suyo dentro):
AGENDA=on
CHANNELS=whatsapp,instagram,messenger
```

`pnpm doctor` marca ✗ si falta `PLATFORM_BASE_DOMAIN` en `multi` y avisa si
falta `PLATFORM_ADMIN_EMAILS`. La migración `0028_plataforma` se aplica sola al
arrancar.

## 4. Primer arranque

1. Regístrate en `https://aliantis.co/register` con un correo de
   `PLATFORM_ADMIN_EMAILS` → entras a `/platform`.
2. «Nuevo negocio» → completa el asistente → copia el enlace de invitación del
   dueño (se muestra UNA vez; no se envía ningún correo).
3. El dueño abre el enlace en `https://{slug}.aliantis.co/invitacion/…`, crea
   su cuenta y entra a su negocio.

## Qué cambia en `multi` (y no en `single`)

- Registro público cerrado (salvo Super-Admins); los negocios entran por
  invitación.
- `/api/bot/*` responde 404 y el despacho al cerebro está apagado: el cerebro
  por organización (`/api/brains/*`) llega en la 070. Hasta entonces cada
  negocio atiende su bandeja a mano.
- La agencia no ve conversaciones ni contactos de ningún negocio salvo con un
  acceso de soporte (motivo, caducidad ≤ 8 h, auditado, visible al dueño).

## Pasar una instancia `single` con datos a `multi`

Su organización conserva el slug `principal`: queda en
`https://principal.aliantis.co` con sus módulos heredados del techo. Agrega tu
correo a `PLATFORM_ADMIN_EMAILS` antes de registrarte como Super-Admin.
