-- Idempotencia permanente por creación; no contiene fotos ni credenciales.
-- Una fila por operación confirmada. No se expiran claves: un teléfono puede
-- reintentar años después. La reserva permanece aunque se elimine el pozo.
CREATE TABLE public.creacion_offline (
  actor BIGINT NOT NULL REFERENCES public.usuario(id_usuario),
  clave UUID NOT NULL,
  huella CHAR(64) NOT NULL,
  resultado JSONB NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor, clave)
);
ALTER TABLE public.pozo ADD COLUMN propietario_provisional_original VARCHAR(160);
UPDATE public.pozo SET propietario_provisional_original=propietario_provisional
  WHERE propietario_provisional IS NOT NULL;
CREATE FUNCTION public.conservar_propietario_provisional() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN
  NEW.propietario_provisional_original := CASE WHEN TG_OP='UPDATE'
    THEN COALESCE(OLD.propietario_provisional_original, OLD.propietario_provisional, NEW.propietario_provisional)
    ELSE NEW.propietario_provisional END;
  RETURN NEW;
END $$;
CREATE TRIGGER pozo_conservar_provisional BEFORE INSERT OR UPDATE ON public.pozo
  FOR EACH ROW EXECUTE FUNCTION public.conservar_propietario_provisional();
