\echo 'ERROR: api/db/scripts.sql fue retirado por RSP-07C porque era destructivo.'
\echo 'Use el comando explícito npm run db:migrate sobre una base vacía.'
\echo 'Para adoptar una base existente verificada use npm run db:migrate -- --adopt-current-schema.'
\quit 3
