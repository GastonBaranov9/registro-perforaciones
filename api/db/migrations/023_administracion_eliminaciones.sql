-- La evidencia no tiene FK a registros que puedan eliminarse. Incluye las reservas originales.
CREATE TABLE administracion_eliminacion (
  id bigserial PRIMARY KEY,
  nonce uuid NOT NULL UNIQUE,
  actor bigint NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  operacion text NOT NULL CHECK (operacion IN ('eliminar','eliminar_prueba','liberar_reserva')),
  id_pozo_original bigint NOT NULL,
  numero_perforacion integer CHECK (numero_perforacion > 0),
  motivo text NOT NULL CHECK (length(trim(motivo)) BETWEEN 10 AND 1000),
  prueba_confirmada boolean NOT NULL,
  sin_referencias_externas boolean NOT NULL,
  anterior jsonb NOT NULL,
  posterior jsonb NOT NULL,
  CHECK (operacion = 'eliminar' OR sin_referencias_externas),
  CHECK (operacion <> 'eliminar_prueba' OR prueba_confirmada)
);
CREATE FUNCTION impedir_cambio_eliminacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'La auditoría de eliminación es inmutable'; END $$;
CREATE TRIGGER administracion_eliminacion_inmutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON administracion_eliminacion
FOR EACH STATEMENT EXECUTE FUNCTION impedir_cambio_eliminacion();
