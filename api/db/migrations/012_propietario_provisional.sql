-- No convierte usuarios históricos ni modifica IDs, números o relaciones existentes.
ALTER TABLE public.pozo ALTER COLUMN id_propietario DROP NOT NULL;
ALTER TABLE public.pozo ADD COLUMN propietario_provisional VARCHAR(160);
ALTER TABLE public.pozo ADD CONSTRAINT pozo_propietario_real_o_provisional CHECK (
  (id_propietario IS NOT NULL AND propietario_provisional IS NULL)
  OR (id_propietario IS NULL AND propietario_provisional IS NOT NULL
      AND length(btrim(propietario_provisional)) BETWEEN 1 AND 160)
);
-- Se conserva la FK de id_propietario a usuario; NULL nunca identifica una cuenta.
