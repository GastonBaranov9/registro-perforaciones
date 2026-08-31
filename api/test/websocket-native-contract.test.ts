import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { consumirTicketWsNative } from "../src/services/native-auth-service.ts";
import { origenPublicoValido } from "../src/plugins/origin.ts";

test("ticket WS malformado se rechaza antes de consultar PostgreSQL", async () => {
  assert.equal(await consumirTicketWsNative("ticket-invalido"), null);
  assert.equal(await consumirTicketWsNative("rspn1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), null);
});

test("Origin distingue web público de Android/iOS native con comparación exacta", () => {
  const native = ["https://localhost", "capacitor://localhost"];
  assert.equal(origenPublicoValido(true, "https://app.example.test", native, "GET", "https://app.example.test", "websocket"), true);
  assert.equal(origenPublicoValido(true, "https://app.example.test", native, "GET", "https://evil.example.test", "websocket"), false);
  assert.equal(native.includes("https://localhost"), true);
  assert.equal(native.includes("https://localhost.evil"), false);
});

test("redención usa update atómico y no SELECT seguido de UPDATE", async () => {
  const file = await fs.readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "services", "native-auth-service.ts"),
    "utf8",
  );
  const redemption = file.slice(file.indexOf("export async function consumirTicketWsNative"));
  assert.match(redemption, /UPDATE ticket_ws_nativo AS t/);
  assert.match(redemption, /t\.used_at IS NULL/);
  assert.match(redemption, /SET used_at = now\(\)/);
  assert.match(redemption, /FOR UPDATE OF s, u/);
});
