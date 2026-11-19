"use client";

import { createContext, useContext, type ReactNode } from "react";
import { t, VOCABULARIO_BASE, type Vocabulario } from "@/verticals/vocabulario";
import type { TerminoVocabulario } from "@/verticals/tipos";

/**
 * 072 (D8) — El vocabulario del Vertical Pack del negocio, para las pantallas
 * de cliente que lo usan (títulos y estados vacíos de Bandeja, Pipeline,
 * Contactos, Citas y el panel de la ficha). Lo pone el `AppShell` con lo que
 * resolvió el servidor; sin proveedor vale el del núcleo, así que una
 * pantalla fuera del Shell (o una prueba) dice lo de siempre.
 */
const VocabularioContext = createContext<Vocabulario>(VOCABULARIO_BASE);

export function VocabularioProvider({ vocabulario, children }: { vocabulario: Vocabulario; children: ReactNode }) {
  return <VocabularioContext.Provider value={vocabulario}>{children}</VocabularioContext.Provider>;
}

/** `const v = useVocabulario(); v("contacto", "varios")` → «Pacientes». */
export function useVocabulario(): (termino: TerminoVocabulario, cuantos?: "uno" | "varios") => string {
  const voc = useContext(VocabularioContext);
  return (termino, cuantos = "uno") => t(voc, termino, cuantos);
}
