"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Bot,
  Braces,
  Building2,
  CalendarDays,
  CheckCircle2,
  Eye,
  KanbanSquare,
  Palette,
  Save,
  ToggleRight,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EnlaceUnaVez } from "@/components/plataforma/enlace-una-vez";
import { leerErrorPlataforma } from "@/components/plataforma/errores";
import type { OrganizationBlueprint, SeccionBlueprint } from "@/lib/platform/blueprint";
import {
  PESTANA_DE_SECCION,
  blueprintParaEnviar,
  formularioDesdeBlueprint,
  formularioInicial,
  seccionesDelFormulario,
  tarjetasIncompletas,
  type DefaultsForm,
  type FormBlueprint,
  type ModoFormulario,
  type ModulosForm,
  type TechoForm,
} from "@/lib/platform/formulario-blueprint";
import { cn } from "@/lib/utils";
import type { Actualizar } from "./controles";
import { PestanaNegocio } from "./pestana-negocio";
import { PestanaMarca } from "./pestana-marca";
import { PestanaModulos, PestanaPipeline } from "./pestana-modulos";
import { PestanaAgente, PestanaConocimiento, type OpcionCerebro } from "./pestana-agente";
import { PestanaAgenda } from "./pestana-agenda";
import { PestanaJson, PestanaRespuestas } from "./pestana-respuestas";

/**
 * Auditoría 069 (Fix-C/D) — EL formulario de un negocio en `/platform`, el
 * mismo para crear (`/platform/nuevo`) y para editar (la ficha). Edita el
 * 100% del `OrganizationBlueprint` sin escribir JSON y lo manda a la misma
 * API que usan las IAs por el MCP. Al editar, manda solo las secciones que
 * cambiaron.
 */

const PESTANAS: { id: string; titulo: string; icono: LucideIcon }[] = [
  { id: "negocio", titulo: "Negocio y región", icono: Building2 },
  { id: "marca", titulo: "Marca y apariencia", icono: Palette },
  { id: "modulos", titulo: "Módulos", icono: ToggleRight },
  { id: "pipeline", titulo: "Pipeline", icono: KanbanSquare },
  { id: "agente", titulo: "Agente", icono: Bot },
  { id: "conocimiento", titulo: "Conocimiento", icono: BookOpen },
  { id: "agenda", titulo: "Agenda", icono: CalendarDays },
  { id: "respuestas", titulo: "Respuestas rápidas", icono: Zap },
  { id: "json", titulo: "JSON avanzado", icono: Braces },
];

const NOMBRE_SECCION: Record<SeccionBlueprint, string> = {
  organization: "Negocio",
  region: "Región",
  brand: "Marca",
  appearance: "Apariencia",
  modules: "Módulos",
  pipeline: "Pipeline",
  agent: "Agente",
  knowledge: "Conocimiento",
  agenda: "Agenda",
  quickReplies: "Respuestas rápidas",
  brain: "Cerebro",
  owner: "Dueño",
};

const ESTADO: Record<string, { texto: string; variante: "success" | "secondary" | "warning" }> = {
  creada: { texto: "Se crea", variante: "success" },
  actualizada: { texto: "Cambia", variante: "warning" },
  sin_cambios: { texto: "Sin cambios", variante: "secondary" },
};

/** Las advertencias del servicio, para una persona. */
function advertencia(w: string): string {
  const [codigo, dato] = w.split(":");
  if (codigo === "modulo_apagado") return `El módulo ${dato} está apagado: su configuración se guarda pero no se usa.`;
  if (codigo === "etapa_con_leads_conservada") return `La etapa «${dato}» tiene leads: se conserva aunque no esté en la lista.`;
  return w;
}

type Resultado = {
  organizationId: string;
  created: boolean;
  dryRun: boolean;
  sections: Partial<Record<SeccionBlueprint, string>>;
  warnings: string[];
  invitation?: { status: string; url?: string; expiresAt?: string };
};

export type PropsFormulario = {
  modo: ModoFormulario;
  dominio: string | null;
  defaults: DefaultsForm;
  techo: TechoForm;
  /** Editar: el Blueprint vigente y los módulos efectivos del negocio. */
  organizationId?: string;
  inicial?: OrganizationBlueprint;
  modulosEfectivos?: ModulosForm;
  /** 070 — Los despliegues de cerebro que se pueden asignar (sin secretos). */
  cerebros?: OpcionCerebro[];
};

export function FormularioBlueprint(p: PropsFormulario) {
  const router = useRouter();
  const desde = (bp?: OrganizationBlueprint) =>
    bp ? formularioDesdeBlueprint(bp, p.defaults, p.techo, p.modulosEfectivos) : formularioInicial(p.defaults, p.techo);
  const [f, setF] = useState<FormBlueprint>(() => desde(p.inicial));
  const [base, setBase] = useState(() => (p.modo === "editar" ? seccionesDelFormulario(desde(p.inicial), "editar", p.techo) : undefined));
  const [pestana, setPestana] = useState("negocio");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conError, setConError] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Resultado | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [creado, setCreado] = useState<Resultado | null>(null);

  const upd: Actualizar = (k, v) => setF((x) => ({ ...x, [k]: { ...x[k], ...v } }));
  const envio = useMemo(() => blueprintParaEnviar(f, p.modo, p.techo, base), [f, p.modo, p.techo, base]);
  const pestanasCambiadas = new Set(envio.modificadas.map((s) => PESTANA_DE_SECCION[s]));
  const incompletas = tarjetasIncompletas(f);
  const avisoIncompletas = [
    incompletas.conocimiento ? `${incompletas.conocimiento} en Conocimiento` : null,
    incompletas.respuestas ? `${incompletas.respuestas} en Respuestas rápidas` : null,
  ].filter(Boolean);
  const hayCambios = p.modo === "crear" ? f.organization.name.trim() !== "" : envio.modificadas.length > 0;

  async function enviar(dryRun: boolean) {
    setError(null);
    setConError(new Set());
    setPlan(null);
    setAviso(null);
    setEnviando(true);
    try {
      const url =
        p.modo === "crear" ? "/api/platform/organizations" : `/api/platform/organizations/${p.organizationId}/blueprint`;
      const res = await fetch(`${url}${dryRun ? "?dryRun=true" : ""}`, {
        method: p.modo === "crear" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envio.blueprint),
      });
      const data = (await res.json().catch(() => null)) as (Resultado & { error?: { issues?: { path?: string }[] } }) | null;
      if (!res.ok) {
        setError(leerErrorPlataforma(data));
        const tabs = new Set<string>();
        for (const i of data?.error?.issues ?? []) {
          const seccion = (i.path ?? "").split(".")[0] as SeccionBlueprint;
          if (PESTANA_DE_SECCION[seccion]) tabs.add(PESTANA_DE_SECCION[seccion]);
        }
        setConError(tabs);
        const primera = PESTANAS.find((t) => tabs.has(t.id));
        if (primera) setPestana(primera.id);
        return;
      }
      if (!data) return;
      if (dryRun) {
        setPlan(data);
        return;
      }
      if (p.modo === "crear") {
        setCreado(data);
        return;
      }
      setBase(seccionesDelFormulario(f, "editar", p.techo));
      const cambiadas = Object.entries(data.sections)
        .filter(([, e]) => e !== "sin_cambios")
        .map(([s]) => NOMBRE_SECCION[s as SeccionBlueprint]);
      setAviso(cambiadas.length ? `Guardado: ${cambiadas.join(", ")}.` : "Nada que cambiar.");
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  if (creado) {
    return (
      <div className="space-y-4 rounded-xl border bg-background p-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <h2 className="text-lg font-semibold">Negocio creado</h2>
        </div>
        {creado.invitation?.status === "creada" && creado.invitation.url ? (
          <EnlaceUnaVez url={creado.invitation.url} expiresAt={creado.invitation.expiresAt} />
        ) : (
          <p className="text-sm text-text-2">Sin invitación: puedes generarla desde la ficha del negocio.</p>
        )}
        {creado.warnings.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-warning-text">
            {creado.warnings.map((w) => (
              <li key={w}>{advertencia(w)}</li>
            ))}
          </ul>
        )}
        <Link href={`/platform/organizaciones/${creado.organizationId}`} className="inline-flex text-sm font-medium text-brand-ink underline underline-offset-4">
          Ir a la ficha del negocio
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Secciones del negocio" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {PESTANAS.map((t) => {
          const Icono = t.icono;
          const activa = pestana === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => setPestana(t.id)}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors",
                activa ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border" : "text-text-3 hover:bg-background/60 hover:text-foreground"
              )}
            >
              <Icono className="h-4 w-4" strokeWidth={1.8} />
              {t.titulo}
              {conError.has(t.id) ? (
                <span aria-label="con errores" className="h-2 w-2 rounded-full bg-danger" />
              ) : (
                pestanasCambiadas.has(t.id) && p.modo === "editar" && <span aria-label="con cambios" className="h-2 w-2 rounded-full bg-brand" />
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="min-h-[300px]">
        {pestana === "negocio" && <PestanaNegocio f={f} upd={upd} modo={p.modo} dominio={p.dominio} />}
        {pestana === "marca" && <PestanaMarca f={f} upd={upd} organizationId={p.organizationId} />}
        {pestana === "modulos" && <PestanaModulos f={f} upd={upd} techo={p.techo} />}
        {pestana === "pipeline" && <PestanaPipeline f={f} upd={upd} />}
        {pestana === "agente" && <PestanaAgente f={f} upd={upd} agendaActiva={p.techo.agenda && f.modules.agenda} cerebros={p.cerebros ?? []} />}
        {pestana === "conocimiento" && <PestanaConocimiento f={f} upd={upd} />}
        {pestana === "agenda" && <PestanaAgenda f={f} upd={upd} moduloActivo={f.modules.agenda} techoAgenda={p.techo.agenda} />}
        {pestana === "respuestas" && <PestanaRespuestas f={f} upd={upd} />}
        {pestana === "json" && (
          <PestanaJson
            vista={envio.blueprint}
            onImportar={(bp) => {
              if (!bp || typeof bp !== "object" || (bp as { version?: unknown }).version !== 1) {
                return "Falta \"version\": 1 o no es un objeto.";
              }
              const nuevo = formularioDesdeBlueprint(bp as OrganizationBlueprint, p.defaults, p.techo, p.modulosEfectivos);
              if (p.modo === "editar") nuevo.organization = { ...nuevo.organization, slug: f.organization.slug };
              else nuevo.organization.slugTocado = Boolean(nuevo.organization.slug);
              setF(nuevo);
              return null;
            }}
          />
        )}
      </div>

      {plan && (
        <div className="space-y-3 rounded-xl border border-brand-soft bg-brand-tint p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Revisión: esto es lo que pasaría (no se guardó nada)</p>
            <button type="button" aria-label="Cerrar revisión" onClick={() => setPlan(null)} className="text-text-3 hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(plan.sections).map(([s, e]) => (
              <Badge key={s} variant={ESTADO[e]?.variante ?? "secondary"}>
                {NOMBRE_SECCION[s as SeccionBlueprint] ?? s}: {ESTADO[e]?.texto ?? e}
              </Badge>
            ))}
          </div>
          {plan.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-warning-text">
              {plan.warnings.map((w) => (
                <li key={w}>{advertencia(w)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6">
        {avisoIncompletas.length > 0 && (
          <p className="mb-2 rounded-md border border-warning-soft bg-warning-tint px-3 py-2 text-xs text-warning-text">
            Tarjetas incompletas que no se guardarán: {avisoIncompletas.join(" y ")}. Complétalas o quítalas.
          </p>
        )}
        {error && (
          <p role="alert" className="mb-2 rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto min-w-0 text-xs text-text-3">
            {aviso ??
              (p.modo === "crear"
                ? `Se enviarán ${envio.modificadas.length} secciones.`
                : envio.modificadas.length
                  ? `Cambios en: ${envio.modificadas.map((s) => NOMBRE_SECCION[s]).join(", ")}`
                  : "Sin cambios por guardar.")}
          </p>
          <Button type="button" variant="outline" disabled={enviando || !hayCambios} onClick={() => enviar(true)}>
            <Eye className="mr-1.5 h-4 w-4" /> Revisar cambios
          </Button>
          <Button type="button" disabled={enviando || !hayCambios} onClick={() => enviar(false)}>
            <Save className="mr-1.5 h-4 w-4" />
            {enviando ? "Enviando…" : p.modo === "crear" ? "Crear negocio" : "Guardar cambios"}
          </Button>
        </div>
      </div>
    </div>
  );
}
