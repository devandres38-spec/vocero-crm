import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * 068 — Utilidades de los guardarraíles que escanean `src/`: los archivos de
 * código y su texto SIN comentarios (un comentario puede contar la historia
 * de Vocero o de México; lo que no puede es mostrárselo al usuario).
 */

export function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivosTs(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Ruta relativa a la raíz del repo, con `/`. */
export function rel(file: string): string {
  return relative(process.cwd(), file).split(sep).join("/");
}

/**
 * El código sin comentarios de bloque (incluidos los `{/* … *\/}` de JSX) ni
 * de línea. Un `//` dentro de una URL (`https://`) se respeta.
 */
export function sinComentarios(source: string): string {
  return source
    // Conserva los saltos de línea para que los números de línea sigan valiendo.
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ""))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

export function leerSinComentarios(file: string): string {
  return sinComentarios(readFileSync(file, "utf8"));
}
