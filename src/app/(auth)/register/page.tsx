import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * 074 — Sin registro público: los negocios y sus dueños los crea Aliantis
 * (`pnpm negocio:alta`), y las cuentas de equipo, el dueño desde Ajustes →
 * Equipo. La dirección se conserva para quien la tenga guardada.
 */
export default function RegisterPage() {
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Las cuentas las crea Aliantis</CardTitle>
        <CardDescription>
          Si eres parte de un negocio, pide acceso a su dueño: él crea las
          cuentas de su equipo desde Ajustes → Equipo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-center text-sm text-muted-foreground">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Inicia sesión
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
