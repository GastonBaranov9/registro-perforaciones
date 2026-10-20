LOCK TABLE public.pozo, public.intervalo_litologico, public.catalogo_litologia IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.sello_sanitario_pozo (
  id_pozo BIGINT PRIMARY KEY REFERENCES public.pozo(id_pozo) ON DELETE CASCADE,
  desde_m NUMERIC NOT NULL,
  hasta_m NUMERIC NOT NULL,
  CONSTRAINT sello_sanitario_rango_ck CHECK (desde_m >= 0 AND desde_m < hasta_m),
  CONSTRAINT sello_sanitario_finito_ck CHECK (
    desde_m NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    AND hasta_m NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric))
);

CREATE TEMP TABLE sello_sanitario_migracion ON COMMIT DROP AS
SELECT i.id_intervalo_litologico, i.id_pozo, i.desde_m, i.hasta_m
FROM public.intervalo_litologico i
JOIN public.catalogo_litologia c USING (id_litologia)
WHERE c.codigo = 'sello_sanitario';

DO $$
DECLARE
  afectados TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.catalogo_litologia
             WHERE codigo = 'sello_sanitario' AND nombre <> 'Sello sanitario') THEN
    RAISE EXCEPTION 'El catálogo canónico sello_sanitario no tiene el nombre esperado; revisar antes de migrar';
  END IF;
  SELECT string_agg(id_pozo::text, ', ' ORDER BY id_pozo) INTO afectados
  FROM (SELECT id_pozo FROM sello_sanitario_migracion GROUP BY id_pozo HAVING count(*) > 1) duplicados;
  IF afectados IS NOT NULL THEN
    RAISE EXCEPTION 'Más de un sello sanitario canónico para los pozos: %. No se fusionaron intervalos', afectados;
  END IF;
  SELECT string_agg(id_intervalo_litologico::text, ', ' ORDER BY id_intervalo_litologico) INTO afectados
  FROM sello_sanitario_migracion
  WHERE desde_m < 0 OR desde_m >= hasta_m
     OR desde_m IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     OR hasta_m IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric);
  IF afectados IS NOT NULL THEN
    RAISE EXCEPTION 'Rango inválido en intervalos de sello sanitario: %', afectados;
  END IF;
  SELECT string_agg(m.id_intervalo_litologico::text, ', ' ORDER BY m.id_intervalo_litologico) INTO afectados
  FROM sello_sanitario_migracion m JOIN public.pozo p USING (id_pozo)
  WHERE p.profundidad_final_m IS NOT NULL AND m.hasta_m > p.profundidad_final_m;
  IF afectados IS NOT NULL THEN
    RAISE EXCEPTION 'Sello sanitario excede la profundidad final en intervalos: %', afectados;
  END IF;
END $$;

INSERT INTO public.sello_sanitario_pozo (id_pozo, desde_m, hasta_m)
SELECT id_pozo, desde_m, hasta_m FROM sello_sanitario_migracion;

DO $$
DECLARE
  borrados BIGINT;
BEGIN
  IF EXISTS (
    (SELECT id_pozo, desde_m, hasta_m FROM sello_sanitario_migracion
     EXCEPT SELECT id_pozo, desde_m, hasta_m FROM public.sello_sanitario_pozo)
    UNION ALL
    (SELECT id_pozo, desde_m, hasta_m FROM public.sello_sanitario_pozo
     EXCEPT SELECT id_pozo, desde_m, hasta_m FROM sello_sanitario_migracion)
  ) OR (SELECT count(*) FROM sello_sanitario_migracion) <> (SELECT count(*) FROM public.sello_sanitario_pozo) THEN
    RAISE EXCEPTION 'La copia de sellos sanitarios no coincide exactamente con los intervalos fuente';
  END IF;
  DELETE FROM public.intervalo_litologico i USING sello_sanitario_migracion m
  WHERE i.id_intervalo_litologico = m.id_intervalo_litologico;
  GET DIAGNOSTICS borrados = ROW_COUNT;
  IF borrados <> (SELECT count(*) FROM sello_sanitario_migracion) THEN
    RAISE EXCEPTION 'No se eliminaron exactamente los intervalos de sello sanitario migrados';
  END IF;
END $$;

UPDATE public.catalogo_litologia
SET activo = FALSE, es_inicial = FALSE, actualizado_en = now()
WHERE codigo = 'sello_sanitario';

ALTER TABLE public.catalogo_litologia ADD CONSTRAINT catalogo_sello_sanitario_inactivo_ck
CHECK (codigo <> 'sello_sanitario' OR NOT activo);
