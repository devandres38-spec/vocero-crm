/** 069 — Error del aprovisionamiento: código estable + ruta exacta del problema. */
export class BlueprintError extends Error {
  constructor(
    public code: string,
    public status: number = 422,
    public issues: { path: string; message: string }[] = []
  ) {
    super(code);
    this.name = "BlueprintError";
  }
}
