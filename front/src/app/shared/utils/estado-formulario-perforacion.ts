import { DatosTecnicosBorrador, NuevoPozo, PropietarioOperativoActualizarBody, SitioBody } from '../types/schemas';
import { ordenarDatosTecnicos } from './datos-tecnicos-borrador';

// Se lee al intentar salir: ngModel también modifica objetos sin emitir señales.
// Vacío/null/undefined representan el mismo campo sin completar.
export function huellaFormulario(pozo: NuevoPozo, sitio: SitioBody, tecnicos: DatosTecnicosBorrador, historico = false): string {
  const ordenados = ordenarDatosTecnicos(tecnicos);
  const datos = Object.fromEntries(Object.entries(ordenados).map(([nombre, filas]) =>
    [nombre, filas.map(fila => fila.dato)]));
  // Sólo estos campos convierten espacios vacíos a ausencia en la persistencia.
  // Los textos del alta normal (empresa, métodos, etc.) se guardan sin trim.
  const camposPozo = historico
    ? ['empresa', 'fecha_inicio', 'fecha_fin', 'metodo_sedimentario', 'metodo_rocoso', 'cementacion', 'desarrollo', 'revestimiento', 'propietario_provisional']
    : ['propietario_provisional'];
  const camposSitio = historico ? ['departamento', 'localidad', 'padron', 'latitud', 'longitud'] : ['localidad', 'padron'];
  return JSON.stringify(normalizar({
    pozo: vaciosPersistidos(pozo, camposPozo), sitio: vaciosPersistidos(sitio, camposSitio), tecnicos: datos,
  }));
}

export function huellaPropietario(datos: PropietarioOperativoActualizarBody): string {
  // El servicio de propietarios normaliza todos sus textos con trim; sólo se
  // normaliza la comparación, nunca los valores que el usuario está editando.
  return JSON.stringify(normalizar(Object.fromEntries(Object.entries(datos).map(([clave, valor]) =>
    [clave, typeof valor === 'string' ? valor.trim() : valor]))));
}

function vaciosPersistidos<T extends object>(datos: T, campos: string[]): object {
  return Object.fromEntries(Object.entries(datos).map(([clave, valor]) =>
    [clave, campos.includes(clave) && typeof valor === 'string' && !valor.trim() ? undefined : valor]));
}

function normalizar(valor: unknown): unknown {
  if (valor == null || valor === '') return undefined;
  if (Array.isArray(valor)) return valor.map(normalizar);
  if (typeof valor === 'object') return Object.fromEntries(
    Object.entries(valor).sort(([a], [b]) => a.localeCompare(b))
      .map(([clave, dato]) => [clave, normalizar(dato)]).filter(([, dato]) => dato !== undefined));
  return valor;
}
