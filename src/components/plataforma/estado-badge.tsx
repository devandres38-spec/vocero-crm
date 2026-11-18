import { Badge } from "@/components/ui/badge";

/** 069 — Estado de una organización en el panel de la plataforma. */
export function EstadoBadge({ status }: { status: "activa" | "suspendida" }) {
  return status === "activa" ? (
    <Badge variant="success">Activa</Badge>
  ) : (
    <Badge variant="destructive">Suspendida</Badge>
  );
}
