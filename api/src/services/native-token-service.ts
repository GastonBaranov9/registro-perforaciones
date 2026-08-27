import { createHmac, randomBytes } from "node:crypto";

export type NativeTokenDomain = "session" | "ws-ticket";

const TOKEN_PREFIXES: Record<NativeTokenDomain, string> = {
  session: "rspn1_",
  "ws-ticket": "rspw1_",
};

const TOKEN_PAYLOAD_LENGTH = 43;

export function generarTokenNativo(domain: NativeTokenDomain): string {
  return `${TOKEN_PREFIXES[domain]}${randomBytes(32).toString("base64url")}`;
}

export function tokenNativoBienFormado(
  token: unknown,
  domain: NativeTokenDomain = "session",
): token is string {
  if (typeof token !== "string") return false;
  const prefix = TOKEN_PREFIXES[domain];
  if (
    token.length !== prefix.length + TOKEN_PAYLOAD_LENGTH ||
    !token.startsWith(prefix)
  ) return false;
  const payload = token.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(payload)) return false;
  try {
    const bytes = Buffer.from(payload, "base64url");
    return bytes.length === 32 && bytes.toString("base64url") === payload;
  } catch {
    return false;
  }
}

export function hmacTokenNativo(
  token: string,
  secret: string,
  domain: NativeTokenDomain,
): Buffer {
  return createHmac("sha256", secret)
    .update(`registro-perforaciones:${domain}:v1\0`, "utf8")
    .update(token, "utf8")
    .digest();
}

export function extraerBearerNativo(authorization: unknown): string | null {
  if (typeof authorization !== "string") return null;
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match || !tokenNativoBienFormado(match[1], "session")) return null;
  return match[1];
}
