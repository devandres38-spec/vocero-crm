# US — RLS en Vocero (075)

Arnés: `scripts/e2e-rls.mjs`, en el job «RLS contra Postgres» de `.github/workflows/ci.yml` (cada push de un PR, sin etiqueta). Postgres 16 de verdad, sin Next.

**Preparación:** `migrate.mjs` corre dos veces como dueño (`DATABASE_MIGRATIONS_URL`), crea el usuario restringido de la app (`DATABASE_URL`) y se prueba que es idempotente.

1. **Catálogo.**
   - Las 38 tablas de negocio (37 con `organization_id` más `organization`) tienen RLS, sin `FORCE`, y una sola política `ALL` cuyo `USING` y `WITH CHECK` son exactamente `organization_id = NULLIF(current_setting('app.organization_id', true), '')` (o `id` en `organization`).
   - Sin RLS solo quedan `user`, `session`, `account` y `verification`.
   - El usuario de la app no es superusuario, no tiene `BYPASSRLS`, no es dueño de nada y es miembro de `vocero_app`.
   - Las 12 funciones `SECURITY DEFINER` fijan `search_path`, no las ejecuta `PUBLIC` y devuelven solo ids o conteos (cada una con su tipo de resultado esperado).
2. **Siembra** (como dueño): dos negocios, A y B, en todas las tablas que se pueden llenar de forma genérica. Las imprescindibles (`organization`, `member`, `contact`, `conversation`, `message`, `webhook_event`, `dispatch`, `meta_app`, `privacy_profile`, `consent`, `aviso_canal`) tienen que quedar sembradas, y al menos 30 de las 38.
3. **Como usuario de la app, tabla por tabla** (dentro de una transacción que siempre se deshace):
   - **INSERT:** con A fijado, una fila de B se rechaza (42501); sin negocio, una fila de A también. Se prueba en las 38 tablas.
   - **SELECT:** con A, se ven exactamente las filas de A y ninguna ajena.
   - **UPDATE y DELETE** de filas de B con A fijado: 0 filas.
   - **Mover una fila de A a B:** se rechaza.
   - **Sin negocio, o con el negocio vacío (`''`):** 0 filas.
4. **Sin fuga por el pool:** en la misma conexión, después de una transacción con A, una consulta suelta no ve nada y la variable quedó vacía.
5. **El envoltorio real** (`src/lib/db`, compilado con esbuild):
   - `conNegocio(A)` ve solo A, y `db.transaction` dentro de `conNegocio(B)` ve B;
   - sin contexto lanza `ConsultaSinNegocio`, y `conNegocio(B)` dentro de `conNegocio(A)` lanza `NegocioCruzado`;
   - en modo sistema no se ve ninguna fila;
   - 20 consultas a la vez, alternando A y B en el mismo pool: cada una ve solo lo suyo.
6. **Las funciones de solo ids** responden como se espera con los dos negocios.

**Además, `e2e.yml`** levanta Vocero con el usuario restringido:

- **Bajo RLS:** los 6 arneses (despacho, consentimiento, contrato, retención, multinegocio y alta), y los comandos que lanzan (`negocio:alta`, `meta:secreto`), que corren con ese usuario.
- **Registro limpio:** un paso falla si el registro de la app tiene `ConsultaSinNegocio` o `NegocioCruzado`.
- **Migración sobre datos:** se prueba con filas de dos negocios.
