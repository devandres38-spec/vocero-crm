# US — Alta de negocios solo por Andres (074)

Arnés: `scripts/e2e-alta.mjs`, en `.github/workflows/e2e.yml` (etiqueta `e2e` en el PR), el último. Antes de todos los arneses, `scripts/e2e-operador.mjs` crea el negocio del operador con `pnpm negocio:alta`: el registro público ya no existe, ni con la instalación vacía.

1. **Registro público cerrado.**
   - `POST /api/auth/sign-up/email` sin sesión: 403, y no queda ningún usuario.
   - `/register` dice «Las cuentas las crea Aliantis» y no tiene formulario.
2. **Las rutas del plugin `organization`, cerradas.** Con la sesión del operador:
   - `organization/create`, `organization/list` y `organization/delete`: 404;
   - no se crea ningún negocio.
3. **`pnpm negocio:alta`, el comando real.**
   - Crea el negocio y muestra una contraseña de 24 caracteres.
   - Su dueño queda como `owner` de ese negocio.
   - Entra con esa contraseña (y no con otra), ve sus 5 etapas y ninguna conversación: las del operador son de otro negocio.
4. **Un correo, un negocio.**
   - El mismo correo otra vez: error («Ya existe una cuenta»).
   - El correo del operador: error.
   - Ninguna fila nueva en `organization` ni en `user`.

Al terminar, borra el negocio y el dueño que creó.
