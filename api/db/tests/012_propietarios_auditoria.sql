-- Diagnóstico únicamente: un nombre compartido NO demuestra que sea la misma persona.
BEGIN READ ONLY;
WITH nombres_repetidos AS (
  SELECT lower(btrim(nombre)) AS nombre
  FROM usuario
  GROUP BY lower(btrim(nombre)) HAVING count(*) > 1
)
SELECT u.id_usuario, u.nombre, u.activo, u.cuenta_acceso,
       u.documento_rut, u.telefono, u.propietario_email,
       (SELECT count(*) FROM pozo WHERE id_propietario=u.id_usuario) AS pozos_propios,
       (SELECT count(*) FROM pozo WHERE id_perforador=u.id_usuario) AS pozos_perforados,
       (SELECT count(*) FROM pozo WHERE creado_por=u.id_usuario) AS pozos_creados,
       (SELECT count(*) FROM informe WHERE generado_por=u.id_usuario) AS informes_generados,
       (SELECT count(*) FROM documento WHERE generado_por=u.id_usuario) AS documentos_generados,
       (SELECT count(*) FROM numeracion_perforacion_configuracion WHERE cambiado_por=u.id_usuario) AS cambios_numeracion,
       (SELECT count(*) FROM sesion_nativa WHERE id_usuario=u.id_usuario) AS sesiones,
       (SELECT string_agg(r.nombre, ', ' ORDER BY r.nombre)
          FROM usuario_rol ur JOIN rol r USING(id_rol) WHERE ur.id_usuario=u.id_usuario) AS roles
FROM usuario u JOIN nombres_repetidos n ON lower(btrim(u.nombre))=n.nombre
ORDER BY n.nombre, u.id_usuario;

-- Inventariar también las FK reales antes de cualquier conciliación futura.
SELECT conrelid::regclass AS tabla, pg_get_constraintdef(oid) AS relacion
FROM pg_constraint WHERE contype='f' AND confrelid='usuario'::regclass
ORDER BY conrelid::regclass::text, conname;
COMMIT;
