ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS version_sesion INTEGER NOT NULL DEFAULT 1;

ALTER TABLE usuario
  ALTER COLUMN version_sesion SET DEFAULT 1;

UPDATE usuario
SET version_sesion = 1
WHERE version_sesion IS NULL;

ALTER TABLE usuario
  ALTER COLUMN version_sesion SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'usuario_version_sesion_positiva'
      AND conrelid = 'usuario'::regclass
  ) THEN
    ALTER TABLE usuario
      ADD CONSTRAINT usuario_version_sesion_positiva
      CHECK (version_sesion > 0);
  END IF;
END
$$;
