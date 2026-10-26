-- Compatibilidad de la instalación anterior, no una regla global de asignación.
-- Sólo se inicializa metadata nueva; no se cambian datos, cursor ni permisos.
CREATE TABLE politica_numeracion (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 rangos jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(rangos)='array'),
 excepciones integer[] NOT NULL DEFAULT '{}'
);
INSERT INTO politica_numeracion(singleton,rangos)
SELECT true,CASE WHEN EXISTS(SELECT 1 FROM pozo) OR EXISTS(SELECT 1 FROM numero_perforacion_reservado)
 OR EXISTS(SELECT 1 FROM numeracion_perforacion WHERE proximo IS NOT NULL)
 OR EXISTS(SELECT 1 FROM numeracion_perforacion_configuracion)
 THEN '[{"desde":1,"hasta":3281}]'::jsonb ELSE '[]'::jsonb END;
CREATE TABLE politica_numeracion_historial (
 id bigserial PRIMARY KEY, actor bigint NOT NULL REFERENCES usuario(id_usuario),
 autorizacion_id bigint NOT NULL REFERENCES autorizacion_numeracion(id),
 motivo text NOT NULL CHECK(length(btrim(motivo)) BETWEEN 10 AND 1000),
 fecha timestamptz NOT NULL DEFAULT clock_timestamp(), nonce uuid NOT NULL UNIQUE,
 operacion text NOT NULL, confirmacion text NOT NULL, evidencia_fisica boolean NOT NULL CHECK(evidencia_fisica),
 anterior jsonb NOT NULL, posterior jsonb NOT NULL
);
CREATE TRIGGER politica_historial_inmutable BEFORE UPDATE OR DELETE OR TRUNCATE ON politica_numeracion_historial
FOR EACH STATEMENT EXECUTE FUNCTION proteger_historial_numeracion();

CREATE FUNCTION numero_protegido(n bigint) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM politica_numeracion p, jsonb_to_recordset(p.rangos) r(desde bigint,hasta bigint)
 WHERE n BETWEEN r.desde AND r.hasta AND NOT(n=ANY(p.excepciones)))
$$;
CREATE FUNCTION validar_politica_numeracion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE r record; limite bigint:=0;
BEGIN
 IF jsonb_array_length(NEW.rangos)>100 OR cardinality(NEW.excepciones)>10000 THEN RAISE EXCEPTION 'Política demasiado extensa'; END IF;
 FOR r IN SELECT * FROM jsonb_to_recordset(NEW.rangos) x(desde bigint,hasta bigint) LOOP
   IF r.desde IS NULL OR r.hasta IS NULL OR r.desde<=limite OR r.hasta<r.desde OR r.hasta>2147483647 THEN RAISE EXCEPTION 'Rangos inválidos, desordenados o superpuestos'; END IF;
   limite:=r.hasta;
 END LOOP;
 IF EXISTS(SELECT 1 FROM unnest(NEW.excepciones) n WHERE n IS NULL OR n<1)
 OR cardinality(NEW.excepciones)<>(SELECT count(DISTINCT n) FROM unnest(NEW.excepciones) n) THEN RAISE EXCEPTION 'Excepciones inválidas'; END IF;
 IF TG_OP='UPDATE' THEN NEW.revision:=OLD.revision+1; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER politica_validar BEFORE INSERT OR UPDATE ON politica_numeracion
FOR EACH ROW EXECUTE FUNCTION validar_politica_numeracion();

ALTER TABLE pozo DROP CONSTRAINT pozo_historico_rango;
ALTER TABLE pozo ADD CONSTRAINT pozo_historico_identificado CHECK(origen<>'historico' OR creado_por IS NOT NULL);
ALTER TABLE reingreso_historico DROP CONSTRAINT reingreso_historico_numero_perforacion_check;
ALTER TABLE reingreso_historico ADD CHECK(numero_perforacion>0);
ALTER TABLE numeracion_rectificacion DROP CONSTRAINT numeracion_rectificacion_proximo_nuevo_check;
ALTER TABLE numeracion_rectificacion ADD CHECK(proximo_nuevo>=1);

-- Clasificar por evidencia de origen, nunca por el número. Ambigüedad bloquea.
CREATE FUNCTION origen_reserva_numero(n integer) RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 WITH reserva AS (SELECT id_pozo_original id FROM numero_perforacion_reservado WHERE numero_perforacion=n),
 evidencias AS (
 SELECT p.origen FROM pozo p JOIN reserva r ON r.id=p.id_pozo WHERE p.numero_perforacion=n
 UNION SELECT c.resultado->>'origen' FROM creacion_historica c JOIN reserva r ON c.resultado->>'id_pozo'=r.id::text WHERE c.resultado->>'numero_perforacion'=n::text
 UNION SELECT a.anterior#>>'{pozo,origen}' FROM administracion_eliminacion a JOIN reserva r ON r.id=a.id_pozo_original WHERE a.numero_perforacion=n
 UNION SELECT 'historico' FROM reingreso_historico h JOIN reserva r ON r.id=h.id_nuevo WHERE h.numero_perforacion=n
 ) SELECT CASE WHEN count(DISTINCT origen)=1 AND min(origen) IN('normal','historico') THEN min(origen) ELSE 'desconocido' END FROM evidencias WHERE origen IS NOT NULL
$$;
CREATE OR REPLACE FUNCTION siguiente_numero_disponible(desde bigint) RETURNS bigint
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 WITH ocupados AS MATERIALIZED(SELECT numero FROM numeros_no_disponibles() WHERE numero>=desde AND numero<=2147483647),
 candidatos AS (SELECT GREATEST(desde,1) n UNION SELECT numero+1 FROM ocupados
 UNION SELECT r.hasta+1 FROM politica_numeracion p,jsonb_to_recordset(p.rangos) r(desde bigint,hasta bigint)
 UNION SELECT unnest(excepciones)::bigint FROM politica_numeracion)
 SELECT COALESCE(min(n),2147483648) FROM candidatos WHERE n BETWEEN GREATEST(desde,1) AND 2147483647
 AND NOT numero_protegido(n) AND NOT EXISTS(SELECT 1 FROM ocupados WHERE numero=n)
$$;
CREATE OR REPLACE FUNCTION verificar_cursor_numeracion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.proximo IS DISTINCT FROM OLD.proximo AND NEW.proximo IS NOT NULL AND NEW.proximo<>2147483648 THEN
   IF NEW.proximo<1 OR numero_protegido(NEW.proximo) OR EXISTS(SELECT 1 FROM numeros_no_disponibles() WHERE numero=NEW.proximo) THEN
     RAISE EXCEPTION USING ERRCODE='P1104',MESSAGE='El número está ocupado, reservado o protegido por antecedentes históricos.';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION asignar_numero_perforacion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE siguiente bigint; automatica boolean;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.numero_perforacion IS NOT DISTINCT FROM OLD.numero_perforacion THEN RETURN NEW; END IF;
   IF OLD.numero_perforacion IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P1102',MESSAGE='El número ya asignado no puede modificarse.'; END IF;
 END IF;
 SELECT proximo INTO siguiente FROM numeracion_perforacion WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1100',MESSAGE='Falta configurar numeración.'; END IF;
 -- Un histórico sin número conocido no consume el cursor ni inventa una reserva.
 IF NEW.origen='historico' AND NEW.numero_perforacion IS NULL THEN RETURN NEW; END IF;
 automatica:=NEW.numero_perforacion IS NULL;
 IF automatica THEN
   IF siguiente IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1100',MESSAGE='Falta configurar numeración.'; END IF;
   IF siguiente>2147483647 THEN RAISE EXCEPTION USING ERRCODE='P1103',MESSAGE='Rango agotado.'; END IF;
   NEW.numero_perforacion:=siguiente;
 END IF;
 IF NEW.origen<>'historico' AND (numero_protegido(NEW.numero_perforacion) OR EXISTS(SELECT 1 FROM numeros_no_disponibles() WHERE numero=NEW.numero_perforacion)) THEN
   RAISE EXCEPTION USING ERRCODE='P1104',MESSAGE='El número está ocupado, reservado o protegido por antecedentes históricos.';
 END IF;
 INSERT INTO numero_perforacion_reservado(numero_perforacion,id_pozo_original) VALUES(NEW.numero_perforacion,NEW.id_pozo);
 UPDATE numeracion_perforacion SET mayor_asignado=GREATEST(mayor_asignado,NEW.numero_perforacion),
 proximo=CASE WHEN NEW.origen<>'historico' AND (automatica OR siguiente=NEW.numero_perforacion)
 THEN siguiente_numero_disponible(siguiente+1) ELSE siguiente END WHERE singleton;
 RETURN NEW;
END $$;
