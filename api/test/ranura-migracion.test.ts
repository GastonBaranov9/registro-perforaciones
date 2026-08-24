import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migracion = fs.readFileSync(new URL("../db/migrations/005_intervalo_filtro_ranura.sql", import.meta.url), "utf8");
const instalacion = fs.readFileSync(new URL("../db/migrations/005_intervalo_filtro_ranura.sql", import.meta.url), "utf8");

test("migración 005 agrega ranura nullable sin backfill y limita valores", () => {
  assert.match(migracion, /ADD COLUMN IF NOT EXISTS ranura_mm NUMERIC\(4,2\)/);
  assert.match(migracion, /ranura_mm IS NULL OR ranura_mm IN \(0\.50, 0\.75, 1\.00\)/);
  assert.doesNotMatch(migracion, /UPDATE\s+public\.intervalo_filtro/i);
  assert.match(instalacion, /ranura_mm\s+NUMERIC\(4,2\)/);
  assert.match(instalacion, /intervalo_filtro_ranura_mm_check/);
});
