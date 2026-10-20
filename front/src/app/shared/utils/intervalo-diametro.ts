import { IntervaloDiametroPerforacionBody } from '../types/schemas';

export function opcionTuberia(dato: IntervaloDiametroPerforacionBody): string {
  return dato.sin_tuberia === true ? 'sin_tuberia' : dato.material_tuberia ?? '';
}

/** Se cambia el estado sólo por una elección explícita, nunca al abrir un borrador. */
export function seleccionarTuberia(dato: IntervaloDiametroPerforacionBody, opcion: string): void {
  if (opcion === 'sin_tuberia') {
    dato.sin_tuberia = true;
    dato.material_tuberia = null;
  } else if (opcion === 'PVC' || opcion === 'Acero') {
    dato.sin_tuberia = false;
    dato.material_tuberia = opcion;
  }
}
