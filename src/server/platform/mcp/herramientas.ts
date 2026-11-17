import { blueprintJsonSchema } from "@/lib/platform/blueprint";
import { aplicarBlueprint, buscarOrganizacion } from "@/server/platform/blueprint/aplicar";
import { BlueprintError } from "@/server/platform/blueprint/errores";
import { leerBlueprint } from "@/server/platform/blueprint/exportar";
import { catalogoPlataforma } from "@/server/platform/catalogo";
import type { ActorPlataforma } from "@/server/platform/guardia";
import { invitarAOrganizacion } from "@/server/platform/invitaciones";
import { cambiarEstado, detalleOrganizacion, listarOrganizaciones } from "@/server/platform/organizaciones";
import type { Alcance } from "@/server/platform/tokens";

/**
 * 069 (D15, US9) — Las herramientas del servidor MCP. Cada una es un
 * adaptador de pocas líneas sobre los MISMOS servicios que usan el panel y la
 * API REST: aquí no hay lógica de negocio (prueba de equivalencia REST↔MCP).
 *
 * Fuera, a propósito: abrir accesos de soporte, leer conversaciones,
 * contactos o mensajes, borrar organizaciones y gestionar tokens.
 */

export class ErrorHerramienta extends Error {
  constructor(
    public code: string,
    public detail: Record<string, unknown> = {}
  ) {
    super(code);
    this.name = "ErrorHerramienta";
  }
}

type Esquema = Record<string, unknown>;

export type Herramienta = {
  name: string;
  title: string;
  description: string;
  inputSchema: Esquema;
  /** Alcance del token que exige. */
  scope: Alcance;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  run: (actor: ActorPlataforma, args: Record<string, unknown>) => Promise<unknown>;
};

const idOrSlug: Esquema = {
  type: "string",
  description: "Id (org_…) o slug de la organización (p. ej. ferreteria-rojas)",
};
const conOrganizacion = (extra: Record<string, Esquema> = {}, requeridos: string[] = []): Esquema => ({
  type: "object",
  properties: { idOrSlug, ...extra },
  required: ["idOrSlug", ...requeridos],
  additionalProperties: false,
});

function texto(args: Record<string, unknown>, clave: string): string {
  const v = args[clave];
  if (typeof v !== "string" || !v.trim()) throw new ErrorHerramienta("argumento_invalido", { path: clave });
  return v.trim();
}

async function organizacion(args: Record<string, unknown>) {
  const org = await buscarOrganizacion(texto(args, "idOrSlug"));
  if (!org) throw new ErrorHerramienta("organizacion_inexistente");
  return org;
}

/** El objetivo de un Blueprint: una organización existente o crear una nueva. */
async function objetivo(args: Record<string, unknown>) {
  if (args.idOrSlug === undefined) return { crear: true } as const;
  return { organizationId: (await organizacion(args)).id };
}

function schemaBlueprint(): Esquema {
  return {
    type: "object",
    properties: {
      idOrSlug: {
        ...idOrSlug,
        description: "Organización existente. Omítelo para CREAR una (entonces blueprint.organization.slug y name son obligatorios).",
      },
      blueprint: blueprintJsonSchema() as Esquema,
    },
    required: ["blueprint"],
    additionalProperties: false,
  };
}

export function herramientas(): Herramienta[] {
  return [
    {
      name: "get_catalog",
      title: "Catálogo de la plataforma",
      description:
        "Valores válidos para armar un OrganizationBlueprint: roles y herramientas del agente, monedas, módulos que esta instancia permite, reglas del slug, límites de la agenda y el JSON Schema del contrato. Llámala primero.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      scope: "read",
      annotations: { readOnlyHint: true },
      run: async () => catalogoPlataforma(),
    },
    {
      name: "list_organizations",
      title: "Listar negocios",
      description: "Los negocios de la plataforma: id, slug, nombre, estado y número de personas.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      scope: "read",
      annotations: { readOnlyHint: true },
      run: async () => ({ organizations: await listarOrganizaciones() }),
    },
    {
      name: "get_organization",
      title: "Detalle de un negocio",
      description: "Configuración de un negocio (región, marca, módulos, equipo e invitaciones pendientes). Nunca conversaciones ni contactos.",
      inputSchema: conOrganizacion(),
      scope: "read",
      annotations: { readOnlyHint: true },
      run: async (_a, args) => ({ organization: await detalleOrganizacion((await organizacion(args)).id) }),
    },
    {
      name: "get_blueprint",
      title: "Blueprint vigente",
      description: "El OrganizationBlueprint vigente de un negocio. Aplicarlo tal cual no cambia nada: úsalo como base para editar.",
      inputSchema: conOrganizacion(),
      scope: "read",
      annotations: { readOnlyHint: true },
      run: async (actor, args) => leerBlueprint(actor, (await organizacion(args)).id),
    },
    {
      name: "plan_blueprint",
      title: "Planificar un Blueprint (sin aplicar)",
      description:
        "Simula aplicar un OrganizationBlueprint (dry run): devuelve qué secciones cambiarían, advertencias y errores con su ruta exacta. No escribe nada. Úsala siempre antes de apply_blueprint.",
      inputSchema: schemaBlueprint(),
      scope: "read",
      annotations: { readOnlyHint: true, idempotentHint: true },
      run: async (actor, args) => aplicarBlueprint(actor, await objetivo(args), args.blueprint, { dryRun: true }),
    },
    {
      name: "apply_blueprint",
      title: "Aplicar un Blueprint",
      description:
        "Crea un negocio (sin idOrSlug) o aplica cambios a uno existente con un OrganizationBlueprint declarativo e idempotente: las secciones ausentes no se tocan y aplicar dos veces lo mismo no cambia nada. Nunca incluye secretos. Si trae owner, devuelve UNA vez el enlace de invitación.",
      inputSchema: schemaBlueprint(),
      scope: "provision",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      run: async (actor, args) => aplicarBlueprint(actor, await objetivo(args), args.blueprint),
    },
    {
      name: "create_owner_invitation",
      title: "Invitar a un negocio",
      description:
        "Genera un enlace de invitación de un solo uso (7 días) para un correo. Se muestra UNA vez; no se envía ningún correo. Revoca cualquier enlace pendiente anterior del mismo correo.",
      inputSchema: conOrganizacion(
        {
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["owner", "admin", "member"], default: "owner" },
        },
        ["email"]
      ),
      scope: "provision",
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: async (actor, args) => {
        const org = await organizacion(args);
        const email = texto(args, "email").toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorHerramienta("argumento_invalido", { path: "email" });
        const role = args.role === "admin" || args.role === "member" ? args.role : "owner";
        const r = await invitarAOrganizacion(actor, org, email, role);
        if (!r) throw new ErrorHerramienta("ya_miembro");
        return { invitationId: r.id, url: r.url, expiresAt: r.expiresAt.toISOString() };
      },
    },
    {
      name: "suspend_organization",
      title: "Suspender un negocio",
      description:
        "Suspende un negocio: su equipo no entra y no se envía nada; los mensajes que lleguen se siguen guardando. Reversible con reactivate_organization.",
      inputSchema: conOrganizacion(),
      scope: "provision",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      run: async (actor, args) => {
        const org = await organizacion(args);
        return { organizationId: org.id, status: "suspendida", changed: await cambiarEstado(actor, org.id, "suspendida") };
      },
    },
    {
      name: "reactivate_organization",
      title: "Reactivar un negocio",
      description: "Reactiva un negocio suspendido.",
      inputSchema: conOrganizacion(),
      scope: "provision",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      run: async (actor, args) => {
        const org = await organizacion(args);
        return { organizationId: org.id, status: "activa", changed: await cambiarEstado(actor, org.id, "activa") };
      },
    },
  ];
}

/** Traduce un error de servicio a lo que la IA necesita para corregir. */
export function errorParaIa(err: unknown): { code: string; issues?: unknown; detail?: unknown } | null {
  if (err instanceof BlueprintError) return { code: err.code, issues: err.issues };
  if (err instanceof ErrorHerramienta) return { code: err.code, detail: err.detail };
  return null;
}
