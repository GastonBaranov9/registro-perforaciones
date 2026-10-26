-- Elemento declarado, independiente del texto legado pozo.pre_filtro.
-- La clave compuesta evita identidades redundantes: la colección se reemplaza
-- dentro de la transacción del pozo. No se crean intervalos para datos antiguos.
CREATE TABLE public.prefiltro_pozo (
  id_pozo BIGINT NOT NULL REFERENCES public.pozo(id_pozo) ON DELETE CASCADE,
  desde_m NUMERIC NOT NULL,
  hasta_m NUMERIC NOT NULL,
  PRIMARY KEY (id_pozo, desde_m),
  CHECK (desde_m >= 0 AND desde_m < hasta_m),
  CHECK (desde_m NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
  CHECK (hasta_m NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric))
);
