-- No personal row contents leave PostgreSQL: only identities and fingerprints.
WITH identities AS (
 SELECT 19::bigint id UNION SELECT 31
 UNION SELECT id_original FROM reingreso_historico WHERE numero_perforacion=3277
 UNION SELECT id_nuevo FROM reingreso_historico WHERE numero_perforacion=3277
)
SELECT json_build_object(
 'ledger',(SELECT json_agg(x ORDER BY version) FROM (SELECT version,nombre,checksum_sha256 FROM schema_migrations)x),
 'counter',(SELECT json_build_object('proximo',proximo,'mayor_asignado',mayor_asignado) FROM numeracion_perforacion WHERE singleton),
 'authorized',(SELECT coalesce(json_agg(usuario ORDER BY usuario),'[]') FROM autorizacion_numeracion WHERE activa),
 'admin1',(SELECT activo AND cuenta_acceso AND EXISTS(SELECT 1 FROM usuario_rol ur JOIN rol r USING(id_rol) WHERE ur.id_usuario=1 AND r.nombre='administracion') FROM usuario WHERE id_usuario=1),
 'chain',json_build_object(
   'active',(SELECT count(*) FROM pozo WHERE numero_perforacion=3277 OR id_pozo IN(SELECT id FROM identities)),
   'reservation',(SELECT id_pozo_original FROM numero_perforacion_reservado WHERE numero_perforacion=3277),
   'edges',(SELECT coalesce(json_agg(json_build_object('from',id_original,'to',id_nuevo,'number',numero_perforacion) ORDER BY id),'[]') FROM reingreso_historico WHERE numero_perforacion=3277 OR id_original IN(SELECT id FROM identities) OR id_nuevo IN(SELECT id FROM identities)),
   'references',(SELECT coalesce(json_agg(json_build_object('id',resultado->>'id_pozo','number',resultado->>'numero_perforacion') ORDER BY resultado->>'id_pozo'),'[]') FROM creacion_historica WHERE resultado->>'numero_perforacion'='3277' OR resultado->>'id_pozo' IN(SELECT id::text FROM identities)),
   'deleted31',(SELECT count(*) FROM administracion_eliminacion WHERE id_pozo_original=31 AND numero_perforacion=3277 AND operacion='eliminar')
 ),
 'protected',json_build_object(
   'pozo',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,'[]')) FROM pozo t),
   'reservas',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,'[]')) FROM numero_perforacion_reservado t),
   'historicos',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,'[]')) FROM creacion_historica t),
   'offline',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,'[]')) FROM creacion_offline t),
   'reingresos',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,'[]')) FROM reingreso_historico t),
   'eliminaciones',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,'[]')) FROM administracion_eliminacion t),
   'configuracion',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,'[]')) FROM numeracion_perforacion_configuracion t),
   'rectificaciones',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,'[]')) FROM numeracion_rectificacion t),
   'capacidades',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,'[]')) FROM autorizacion_numeracion t),
   'capacidad_historial',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,'[]')) FROM autorizacion_numeracion_historial t),
   'roles',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,'[]')) FROM usuario_rol t)
 ));
