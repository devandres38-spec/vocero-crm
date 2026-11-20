"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SeccionFichaRef } from "@/modulos/catalogo";
import { SECCIONES_FICHA } from "@/modulos/registro-cliente";

/**
 * 072-B (D4, FR-040) — Las secciones que los módulos ENCENDIDOS aportan a la
 * ficha lateral. El `AppShell` pone la lista que resolvió el servidor
 * (`experiencia.modulos.seccionesFicha`); sin proveedor no hay ninguna, así
 * que un negocio sin módulos ve el panel de siempre.
 */
const SeccionesContext = createContext<readonly SeccionFichaRef[]>([]);

export function SeccionesDeModuloProvider({
  secciones,
  children,
}: {
  secciones: readonly SeccionFichaRef[];
  children: ReactNode;
}) {
  return <SeccionesContext.Provider value={secciones}>{children}</SeccionesContext.Provider>;
}

/** Debajo de la ficha del núcleo: una sección por aporte, cada una con su carga diferida. */
export function SeccionesDeModulo({ conversationId }: { conversationId: string }) {
  const secciones = useContext(SeccionesContext);
  if (secciones.length === 0) return null;
  return (
    <>
      {secciones.map((s) => {
        const Seccion = SECCIONES_FICHA[`${s.modulo}.${s.clave}`];
        if (!Seccion) return null;
        return (
          <section key={`${s.modulo}.${s.clave}`} className="border-b p-4" data-modulo={s.modulo}>
            <p className="kicker mb-2">{s.titulo}</p>
            <Seccion conversationId={conversationId} />
          </section>
        );
      })}
    </>
  );
}
