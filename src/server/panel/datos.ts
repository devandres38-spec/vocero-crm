import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contextoActual, validarNegocio } from "@/lib/db/contexto";

/**
 * 076 (D16 de Aliantis) — El ÚNICO módulo del panel de Andres que habla con la
 * base. Solo llama a las funciones `vocero_panel_*` de la migración 0034, que
 * devuelven agregados (conteos, sumas, banderas, fechas) y el personal de cada
 * negocio; nunca texto de pacientes ni de conversaciones.
 *
 * Todo corre dentro de `comoPanel` (lo pone `rutaDelPanel`): cada consulta va
 * con el rol `vocero_panel`, que no puede leer NINGUNA tabla. Si este archivo
 * intentara un `select` a `message`, Postgres lo negaría. El guardarraíl
 * `panel-candado.test.ts` impide además que el resto del panel importe la
 * base por otro lado.
 *
 * Las fechas son `timestamp` en UTC: se leen `AT TIME ZONE 'UTC'` para que
 * lleguen como instantes y no como hora local del servidor. Los conteos
 * (`bigint`) llegan como `int`.
 */

export class FueraDelPanel extends Error {
  constructor() {
    super("datos del panel fuera de comoPanel");
    this.name = "FueraDelPanel";
  }
}

function exigirPanel(): void {
  if (contextoActual()?.tipo !== "panel") throw new FueraDelPanel();
}

async function filas<T>(consulta: ReturnType<typeof sql>): Promise<T[]> {
  exigirPanel();
  const r = await getDb().execute(consulta);
  return r as unknown as T[];
}

const fecha = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string | Date).toISOString();

export type NegocioDelPanel = {
  id: string;
  nombre: string;
  slug: string | null;
  creadoEn: string;
  pausadoEn: string | null;
  agenteEncendido: boolean;
  canales: { whatsapp: boolean; instagram: boolean; messenger: boolean; tiktok: boolean };
  usuarios: number;
  conversaciones: number;
  conversaciones7d: number;
  entrantes24h: number;
  ultimoEntranteEn: string | null;
  despachosPendientes: number;
  aHumano24h: number;
  webhooksPendientes: number;
  webhooksAgotados: number;
  retencionDias: number | null;
};

type FilaNegocio = {
  id: string;
  nombre: string;
  slug: string | null;
  creado_en: Date;
  pausado_en: Date | null;
  agente_encendido: boolean;
  whatsapp: boolean;
  instagram: boolean;
  messenger: boolean;
  tiktok: boolean;
  usuarios: number;
  conversaciones: number;
  conversaciones_7d: number;
  entrantes_24h: number;
  ultimo_entrante_en: Date | null;
  despachos_pendientes: number;
  a_humano_24h: number;
  webhooks_pendientes: number;
  webhooks_agotados: number;
  retencion_dias: number | null;
};

export async function negociosDelPanel(): Promise<NegocioDelPanel[]> {
  const r = await filas<FilaNegocio>(sql`
    select id, nombre, slug,
      creado_en at time zone 'UTC' as creado_en,
      pausado_en at time zone 'UTC' as pausado_en,
      agente_encendido, whatsapp, instagram, messenger, tiktok,
      usuarios::int as usuarios, conversaciones::int as conversaciones,
      conversaciones_7d::int as conversaciones_7d, entrantes_24h::int as entrantes_24h,
      ultimo_entrante_en at time zone 'UTC' as ultimo_entrante_en,
      despachos_pendientes::int as despachos_pendientes, a_humano_24h::int as a_humano_24h,
      webhooks_pendientes::int as webhooks_pendientes, webhooks_agotados::int as webhooks_agotados,
      retencion_dias
    from vocero_panel_negocios()`);
  return r.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    slug: f.slug,
    creadoEn: fecha(f.creado_en)!,
    pausadoEn: fecha(f.pausado_en),
    agenteEncendido: f.agente_encendido,
    canales: {
      whatsapp: f.whatsapp,
      instagram: f.instagram,
      messenger: f.messenger,
      tiktok: f.tiktok,
    },
    usuarios: f.usuarios,
    conversaciones: f.conversaciones,
    conversaciones7d: f.conversaciones_7d,
    entrantes24h: f.entrantes_24h,
    ultimoEntranteEn: fecha(f.ultimo_entrante_en),
    despachosPendientes: f.despachos_pendientes,
    aHumano24h: f.a_humano_24h,
    webhooksPendientes: f.webhooks_pendientes,
    webhooksAgotados: f.webhooks_agotados,
    retencionDias: f.retencion_dias,
  }));
}

export type SaludDelPanel = {
  negocios: number;
  pausados: number;
  webhooksPendientes: number;
  webhooksAgotados: number;
  despachosPendientes: number;
  despachosEnVuelo: number;
  despachosVencidos: number;
  olvidosPendientes: number;
  avisosPendientes: number;
  ultimoEntranteEn: string | null;
};

export async function saludDelPanel(): Promise<SaludDelPanel> {
  const [f] = await filas<Record<string, number | Date | null>>(sql`
    select negocios::int as negocios, pausados::int as pausados,
      webhooks_pendientes::int as webhooks_pendientes, webhooks_agotados::int as webhooks_agotados,
      despachos_pendientes::int as despachos_pendientes, despachos_en_vuelo::int as despachos_en_vuelo,
      despachos_vencidos::int as despachos_vencidos, olvidos_pendientes::int as olvidos_pendientes,
      avisos_pendientes::int as avisos_pendientes,
      ultimo_entrante_en at time zone 'UTC' as ultimo_entrante_en
    from vocero_panel_salud()`);
  const n = (k: string) => Number(f?.[k] ?? 0);
  return {
    negocios: n("negocios"),
    pausados: n("pausados"),
    webhooksPendientes: n("webhooks_pendientes"),
    webhooksAgotados: n("webhooks_agotados"),
    despachosPendientes: n("despachos_pendientes"),
    despachosEnVuelo: n("despachos_en_vuelo"),
    despachosVencidos: n("despachos_vencidos"),
    olvidosPendientes: n("olvidos_pendientes"),
    avisosPendientes: n("avisos_pendientes"),
    ultimoEntranteEn: fecha(f?.ultimo_entrante_en ?? null),
  };
}

export type UsuarioDelPanel = {
  userId: string;
  nombre: string;
  correo: string;
  rol: string;
  creadoEn: string;
  ultimaSesionEn: string | null;
  debeCambiarContrasena: boolean;
};

export async function usuariosDelPanel(organizationId: string): Promise<UsuarioDelPanel[]> {
  validarNegocio(organizationId);
  const r = await filas<{
    user_id: string;
    nombre: string;
    correo: string;
    rol: string;
    creado_en: Date;
    ultima_sesion_en: Date | null;
    debe_cambiar_contrasena: boolean;
  }>(sql`
    select user_id, nombre, correo, rol,
      creado_en at time zone 'UTC' as creado_en,
      ultima_sesion_en at time zone 'UTC' as ultima_sesion_en,
      debe_cambiar_contrasena
    from vocero_panel_usuarios(${organizationId}::text)`);
  return r.map((f) => ({
    userId: f.user_id,
    nombre: f.nombre,
    correo: f.correo,
    rol: f.rol,
    creadoEn: fecha(f.creado_en)!,
    ultimaSesionEn: fecha(f.ultima_sesion_en),
    debeCambiarContrasena: f.debe_cambiar_contrasena,
  }));
}

/** Pausa o activa un negocio. Devuelve desde cuándo está pausado (`null` si quedó activo). */
export async function pausarDesdeElPanel(organizationId: string, pausar: boolean): Promise<string | null> {
  validarNegocio(organizationId);
  const [f] = await filas<{ pausado_en: Date | null }>(sql`
    select vocero_panel_pausar(${organizationId}::text, ${pausar}::boolean) at time zone 'UTC' as pausado_en`);
  return fecha(f?.pausado_en ?? null);
}

/** El hash lo calcula quien llama (`hashPassword` de Better Auth): la contraseña nunca llega a la base. */
export async function restablecerDesdeElPanel(
  organizationId: string,
  userId: string,
  hash: string
): Promise<void> {
  validarNegocio(organizationId);
  validarNegocio(userId);
  await filas(sql`select vocero_panel_restablecer(${organizationId}::text, ${userId}::text, ${hash}::text)`);
}

export async function quitarUsuarioDesdeElPanel(organizationId: string, userId: string): Promise<void> {
  validarNegocio(organizationId);
  validarNegocio(userId);
  await filas(sql`select vocero_panel_quitar_usuario(${organizationId}::text, ${userId}::text)`);
}

/** Lo que no pasa por una función del panel (hoy, solo el alta). Sin contraseñas. */
export async function anotarEnElPanel(
  accion: "alta_negocio",
  organizationId: string,
  detalle: Record<string, string>
): Promise<void> {
  validarNegocio(organizationId);
  await filas(
    sql`select vocero_panel_anotar(${accion}::text, ${organizationId}::text, ${JSON.stringify(detalle)}::jsonb)`
  );
}

export type EntradaDelRegistro = {
  cuando: string;
  accion: string;
  negocioId: string | null;
  nombre: string | null;
  detalle: Record<string, unknown>;
};

export async function registroDelPanel(limite = 200): Promise<EntradaDelRegistro[]> {
  const r = await filas<{
    cuando: Date;
    accion: string;
    negocio_id: string | null;
    nombre: string | null;
    detalle: Record<string, unknown> | null;
  }>(sql`
    select cuando at time zone 'UTC' as cuando, accion, negocio_id, nombre, detalle
    from vocero_panel_registro(${Math.trunc(limite)}::integer)`);
  return r.map((f) => ({
    cuando: fecha(f.cuando)!,
    accion: f.accion,
    negocioId: f.negocio_id,
    nombre: f.nombre,
    detalle: f.detalle ?? {},
  }));
}
