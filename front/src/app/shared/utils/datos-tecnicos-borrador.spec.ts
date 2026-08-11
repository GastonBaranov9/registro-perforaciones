import { DatosTecnicosBorrador } from '../types/schemas';
import { analizarCoberturaIntervalos, ordenarDatosTecnicos, sugerirInicioSiguienteIntervalo, sugerirIntervaloLitologico, validarDatosTecnicos } from './datos-tecnicos-borrador';

function datos(): DatosTecnicosBorrador {
  return {
    intervalosLitologicos: [
      { idLocal: 'b', dato: { desde_m: 10, hasta_m: 20, material: 'Roca', id_litologia: 2 } },
      { idLocal: 'a', dato: { desde_m: 0, hasta_m: 5, material: 'Arena', id_litologia: 1 } },
    ],
    intervalosDiametro: [],
    intervalosFiltro: [],
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

  it('mantiene el contrato histórico que permite guardar perfiles con huecos', () => {
    expect(validarDatosTecnicos(datos(), 20)).toEqual([]);
  });
});

describe('litologias nuevas e historicas', () => {
  it('exige seleccion en intervalos nuevos y la recupera al elegir una activa', () => {
    const borrador = datos();
    borrador.intervalosLitologicos = [
      { idLocal: 'nuevo', dato: { desde_m: 0, hasta_m: 5, material: '' } },
    ];
    expect(validarDatosTecnicos(borrador, 20).join(' ')).toContain('selecciona una');
    borrador.intervalosLitologicos[0].dato.id_litologia = 4;
    borrador.intervalosLitologicos[0].dato.material = 'Basalto';
    expect(validarDatosTecnicos(borrador, 20)).toEqual([]);
    borrador.intervalosLitologicos[0].dato.id_litologia = undefined;
    borrador.intervalosLitologicos[0].dato.material = '';
    expect(validarDatosTecnicos(borrador, 20).length).toBeGreaterThan(0);
  });

  it('permite historico inactivo y historico sin FK con material', () => {
    const borrador = datos();
    borrador.intervalosLitologicos = [
      { idLocal: 'inactivo', dato: { id_intervalo_litologico: 10, desde_m: 0, hasta_m: 5, material: 'Arcilla historica', id_litologia: 99 } },
      { idLocal: 'sin-fk', dato: { id_intervalo_litologico: 11, desde_m: 5, hasta_m: 10, material: 'Material legado' } },
    ];
    expect(validarDatosTecnicos(borrador, 20)).toEqual([]);
    borrador.intervalosLitologicos[1].dato.id_litologia = 4;
    expect(validarDatosTecnicos(borrador, 20)).toEqual([]);
  });
});

describe('cobertura del perfil litológico', () => {
  it('distingue cobertura completa del simple alcance del último intervalo', () => {
    const completo = [{ desde_m: 0, hasta_m: 10 }, { desde_m: 10, hasta_m: 40 }, { desde_m: 40, hasta_m: 100 }];
    expect(analizarCoberturaIntervalos(100, completo)).toEqual({ huecos: [], solapamientos: [], invalidos: [], coberturaCompleta: true });

    const editado = [{ desde_m: 0, hasta_m: 5 }, { desde_m: 10, hasta_m: 40 }, { desde_m: 40, hasta_m: 100 }];
    expect(analizarCoberturaIntervalos(100, editado).huecos).toEqual([{ desde_m: 5, hasta_m: 10 }]);
    expect(sugerirIntervaloLitologico(editado, 100)).toEqual({ permitido: true, desde_m: 5, hasta_m: 10 });
    expect(analizarCoberturaIntervalos(100, [...editado, { desde_m: 5, hasta_m: 10 }]).coberturaCompleta).toBeTrue();
  });

  it('detecta huecos iniciales, finales y múltiples', () => {
    expect(analizarCoberturaIntervalos(100, [{ desde_m: 5, hasta_m: 20 }, { desde_m: 20, hasta_m: 100 }]).huecos)
      .toEqual([{ desde_m: 0, hasta_m: 5 }]);
    expect(analizarCoberturaIntervalos(100, [{ desde_m: 0, hasta_m: 20 }, { desde_m: 20, hasta_m: 80 }]).huecos)
      .toEqual([{ desde_m: 80, hasta_m: 100 }]);
    expect(analizarCoberturaIntervalos(100, [{ desde_m: 0, hasta_m: 20 }, { desde_m: 30, hasta_m: 50 }, { desde_m: 70, hasta_m: 100 }]).huecos)
      .toEqual([{ desde_m: 20, hasta_m: 30 }, { desde_m: 50, hasta_m: 70 }]);
  });

  it('ordena una copia, detecta solapamientos y no muta la entrada', () => {
    const desordenados = [{ desde_m: 40, hasta_m: 100 }, { desde_m: 10, hasta_m: 40 }, { desde_m: 0, hasta_m: 5 }];
    const original = desordenados.map((intervalo) => ({ ...intervalo }));
    expect(analizarCoberturaIntervalos(100, desordenados).huecos).toEqual([{ desde_m: 5, hasta_m: 10 }]);
    expect(desordenados).toEqual(original);
    expect(analizarCoberturaIntervalos(100, [{ desde_m: 0, hasta_m: 20 }, { desde_m: 5, hasta_m: 10 }]).solapamientos)
      .toEqual([{ desde_m: 5, hasta_m: 10 }]);
  });

  it('rechaza rangos inválidos antes de sugerir otro intervalo', () => {
    expect(sugerirIntervaloLitologico([{ desde_m: 10, hasta_m: 10 }], 100).permitido).toBeFalse();
    expect(sugerirIntervaloLitologico([{ desde_m: 0, hasta_m: 10 }, { desde_m: 5, hasta_m: 20 }], 100).permitido).toBeFalse();
  });

  it('conserva la edición previa a definir la profundidad final', () => {
    expect(sugerirIntervaloLitologico([], undefined)).toEqual({ permitido: true, desde_m: 0, hasta_m: Number.NaN });
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

describe('tubería y filtros', () => {
  it('valida materiales y solapamiento de filtros independientemente de tubería', () => {
    const borrador = datos();
    borrador.intervalosDiametro = [{idLocal:'t',dato:{desde_m:0,hasta_m:20,diametro_pulg:8,material_tuberia:'PVC'}}];
    borrador.intervalosFiltro = [{idLocal:'f1',dato:{desde_m:5,hasta_m:10,diametro_pulg:6,material_tuberia:'Acero'}},{idLocal:'f2',dato:{desde_m:9,hasta_m:12,diametro_pulg:6,material_tuberia:'PVC'}}];
    expect(validarDatosTecnicos(borrador, 20).some((x) => x.includes('solapan'))).toBeTrue();
    borrador.intervalosFiltro[1].dato.desde_m = 10;
    expect(validarDatosTecnicos(borrador, 20)).toEqual([]);
    expect(sugerirInicioSiguienteIntervalo(borrador.intervalosFiltro.map((x) => x.dato),20)).toEqual({permitido:true,desde_m:12});
  });
});
