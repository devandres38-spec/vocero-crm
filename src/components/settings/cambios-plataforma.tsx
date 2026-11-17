import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CambioPlataforma } from "@/server/platform/cambios";

const ACCION: Record<string, string> = {
  organizacion_creada: "Creó el negocio",
  blueprint_aplicado: "Cambió la configuración",
  organizacion_suspendida: "Suspendió el negocio",
  organizacion_reactivada: "Reactivó el negocio",
  invitacion_creada: "Generó una invitación",
  invitacion_revocada: "Revocó una invitación",
  soporte_otorgado: "Abrió un acceso de soporte",
  soporte_revocado: "Cerró un acceso de soporte",
};

const SECCION: Record<string, string> = {
  organization: "nombre",
  region: "región",
  brand: "marca",
  modules: "módulos",
  pipeline: "pipeline",
  agent: "agente",
  knowledge: "conocimiento",
  agenda: "agenda",
  owner: "invitación del dueño",
};

const VIA: Record<string, string> = { sesion: "panel", api: "API", mcp: "asistente de IA (MCP)" };

/** 069 (D12) — Transparencia: lo que la plataforma cambió en este negocio. */
export function CambiosPlataforma({ cambios }: { cambios: CambioPlataforma[] }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Cambios de la plataforma</CardTitle>
        <CardDescription>
          Lo que la agencia que administra la plataforma hizo en tu negocio. Nunca incluye leer tus conversaciones
          sin un acceso de soporte, que también aparece aquí.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {cambios.length === 0 ? (
          <p className="text-sm text-text-3">Ningún cambio todavía.</p>
        ) : (
          <ul className="divide-y text-sm">
            {cambios.map((c) => (
              <li key={c.id} className="py-2">
                <p>
                  <span className="font-medium">{ACCION[c.action] ?? c.action}</span>
                  {c.sections.length > 0 && (
                    <span className="text-text-2"> · {c.sections.map((s) => SECCION[s] ?? s).join(", ")}</span>
                  )}
                </p>
                <p className="text-xs text-text-3">
                  {c.actor} · por {VIA[c.via] ?? c.via} ·{" "}
                  {new Date(c.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
