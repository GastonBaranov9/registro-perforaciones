BEGIN;

CREATE OR REPLACE FUNCTION litologia_normalizar(valor TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
RETURN lower(translate(btrim(regexp_replace(valor, '\\s+', ' ', 'g')), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));

CREATE TABLE catalogo_litologia (
  id_litologia BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(64) NOT NULL UNIQUE CHECK (codigo ~ '^[a-z][a-z0-9_]*$'),
  nombre VARCHAR(120) NOT NULL CHECK (nombre = btrim(nombre) AND nombre <> ''),
  nombre_normalizado TEXT GENERATED ALWAYS AS (litologia_normalizar(nombre)) STORED,
  familia VARCHAR(32) NOT NULL CHECK (familia IN ('basalto','suelo','arenisca','arcilla_arena','tosca','gravilla','granito','otro')),
  color VARCHAR(7) NOT NULL CHECK (color ~ '^#[0-9A-F]{6}$'),
  patron VARCHAR(32) NOT NULL CHECK (patron IN ('basalt','basalt_fractured','organic','sandstone_fine','sandstone_medium','sandstone_coarse','clay','sandy_clay','tosca','gravel_fine','gravel_coarse','granite')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  orden INTEGER NOT NULL CHECK (orden >= 0),
  es_inicial BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalogo_litologia_nombre_normalizado_uq UNIQUE (nombre_normalizado)
);

INSERT INTO catalogo_litologia (codigo,nombre,familia,color,patron,orden,es_inicial) VALUES
('basalto_marron','Basalto marrón','basalto','#795548','basalt',1,TRUE),
('basalto_marron_rojizo','Basalto marrón-rojizo','basalto','#70423A','basalt',2,TRUE),
('basalto_gris_oscuro','Basalto gris oscuro','basalto','#42464B','basalt',3,TRUE),
('basalto_negro','Basalto negro','basalto','#202124','basalt',4,TRUE),
('basalto_fracturado','Basalto fracturado','basalto','#555B61','basalt_fractured',5,TRUE),
('suelo_organico','Suelo orgánico','suelo','#4E342E','organic',6,TRUE),
('arenisca_rosada','Arenisca rosada','arenisca','#C98783','sandstone_medium',7,TRUE),
('arenisca_rojiza','Arenisca rojiza','arenisca','#A65345','sandstone_medium',8,TRUE),
('arenisca_blanca','Arenisca blanca','arenisca','#E7DDC7','sandstone_medium',9,TRUE),
('arenisca_fina','Arenisca fina','arenisca','#D7B77A','sandstone_fine',10,TRUE),
('arenisca_media','Arenisca media','arenisca','#C9A467','sandstone_medium',11,TRUE),
('arenisca_gruesa','Arenisca gruesa','arenisca','#B58B50','sandstone_coarse',12,TRUE),
('arcilla_roja','Arcilla roja','arcilla_arena','#9E463D','clay',13,TRUE),
('arcilla_marron','Arcilla marrón','arcilla_arena','#795548','clay',14,TRUE),
('arcilla_gris','Arcilla gris','arcilla_arena','#777B7E','clay',15,TRUE),
('arena_arcillosa','Arena arcillosa','arcilla_arena','#B89062','sandy_clay',16,TRUE),
('arcilla_negra','Arcilla negra','arcilla_arena','#292929','clay',17,TRUE),
('arcilla_rosada','Arcilla rosada','arcilla_arena','#C47F7B','clay',18,TRUE),
('tosca_rosada','Tosca rosada','tosca','#D29A91','tosca',19,TRUE),
('tosca_blanca','Tosca blanca','tosca','#E8E0D0','tosca',20,TRUE),
('tosca_amarilla','Tosca amarilla','tosca','#D1AF58','tosca',21,TRUE),
('tosca_marron','Tosca marrón','tosca','#846044','tosca',22,TRUE),
('tosca_rojiza','Tosca rojiza','tosca','#A95747','tosca',23,TRUE),
('tosca_compacta','Tosca compacta','tosca','#8C7A62','tosca',24,TRUE),
('gravilla_fina','Gravilla fina','gravilla','#777D7C','gravel_fine',25,TRUE),
('gravilla_gruesa','Gravilla gruesa','gravilla','#756657','gravel_coarse',26,TRUE),
('granito_rosado','Granito rosado','granito','#C58D8A','granite',27,TRUE),
('granito_blanco','Granito blanco','granito','#DDDAD0','granite',28,TRUE),
('granito_gris','Granito gris','granito','#85898C','granite',29,TRUE);

ALTER TABLE intervalo_litologico ADD COLUMN id_litologia BIGINT;
ALTER TABLE intervalo_litologico ADD CONSTRAINT intervalo_litologico_catalogo_fk
  FOREIGN KEY (id_litologia) REFERENCES catalogo_litologia(id_litologia) ON DELETE RESTRICT;
CREATE INDEX intervalo_litologico_id_litologia_idx ON intervalo_litologico(id_litologia);

UPDATE intervalo_litologico i
SET id_litologia = c.id_litologia
FROM catalogo_litologia c
WHERE litologia_normalizar(i.material) = c.nombre_normalizado;

COMMIT;

-- Rollback manual (conserva material y todos los intervalos):
-- BEGIN; ALTER TABLE intervalo_litologico DROP CONSTRAINT intervalo_litologico_catalogo_fk;
-- DROP INDEX intervalo_litologico_id_litologia_idx; ALTER TABLE intervalo_litologico DROP COLUMN id_litologia;
-- DROP TABLE catalogo_litologia; DROP FUNCTION litologia_normalizar(TEXT); COMMIT;
