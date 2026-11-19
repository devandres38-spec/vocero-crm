import { exigirModulo } from "@/server/modulos/guardas";

/**
 * 072-B (D16) — La puerta de `/m/diagnostico`: sin el módulo encendido para
 * este negocio, 404 (igual que una ruta que no existe).
 */
export default async function DiagnosticoLayout({ children }: { children: React.ReactNode }) {
  await exigirModulo("diagnostico");
  return children;
}
