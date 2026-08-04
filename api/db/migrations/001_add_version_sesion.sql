ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS version_sesion INTEGER NOT NULL DEFAULT 1;

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
