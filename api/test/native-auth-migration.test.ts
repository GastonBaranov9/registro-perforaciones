import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../db/migrations/008_autenticacion_nativa.sql",
  import.meta.url,
);

test("008 crea sesiones/tickets native con hashes constraints y FK cascade", async () => {
  const sql = await fs.readFile(migrationUrl, "utf8");
  assert.match(sql, /CREATE TABLE sesion_nativa/i);
  assert.match(sql, /token_hash BYTEA NOT NULL UNIQUE/i);
  assert.match(sql, /octet_length\(token_hash\) = 32/i);
  assert.match(sql, /installation_id UUID NOT NULL/i);
  assert.match(sql, /version_sesion_emitida INTEGER NOT NULL/i);
  assert.match(sql, /platform IN \('android', 'ios'\)/i);
  assert.match(sql, /CREATE TABLE ticket_ws_nativo/i);
  assert.match(sql, /REFERENCES sesion_nativa\(id_sesion_nativa\) ON DELETE CASCADE/i);
  assert.match(sql, /ticket_hash BYTEA NOT NULL UNIQUE/i);
  assert.doesNotMatch(sql, /password|imei|advertising|fingerprint/i);
});

test("008 indexa lookup replacement eviction y ambas ramas de cleanup", async () => {
  const sql = await fs.readFile(migrationUrl, "utf8");
  for (const index of [
    "sesion_nativa_usuario_activas_eviction_idx",
    "sesion_nativa_usuario_installation_activa_idx",
    "sesion_nativa_revoked_cleanup_idx",
    "sesion_nativa_expired_cleanup_idx",
    "ticket_ws_nativo_sesion_idx",
    "ticket_ws_nativo_expiry_cleanup_idx",
  ]) assert.match(sql, new RegExp(`CREATE INDEX ${index}`, "i"));
});
