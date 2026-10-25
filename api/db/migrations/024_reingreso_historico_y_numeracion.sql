-- Sólo estructura. Ninguna reserva, contador o referencia existente se modifica.
ALTER TABLE numeracion_perforacion_configuracion ADD COLUMN motivo text
  CHECK (motivo IS NULL OR length(btrim(motivo)) BETWEEN 10 AND 1000);
ALTER TABLE numeracion_rectificacion ADD COLUMN nonce uuid UNIQUE;
ALTER TABLE numeracion_rectificacion ADD COLUMN confirmacion text CHECK (confirmacion IS NULL OR confirmacion='RECTIFICAR');
ALTER TABLE numeracion_rectificacion ADD COLUMN pruebas_confirmadas boolean CHECK (pruebas_confirmadas IS NULL OR pruebas_confirmadas);

CREATE TABLE reingreso_historico (
  id bigserial PRIMARY KEY,
  nonce uuid NOT NULL UNIQUE,
  actor bigint NOT NULL,
  clave uuid NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  numero_perforacion integer NOT NULL CHECK (numero_perforacion BETWEEN 1 AND 3281),
  id_original bigint NOT NULL,
  id_nuevo bigint NOT NULL UNIQUE,
  motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 10 AND 1000),
  confirmacion text NOT NULL,
  sin_referencias_externas boolean NOT NULL CHECK (sin_referencias_externas),
  nueva_carga_administrativa boolean NOT NULL CHECK (nueva_carga_administrativa),
  anterior jsonb NOT NULL,
  reserva_nueva jsonb NOT NULL,
  UNIQUE(actor,clave),
  CHECK (id_original <> id_nuevo),
  CHECK (confirmacion = 'REINGRESAR ' || numero_perforacion::text)
);
COMMENT ON TABLE reingreso_historico IS 'Antecedentes permanentes de identidades sustituidas. Sin FK destructivas; no elimina idempotencias ni documentos originales.';
CREATE FUNCTION proteger_historial_numeracion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'El historial administrativo de numeración es inmutable'; END $$;
CREATE TRIGGER reingreso_historico_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON reingreso_historico
FOR EACH STATEMENT EXECUTE FUNCTION proteger_historial_numeracion();
CREATE TRIGGER numeracion_configuracion_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON numeracion_perforacion_configuracion
FOR EACH STATEMENT EXECUTE FUNCTION proteger_historial_numeracion();
CREATE FUNCTION exigir_motivo_configuracion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.motivo IS NULL OR length(btrim(NEW.motivo)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Se requiere motivo de configuración';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER numeracion_configuracion_motivo BEFORE INSERT ON numeracion_perforacion_configuracion
FOR EACH ROW EXECUTE FUNCTION exigir_motivo_configuracion();
