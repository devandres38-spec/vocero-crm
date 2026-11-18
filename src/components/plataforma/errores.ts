/**
 * 069 — Mensajes para las respuestas de error de `/api/platform/*`. El código
 * es estable (lo lee también una IA); aquí solo se traduce para una persona.
 */

const MENSAJES: Record<string, string> = {
  slug_en_uso: "Esa dirección ya la usa otro negocio.",
  slug_formato: "La dirección solo admite minúsculas, números y guiones (3 a 40).",
  slug_reservado: "Esa dirección está reservada por la plataforma.",
  slug_guiones: "La dirección no puede llevar dos guiones seguidos.",
  slug_requerido: "Falta la dirección.",
  nombre_requerido: "Falta el nombre.",
  pais_invalido: "El país debe ser un código de dos letras (p. ej. CO).",
  locale_invalido: "El idioma y formato no es válido (p. ej. es-CO).",
  zona_invalida: "La zona horaria no existe (p. ej. America/Bogota).",
  color_invalido: "El color debe ser hexadecimal (#rrggbb).",
  ya_miembro: "Ese correo ya es miembro del negocio.",
  secreto_detectado: "No pegues llaves ni tokens: el negocio conecta sus credenciales.",
  organizacion_inexistente: "Ese negocio no existe.",
  slug_inmutable: "La dirección de un negocio no se puede cambiar.",
  etapas_repetidas: "Hay dos etapas con el mismo nombre.",
  horarios_solapados: "En la agenda, dos franjas del mismo día se pisan.",
  intervalo_invertido: "En la agenda, una franja termina antes de empezar.",
  tema_propio_ilegible: "Con esos colores el texto no se lee: ajusta el tema propio.",
  atajo_invalido: "Un atajo de respuesta rápida está vacío o no es válido.",
  atajos_repetidos: "Hay dos respuestas rápidas con el mismo atajo.",
  invitacion_inexistente: "Esa invitación ya no existe.",
  url_invalida: "La URL debe ser http(s), sin usuario ni clave, y no apuntar a localhost ni a direcciones reservadas.",
  secreto_invalido: "El secreto debe tener al menos 32 caracteres y no llevar espacios.",
  cerebro_no_encontrado: "Ese cerebro no existe.",
  cerebro_en_uso: "Ese cerebro atiende negocios: reasígnalos antes de borrarlo.",
  cerebro_pausado: "Ese cerebro está pausado: reactívalo antes de asignarlo.",
  url_sin_ruta: "La URL de despacho debe incluir la ruta, por ejemplo http://nea:8000/vocero/dispatch.",
  url_con_query: "La URL de despacho no lleva ?parámetros ni #fragmento.",
  url_otro_origen: "La URL de salud debe estar en el mismo servidor que la de despacho.",
  origen_invalido: "La petición no vino del panel de la plataforma. Recarga la página.",
  demasiados_intentos: "Demasiados intentos seguidos: espera un momento.",
};

type Issue = { path?: string; message?: string };

export function leerErrorPlataforma(data: unknown): string {
  const error = (data as { error?: { code?: string; message?: string; issues?: Issue[] } } | null)?.error;
  if (!error) return "No se pudo completar. Intenta de nuevo.";
  const issues = error.issues ?? [];
  if (issues.length > 0) {
    return issues
      .map((i) => MENSAJES[i.message ?? ""] ?? `${i.path ?? ""}: ${i.message ?? ""}`)
      .join(" ");
  }
  return MENSAJES[error.code ?? ""] ?? error.message ?? "No se pudo completar.";
}
