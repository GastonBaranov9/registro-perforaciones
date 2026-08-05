import { formatearFechaCalendario, formatearInstanteComoFecha, normalizarFechaCalendarioInput } from './fechas';
describe('utilidades de fecha', () => {
  it('mantiene DATE como fecha de calendario y la presenta DD/MM/YYYY', () => {
    expect(normalizarFechaCalendarioInput('2026-08-05T00:00:00.000Z')).toBe('2026-08-05');
    expect(formatearFechaCalendario('2026-08-05')).toBe('05/08/2026');
  });
  it('presenta ausencias e inválidos sin Invalid Date', () => {
    expect(formatearFechaCalendario(undefined)).toBe('No especificada');
    expect(formatearFechaCalendario('2026-02-30')).toBe('No especificada');
    expect(formatearInstanteComoFecha('inválido')).toBe('No especificada');
  });
});
