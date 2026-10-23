import { DatosTecnicosBorrador, NuevoPozo, SitioBody } from '../types/schemas';
import { huellaFormulario, huellaPropietario } from './estado-formulario-perforacion';

describe('Huella del formulario y semántica de persistencia', () => {
  const pozo: NuevoPozo = { id_propietario: null, id_perforador: 0, id_sitio: 0 };
  const sitio: SitioBody = { departamento: '', localidad: '', latitud: '', longitud: '' };
  const tecnicos: DatosTecnicosBorrador = { intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] };

  it('histórico equipara ausente, null, vacío y whitespace-only sin mutar el formulario', () => {
    const base = huellaFormulario(pozo, sitio, tecnicos, true);
    for (const empresa of [undefined, null, '', ' \t\n ']) {
      const datos = { ...pozo, empresa } as NuevoPozo;
      expect(huellaFormulario(datos, { ...sitio, padron: '  ', latitud: '\t' }, tecnicos, true)).toBe(base);
      expect(datos.empresa).toBe(empresa as never);
    }
  });

  it('alta normal sólo ignora blancos en campos normalizados por su persistencia', () => {
    const base = huellaFormulario(pozo, sitio, tecnicos);
    expect(huellaFormulario({ ...pozo, propietario_provisional: '  ' }, { ...sitio, localidad: '\t', padron: ' ' }, tecnicos)).toBe(base);
    expect(huellaFormulario({ ...pozo, empresa: ' ' }, sitio, tecnicos)).not.toBe(base);
    expect(huellaFormulario(pozo, { ...sitio, latitud: ' ' }, tecnicos)).not.toBe(base);
  });

  it('no elimina espacios de textos significativos ni confunde cero con ausencia', () => {
    expect(huellaFormulario({ ...pozo, empresa: ' A ' }, sitio, tecnicos))
      .not.toBe(huellaFormulario({ ...pozo, empresa: 'A' }, sitio, tecnicos));
    expect(huellaFormulario({ ...pozo, nivel_estatico_m: 0 }, sitio, tecnicos, true))
      .not.toBe(huellaFormulario(pozo, sitio, tecnicos, true));
  });

  it('propietarios compara el trim persistido y conserva espacios internos', () => {
    expect(huellaPropietario({ nombre: ' Ana ', telefono: ' \t ' })).toBe(huellaPropietario({ nombre: 'Ana', telefono: null }));
    expect(huellaPropietario({ nombre: 'Ana  Pérez' })).not.toBe(huellaPropietario({ nombre: 'Ana Pérez' }));
  });
});
