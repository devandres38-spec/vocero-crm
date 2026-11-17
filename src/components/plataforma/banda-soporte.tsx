import { ShieldAlert } from "lucide-react";

/**
 * 069 (US5) — Siempre visible mientras un Super-Admin navega un negocio con
 * acceso de soporte: nadie debe olvidar que está dentro de los datos de otro,
 * ni hasta cuándo.
 */
export function BandaSoporte({
  level,
  expiresAt,
  zona,
}: {
  level: "lectura" | "configuracion";
  expiresAt: Date;
  zona: string;
}) {
  const hora = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit", timeZone: zona }).format(expiresAt);
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-warning-tint px-3 py-1.5 text-center text-[13px] font-medium text-warning-text"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      Acceso de soporte ({level === "lectura" ? "solo lectura" : "configuración"}) — vence a las {hora}. Todo lo que
      hagas queda registrado.
    </div>
  );
}
