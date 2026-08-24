ALTER TABLE public.usuario
  ADD COLUMN documento_rut VARCHAR(80),
  ADD COLUMN telefono VARCHAR(80),
  ADD COLUMN propietario_email VARCHAR(254),
  ADD COLUMN direccion VARCHAR(300),
  ADD COLUMN localidad VARCHAR(160),
  ADD COLUMN departamento VARCHAR(32),
  ADD COLUMN observaciones VARCHAR(2000);

ALTER TABLE public.usuario
  ADD CONSTRAINT usuario_propietario_departamento_check
  CHECK (
    departamento IS NULL OR departamento IN (
      'Artigas', 'Canelones', 'Cerro Largo', 'Colonia', 'Durazno',
      'Flores', 'Florida', 'Lavalleja', 'Maldonado', 'Montevideo',
      'Paysandú', 'Río Negro', 'Rivera', 'Rocha', 'Salto', 'San José',
      'Soriano', 'Tacuarembó', 'Treinta y Tres'
    )
  );

ALTER TABLE public.sitio
  ADD COLUMN padron VARCHAR(80);

