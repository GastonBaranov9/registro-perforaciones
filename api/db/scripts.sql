DROP TABLE IF EXISTS
  documento,
  pozo_estado_hist,
  regla_transicion,
  transicion,
  estado,
  nivel_aporte,
  intervalo_diametro_perforacion,
  intervalo_litologico,
  pozo,
  perforador,
  empresa,
  sitio,
  propietario,
  rol_permiso,
  permiso,
  usuario_rol,
  rol,
  usuario
CASCADE;

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE usuario (
  id_usuario      BIGSERIAL PRIMARY KEY,
  email           CITEXT NOT NULL UNIQUE,
  nombre          VARCHAR NOT NULL,
  password        VARCHAR NOT NULL,    
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_registro  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rol (
  id_rol  BIGSERIAL PRIMARY KEY,
  nombre  VARCHAR NOT NULL UNIQUE,
  descr   VARCHAR NOT NULL
);

CREATE TABLE usuario_rol (
  id_usuario BIGINT REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  id_rol     BIGINT REFERENCES rol(id_rol)        ON DELETE CASCADE,
  PRIMARY KEY (id_usuario, id_rol)
);

CREATE TABLE permiso (
  id_permiso BIGSERIAL PRIMARY KEY,
  clave      TEXT NOT NULL UNIQUE,
  descr      VARCHAR NOT NULL        
);

CREATE TABLE rol_permiso (
  id_rol     BIGINT REFERENCES rol(id_rol)           ON DELETE CASCADE,
  id_permiso BIGINT REFERENCES permiso(id_permiso)   ON DELETE CASCADE,
  PRIMARY KEY (id_rol, id_permiso)
);



CREATE TABLE sitio (
  id_sitio      BIGSERIAL PRIMARY KEY,
  departamento  VARCHAR NOT NULL,
  localidad     VARCHAR,
  latitud       VARCHAR,   
  longitud      VARCHAR
);



CREATE TABLE pozo (
  id_pozo              BIGSERIAL PRIMARY KEY,
  id_propietario       BIGINT NOT NULL REFERENCES usuario(id_usuario),
  id_sitio             BIGINT NOT NULL REFERENCES sitio(id_sitio),
  empresa              VARCHAR,
  id_perforador        BIGINT NOT NULL REFERENCES usuario(id_usuario),  
  creado_por           BIGINT REFERENCES usuario(id_usuario),                
  fecha_inicio         DATE,
  fecha_fin            DATE,
  profundidad_final_m  NUMERIC CHECK (profundidad_final_m > 0),
  sello_sanitario      BOOLEAN,
  pre_filtro           VARCHAR,
  nivel_estatico_m     NUMERIC,
  nivel_dinamico_m     NUMERIC,
  caudal_estimado_lh   INTEGER,
  metodo_sedimentario  VARCHAR, 
  metodo_rocoso        VARCHAR, 
  cementacion          VARCHAR, 
  desarrollo           VARCHAR, 
  revestimiento        VARCHAR,
  foto_url             VARCHAR,
  fecha_creado         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE intervalo_litologico (
  id_intervalo_litologico BIGSERIAL PRIMARY KEY,
  id_pozo                 BIGINT NOT NULL REFERENCES pozo(id_pozo) ON DELETE CASCADE,
  desde_m                 NUMERIC NOT NULL,
  hasta_m                 NUMERIC NOT NULL,
  material                VARCHAR NOT NULL,
  CHECK (hasta_m > desde_m)
);

CREATE TABLE intervalo_diametro_perforacion (
  id_intervalo_diametro_perforacion BIGSERIAL PRIMARY KEY,
  id_pozo                           BIGINT NOT NULL REFERENCES pozo(id_pozo) ON DELETE CASCADE,
  desde_m                           NUMERIC NOT NULL,
  hasta_m                           NUMERIC NOT NULL,
  diametro_pulg                     NUMERIC NOT NULL,
  CHECK (hasta_m > desde_m)
);

CREATE TABLE nivel_aporte (
  id_nivel_aporte BIGSERIAL PRIMARY KEY,
  id_pozo         BIGINT NOT NULL REFERENCES pozo(id_pozo) ON DELETE CASCADE,
  profundidad_m   NUMERIC NOT NULL CHECK (profundidad_m >= 0)
);


CREATE TABLE documento (
  id_documento  BIGSERIAL PRIMARY KEY,
  id_pozo       BIGINT NOT NULL REFERENCES pozo(id_pozo) ON DELETE CASCADE,
  tipo          VARCHAR,
  nombre_archivo VARCHAR NOT NULL,
  ruta          VARCHAR,
  generado_por  BIGINT REFERENCES usuario(id_usuario),
  generado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE informe (
  id_informe   BIGSERIAL PRIMARY KEY,
  id_pozo      BIGINT NOT NULL REFERENCES pozo(id_pozo) ON DELETE CASCADE,
  titulo       VARCHAR NOT NULL,
  descripcion  TEXT,
  generado_por BIGINT NOT NULL REFERENCES usuario(id_usuario),
  generado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);



-- Los roles, permisos, usuarios iniciales y datos de demostración
-- se gestionarán posteriormente mediante migraciones y seeds separados.
-- Este script no crea cuentas con contraseñas predeterminadas.
