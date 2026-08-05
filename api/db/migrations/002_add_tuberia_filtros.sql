BEGIN;

ALTER TABLE intervalo_diametro_perforacion
  ADD COLUMN IF NOT EXISTS material_tuberia VARCHAR(5),
  ADD CONSTRAINT intervalo_diametro_material_chk
    CHECK (material_tuberia IS NULL OR material_tuberia IN ('PVC', 'Acero'));

CREATE TABLE IF NOT EXISTS intervalo_filtro (
  id_intervalo_filtro BIGSERIAL PRIMARY KEY,
  id_pozo BIGINT NOT NULL REFERENCES pozo(id_pozo) ON DELETE CASCADE,
  desde_m NUMERIC NOT NULL CHECK (desde_m >= 0),
  hasta_m NUMERIC NOT NULL,
  diametro_pulg NUMERIC NOT NULL CHECK (diametro_pulg > 0),
  material_tuberia VARCHAR(5) NOT NULL,
  CONSTRAINT intervalo_filtro_rango_chk CHECK (hasta_m > desde_m),
  CONSTRAINT intervalo_filtro_material_chk CHECK (material_tuberia IN ('PVC', 'Acero'))
);

CREATE INDEX IF NOT EXISTS intervalo_filtro_pozo_profundidad_idx
  ON intervalo_filtro (id_pozo, desde_m, hasta_m);

COMMIT;

-- Rollback manual, no destructivo para la tabla histórica:
-- DROP TABLE IF EXISTS intervalo_filtro;
-- ALTER TABLE intervalo_diametro_perforacion DROP CONSTRAINT IF EXISTS intervalo_diametro_material_chk;
-- ALTER TABLE intervalo_diametro_perforacion DROP COLUMN IF EXISTS material_tuberia;
