export function mensajeHumano(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message && !error.message.includes('[object Object]')) return error.message;
  if (typeof error === 'object' && error !== null) {
    const dato = error as { error?: { message?: unknown } | unknown; message?: unknown };
    const mensaje = typeof dato.error === 'object' && dato.error !== null && 'message' in dato.error
      ? (dato.error as { message?: unknown }).message
      : dato.message;
    if (typeof mensaje === 'string' && mensaje && !mensaje.includes('[object Object]')) return mensaje;
  }
  return fallback;
}
