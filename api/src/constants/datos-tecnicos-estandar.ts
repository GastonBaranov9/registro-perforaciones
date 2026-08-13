export const DATOS_TECNICOS_ESTANDAR = Object.freeze({
  desarrollo: "Fue realizado el desarrollo con aire comprimido.",
  cementacion: "Es el espacio anular entre el tubo de protección sanitario y el revestimiento que fue cementado.",
  metodo_sedimentario: "Rotativa.",
  metodo_rocoso: "Rotoneumatica.",
});

export type CampoTecnicoEstandar = keyof typeof DATOS_TECNICOS_ESTANDAR;

export function datosTecnicosParaCreacion<T extends Partial<Record<CampoTecnicoEstandar, string>>>(data: T) {
  const resultado = {} as Record<CampoTecnicoEstandar, string>;
  for (const campo of Object.keys(DATOS_TECNICOS_ESTANDAR) as CampoTecnicoEstandar[]) {
    const valor = data[campo];
    if (valor !== undefined && !valor.trim()) throw new Error(`El campo ${campo} no puede estar vacío.`);
    resultado[campo] = valor ?? DATOS_TECNICOS_ESTANDAR[campo];
  }
  return resultado;
}
