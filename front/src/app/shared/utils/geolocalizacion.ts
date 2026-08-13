export type UbicacionCapturada = { latitud: string; longitud: string; precision?: number };

export function capturarUbicacionActual(
  geolocation: Geolocation | null | undefined = globalThis.navigator?.geolocation,
  timeout = 10_000,
): Promise<UbicacionCapturada> {
  if (!geolocation) return Promise.reject(new Error('La geolocalización no está disponible en este dispositivo.'));
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!Number.isFinite(coords.latitude) || coords.latitude < -90 || coords.latitude > 90 ||
            !Number.isFinite(coords.longitude) || coords.longitude < -180 || coords.longitude > 180) {
          reject(new Error('El dispositivo devolvió coordenadas inválidas.'));
          return;
        }
        resolve({
          latitud: coords.latitude.toFixed(6), longitud: coords.longitude.toFixed(6),
          precision: Number.isFinite(coords.accuracy) ? coords.accuracy : undefined,
        });
      },
      (error) => {
        const mensajes: Record<number, string> = {
          1: 'Permiso de ubicación denegado.', 2: 'No fue posible determinar la ubicación.',
          3: 'Se agotó el tiempo para obtener la ubicación.',
        };
        reject(new Error(mensajes[error.code] ?? 'No fue posible obtener la ubicación.'));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}
