ALTER TABLE public.intervalo_filtro
  ADD COLUMN IF NOT EXISTS ranura_mm NUMERIC(4,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'intervalo_filtro_ranura_mm_check'
      AND conrelid = 'public.intervalo_filtro'::regclass
  ) THEN
    ALTER TABLE public.intervalo_filtro
      ADD CONSTRAINT intervalo_filtro_ranura_mm_check
      CHECK (ranura_mm IS NULL OR ranura_mm IN (0.50, 0.75, 1.00));
  END IF;
END $$;
