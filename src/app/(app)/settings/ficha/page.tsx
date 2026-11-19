import { FichaCamposClient } from "@/components/settings/ficha-campos-client";

export const dynamic = "force-dynamic";

/** 072 (FR-013) — Ajustes → Ficha: los datos que este negocio quiere de cada cliente. */
export default function FichaSettingsPage() {
  return <FichaCamposClient />;
}
