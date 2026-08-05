export interface CoordenadasMapa { latitud: number; longitud: number }
export type ResultadoMapa =
  | { estado: "disponible"; bytes: Uint8Array; tipo: "image/png" | "image/jpeg"; atribucion: string }
  | { estado: "no-disponible"; motivo: string };

export interface ConfiguracionMapa {
  plantillaUrl?: string;
  hostPermitido?: string;
  clave?: string;
  atribucion?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export function leerCoordenadas(latitud: string | null, longitud: string | null): CoordenadasMapa | null {
  if (!latitud?.trim() || !longitud?.trim()) return null;
  const coordenadas = { latitud: Number(latitud), longitud: Number(longitud) };
  return Number.isFinite(coordenadas.latitud) && Number.isFinite(coordenadas.longitud)
    && coordenadas.latitud >= -90 && coordenadas.latitud <= 90
    && coordenadas.longitud >= -180 && coordenadas.longitud <= 180 ? coordenadas : null;
}

export function configuracionMapaDesdeEntorno(env: NodeJS.ProcessEnv = process.env): ConfiguracionMapa {
  return {
    plantillaUrl: env.PDF_MAP_STATIC_URL_TEMPLATE,
    hostPermitido: env.PDF_MAP_ALLOWED_HOST,
    clave: env.PDF_MAP_STATIC_API_KEY,
    atribucion: env.PDF_MAP_ATTRIBUTION,
  };
}

export async function obtenerMapaEstatico(
  coordenadas: CoordenadasMapa,
  configuracion: ConfiguracionMapa,
  fetchImpl: typeof fetch = fetch,
): Promise<ResultadoMapa> {
  if (!configuracion.plantillaUrl || !configuracion.hostPermitido || !configuracion.atribucion?.trim()) {
    return { estado: "no-disponible", motivo: "Proveedor no configurado" };
  }
  const valor = (numero: number) => encodeURIComponent(numero.toFixed(6));
  const urlTexto = configuracion.plantillaUrl
    .replaceAll("{latitud}", valor(coordenadas.latitud))
    .replaceAll("{longitud}", valor(coordenadas.longitud))
    .replaceAll("{apiKey}", encodeURIComponent(configuracion.clave ?? ""));
  let url: URL;
  try { url = new URL(urlTexto); } catch { return { estado: "no-disponible", motivo: "URL inválida" }; }
  if (url.protocol !== "https:" || url.hostname !== configuracion.hostPermitido || url.username || url.password) {
    return { estado: "no-disponible", motivo: "Proveedor no permitido" };
  }
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), configuracion.timeoutMs ?? 3_000);
  try {
    const respuesta = await fetchImpl(url, { redirect: "manual", signal: controlador.signal });
    if (!respuesta.ok || respuesta.status >= 300) return { estado: "no-disponible", motivo: "Respuesta no válida" };
    const tipo = respuesta.headers.get("content-type")?.split(";")[0];
    if (tipo !== "image/png" && tipo !== "image/jpeg") return { estado: "no-disponible", motivo: "Contenido no admitido" };
    const maxBytes = configuracion.maxBytes ?? 2_000_000;
    const anunciado = Number(respuesta.headers.get("content-length"));
    if (Number.isFinite(anunciado) && anunciado > maxBytes) return { estado: "no-disponible", motivo: "Imagen excesiva" };
    const bytes = new Uint8Array(await respuesta.arrayBuffer());
    if (bytes.length > maxBytes) return { estado: "no-disponible", motivo: "Imagen excesiva" };
    return { estado: "disponible", bytes, tipo, atribucion: configuracion.atribucion };
  } catch { return { estado: "no-disponible", motivo: "Proveedor no disponible" }; }
  finally { clearTimeout(timeout); }
}
