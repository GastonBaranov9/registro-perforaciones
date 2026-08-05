import { DatosTecnicosBorrador } from '../types/schemas';
import { ordenarDatosTecnicos, validarDatosTecnicos } from './datos-tecnicos-borrador';

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
