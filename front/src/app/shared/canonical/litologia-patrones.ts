/**
 * Contrato visual semántico compartido por los renderers web y PDF.
 * Las claves son datos del catálogo; las primitivas son una decisión del renderer.
 */
export const PATRONES_LITOLOGICOS = [
  'basalt', 'basalt_fractured', 'organic', 'sandstone_fine', 'sandstone_medium',
  'sandstone_coarse', 'clay', 'sandy_clay', 'tosca', 'gravel_fine', 'gravel_coarse', 'granite',
] as const;

export type PatronCatalogo = (typeof PATRONES_LITOLOGICOS)[number];
export type FormaPatron = 'angular' | 'fractura' | 'organica' | 'grano' | 'laminar' | 'hibrido' | 'nodulo' | 'canto' | 'cristalino';

export interface EspecificacionPatronLitologico {
  forma: FormaPatron;
  paso: number;
  tamano: number;
  densidad: number;
  contraste: number;
}

export const ESPECIFICACION_PATRON: Readonly<Record<PatronCatalogo, EspecificacionPatronLitologico>> = {
  basalt: { forma: 'angular', paso: 14, tamano: 2.1, densidad: 0.55, contraste: 0.42 },
  basalt_fractured: { forma: 'fractura', paso: 17, tamano: 2.2, densidad: 0.55, contraste: 0.48 },
  organic: { forma: 'organica', paso: 11, tamano: 2.3, densidad: 0.72, contraste: 0.58 },
  sandstone_fine: { forma: 'grano', paso: 7, tamano: 0.9, densidad: 0.88, contraste: 0.42 },
  sandstone_medium: { forma: 'grano', paso: 11, tamano: 1.35, densidad: 0.68, contraste: 0.44 },
  sandstone_coarse: { forma: 'grano', paso: 17, tamano: 2.3, densidad: 0.48, contraste: 0.48 },
  clay: { forma: 'laminar', paso: 10, tamano: 0.9, densidad: 0.82, contraste: 0.45 },
  sandy_clay: { forma: 'hibrido', paso: 12, tamano: 1.2, densidad: 0.68, contraste: 0.5 },
  tosca: { forma: 'nodulo', paso: 18, tamano: 2.4, densidad: 0.5, contraste: 0.46 },
  gravel_fine: { forma: 'canto', paso: 12, tamano: 2.6, densidad: 0.58, contraste: 0.5 },
  gravel_coarse: { forma: 'canto', paso: 21, tamano: 4.2, densidad: 0.4, contraste: 0.55 },
  granite: { forma: 'cristalino', paso: 15, tamano: 2.8, densidad: 0.58, contraste: 0.5 },
};

export function especificacionPatron(patron: PatronCatalogo): EspecificacionPatronLitologico {
  return ESPECIFICACION_PATRON[patron];
}

export function patronCatalogoValido(valor: string): valor is PatronCatalogo {
  return (PATRONES_LITOLOGICOS as readonly string[]).includes(valor);
}
