/**
 * 075 — El envoltorio REAL de `src/lib/db`, para probarlo contra Postgres en
 * `scripts/e2e-rls.mjs`. El CI lo compila con esbuild (alias @ → ./src).
 */
export { clienteConRls } from "@/lib/db/cliente-rls";
export {
  comoPanel,
  comoSistema,
  conNegocio,
  ConsultaSinNegocio,
  NegocioCruzado,
  trabajoDeFondo,
} from "@/lib/db/contexto";
export * as schema from "@/lib/db/schema";
