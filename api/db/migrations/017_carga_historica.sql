ALTER TABLE public.pozo ADD COLUMN origen TEXT NOT NULL DEFAULT 'normal'
  CHECK (origen IN ('normal','historico'));
ALTER TABLE public.pozo ALTER COLUMN id_sitio DROP NOT NULL;
ALTER TABLE public.pozo ALTER COLUMN id_perforador DROP NOT NULL;
ALTER TABLE public.pozo ADD CONSTRAINT pozo_normal_identificado CHECK (
  origen='historico' OR (id_sitio IS NOT NULL AND id_perforador IS NOT NULL));
ALTER TABLE public.pozo ADD CONSTRAINT pozo_historico_rango CHECK (
  origen<>'historico' OR (numero_perforacion IS NOT NULL AND numero_perforacion BETWEEN 1 AND 3281 AND creado_por IS NOT NULL));
ALTER TABLE public.pozo DROP CONSTRAINT pozo_propietario_real_o_provisional;
ALTER TABLE public.pozo ADD CONSTRAINT pozo_propietario_real_o_provisional CHECK (
  (id_propietario IS NOT NULL AND propietario_provisional IS NULL)
  OR (id_propietario IS NULL AND propietario_provisional IS NOT NULL AND length(btrim(propietario_provisional)) BETWEEN 1 AND 160)
  OR (origen='historico' AND id_propietario IS NULL AND propietario_provisional IS NULL));
CREATE FUNCTION public.conservar_origen_pozo() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origen IS DISTINCT FROM OLD.origen THEN
    RAISE EXCEPTION 'El origen de la perforación es inmutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pozo_conservar_origen BEFORE UPDATE OF origen ON public.pozo
  FOR EACH ROW EXECUTE FUNCTION public.conservar_origen_pozo();
CREATE TABLE public.creacion_historica (
  actor BIGINT NOT NULL REFERENCES public.usuario(id_usuario),
  clave UUID NOT NULL,
  epoca UUID NOT NULL,
  huella CHAR(64) NOT NULL,
  resultado JSONB NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor,clave)
);
