-- Búsqueda parcial sin tildes y paginación de perforaciones por identidad real.
-- Sólo índices; no altera datos ni credenciales existentes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX usuario_nombre_admin_trgm_idx ON public.usuario USING gin
  ((translate(lower(nombre), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun')) gin_trgm_ops);
CREATE INDEX usuario_documento_admin_trgm_idx ON public.usuario USING gin
  ((translate(lower(COALESCE(documento_rut, '')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun')) gin_trgm_ops);
CREATE INDEX pozo_propietario_fecha_admin_idx ON public.pozo
  (id_propietario, fecha_creado DESC, id_pozo DESC)
  WHERE id_propietario IS NOT NULL;
