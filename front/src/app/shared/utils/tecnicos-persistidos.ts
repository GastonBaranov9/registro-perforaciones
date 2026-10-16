import { DatosTecnicosBorrador, IntervaloLitologico, IntervaloDiametroPerforacion, IntervaloFiltro, NivelAporte } from '../types/schemas';

/** Conserva las identidades necesarias para litologías retiradas y ranuras legadas. */
export function tecnicosPersistidos(litologia:IntervaloLitologico[],diametros:IntervaloDiametroPerforacion[],filtros:IntervaloFiltro[],aportes:NivelAporte[]):DatosTecnicosBorrador{
  return {
    intervalosLitologicos:litologia.map(x=>({idLocal:`persistido-lit-${x.id_intervalo_litologico}`,dato:{id_intervalo_litologico:x.id_intervalo_litologico,desde_m:x.desde_m,hasta_m:x.hasta_m,material:x.material,litologia_provisional:x.litologia_provisional,id_litologia:x.id_litologia??undefined}})),
    intervalosDiametro:diametros.map(x=>({idLocal:`persistido-dia-${x.id_intervalo_diametro_perforacion}`,dato:{desde_m:x.desde_m,hasta_m:x.hasta_m,diametro_pulg:x.diametro_pulg,material_tuberia:x.material_tuberia??''}})),
    intervalosFiltro:filtros.map(x=>({idLocal:`persistido-fil-${x.id_intervalo_filtro}`,ranuraOriginal:x.ranura_mm,dato:{id_intervalo_filtro:x.id_intervalo_filtro,desde_m:x.desde_m,hasta_m:x.hasta_m,diametro_pulg:x.diametro_pulg,material_tuberia:x.material_tuberia,ranura_mm:x.ranura_mm}})),
    nivelesAporte:aportes.map(x=>({idLocal:`persistido-apo-${x.id_nivel_aporte}`,dato:{profundidad_m:x.profundidad_m}})),
  };
}
