/**
 * 069 (H-02) — A dónde entra un Super-Admin por la raíz `/`.
 *
 * En el dominio raíz de una plataforma con dominio base, la casa del
 * Super-Admin es `/platform`, aunque además sea miembro de un negocio (caso
 * típico al pasar de `single` a `multi`: la sesión queda con esa única
 * organización activa). A sus negocios entra por el subdominio, donde el host
 * decide. Sin dominio base, elegir empresa es fijar la organización activa
 * de la sesión: ahí la raíz respeta esa elección.
 */
export function plataformaPrimero(d: {
  multi: boolean;
  base: string | null;
  hostEsRaiz: boolean;
  superAdmin: boolean;
}): boolean {
  return d.multi && d.base !== null && d.hostEsRaiz && d.superAdmin;
}
