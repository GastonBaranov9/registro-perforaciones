INSERT INTO rol (nombre, descr) VALUES
  ('operador_administrativo', 'Operación de pozos y carga histórica sin administración de usuarios ni del sistema')
ON CONFLICT (nombre) DO NOTHING;
