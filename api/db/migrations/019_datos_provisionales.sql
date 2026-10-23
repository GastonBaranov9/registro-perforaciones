-- Sólo datos observados: no crea personas, cuentas ni entradas del catálogo.
ALTER TABLE public.pozo ADD COLUMN perforador_provisional VARCHAR(160);
ALTER TABLE public.pozo ADD CONSTRAINT pozo_perforador_provisional_ck CHECK (
  perforador_provisional IS NULL OR
  (origen='historico' AND id_perforador IS NULL
   AND perforador_provisional=btrim(perforador_provisional)
   AND length(perforador_provisional) BETWEEN 1 AND 160));

ALTER TABLE public.intervalo_litologico ADD COLUMN litologia_provisional VARCHAR(160);
ALTER TABLE public.intervalo_litologico ADD CONSTRAINT intervalo_litologia_provisional_ck CHECK (
  litologia_provisional IS NULL OR
  (id_litologia IS NULL AND litologia_provisional=btrim(litologia_provisional)
   AND length(litologia_provisional) BETWEEN 1 AND 160));
-- material se conserva para consumidores existentes y registros legados sin catálogo.
-- Las listas consultan sólo pendientes; no se crean tablas ni vínculos por nombre.
CREATE INDEX pozo_propietario_pendiente_idx ON public.pozo(id_pozo)
  WHERE propietario_provisional IS NOT NULL;
CREATE INDEX pozo_perforador_pendiente_idx ON public.pozo(id_pozo)
  WHERE perforador_provisional IS NOT NULL;
CREATE INDEX intervalo_litologia_pendiente_idx ON public.intervalo_litologico(id_pozo,id_intervalo_litologico)
  WHERE litologia_provisional IS NOT NULL;
