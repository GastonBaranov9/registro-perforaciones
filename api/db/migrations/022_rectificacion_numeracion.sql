-- Sólo agrega auditoría. No cambia reservas, números ni datos existentes.
CREATE TABLE public.numeracion_rectificacion (
  id BIGSERIAL PRIMARY KEY,
  actor BIGINT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  motivo TEXT NOT NULL CHECK (length(btrim(motivo)) BETWEEN 10 AND 1000),
  sin_referencias_externas BOOLEAN NOT NULL CHECK (sin_referencias_externas),
  proximo_anterior BIGINT NOT NULL,
  mayor_anterior INTEGER NOT NULL,
  proximo_nuevo BIGINT NOT NULL CHECK (proximo_nuevo >= 3282),
  mayor_nuevo INTEGER NOT NULL,
  reservas_anuladas JSONB NOT NULL CHECK (jsonb_typeof(reservas_anuladas)='array' AND jsonb_array_length(reservas_anuladas)>0),
  CHECK (proximo_nuevo > mayor_nuevo AND proximo_nuevo < proximo_anterior)
);
COMMENT ON TABLE public.numeracion_rectificacion IS
  'Historia permanente de reservas de pruebas anuladas explícitamente; actor sin FK para conservar su identidad aun si se elimina la cuenta.';
CREATE FUNCTION public.proteger_rectificacion_numeracion() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría de rectificación de numeración es inmutable';
END $$;
CREATE TRIGGER numeracion_rectificacion_inmutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.numeracion_rectificacion
  FOR EACH STATEMENT EXECUTE FUNCTION public.proteger_rectificacion_numeracion();
