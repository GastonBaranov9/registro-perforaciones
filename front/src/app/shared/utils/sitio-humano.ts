import { Sitio } from '../types/schemas';

export function representarSitio(sitio: Sitio | null | undefined): string {
  if (!sitio) return 'Información de ubicación no disponible';
  const lugar = [sitio.localidad?.trim(), sitio.departamento.trim()].filter(Boolean).join(', ');
  const coordenadas = sitio.latitud && sitio.longitud ? `${sitio.latitud}, ${sitio.longitud}` : '';
  return [lugar || 'Ubicación sin nombre', coordenadas].filter(Boolean).join(' — ');
}
