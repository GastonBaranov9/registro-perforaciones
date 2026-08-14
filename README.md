# Proyecto Desarrollo Web - "Nombre de proyecto"

Las instrucciones para iniciar la api con su correspondiente documentación:

# Backend

1. Clonar el repositorio
2. Crear `.env` desde `.env.example` con credenciales locales no reutilizadas.
3. Levantar PostgreSQL y el migrador canónico: `docker compose --env-file .env -f docker-compose.development.yaml up -d`.
4. Verificar que `migrate` terminó con exit 0: `docker compose --env-file .env -f docker-compose.development.yaml ps --all migrate`. En un volumen nuevo aplica 000–006; en los siguientes arranques verifica checksums y no modifica datos si no hay pendientes.
5. Entrar en `/api`, instalar dependencias con `npm install` y levantar el servidor host con `npm run dev`. La API usa `PGHOST=127.0.0.1` y el `PGPORT` publicado (default documentado 5433), mientras el migrador usa `postgres:5432` dentro de Docker.
6. Entrar en [http://localhost:3000](http://localhost:3000).

Diagnóstico manual: desde `/api`, `npm run db:migrate` usa la configuración DB del proceso. La adopción de una base legacy nunca es automática; `--adopt-current-schema` requiere una decisión explícita.

# Frontend (Angular)

1. Entrar en la carpeta /front desde terminal
2. Instalar dependencias: `npm install`
3. Levantar el servidor: `npm start`
4. Entrar en [http://localhost:4200](http://localhost:4200)

| Historia de Usuario 1 | [Autenticacion y altas por administrador](hdu/autorizacion.md)
| Historia de Usuario 2 | [Creacion de PDF](hdu/creacion-pdf.md)
| Historia de Usuario 3 | [Flujo y estado de perforación](hdu/flujo-estados.md)
| Historia de Usuario 4 | [Ingresar datos de la perforación](hdu/ingresar-datos.md)
| Historia de Usuario 5 | [Login](hdu/login.md)
| Historia de Usuario 6 | [Registar perforacion en DINAGUA](hdu/registro-dinagua.md)

Manejo de errores de la API

[Ver tabla de errores detallada](hdu/errores.md)
En este documento se describen los códigos de error, su significado, el código HTTP asociado y el contexto donde pueden ocurrir.
