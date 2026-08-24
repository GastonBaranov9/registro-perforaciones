export const DEPARTAMENTOS_URUGUAY = [
  "Artigas",
  "Canelones",
  "Cerro Largo",
  "Colonia",
  "Durazno",
  "Flores",
  "Florida",
  "Lavalleja",
  "Maldonado",
  "Montevideo",
  "Paysandú",
  "Río Negro",
  "Rivera",
  "Rocha",
  "Salto",
  "San José",
  "Soriano",
  "Tacuarembó",
  "Treinta y Tres",
] as const;

export type DepartamentoUruguay = (typeof DEPARTAMENTOS_URUGUAY)[number];

export function esDepartamentoUruguay(valor: string): valor is DepartamentoUruguay {
  return (DEPARTAMENTOS_URUGUAY as readonly string[]).includes(valor);
}
