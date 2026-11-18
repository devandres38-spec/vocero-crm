"use client";

import { Input } from "@/components/ui/input";
import { REGIONES_SUGERIDAS } from "@/lib/region";
import { sugerirSlug, type FormBlueprint, type ModoFormulario } from "@/lib/platform/formulario-blueprint";
import { Campo, Seccion, SelectGuiado, type Actualizar } from "./controles";

/** Únicos, en el orden de las regiones sugeridas (Colombia primero). */
const unicos = (xs: string[]) => [...new Set(xs)];
const PAISES = REGIONES_SUGERIDAS.map((r) => ({ value: r.country, label: `${r.label} (${r.country})` }));
const LOCALES = unicos(REGIONES_SUGERIDAS.map((r) => r.locale)).map((l) => ({ value: l, label: l }));
export const ZONAS = unicos(REGIONES_SUGERIDAS.map((r) => r.timezone)).map((z) => ({ value: z, label: z.replace(/_/g, " ") }));

/** Pestaña «Negocio y Región»: nombre, dirección, región y (al crear) el dueño. */
export function PestanaNegocio({
  f,
  upd,
  modo,
  dominio,
}: {
  f: FormBlueprint;
  upd: Actualizar;
  modo: ModoFormulario;
  dominio: string | null;
}) {
  const slug = f.organization.slugTocado ? f.organization.slug : sugerirSlug(f.organization.name);

  /** Elegir un país sugerido completa idioma, zona y moneda de una vez. */
  function elegirPais(country: string) {
    const r = REGIONES_SUGERIDAS.find((x) => x.country === country);
    if (!r) {
      upd("region", { country });
      return;
    }
    upd("region", { country: r.country, locale: r.locale, timezone: r.timezone });
    upd("brand", { currency: r.currency });
    upd("agenda", { timezone: r.timezone });
  }

  return (
    <div className="space-y-4">
      <Seccion titulo="El negocio">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombre" className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                value={f.organization.name}
                maxLength={80}
                placeholder="Clínica Sol"
                onChange={(e) => upd("organization", { name: e.target.value })}
              />
            )}
          </Campo>
          <Campo
            etiqueta={modo === "crear" ? "Dirección (no se puede cambiar después)" : "Dirección"}
            className="sm:col-span-2"
            ayuda={
              <span className="font-mono">
                {slug || "tu-negocio"}.{dominio ?? "<PLATFORM_BASE_DOMAIN>"}
              </span>
            }
          >
            {(id) => (
              <Input
                id={id}
                value={slug}
                maxLength={40}
                disabled={modo === "editar"}
                onChange={(e) => upd("organization", { slug: e.target.value.toLowerCase(), slugTocado: true })}
              />
            )}
          </Campo>
        </div>
      </Seccion>

      <Seccion
        titulo="Región"
        descripcion="Formato de fechas, números y moneda, y la zona en que se cuentan los días. Elegir el país completa el resto."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo etiqueta="País">
            {(id) => (
              <SelectGuiado id={id} valor={f.region.country} opciones={PAISES} onChange={elegirPais} placeholderOtro="Código de 2 letras (p. ej. BO)" />
            )}
          </Campo>
          <Campo etiqueta="Idioma y formato">
            {(id) => (
              <SelectGuiado
                id={id}
                valor={f.region.locale}
                opciones={LOCALES}
                onChange={(v) => upd("region", { locale: v })}
                placeholderOtro="p. ej. es-BO"
              />
            )}
          </Campo>
          <Campo etiqueta="Zona horaria">
            {(id) => (
              <SelectGuiado
                id={id}
                valor={f.region.timezone}
                opciones={ZONAS}
                onChange={(v) => upd("region", { timezone: v })}
                placeholderOtro="IANA, p. ej. America/La_Paz"
              />
            )}
          </Campo>
        </div>
      </Seccion>

      {modo === "crear" && (
        <Seccion
          titulo="Dueño del negocio"
          descripcion="Opcional. Se genera un enlace de invitación de un solo uso (7 días). No se envía ningún correo: lo copias tú."
        >
          <Campo etiqueta="Correo del dueño">
            {(id) => (
              <Input id={id} type="email" value={f.owner.email} onChange={(e) => upd("owner", { email: e.target.value })} />
            )}
          </Campo>
        </Seccion>
      )}
    </div>
  );
}
