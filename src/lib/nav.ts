import {
  CalendarDays,
  ChartColumn,
  FlaskConical,
  HeartPulse,
  Inbox,
  Kanban,
  LayoutDashboard,
  ListChecks,
  PartyPopper,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { canConfigure } from "@/lib/auth/roles";
import type { ExperienciaResuelta } from "@/verticals/resolver";
import type { IconoNav } from "@/verticals/tipos";
import { t } from "@/verticals/vocabulario";

/**
 * #87 — El modelo del menú, separado del componente que lo pinta.
 *
 * Qué entradas existen lo deciden dos cosas que el nav de cliente no puede
 * leer solo: las banderas de la instancia (`AGENDA`, `CHANNELS`, `ATRIBUCION`,
 * que bajan por prop desde el servidor) y el rol de quien mira. Tenerlo aquí,
 * sin React, deja que una prueba unitaria afirme qué aparece y qué no sin
 * dibujar nada.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Muestra el contador de no leídos (solo la Bandeja). */
  badge?: boolean;
};

export type NavGroup = {
  /** Encabezado pequeño; sin él, el grupo es una entrada suelta. */
  title?: string;
  items: NavItem[];
};

/** La única entrada que va abajo, separada del resto. */
export const SETTINGS_ITEM: NavItem = {
  href: "/settings",
  label: "Ajustes",
  icon: Settings,
};

/**
 * Grupos de la barra lateral, en el orden en que se leen: lo que se atiende
 * cada día, lo que configura al agente y, al final, cómo va el negocio.
 */
/** 072 — Los íconos que un Vertical Pack puede nombrar (lista cerrada). */
export const ICONOS_NAV: Record<IconoNav, LucideIcon> = {
  inicio: LayoutDashboard,
  bandeja: Inbox,
  pipeline: Kanban,
  contactos: Users,
  citas: CalendarDays,
  agente: Sparkles,
  laboratorio: FlaskConical,
  resultados: ChartColumn,
  guia: ListChecks,
  salud: HeartPulse,
  evento: PartyPopper,
};

export function appNavGroups({
  agenda = false,
  role,
  experiencia,
}: {
  /** 015 — "Citas" solo existe si esta instancia encendió la agenda. */
  agenda?: boolean;
  /** #86 — La guía de inicio solo para quien puede configurar. */
  role?: string | null;
  /**
   * 072 (D4) — El Vertical Pack del negocio ya resuelto: vocabulario, orden,
   * entradas ocultas, íconos e Inicio. Sin él (o con `default`), el menú de
   * 2.11.0 (red de seguridad en `tests/unit/red-072.test.ts`).
   */
  experiencia?: ExperienciaResuelta | null;
}): NavGroup[] {
  const voc = experiencia?.vocabulario;
  const trabajo: NavItem[] = [
    { href: "/inbox", label: t(voc, "bandeja"), icon: Inbox, badge: true },
    { href: "/pipeline", label: t(voc, "pipeline"), icon: Kanban },
    { href: "/contacts", label: t(voc, "contacto", "varios"), icon: Users },
  ];
  // Citas va después de Contactos: es el paso siguiente de un trato, no una
  // sección aparte.
  if (agenda) trabajo.push({ href: "/bookings", label: t(voc, "cita", "varios"), icon: CalendarDays });
  // 072 (D7) — Inicio solo existe si el pack (o el negocio) lo define.
  if (experiencia?.inicio) trabajo.unshift({ href: "/inicio", label: t(voc, "inicio"), icon: LayoutDashboard });

  const agente: NavItem[] = [];
  // Un miembro del equipo no puede hacer ninguno de los pasos de la guía.
  if (canConfigure(role)) {
    agente.push({ href: "/onboarding", label: "Guía de inicio", icon: ListChecks });
  }
  agente.push(
    { href: "/agent", label: t(voc, "agente"), icon: Sparkles },
    { href: "/lab", label: "Laboratorio", icon: FlaskConical }
  );

  const grupos: NavGroup[] = [
    { title: "Trabajo", items: trabajo },
    { title: "Agente", items: agente },
    // 019 — Se mide al final: primero se atiende y se organiza.
    { items: [{ href: "/results", label: t(voc, "resultados"), icon: ChartColumn }] },
  ];
  return experiencia ? aplicarExperiencia(grupos, experiencia) : grupos;
}

/**
 * 072 — Orden, ocultas e íconos del pack, DENTRO de cada grupo. La Bandeja
 * no se oculta (es por donde existe el producto); un grupo que queda vacío
 * desaparece. Un `href` que no esté en el menú se ignora.
 */
function aplicarExperiencia(grupos: NavGroup[], exp: ExperienciaResuelta): NavGroup[] {
  const ocultas = new Set(exp.nav.ocultas.filter((h) => h !== "/inbox"));
  const pos = new Map(exp.nav.orden.map((h, i) => [h, i]));
  return grupos
    .map((g) => {
      const items = g.items
        .filter((i) => !ocultas.has(i.href))
        .map((i, original) => ({ i, original }))
        .sort((a, b) => {
          const pa = pos.get(a.i.href);
          const pb = pos.get(b.i.href);
          if (pa !== undefined && pb !== undefined) return pa - pb;
          if (pa !== undefined) return -1;
          if (pb !== undefined) return 1;
          return a.original - b.original;
        })
        .map(({ i }) => {
          const icono = exp.nav.iconos[i.href];
          return icono ? { ...i, icon: ICONOS_NAV[icono] } : i;
        });
      return { ...g, items };
    })
    .filter((g) => g.items.length > 0);
}

export type SettingsLink = { href: string; label: string };

export type SettingsSection = {
  title: string;
  links: SettingsLink[];
};

/**
 * Ajustes en tres secciones: por dónde entran los mensajes, qué hace el agente
 * con ellos y lo que es del negocio. Una pestaña por canal no escala; una
 * sección por canal, sí: cada canal nuevo cae en "Canales" sin tocar el resto.
 *
 * Instagram no tiene pantalla propia todavía: sus credenciales se guardan
 * por API (`/api/settings/instagram`). Cuando la tenga, va aquí tras
 * `CHANNELS`, igual que Messenger.
 */
export function settingsSections({
  agenda = false,
  atribucion = false,
  instagram = false,
  messenger = false,
  tiktok = false,
}: {
  agenda?: boolean;
  /** 016 — "Anuncios" existe solo con la bandera ATRIBUCION. */
  atribucion?: boolean;
  /** 023 — "Instagram" solo si el canal está encendido con CHANNELS. */
  instagram?: boolean;
  /** 017 — "Messenger", igual. */
  messenger?: boolean;
  /** 022 — "TikTok", igual: solo con el canal en CHANNELS. */
  tiktok?: boolean;
}): SettingsSection[] {
  const canales: SettingsLink[] = [];
  // 023 — "Estado" reúne todos los canales; con WhatsApp solo no aporta nada
  // que su pantalla no diga, así que no existe (ADR-001).
  if (instagram || messenger || tiktok) {
    canales.push({ href: "/settings/channels", label: "Estado" });
  }
  canales.push({ href: "/settings/whatsapp", label: "WhatsApp" });
  if (instagram) canales.push({ href: "/settings/instagram", label: "Instagram" });
  if (messenger) canales.push({ href: "/settings/messenger", label: "Messenger" });
  if (tiktok) canales.push({ href: "/settings/tiktok", label: "TikTok" });

  // #85 — el proveedor de IA se configura aquí; el entorno queda de respaldo.
  const agente: SettingsLink[] = [{ href: "/settings/ai", label: "IA" }];
  if (agenda) agente.push({ href: "/settings/calendar", label: "Agenda" });

  const negocio: SettingsLink[] = [
    { href: "/settings/branding", label: "Marca" },
    // 062 — Tema, letra, tamaño y densidad (cada quien la suya).
    { href: "/settings/appearance", label: "Apariencia" },
    { href: "/settings/templates", label: "Plantillas" },
    // 049 — lo que el equipo inserta con «/atajo» en la Bandeja.
    { href: "/settings/quick-replies", label: "Respuestas rápidas" },
    { href: "/settings/team", label: "Equipo" },
  ];
  if (atribucion) negocio.push({ href: "/settings/ads", label: "Anuncios" });

  return [
    { title: "Canales", links: canales },
    { title: "Agente", links: agente },
    { title: "Negocio", links: negocio },
  ];
}

/** Activa si la ruta es la entrada o cuelga de ella (`/inbox/cv_123`). */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
