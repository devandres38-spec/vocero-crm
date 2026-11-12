# US — El panel de Andres (076, bloque I)

Automatizado en `scripts/e2e-panel.mjs` (lo corre `.github/workflows/e2e.yml`, con la app bajo RLS). La parte de la base está en `scripts/e2e-rls.mjs` («Panel de Andres»).

1. **Superadmin por comando:** `pnpm superadmin:alta` sin `DATABASE_MIGRATIONS_URL` se niega; con ella, crea el superadmin (sin negocio) y muestra la contraseña una vez.
2. **Sin segundo factor:** la raíz manda a `/admin`; `/admin` manda a `/admin/segundo-factor`; el API del panel responde 403; `/two-factor/enable` por HTTP responde 404.
3. **Activar el TOTP:** devuelve el QR, el secreto y 10 códigos de respaldo, sin caché. El primer código lo activa y se cierran todas sus sesiones.
4. **Login en dos pasos:** la contraseña sola pide el código. «Confiar en este dispositivo» se rechaza (400) y con el código entra.
5. **Alta desde el panel:**
   - 201 con la contraseña (24 caracteres) y el id;
   - el mismo correo otra vez, 409; desde otro origen, 403;
   - queda en el registro sin la contraseña.
   - El dueño entra, pero las páginas lo mandan a `/cuenta` hasta cambiarla (el API no se bloquea).
   - Una contraseña nueva de menos de 12 da 422, y `/change-password` por HTTP da 404.
6. **Pausar y activar:**
   - sin el nombre exacto, 422;
   - al pausar, el dueño pierde la sesión (401) y no entra (403 con el motivo);
   - al activar, vuelve a entrar.
7. **Restablecer:** una contraseña nueva de 24, sin caché. La vieja no sirve, la nueva sí, y debe cambiarla al entrar. Si el usuario no es del negocio, 404.
8. **Quitar al último dueño:** 409.
9. **Candado D16:** con un contacto y un mensaje centinela sembrados en el negocio, ninguna página del panel trae el texto ni el nombre; el conteo sí cuenta la conversación.
10. **Gasto:** un cerebro de mentira en `:3261` verifica la firma derivada (ninguna firma inválida) y el resumen muestra el gasto frente al tope.
11. **Ajenos:** un dueño de negocio recibe 404 en `/admin` y en `/api/admin`.
12. **Capturas:** `/admin`, `/admin/negocios` y el detalle a 390 y 1280 px, sin desborde horizontal; se suben como artefacto `capturas-panel`.
