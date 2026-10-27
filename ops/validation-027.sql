-- Executed only inside a REPEATABLE READ READ ONLY transaction.
-- No personal contents leave PostgreSQL: counts, SHA-256 fingerprints and schema.
WITH tables AS (
 SELECT c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r'
), inventory AS (
 SELECT relname,
   (xpath('/row/n/text()',x))[1]::text::bigint AS n,
   (xpath('/row/hash/text()',x))[1]::text AS hash,
   (xpath('/row/business/text()',x))[1]::text AS business
 FROM tables CROSS JOIN LATERAL query_to_xml(format(
   'SELECT count(*) n, encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t))::text,''[]''),''UTF8'')),''hex'') hash,
    encode(sha256(convert_to(coalesce(jsonb_agg(%s ORDER BY %s)::text,''[]''),''UTF8'')),''hex'') business FROM public.%I t',
   CASE WHEN relname='usuario' THEN 'to_jsonb(t)-''version_sesion''' ELSE 'to_jsonb(t)' END,
   CASE WHEN relname='usuario' THEN 'to_jsonb(t)-''version_sesion''' ELSE 'to_jsonb(t)' END,relname),false,true,'') x
 WHERE relname NOT IN ('schema_migrations','prefiltro_pozo')
), structures AS (
 SELECT relname,jsonb_build_object(
   'rls',relrowsecurity,'force_rls',relforcerowsecurity,
   'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'identity',a.attidentity,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped),
   'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'def',pg_get_constraintdef(c.oid),'validated',c.convalidated,'deferred',c.condeferrable) ORDER BY c.conname),'[]') FROM pg_constraint c WHERE c.conrelid=t.oid),
   'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('def',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready) ORDER BY pg_get_indexdef(i.indexrelid)),'[]') FROM pg_index i WHERE i.indrelid=t.oid),
   'triggers',(SELECT coalesce(jsonb_agg(pg_get_triggerdef(g.oid) ORDER BY g.tgname),'[]') FROM pg_trigger g WHERE g.tgrelid=t.oid AND NOT g.tgisinternal)
 ) AS definition FROM tables t
)
SELECT json_build_object(
 'ledger',(SELECT json_agg(x ORDER BY version) FROM (SELECT version,nombre,checksum_sha256 FROM schema_migrations)x),
 'counter',(SELECT json_build_object('proximo',proximo,'mayor_asignado',mayor_asignado) FROM numeracion_perforacion WHERE singleton),
 'data',(SELECT json_object_agg(relname,json_build_object('count',n,'hash',hash,'business',business) ORDER BY relname) FROM inventory),
 'sessions',(SELECT json_agg(json_build_object('id',id_usuario,'version',version_sesion) ORDER BY id_usuario) FROM usuario),
 'schema',(SELECT json_object_agg(relname,definition ORDER BY relname) FROM structures WHERE relname<>'prefiltro_pozo'),
 'functions',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid))::text,'[]'),'UTF8')),'hex') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'),
 'sequences',(SELECT coalesce(json_object_agg(c.relname,(xpath('/row/v/text()',query_to_xml(format('SELECT row_to_json(s)::text v FROM (SELECT last_value,log_cnt,is_called FROM public.%I) s',c.relname),false,true,'')))[1]::text ORDER BY c.relname),'{}') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'),
 'prefiltro',(SELECT definition FROM structures WHERE relname='prefiltro_pozo'),
 'prefiltro_rows',CASE WHEN to_regclass('public.prefiltro_pozo') IS NULL THEN NULL ELSE (xpath('/row/n/text()',query_to_xml('SELECT count(*) n FROM public.prefiltro_pozo',false,true,'')))[1]::text::bigint END
);
