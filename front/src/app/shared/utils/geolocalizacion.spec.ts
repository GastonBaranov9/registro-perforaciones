import { capturarUbicacionActual } from './geolocalizacion';

describe('capturarUbicacionActual', () => {
  it('normaliza coordenadas y conserva la precisión', async () => {
    const geo = { getCurrentPosition: (ok: PositionCallback) => ok({ coords:{ latitude:-31.1234567,longitude:-57.7654321,accuracy:8 } } as GeolocationPosition) } as Geolocation;
    await expectAsync(capturarUbicacionActual(geo)).toBeResolvedTo({ latitud:'-31.123457',longitud:'-57.765432',precision:8 });
  });
  it('explica permiso denegado y timeout', async () => {
    for (const [codigo,mensaje] of [[1,'denegado'],[3,'tiempo']] as const) {
      const geo = { getCurrentPosition: (_ok:PositionCallback,error:PositionErrorCallback) => error({code:codigo} as GeolocationPositionError) } as Geolocation;
      await expectAsync(capturarUbicacionActual(geo)).toBeRejectedWithError(new RegExp(mensaje,'i'));
    }
  });
  it('rechaza geolocalización ausente y coordenadas inválidas', async () => {
    await expectAsync(capturarUbicacionActual(null)).toBeRejectedWithError(/no está disponible/i);
    const geo = { getCurrentPosition: (ok: PositionCallback) => ok({ coords:{ latitude:999,longitude:0,accuracy:1 } } as GeolocationPosition) } as Geolocation;
    await expectAsync(capturarUbicacionActual(geo)).toBeRejectedWithError(/inválidas/i);
  });
});
