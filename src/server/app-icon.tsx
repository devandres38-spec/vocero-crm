import { ImageResponse } from "next/og";
import { DEFAULT_BRANDING, resolveAccentSet, type Branding } from "@/lib/branding";
import {
  BRAND_CYAN_ON_TILE,
  BRAND_MARK_BODY,
  BRAND_MARK_STROKE,
  BRAND_MARK_TAIL,
  isVoceroName,
} from "@/lib/brand";
import { FAVICON_ASSET, faviconInitial } from "@/lib/favicon";
import type { AppIconPurpose, AppIconSize } from "@/lib/pwa";
import { marcaDeLaPeticion } from "@/server/marca-de-la-peticion";
import { readMediaFile } from "@/server/whatsapp/media";

/**
 * 048 — El icono PNG de la app instalada.
 *
 * Chrome necesita PNG de 192 y 512 px para ofrecer «Instalar», y el iPhone
 * uno de 180 para «Agregar a inicio». El favicon es SVG (028) y no sirve
 * ahí. Se dibuja con `ImageResponse` de `next/og`, que viene dentro de Next con
 * su propia fuente: sin librerías de imagen en el núcleo y sin red.
 *
 * Con logo subido (PNG, JPEG o SVG) va el logo sobre el color de marca. Un ICO
 * o un WEBP no los sabe dibujar `ImageResponse`: con esos, como sin logo, va
 * lo mismo que la pestaña (la V de Vocero o la inicial sobre el acento).
 */

/** Los formatos que `ImageResponse` dibuja dentro de un `<img>`. */
const DIBUJABLES = new Set(["image/png", "image/jpeg", "image/svg+xml"]);

export async function appIconResponse(
  size: AppIconSize,
  purpose: AppIconPurpose
): Promise<ImageResponse> {
  const ctx = await marcaDeLaPeticion().catch(() => null);
  const branding = ctx?.branding ?? DEFAULT_BRANDING;
  const logo = await logoSubido(ctx?.organizationId ?? null, branding);
  return new ImageResponse(dibujo(branding, logo, size, purpose), {
    width: size,
    height: size,
  });
}

async function logoSubido(
  organizationId: string | null,
  branding: Branding
): Promise<string | null> {
  if (!organizationId || !branding.favicon) return null;
  if (!DIBUJABLES.has(branding.favicon.mime)) return null;
  try {
    const buf = await readMediaFile(organizationId, FAVICON_ASSET);
    return `data:${branding.favicon.mime};base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    // El archivo se perdió: se dibuja el generado, como hace el favicon.
    return null;
  }
}

function dibujo(
  branding: Branding,
  logo: string | null,
  size: AppIconSize,
  purpose: AppIconPurpose
) {
  const { accent, hover, fg } = resolveAccentSet(branding.accent);
  // El iPhone recorta él mismo las esquinas y Android recorta el maskable con
  // su forma: los dos van a sangre. El `any` de 192/512 lleva su mosaico
  // redondeado, como el favicon.
  const aSangre = purpose === "maskable" || size === 180;
  // Zona segura del maskable: lo importante dentro del 60 % central.
  const contenido = Math.round(size * (purpose === "maskable" ? 0.6 : 0.72));
  const vocero = !logo && isVoceroName(branding.name);
  const fondo = vocero
    ? `linear-gradient(135deg, ${accent}, ${hover})`
    : logo
      ? "#ffffff"
      : accent;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: fondo,
        // Fuera del radio el PNG queda transparente.
        borderRadius: aSangre ? 0 : Math.round(size * 0.22),
      }}
    >
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- ImageResponse dibuja <img>, no next/image
        <img src={logo} width={contenido} height={contenido} style={{ objectFit: "contain" }} alt="" />
      ) : vocero ? (
        // eslint-disable-next-line @next/next/no-img-element -- ImageResponse dibuja <img>, no next/image
        <img src={marcaVocero()} width={contenido} height={contenido} alt="" />
      ) : (
        <span
          style={{
            color: fg,
            fontSize: Math.round(contenido * 0.78),
            lineHeight: 1,
            // La fuente que trae `next/og` es solo la regular: el trazo se
            // engruesa con sombras del mismo color, como la inicial del favicon.
            textShadow: grosor(fg, size),
          }}
        >
          {faviconInitial(branding.name)}
        </span>
      )}
    </div>
  );
}

/** Sombras en 8 direcciones que engruesan la letra ~4 % del lado. */
function grosor(color: string, size: number): string {
  const t = Math.max(1, Math.round(size * 0.012));
  const pasos: [number, number][] = [
    [t, 0], [-t, 0], [0, t], [0, -t], [t, t], [-t, -t], [t, -t], [-t, t],
  ];
  return pasos.map(([x, y]) => `${x}px ${y}px 0 ${color}`).join(", ");
}

/** La V de Vocero sola, sin mosaico: el mosaico lo pone el contenedor. */
function marcaVocero(): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="240" height="240">`,
    `<g fill="none" stroke-linecap="round">`,
    `<path d="${BRAND_MARK_BODY}" stroke="#ffffff" stroke-width="${BRAND_MARK_STROKE}"/>`,
    `<path d="${BRAND_MARK_TAIL}" stroke="${BRAND_CYAN_ON_TILE}" stroke-width="${BRAND_MARK_STROKE}"/>`,
    `</g></svg>`,
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
