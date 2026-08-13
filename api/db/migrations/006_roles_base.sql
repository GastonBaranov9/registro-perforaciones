INSERT INTO rol (nombre, descr) VALUES
  ('administracion', 'Administración general del sistema'),
  ('perforador', 'Registro y gestión técnica de perforaciones'),
  ('propietario', 'Consulta de perforaciones propias')
ON CONFLICT (nombre) DO UPDATE SET descr = EXCLUDED.descr;
