export interface CoordenadasTexto {
  latitud: string;
  longitud: string;
}

export function normalizarCoordenadasTexto(
  latitud: unknown,
  longitud: unknown,
  obligatorias = false,
): CoordenadasTexto | null {
  const latitudTexto = latitud == null ? "" : String(latitud).trim();
  const longitudTexto = longitud == null ? "" : String(longitud).trim();
  if (!latitudTexto && !longitudTexto) return obligatorias ? null : null;
  if (!latitudTexto || !longitudTexto) return null;

  const latitudNumero = Number(latitudTexto);
  const longitudNumero = Number(longitudTexto);
  if (!Number.isFinite(latitudNumero) || !Number.isFinite(longitudNumero)) return null;
  if (latitudNumero < -90 || latitudNumero > 90 || longitudNumero < -180 || longitudNumero > 180) return null;
  return { latitud: latitudTexto, longitud: longitudTexto };
}
