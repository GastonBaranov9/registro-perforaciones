/**
 * Fastify evalúa el salto 0 como la conexión directa al proceso API.
 * Sólo ese salto (el proxy edge de la red Compose) es confiable; cualquier
 * X-Forwarded-* anterior queda tratado como aportado por el cliente.
 */
export function confiarSoloEnProxyEdge(_address: string, hop: number): boolean {
  return hop === 0;
}
