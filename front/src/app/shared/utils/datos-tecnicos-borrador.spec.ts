import { DatosTecnicosBorrador } from '../types/schemas';
import { ordenarDatosTecnicos, sugerirInicioSiguienteIntervalo, validarDatosTecnicos } from './datos-tecnicos-borrador';

function datos(): DatosTecnicosBorrador {
  return {
    intervalosLitologicos: [
      { idLocal: 'b', dato: { desde_m: 10, hasta_m: 20, material: 'Roca' } },
      { idLocal: 'a', dato: { desde_m: 0, hasta_m: 5, material: 'Arena' } },
    ],
    intervalosDiametro: [],
    nivelesAporte: [{ idLocal: 'c', dato: { profundidad_m: 15 } }],
  };
}

describe('datos técnicos en memoria', () => {
  it('ordena sin reemplazar identificadores locales por IDs persistidos', () => {
    const ordenados = ordenarDatosTecnicos(datos());
    expect(ordenados.intervalosLitologicos.map((item) => item.idLocal)).toEqual(['a', 'b']);
  });

  it('valida profundidad, rangos y solapamientos sin eliminar filas', () => {
    const borrador = datos();
    borrador.intervalosLitologicos[1].dato.desde_m = 4;
    borrador.intervalosLitologicos[1].dato.hasta_m = 25;
    borrador.nivelesAporte[0].dato.profundidad_m = 30;
    const errores = validarDatosTecnicos(borrador, 20);
    expect(errores.some((error) => error.includes('solapan'))).toBeTrue();
    expect(errores.filter((error) => error.includes('excede')).length).toBe(2);
    expect(borrador.intervalosLitologicos.length).toBe(2);
  });
});

describe('continuidad sugerida de intervalos', () => {
  it('inicia en cero y continúa desde el último hasta lógico', () => {
    expect(sugerirInicioSiguienteIntervalo([], 30)).toEqual({ permitido: true, desde_m: 0 });
    expect(sugerirInicioSiguienteIntervalo([{ desde_m: 10, hasta_m: 20 }, { desde_m: 0, hasta_m: 10 }], 30))
      .toEqual({ permitido: true, desde_m: 20 });
  });
  it('conserva huecos y cambia al eliminar el último intervalo', () => {
    const intervalos = [{ desde_m: 0, hasta_m: 5 }, { desde_m: 10, hasta_m: 15 }];
    expect(sugerirInicioSiguienteIntervalo(intervalos, 30)).toEqual({ permitido: true, desde_m: 15 });
    expect(sugerirInicioSiguienteIntervalo(intervalos.slice(0, 1), 30)).toEqual({ permitido: true, desde_m: 5 });
  });
  it('no deduce con solapamiento, rango inválido o profundidad completa', () => {
    expect(sugerirInicioSiguienteIntervalo([{ desde_m: 0, hasta_m: 10 }, { desde_m: 9, hasta_m: 12 }], 30).permitido).toBeFalse();
    expect(sugerirInicioSiguienteIntervalo([{ desde_m: 2, hasta_m: 2 }], 30).permitido).toBeFalse();
    expect(sugerirInicioSiguienteIntervalo([{ desde_m: 0, hasta_m: 30 }], 30).permitido).toBeFalse();
  });
});
