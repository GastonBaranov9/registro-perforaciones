/**
 * Fastify evalúa el salto 0 como la conexión directa al proceso API.
 * Esta función conserva la semántica histórica de un único salto: confía en
 * cualquier peer TCP inmediato, sin verificar que su identidad sea Nginx.
 * La configuración productiva debe impedir el acceso público directo a la API
 * y hacer que el proxy reemplace los headers X-Forwarded-* recibidos.
 */
export function confiarSoloEnPeerInmediato(_address: string, hop: number): boolean {
  return hop === 0;
}
