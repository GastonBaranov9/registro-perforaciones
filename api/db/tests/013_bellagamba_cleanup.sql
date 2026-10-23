-- Preparado para el backup rsp-backup-20261002T180908Z. Ensayo por defecto: ROLLBACK.
-- Sólo usar en ventana de mantenimiento, con backup fresco y autorización explícita.
-- psql -X -v ON_ERROR_STOP=1 -f 013_bellagamba_cleanup.sql
-- Para una ejecución aprobada posteriormente: añadir -v RSP_CLEANUP_COMMIT=true.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE rsp_cleanup_numeracion_antes ON COMMIT DROP AS
  SELECT proximo, mayor_asignado FROM numeracion_perforacion;
CREATE TEMP TABLE rsp_cleanup_reserva_antes ON COMMIT DROP AS
  SELECT numero_perforacion, id_pozo_original, asignado_en
  FROM numero_perforacion_reservado WHERE numero_perforacion=3001;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f'
      AND confrelid IN ('usuario'::regclass,'pozo'::regclass,'sitio'::regclass,'sesion_nativa'::regclass)
      AND conrelid NOT IN ('pozo'::regclass,'documento'::regclass,'informe'::regclass,
        'intervalo_litologico'::regclass,'intervalo_diametro_perforacion'::regclass,
        'intervalo_filtro'::regclass,'nivel_aporte'::regclass,'usuario_rol'::regclass,
        'sesion_nativa'::regclass,'ticket_ws_nativo'::regclass,
        'numeracion_perforacion_configuracion'::regclass))
    THEN RAISE EXCEPTION 'Hay nuevas tablas relacionadas; revisar dependencias'; END IF;
  IF (SELECT count(*) FROM usuario WHERE id_usuario IN (4,5,7) AND nombre='Marcelo Bellagamba') <> 3
    THEN RAISE EXCEPTION 'Identidades objetivo distintas del inventario'; END IF;
  IF (SELECT count(*) FROM usuario WHERE id_usuario IN (4,5) AND NOT cuenta_acceso AND activo) <> 2
    OR (SELECT count(*) FROM usuario WHERE id_usuario=7 AND cuenta_acceso AND activo) <> 1
    THEN RAISE EXCEPTION 'Estado de cuentas distinto del inventario'; END IF;
  IF (SELECT count(*) FROM usuario_rol ur JOIN rol r USING(id_rol)
      WHERE ur.id_usuario IN (4,5,7) AND r.nombre='propietario') <> 3
    OR (SELECT count(*) FROM usuario_rol WHERE id_usuario IN (4,5,7)) <> 3
    THEN RAISE EXCEPTION 'Roles distintos del inventario'; END IF;
  IF (SELECT count(*) FROM pozo WHERE id_propietario IN (4,5,7)
      OR id_perforador IN (4,5,7) OR creado_por IN (4,5,7)) <> 2
    OR NOT EXISTS (SELECT 1 FROM pozo WHERE id_pozo=2 AND id_propietario=7
      AND id_perforador=3 AND creado_por=1 AND id_sitio=2 AND numero_perforacion IS NULL)
    OR NOT EXISTS (SELECT 1 FROM pozo WHERE id_pozo=4 AND id_propietario=4
      AND id_perforador=6 AND creado_por=1 AND id_sitio=4 AND numero_perforacion=3001)
    THEN RAISE EXCEPTION 'Pozos relacionados distintos del inventario'; END IF;
  IF (SELECT count(*) FROM pozo WHERE id_sitio IN (2,4)) <> 2
    THEN RAISE EXCEPTION 'Los sitios objetivo tienen otros pozos'; END IF;
  IF (SELECT count(*) FROM intervalo_litologico WHERE id_pozo=2) <> 3
    OR (SELECT count(*) FROM intervalo_litologico WHERE id_pozo=4) <> 4
    OR (SELECT count(*) FROM intervalo_diametro_perforacion WHERE id_pozo=2) <> 2
    OR (SELECT count(*) FROM intervalo_diametro_perforacion WHERE id_pozo=4) <> 2
    OR (SELECT count(*) FROM intervalo_filtro WHERE id_pozo=2) <> 1
    OR (SELECT count(*) FROM intervalo_filtro WHERE id_pozo=4) <> 0
    OR (SELECT count(*) FROM nivel_aporte WHERE id_pozo=2) <> 1
    OR (SELECT count(*) FROM nivel_aporte WHERE id_pozo=4) <> 2
    THEN RAISE EXCEPTION 'Datos técnicos distintos del inventario'; END IF;
  IF EXISTS (SELECT 1 FROM documento WHERE id_pozo IN (2,4) OR generado_por IN (4,5,7))
    OR EXISTS (SELECT 1 FROM informe WHERE id_pozo IN (2,4) OR generado_por IN (4,5,7))
    OR EXISTS (SELECT 1 FROM numeracion_perforacion_configuracion WHERE cambiado_por IN (4,5,7))
    OR EXISTS (SELECT 1 FROM ticket_ws_nativo WHERE id_sesion_nativa IN
      (SELECT id_sesion_nativa FROM sesion_nativa WHERE id_usuario IN (4,5,7)))
    THEN RAISE EXCEPTION 'Referencias adicionales requieren nueva revisión'; END IF;
  IF (SELECT count(*) FROM sesion_nativa WHERE id_usuario IN (4,5,7)) <> 1
    OR NOT EXISTS (SELECT 1 FROM sesion_nativa WHERE id_sesion_nativa=16 AND id_usuario=7 AND revoked_at IS NOT NULL)
    THEN RAISE EXCEPTION 'Sesiones distintas del inventario'; END IF;
  IF (SELECT count(*) FROM rsp_cleanup_reserva_antes WHERE numero_perforacion=3001 AND id_pozo_original=4) <> 1
    THEN RAISE EXCEPTION 'Reserva 3001 distinta del inventario'; END IF;
END $$;

-- Hijos explícitos; no se usa DELETE CASCADE indiscriminado.
DELETE FROM intervalo_litologico WHERE id_pozo IN (2,4);
DELETE FROM intervalo_diametro_perforacion WHERE id_pozo IN (2,4);
DELETE FROM intervalo_filtro WHERE id_pozo IN (2,4);
DELETE FROM nivel_aporte WHERE id_pozo IN (2,4);
DELETE FROM pozo WHERE id_pozo IN (2,4);
DELETE FROM sitio WHERE id_sitio IN (2,4);
DELETE FROM sesion_nativa WHERE id_sesion_nativa=16 AND id_usuario=7;
DELETE FROM usuario_rol WHERE id_usuario IN (4,5,7);
DELETE FROM usuario WHERE id_usuario IN (4,5,7) AND nombre='Marcelo Bellagamba';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM usuario WHERE id_usuario IN (4,5,7))
    OR EXISTS (SELECT 1 FROM pozo WHERE id_pozo IN (2,4))
    OR EXISTS (SELECT 1 FROM sitio WHERE id_sitio IN (2,4))
    OR EXISTS (SELECT 1 FROM sesion_nativa WHERE id_usuario IN (4,5,7))
    THEN RAISE EXCEPTION 'Verificación posterior de limpieza fallida'; END IF;
  IF EXISTS ((SELECT proximo,mayor_asignado FROM numeracion_perforacion
              EXCEPT SELECT proximo,mayor_asignado FROM rsp_cleanup_numeracion_antes)
             UNION ALL
             (SELECT proximo,mayor_asignado FROM rsp_cleanup_numeracion_antes
              EXCEPT SELECT proximo,mayor_asignado FROM numeracion_perforacion))
    OR EXISTS ((SELECT numero_perforacion,id_pozo_original,asignado_en FROM numero_perforacion_reservado WHERE numero_perforacion=3001
                EXCEPT SELECT numero_perforacion,id_pozo_original,asignado_en FROM rsp_cleanup_reserva_antes)
               UNION ALL
               (SELECT numero_perforacion,id_pozo_original,asignado_en FROM rsp_cleanup_reserva_antes
                EXCEPT SELECT numero_perforacion,id_pozo_original,asignado_en FROM numero_perforacion_reservado WHERE numero_perforacion=3001))
    THEN RAISE EXCEPTION 'La numeración o la reserva cambiaron'; END IF;
END $$;

SELECT 'ensayo antes de cerrar transacción' AS estado,
  (SELECT count(*) FROM usuario WHERE id_usuario IN (4,5,7)) AS identidades_restantes,
  (SELECT count(*) FROM pozo WHERE id_pozo IN (2,4)) AS pozos_restantes,
  (SELECT id_pozo_original FROM numero_perforacion_reservado WHERE numero_perforacion=3001) AS reserva_3001;

\if :{?RSP_CLEANUP_COMMIT}
  \if :RSP_CLEANUP_COMMIT
    COMMIT;
  \else
    ROLLBACK;
  \endif
\else
  ROLLBACK;
\endif
