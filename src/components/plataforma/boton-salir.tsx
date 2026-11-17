"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

/** 069 — Cerrar sesión desde las pantallas sin organización. */
export function BotonSalir({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const router = useRouter();
  return (
    <Button
      variant={variant}
      onClick={async () => {
        await signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      Cerrar sesión
    </Button>
  );
}
