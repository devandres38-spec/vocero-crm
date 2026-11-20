"use client";

import Link from "next/link";

/** 072-B — Widget `diagnostico.estado` del Inicio: el módulo está vivo. */
export default function WidgetEstado() {
  return (
    <p className="text-sm text-text-2">
      Módulo de diagnóstico activo.{" "}
      <Link href="/m/diagnostico" className="underline">
        Ver detalle
      </Link>
    </p>
  );
}
