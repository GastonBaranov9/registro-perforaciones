-- No altera numeración ni borra recibos. Los clientes sin época deben actualizarse.
CREATE TABLE public.epoca_datos (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  epoca UUID NOT NULL DEFAULT gen_random_uuid(),
  cambiada_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.epoca_datos(singleton) VALUES (TRUE);
ALTER TABLE public.creacion_offline ADD COLUMN epoca UUID;
ALTER TABLE public.clave_offline_cerrada ADD COLUMN epoca UUID;
UPDATE public.creacion_offline SET epoca=(SELECT epoca FROM public.epoca_datos);
UPDATE public.clave_offline_cerrada SET epoca=(SELECT epoca FROM public.epoca_datos);
ALTER TABLE public.creacion_offline ALTER COLUMN epoca SET NOT NULL;
ALTER TABLE public.clave_offline_cerrada ALTER COLUMN epoca SET NOT NULL;
COMMENT ON TABLE public.epoca_datos IS 'Generación del conjunto de datos. Sólo cambia en un corte administrativo; no es una versión de sesión.';
