DO $$
DECLARE
  resultados TEXT[];
  vinculada BIGINT;
  esperada BIGINT;
BEGIN
  SELECT array_agg(litologia_normalizar(valor) ORDER BY orden)
  INTO resultados
  FROM (VALUES
    (1,'Arena fina'),
    (2,'Arena   fina'),
    (3,' Arena fina '),
    (4,E'Arena\tfina'),
    (5,E'Arena\nfina')
  ) variantes(orden,valor);
  IF resultados <> ARRAY['arena fina','arena fina','arena fina','arena fina','arena fina'] THEN
    RAISE EXCEPTION 'Normalización incorrecta: %', resultados;
  END IF;
  IF litologia_normalizar('Arena final') = litologia_normalizar('Arena fina') THEN
    RAISE EXCEPTION 'Nombres diferentes colisionaron';
  END IF;
  IF (SELECT count(*) FROM catalogo_litologia) <> 29 THEN
    RAISE EXCEPTION 'El catálogo no contiene exactamente 29 entradas';
  END IF;
  SELECT id_litologia INTO vinculada FROM intervalo_litologico WHERE material=E'  Arenisca   fina\t';
  SELECT id_litologia INTO esperada FROM catalogo_litologia WHERE codigo='arenisca_fina';
  IF vinculada IS DISTINCT FROM esperada THEN
    RAISE EXCEPTION 'El valor histórico no quedó vinculado: % / %', vinculada, esperada;
  END IF;
  INSERT INTO catalogo_litologia(codigo,nombre,familia,color,patron,orden)
  VALUES('control_r1_limpio','Arena control R1','otro','#6B625A','granite',999);
  BEGIN
    INSERT INTO catalogo_litologia(codigo,nombre,familia,color,patron,orden)
    VALUES('control_r1_duplicado',E'Arena   control\tR1','otro','#6B625A','granite',1000);
    RAISE EXCEPTION 'El duplicado normalizado fue aceptado';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$$;

SELECT json_build_object(
  'catalogo', (SELECT count(*) FROM catalogo_litologia),
  'normalizacion', litologia_normalizar(E' Arena\t fina\n'),
  'historico', (SELECT material FROM intervalo_litologico LIMIT 1),
  'vinculado', (SELECT id_litologia IS NOT NULL FROM intervalo_litologico LIMIT 1)
);
