-- Los pozos existentes permanecen NULL: no conocemos su número empresarial.
-- El runner ejecuta todo este archivo en una única transacción.
ALTER TABLE public.pozo ADD COLUMN numero_perforacion INTEGER;
ALTER TABLE public.pozo ADD CONSTRAINT pozo_numero_perforacion_positivo
  CHECK (numero_perforacion > 0);
ALTER TABLE public.pozo ADD CONSTRAINT pozo_numero_perforacion_uq
  UNIQUE (numero_perforacion);

CREATE TABLE public.numeracion_perforacion (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  proximo BIGINT CHECK (proximo BETWEEN 1 AND 2147483648),
  mayor_asignado INTEGER NOT NULL DEFAULT 0 CHECK (mayor_asignado >= 0),
  CHECK (proximo IS NULL OR proximo > mayor_asignado)
);
INSERT INTO public.numeracion_perforacion(singleton) VALUES (TRUE);

-- Reserva permanente: eliminar el pozo no permite reciclar su número.
-- id_pozo_original es una referencia de auditoría, sin borrado en cascada.
CREATE TABLE public.numero_perforacion_reservado (
  numero_perforacion INTEGER PRIMARY KEY CHECK (numero_perforacion > 0),
  id_pozo_original BIGINT NOT NULL UNIQUE,
  asignado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.numeracion_perforacion_configuracion (
  id BIGSERIAL PRIMARY KEY,
  anterior BIGINT,
  proximo BIGINT NOT NULL CHECK (proximo BETWEEN 1 AND 2147483647),
  cambiado_por BIGINT REFERENCES public.usuario(id_usuario) ON DELETE SET NULL,
  cambiado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION public.asignar_numero_perforacion()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE siguiente BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.numero_perforacion IS NOT DISTINCT FROM OLD.numero_perforacion THEN
      RETURN NEW;
    END IF;
    IF OLD.numero_perforacion IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P1102', MESSAGE = 'El número de perforación ya asignado no se puede modificar.';
    END IF;
  END IF;

  -- Toda asignación automática o manual comparte el mismo bloqueo.
  SELECT proximo INTO siguiente FROM public.numeracion_perforacion
    WHERE singleton = TRUE FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P1100', MESSAGE = 'Falta configurar la numeración de perforaciones.';
  END IF;
  IF NEW.numero_perforacion IS NULL THEN
    IF siguiente IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P1100', MESSAGE = 'Administración debe configurar el próximo número de perforación.';
    END IF;
    IF siguiente > 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = 'P1103', MESSAGE = 'Se agotó el rango de numeración de perforaciones.';
    END IF;
    NEW.numero_perforacion := siguiente;
  END IF;

  INSERT INTO public.numero_perforacion_reservado(numero_perforacion, id_pozo_original)
    VALUES (NEW.numero_perforacion, NEW.id_pozo);
  UPDATE public.numeracion_perforacion SET
    mayor_asignado = GREATEST(mayor_asignado, NEW.numero_perforacion),
    proximo = CASE WHEN proximo IS NULL THEN NULL
      ELSE GREATEST(proximo, NEW.numero_perforacion::BIGINT + 1) END
    WHERE singleton = TRUE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pozo_asignar_numero_perforacion
  BEFORE INSERT OR UPDATE OF numero_perforacion ON public.pozo
  FOR EACH ROW EXECUTE FUNCTION public.asignar_numero_perforacion();

COMMENT ON COLUMN public.pozo.numero_perforacion IS
  'Número empresarial global. NULL únicamente para registros anteriores pendientes de identificación.';
