export const MAX_FOTO_BYTES = 5_000_000;
export const MAX_FOTO_BASE64_CHARS = Math.ceil(MAX_FOTO_BYTES / 3) * 4;

// El JSON contiene base64 (4/3 del binario) y el resto del formulario completo.
export const FOTO_JSON_BODY_LIMIT_BYTES = MAX_FOTO_BASE64_CHARS + 256_000;

// Nginx usa MiB enteros; 7 MiB supera el body JSON admitido sin ampliar el contrato.
export const PROXY_UPLOAD_LIMIT_MIB = 7;
