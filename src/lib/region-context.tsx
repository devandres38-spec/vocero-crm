"use client";

import { createContext, useContext, type ReactNode } from "react";
import { REGION_DEFAULTS, type Region } from "@/lib/region";

/**
 * 068 — La región de la instancia en el cliente. El layout del servidor la lee
 * con `getRegion()` y la monta aquí; un componente fuera del proveedor (una
 * prueba, una página suelta) recibe los defaults en vez de romperse.
 */
const RegionContext = createContext<Region>(REGION_DEFAULTS);

export function RegionProvider({ value, children }: { value: Region; children: ReactNode }) {
  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export function useRegion(): Region {
  return useContext(RegionContext);
}
