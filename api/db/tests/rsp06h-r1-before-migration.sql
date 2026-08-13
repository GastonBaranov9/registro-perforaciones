WITH u AS (
  INSERT INTO usuario(email,nombre,password,activo)
  VALUES ('rsp06h-r1-clean@example.invalid','Control R1','sin-login',TRUE)
  RETURNING id_usuario
), s AS (
  INSERT INTO sitio(departamento,localidad) VALUES ('Control','Temporal') RETURNING id_sitio
), p AS (
  INSERT INTO pozo(id_propietario,id_sitio,id_perforador,creado_por,profundidad_final_m)
  SELECT u.id_usuario,s.id_sitio,u.id_usuario,u.id_usuario,10 FROM u CROSS JOIN s
  RETURNING id_pozo
)
INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material)
SELECT id_pozo,0,10,E'  Arenisca   fina\t' FROM p;
