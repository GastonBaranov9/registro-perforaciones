export function normalizarFechaCalendarioInput(valor: string | null | undefined): string {
  if (!valor) return '';
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  return partes && esFechaValida(+partes[1], +partes[2], +partes[3]) ? `${partes[1]}-${partes[2]}-${partes[3]}` : '';
}
export function formatearFechaCalendario(valor: string | null | undefined): string {
  const normalizada = normalizarFechaCalendarioInput(valor);
  if (!normalizada) return 'No especificada';
  const [anio, mes, dia] = normalizada.split('-');
  return `${dia}/${mes}/${anio}`;
}
export function formatearInstanteComoFecha(valor: string | null | undefined): string {
  if (!valor) return 'No especificada';
  const instante = new Date(valor);
  if (!Number.isFinite(instante.getTime())) return 'No especificada';
  return new Intl.DateTimeFormat('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Montevideo' }).format(instante);
}
function esFechaValida(anio: number, mes: number, dia: number) {
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}
