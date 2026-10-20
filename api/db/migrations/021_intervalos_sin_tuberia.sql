-- La ausencia de este estado conservaba la representación de tubería, incluso
-- con material desconocido. No se reinterpreta ningún material nulo histórico.
ALTER TABLE public.intervalo_diametro_perforacion
  ADD COLUMN sin_tuberia BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT intervalo_diametro_sin_tuberia_material_chk
    CHECK (NOT sin_tuberia OR material_tuberia IS NULL);
