import { coordenadasRegistradasValidas, normalizarCoordenadaTexto } from './coordenadas';

describe('coordenadas históricas', () => {
  it('normaliza DMS histórico y variantes con espacios', () => {
    expect(normalizarCoordenadaTexto(`31°26'38.1"S`, 'latitud')).toBe('-31.4439167');
    expect(normalizarCoordenadaTexto(`57°59'11.6"W`, 'longitud')).toBe('-57.9865556');
    expect(normalizarCoordenadaTexto(`34° 54' 31.3" S`, 'latitud')).toBe('-34.9086944');
    expect(normalizarCoordenadaTexto('57 59 11.6 W', 'longitud')).toBe('-57.9865556');
  });

  it('acepta decimales, cero y límites', () => {
    expect(coordenadasRegistradasValidas('-31.4439167', '-57.9865556')).toBeTrue();
    expect(normalizarCoordenadaTexto('0', 'latitud')).toBe('0');
    expect(normalizarCoordenadaTexto(`90°0'0"N`, 'latitud')).toBe('90');
    expect(normalizarCoordenadaTexto(`90°0'0"S`, 'latitud')).toBe('-90');
    expect(normalizarCoordenadaTexto(`180°0'0"E`, 'longitud')).toBe('180');
    expect(normalizarCoordenadaTexto(`180°0'0"W`, 'longitud')).toBe('-180');
  });

  it('rechaza rangos, orientación, signos y texto inválidos', () => {
    for (const valor of [`31°60'0"S`, `31°20'60"S`, `91°0'0"N`, `31°0'0"E`, `-31°26'38.1"N`, '', ' ', 'texto']) {
      expect(normalizarCoordenadaTexto(valor, 'latitud')).toBeNull();
    }
    expect(normalizarCoordenadaTexto(`181°0'0"W`, 'longitud')).toBeNull();
    expect(normalizarCoordenadaTexto(`57°0'0"N`, 'longitud')).toBeNull();
  });
});
