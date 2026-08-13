import { NuevoPozo } from '../types/schemas';

export const DATOS_TECNICOS_ESTANDAR: Pick<NuevoPozo, 'desarrollo' | 'cementacion' | 'metodo_sedimentario' | 'metodo_rocoso'> = {
  desarrollo: 'Fue realizado el desarrollo con aire comprimido.',
  cementacion: 'Es el espacio anular entre el tubo de protección sanitario y el revestimiento que fue cementado.',
  metodo_sedimentario: 'Rotativa.',
  metodo_rocoso: 'Rotoneumatica.',
};

export type CampoTecnicoEstandar = keyof typeof DATOS_TECNICOS_ESTANDAR;
