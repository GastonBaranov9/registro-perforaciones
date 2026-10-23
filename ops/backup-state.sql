-- No row contents leave PostgreSQL: deterministic fingerprints plus sequences.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT format('SELECT %L, count(*), md5(COALESCE(string_agg(md5(row_to_json(t)::text), '''' ORDER BY md5(row_to_json(t)::text)), '''')) FROM %I.%I t',
              schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema'
ORDER BY schemaname, tablename
\gexec
SELECT format('SELECT %L, last_value, is_called FROM %I.%I',
              schemaname || '.' || sequencename, schemaname, sequencename)
FROM pg_sequences WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema'
ORDER BY schemaname, sequencename
\gexec
COMMIT;
