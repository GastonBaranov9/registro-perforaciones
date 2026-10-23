import { EstadoPerforacion, reconciliarPerforacion } from './reconciliar-perforacion';
import { tecnicosVacios } from './historicos-form';

describe('Reconciliación de una perforación guardada', () => {
  const estado = (): EstadoPerforacion => ({
    pozo: { id_sitio: 0, id_perforador: 0, id_propietario: null, empresa: 'Enviada' },
    sitio: { departamento: '', localidad: '', latitud: '', longitud: '' }, tecnicos: tecnicosVacios(),
  });

  it('adopta el estado canónico y conserva sólo las ediciones posteriores al snapshot', () => {
    const enviado = estado(), actual = structuredClone(enviado), canonico = structuredClone(enviado);
    actual.pozo.empresa = 'Posterior'; actual.sitio.padron = '123';
    canonico.pozo.id_sitio = 9; canonico.sitio.departamento = 'Salto';
    const resultado = reconciliarPerforacion(enviado, actual, canonico);
    expect(resultado.pozo.empresa).toBe('Posterior'); expect(resultado.pozo.id_sitio).toBe(9);
    expect(resultado.sitio.padron).toBe('123'); expect(resultado.sitio.departamento).toBe('Salto');
    expect(enviado.pozo.empresa).toBe('Enviada');
  });
  it('reconcilia sello canónico y conserva modificaciones o eliminación posteriores al envío', () => {
    const enviado = estado(); enviado.tecnicos.sello_sanitario_constructivo = { desde_m: 1.125, hasta_m: 9.875 };
    const canonico = structuredClone(enviado); canonico.tecnicos.sello_sanitario_constructivo = { desde_m: 2, hasta_m: 8 };
    expect(reconciliarPerforacion(enviado, structuredClone(enviado), canonico).tecnicos.sello_sanitario_constructivo).toEqual({ desde_m: 2, hasta_m: 8 });
    const actual = structuredClone(enviado); actual.tecnicos.sello_sanitario_constructivo = { desde_m: 3, hasta_m: 7 };
    expect(reconciliarPerforacion(enviado, actual, canonico).tecnicos.sello_sanitario_constructivo).toEqual({ desde_m: 3, hasta_m: 7 });
    actual.tecnicos.sello_sanitario_constructivo = null;
    expect(reconciliarPerforacion(enviado, actual, canonico).tecnicos.sello_sanitario_constructivo).toBeNull();
  });

  it('reemplaza IDs por los canónicos aun con filas reordenadas, modificadas, nuevas o eliminadas', () => {
    const enviado = estado();
    enviado.tecnicos.intervalosFiltro = [0, 10].map((desde, i) => ({ idLocal: `local-${i}`, ranuraOriginal: null,
      dato: { id_intervalo_filtro: i + 1, desde_m: desde, hasta_m: desde + 10, diametro_pulg: 4, material_tuberia: 'PVC', ranura_mm: null } }));
    const actual = structuredClone(enviado), canonico = structuredClone(enviado);
    actual.tecnicos.intervalosFiltro.shift();
    actual.tecnicos.intervalosFiltro[0].dato.diametro_pulg = 6;
    actual.tecnicos.intervalosFiltro.push({ idLocal: 'nueva', dato: { desde_m: 20, hasta_m: 30, diametro_pulg: 4, material_tuberia: 'PVC', ranura_mm: 0.5 } });
    canonico.tecnicos.intervalosFiltro.forEach(f => { f.dato.id_intervalo_filtro! += 100; });
    canonico.tecnicos.intervalosFiltro.reverse();
    const resultado = reconciliarPerforacion(enviado, actual, canonico);
    expect(resultado.tecnicos.intervalosFiltro.map(f => f.idLocal)).toEqual(['local-1', 'nueva']);
    expect(resultado.tecnicos.intervalosFiltro[0].dato.id_intervalo_filtro).toBe(102);
    expect(resultado.tecnicos.intervalosFiltro[0].dato.diametro_pulg).toBe(6);
    expect(resultado.tecnicos.intervalosFiltro[0].ranuraOriginal).toBeNull();
    expect(resultado.tecnicos.intervalosFiltro[1].dato.id_intervalo_filtro).toBeUndefined();
  });

  it('conserva litologías legadas con el ID nuevo y cambios posteriores en sus límites', () => {
    const enviado = estado();
    enviado.tecnicos.intervalosLitologicos.push({ idLocal: 'lit', dato: { id_intervalo_litologico: 3, desde_m: 0, hasta_m: 10, material: 'Legado' } });
    const actual = structuredClone(enviado), canonico = structuredClone(enviado);
    actual.tecnicos.intervalosLitologicos[0].dato.hasta_m = 12;
    canonico.tecnicos.intervalosLitologicos[0].dato.id_intervalo_litologico = 33;
    const fila = reconciliarPerforacion(enviado, actual, canonico).tecnicos.intervalosLitologicos[0];
    expect(fila.dato.id_intervalo_litologico).toBe(33); expect(fila.dato.hasta_m).toBe(12);
    expect(fila.dato.id_litologia).toBeUndefined();
  });

  it('no fabrica identidades si la recarga no corresponde a las filas enviadas', () => {
    const enviado = estado(); enviado.tecnicos.nivelesAporte.push({ idLocal: 'a', dato: { profundidad_m: 10 } });
    expect(() => reconciliarPerforacion(enviado, enviado, estado())).toThrow();
  });
});
