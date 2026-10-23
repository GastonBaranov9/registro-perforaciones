import { opcionTuberia, seleccionarTuberia } from './intervalo-diametro';
import { tecnicosPersistidos } from './tecnicos-persistidos';
import { validarDatosTecnicos } from './datos-tecnicos-borrador';
import { IntervaloDiametroPerforacionBody } from '../types/schemas';

describe('Intervalos sin cañería', () => {
  it('alterna PVC, abierto y Acero sin perder medidas ni guardar material incompatible', () => {
    const dato:IntervaloDiametroPerforacionBody={desde_m:20,hasta_m:50,diametro_pulg:8,material_tuberia:'PVC'};
    seleccionarTuberia(dato,'sin_tuberia');
    expect(dato).toEqual({desde_m:20,hasta_m:50,diametro_pulg:8,material_tuberia:null,sin_tuberia:true});
    expect(opcionTuberia(dato)).toBe('sin_tuberia');
    seleccionarTuberia(dato,'Acero');
    expect(dato.sin_tuberia).toBeFalse();expect(dato.material_tuberia).toBe('Acero');
  });
  it('reconstruye edición sin confundir material desconocido con perforación abierta', () => {
    const comun={id_pozo:1,desde_m:0,hasta_m:20,diametro_pulg:8,material_tuberia:null};
    const datos=tecnicosPersistidos([],[
      {...comun,id_intervalo_diametro_perforacion:1},
      {...comun,id_intervalo_diametro_perforacion:2,desde_m:20,hasta_m:50,sin_tuberia:true},
    ],[],[]);
    expect(datos.intervalosDiametro[0].dato.sin_tuberia).toBeUndefined();
    expect(opcionTuberia(datos.intervalosDiametro[0].dato)).toBe('');
    expect(opcionTuberia(datos.intervalosDiametro[1].dato)).toBe('sin_tuberia');
    expect(datos.intervalosDiametro[1].dato.material_tuberia).toBeNull();
  });
  it('acepta abierto y rechaza materiales contradictorios y filtros que se superponen', () => {
    const datos=tecnicosPersistidos([],[{id_pozo:1,id_intervalo_diametro_perforacion:1,desde_m:20,hasta_m:50,diametro_pulg:8,material_tuberia:null,sin_tuberia:true}],[],[]);
    expect(validarDatosTecnicos(datos,50)).toEqual([]);
    datos.intervalosDiametro[0].dato.material_tuberia='PVC';
    expect(validarDatosTecnicos(datos,50).join()).toContain('no admite material');
    datos.intervalosDiametro[0].dato.material_tuberia=null;
    datos.intervalosFiltro=[{idLocal:'f',dato:{desde_m:20,hasta_m:25,diametro_pulg:8,material_tuberia:'PVC',ranura_mm:0.5}}];
    expect(validarDatosTecnicos(datos,50).join()).toContain('no puede solaparse');
    datos.intervalosFiltro[0].dato.desde_m=10;datos.intervalosFiltro[0].dato.hasta_m=20;
    expect(validarDatosTecnicos(datos,50)).toEqual([]);
  });
});
