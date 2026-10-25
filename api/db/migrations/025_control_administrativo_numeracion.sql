-- Sólo estructura: no configura el cursor, no libera reservas ni concede privilegios.
ALTER TABLE numeracion_perforacion DROP CONSTRAINT numeracion_perforacion_check;

-- Capacidad excepcional separada de los roles editables por administradores.
-- Se provisiona sólo mediante una intervención expresamente autorizada.
CREATE TABLE autorizacion_numeracion (
  id bigserial PRIMARY KEY,
  usuario bigint NOT NULL UNIQUE REFERENCES usuario(id_usuario),
  concedido_por bigint NOT NULL REFERENCES usuario(id_usuario),
  motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 10 AND 1000),
  concedida_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  activa boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE TABLE autorizacion_numeracion_historial (
  id bigserial PRIMARY KEY,
  autorizacion_id bigint NOT NULL REFERENCES autorizacion_numeracion(id),
  responsable bigint NOT NULL REFERENCES usuario(id_usuario),
  motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 10 AND 1000),
  fecha timestamptz NOT NULL DEFAULT clock_timestamp(),
  operador_bd text NOT NULL DEFAULT session_user,
  anterior jsonb,
  nuevo jsonb NOT NULL
);
CREATE TRIGGER autorizacion_historial_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON autorizacion_numeracion_historial
FOR EACH STATEMENT EXECUTE FUNCTION proteger_historial_numeracion();
CREATE TRIGGER autorizacion_no_borrar BEFORE DELETE OR TRUNCATE ON autorizacion_numeracion
FOR EACH STATEMENT EXECUTE FUNCTION proteger_historial_numeracion();

-- Toda concesión/revocación exige contexto explícito y queda auditada, incluso
-- ante DML directo. No hay un endpoint HTTP para aprovisionar esta capacidad.
CREATE FUNCTION auditar_autorizacion_numeracion() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE actor bigint; razon text;
BEGIN
 actor := NULLIF(current_setting('rsp.autorizacion_actor',true),'')::bigint;
 razon := NULLIF(current_setting('rsp.autorizacion_motivo',true),'');
 IF actor IS NULL OR razon IS NULL OR length(btrim(razon)) NOT BETWEEN 10 AND 1000 THEN
   RAISE EXCEPTION 'Utilice administrar_autorizacion_numeracion con responsable y motivo';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM usuario u JOIN usuario_rol ur USING(id_usuario) JOIN rol r USING(id_rol)
   WHERE u.id_usuario=actor AND u.activo AND u.cuenta_acceso AND r.nombre='administracion') THEN
   RAISE EXCEPTION 'El responsable debe ser administrador activo';
 END IF;
 IF NEW.activa AND NOT EXISTS(SELECT 1 FROM usuario u JOIN usuario_rol ur USING(id_usuario) JOIN rol r USING(id_rol)
   WHERE u.id_usuario=NEW.usuario AND u.activo AND u.cuenta_acceso AND r.nombre='administracion') THEN
   RAISE EXCEPTION 'La cuenta destinataria debe ser administradora activa';
 END IF;
 IF TG_WHEN='BEFORE' THEN
   IF TG_OP='UPDATE' THEN
     IF NEW.id<>OLD.id OR NEW.usuario<>OLD.usuario OR NEW.activa=OLD.activa THEN
       RAISE EXCEPTION 'Sólo se admite conceder o revocar sin cambiar la identidad';
     END IF;
     NEW.revision := OLD.revision+1;
   ELSE
     IF NOT NEW.activa THEN RAISE EXCEPTION 'No existe autorización para revocar'; END IF;
     NEW.revision := 1;
   END IF;
   NEW.concedido_por := actor;
   NEW.motivo := btrim(razon);
   NEW.concedida_en := clock_timestamp();
 ELSE
   INSERT INTO autorizacion_numeracion_historial(autorizacion_id,responsable,motivo,anterior,nuevo)
   VALUES(NEW.id,actor,btrim(razon),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER autorizacion_validar BEFORE INSERT OR UPDATE ON autorizacion_numeracion
FOR EACH ROW EXECUTE FUNCTION auditar_autorizacion_numeracion();
CREATE TRIGGER autorizacion_auditar AFTER INSERT OR UPDATE ON autorizacion_numeracion
FOR EACH ROW EXECUTE FUNCTION auditar_autorizacion_numeracion();

-- Sólo el operador de base autorizado puede invocarla (sin SECURITY DEFINER).
-- Revision esperada 0 significa que todavía no existe ninguna autorización.
CREATE FUNCTION administrar_autorizacion_numeracion(destinatario bigint, responsable bigint,
 conceder boolean, razon text, revision_esperada bigint, confirmacion text) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE actual autorizacion_numeracion%ROWTYPE; resultado bigint; contexto_actor text; contexto_motivo text;
BEGIN
 IF conceder IS NULL OR destinatario IS NULL OR responsable IS NULL OR razon IS NULL
   OR length(btrim(razon)) NOT BETWEEN 10 AND 1000 OR revision_esperada IS NULL
   OR confirmacion IS DISTINCT FROM (CASE WHEN conceder THEN 'CONCEDER ' ELSE 'REVOCAR ' END || destinatario::text) THEN
   RAISE EXCEPTION 'Revise cuenta, responsable, motivo, revisión y confirmación';
 END IF;
 PERFORM pg_advisory_xact_lock(731024,1);
 SELECT * INTO actual FROM autorizacion_numeracion WHERE usuario=destinatario FOR UPDATE;
 IF COALESCE(actual.revision,0)<>revision_esperada OR COALESCE(actual.activa,false)=conceder THEN
   RAISE EXCEPTION 'La autorización cambió o no hay un cambio que aplicar';
 END IF;
 contexto_actor := current_setting('rsp.autorizacion_actor',true);
 contexto_motivo := current_setting('rsp.autorizacion_motivo',true);
 PERFORM set_config('rsp.autorizacion_actor',responsable::text,true);
 PERFORM set_config('rsp.autorizacion_motivo',btrim(razon),true);
 IF actual.id IS NULL THEN
   INSERT INTO autorizacion_numeracion(usuario,concedido_por,motivo)
   VALUES(destinatario,responsable,btrim(razon)) RETURNING revision INTO resultado;
 ELSE
   UPDATE autorizacion_numeracion SET activa=conceder WHERE id=actual.id RETURNING revision INTO resultado;
 END IF;
 PERFORM set_config('rsp.autorizacion_actor',COALESCE(contexto_actor,''),true);
 PERFORM set_config('rsp.autorizacion_motivo',COALESCE(contexto_motivo,''),true);
 RETURN resultado;
END $$;
REVOKE ALL ON FUNCTION administrar_autorizacion_numeracion(bigint,bigint,boolean,text,bigint,text) FROM PUBLIC;

ALTER TABLE numeracion_perforacion_configuracion
  ADD COLUMN tipo text CHECK (tipo IN ('adelanto','retroceso','habilitacion')),
  ADD COLUMN estado_verificado jsonb,
  ADD COLUMN autorizacion_id bigint,
  ADD COLUMN nonce uuid UNIQUE,
  ADD COLUMN confirmacion text;

-- Incluye referencias de resultados anteriores aunque falte su reserva.
CREATE FUNCTION numeros_no_disponibles() RETURNS TABLE(numero bigint)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT numero_perforacion::bigint FROM numero_perforacion_reservado
 UNION SELECT numero_perforacion::bigint FROM pozo WHERE numero_perforacion IS NOT NULL
 UNION SELECT valor::bigint FROM (
   SELECT resultado->>'numero_perforacion' valor FROM creacion_historica
   UNION ALL SELECT resultado->>'numero_perforacion' FROM creacion_offline
   UNION ALL SELECT resultado#>>'{pozo,numero_perforacion}' FROM creacion_offline
 ) r WHERE valor ~ '^[0-9]{1,10}$'
$$;
CREATE FUNCTION siguiente_numero_disponible(desde bigint) RETURNS bigint
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 WITH ocupados AS MATERIALIZED (SELECT numero FROM numeros_no_disponibles() WHERE numero>=desde AND numero<=2147483647),
 candidatos AS (SELECT GREATEST(desde,3282) n UNION SELECT numero+1 FROM ocupados)
 SELECT COALESCE(min(n),2147483648) FROM candidatos
 WHERE n BETWEEN 3282 AND 2147483647 AND NOT EXISTS(SELECT 1 FROM ocupados WHERE numero=n)
$$;
CREATE FUNCTION verificar_cursor_numeracion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.proximo IS DISTINCT FROM OLD.proximo AND NEW.proximo IS NOT NULL THEN
   IF NEW.proximo<3282 OR EXISTS(SELECT 1 FROM numeros_no_disponibles() WHERE numero=NEW.proximo) THEN
     RAISE EXCEPTION USING ERRCODE='P1104', MESSAGE='El próximo número no está disponible en el rango automático.';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER numeracion_cursor_disponible BEFORE UPDATE ON numeracion_perforacion
FOR EACH ROW EXECUTE FUNCTION verificar_cursor_numeracion();

CREATE OR REPLACE FUNCTION asignar_numero_perforacion() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE siguiente bigint; automatica boolean;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.numero_perforacion IS NOT DISTINCT FROM OLD.numero_perforacion THEN RETURN NEW; END IF;
   IF OLD.numero_perforacion IS NOT NULL THEN
     RAISE EXCEPTION USING ERRCODE='P1102', MESSAGE='El número ya asignado no puede modificarse.';
   END IF;
 END IF;
 SELECT proximo INTO siguiente FROM numeracion_perforacion WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1100',MESSAGE='Falta configurar numeración.'; END IF;
 automatica := NEW.numero_perforacion IS NULL;
 IF automatica THEN
   IF siguiente IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1100',MESSAGE='Falta configurar numeración.'; END IF;
   IF siguiente>2147483647 THEN RAISE EXCEPTION USING ERRCODE='P1103',MESSAGE='Rango agotado.'; END IF;
   -- No saltar silenciosamente el número elegido si un conflicto aparece después.
   IF siguiente<3282 OR EXISTS(SELECT 1 FROM numeros_no_disponibles() WHERE numero=siguiente) THEN
     RAISE EXCEPTION USING ERRCODE='P1104',MESSAGE='El número configurado dejó de estar disponible.';
   END IF;
   NEW.numero_perforacion := siguiente;
 END IF;
 INSERT INTO numero_perforacion_reservado(numero_perforacion,id_pozo_original) VALUES(NEW.numero_perforacion,NEW.id_pozo);
 UPDATE numeracion_perforacion SET mayor_asignado=GREATEST(mayor_asignado,NEW.numero_perforacion),
   proximo=CASE WHEN automatica THEN siguiente_numero_disponible(siguiente+1)
     WHEN siguiente=NEW.numero_perforacion THEN siguiente_numero_disponible(siguiente+1)
     ELSE siguiente END WHERE singleton;
 RETURN NEW;
END $$;
COMMENT ON COLUMN numeracion_perforacion.proximo IS 'Cursor administrativo independiente del máximo. Asignación exacta, luego avance al siguiente libre sin liberar reservas.';
