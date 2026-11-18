import { SettingsNav } from "@/components/settings/settings-nav";
import { agendaActiva, atribucionActiva, canalActivo } from "@/server/modulos/consulta";
import { getSessionOrNull } from "@/lib/auth/session";

// La bandera se lee en cada petición: si esto se resolviera al construir, la
// imagen quedaría con la agenda apagada para siempre y encenderla en la
// plataforma no haría nada.
export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 069 — Los módulos de ESTA organización (techo ∧ organización).
  const session = await getSessionOrNull();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Configuración</h2>
      </header>
      {/* En móvil las pestañas van arriba (en fila), no como columna lateral. */}
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <SettingsNav
          agenda={agendaActiva(session)}
          atribucion={atribucionActiva(session)}
          instagram={canalActivo(session, "instagram")}
          messenger={canalActivo(session, "messenger")}
          tiktok={canalActivo(session, "tiktok")}
        />
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
