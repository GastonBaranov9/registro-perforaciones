-- Amplía el catálogo sin reescribir migraciones ni intervalos existentes.
ALTER TABLE catalogo_litologia DROP CONSTRAINT catalogo_litologia_patron_check;
ALTER TABLE catalogo_litologia ADD CONSTRAINT catalogo_litologia_patron_check
  CHECK (patron IN ('basalt','basalt_fractured','organic','sandstone_fine',
    'sandstone_medium','sandstone_coarse','clay','sandy_clay','tosca',
    'gravel_fine','gravel_coarse','granite','concrete'));

-- No sobreescribir una entrada creada previamente por administración.
-- Una colisión de nombre con otro código detiene la transacción para revisión.
-- 003 ya protege nombre_normalizado con UNIQUE. Este control también detecta
-- el conflicto doble (código existente + nombre ocupado por otra entrada),
-- que ON CONFLICT (codigo) DO NOTHING podría omitir sin evaluar el otro índice.
-- El runner envuelve toda la migración en una transacción.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM catalogo_litologia
    WHERE nombre_normalizado = litologia_normalizar('Sello sanitario')
      AND codigo <> 'sello_sanitario'
  ) THEN
    RAISE EXCEPTION 'El nombre Sello sanitario ya existe con otro código; revisar el catálogo antes de migrar'
      USING ERRCODE = '23505', CONSTRAINT = 'catalogo_litologia_nombre_normalizado_uq';
  END IF;
END;
$$;

INSERT INTO catalogo_litologia (codigo,nombre,familia,color,patron,orden,es_inicial)
VALUES ('sello_sanitario','Sello sanitario','otro','#999999','concrete',30,TRUE)
ON CONFLICT (codigo) DO NOTHING;
