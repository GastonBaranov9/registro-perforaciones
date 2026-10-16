import { IntervaloLitologicoBody } from '../types/schemas';

/** Compara sólo lo editable, con la misma normalización que la escritura. */
export function huellaIntervaloLitologico(dato: IntervaloLitologicoBody): string {
  const provisional = dato.litologia_provisional == null ? null : dato.litologia_provisional.trim();
  return JSON.stringify({
    desde_m: dato.desde_m,
    hasta_m: dato.hasta_m,
    id_litologia: dato.id_litologia ?? null,
    litologia_provisional: provisional,
    // El nombre de catálogo es derivado; el provisional se guarda con trim.
    material: dato.id_litologia != null ? null : provisional ?? dato.material,
  });
}
