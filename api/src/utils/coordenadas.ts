export interface CoordenadasTexto {
  latitud: string;
  longitud: string;
}

export type EjeCoordenada = "latitud" | "longitud";

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const DMS = /^([+-]?)(\d{1,3})\s*(?:°|\s)\s*(\d{1,2})\s*(?:['’′]|\s)\s*(\d{1,2}(?:\.\d+)?)\s*(?:["”″])?\s*([NSEW])$/i;

export function normalizarCoordenadaTexto(valor: unknown, eje: EjeCoordenada): string | null {
  const texto = valor == null ? "" : String(valor).trim();
  if (!texto) return null;

  if (DECIMAL.test(texto)) {
    const numero = Number(texto);
    const limite = eje === "latitud" ? 90 : 180;
    if (!Number.isFinite(numero) || numero < -limite || numero > limite) return null;
    return Object.is(numero, -0) || numero === 0 ? "0" : texto;
  }

  const partes = DMS.exec(texto);
  if (!partes) return null;
  const [, signoExplicito, gradosTexto, minutosTexto, segundosTexto, orientacionCruda] = partes;
  // En DMS la orientación define el signo. Todo signo explícito se rechaza para evitar
  // contradicciones o dobles signos silenciosos.
  if (signoExplicito) return null;
  const orientacion = orientacionCruda.toUpperCase();
  if (eje === "latitud" ? !["N", "S"].includes(orientacion) : !["E", "W"].includes(orientacion)) return null;

  const grados = Number(gradosTexto);
  const minutos = Number(minutosTexto);
  const segundos = Number(segundosTexto);
  const limite = eje === "latitud" ? 90 : 180;
  if (grados > limite || minutos >= 60 || segundos >= 60) return null;
  let decimal = grados + minutos / 60 + segundos / 3600;
  if (decimal > limite) return null;
  if (orientacion === "S" || orientacion === "W") decimal *= -1;
  if (decimal === 0) return "0";
  return decimal.toFixed(7).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
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

  const latitudNormalizada = normalizarCoordenadaTexto(latitudTexto, "latitud");
  const longitudNormalizada = normalizarCoordenadaTexto(longitudTexto, "longitud");
  if (latitudNormalizada === null || longitudNormalizada === null) return null;
  return { latitud: latitudNormalizada, longitud: longitudNormalizada };
}
