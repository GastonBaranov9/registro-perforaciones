export function formatearFechaCalendario(valor: string | Date | null | undefined): string {
  if (valor == null || valor === "") return "No especificada";
  if (valor instanceof Date) {
    if (!Number.isFinite(valor.getTime())) return "No especificada";
    return `${dos(valor.getUTCDate())}/${dos(valor.getUTCMonth() + 1)}/${valor.getUTCFullYear()}`;
  }
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (!partes || !esFechaValida(+partes[1], +partes[2], +partes[3])) return "No especificada";
  return `${partes[3]}/${partes[2]}/${partes[1]}`;
}
function dos(valor: number) { return String(valor).padStart(2, "0"); }
function esFechaValida(anio: number, mes: number, dia: number) {
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}
