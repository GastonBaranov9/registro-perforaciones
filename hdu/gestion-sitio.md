## Historia de usuario: Gestión de sitios

### Título: Gestión de sitios

Administración de sitios por parte de Administrador o Perforador.

### Descripción:

“Como administrador o perforador, quiero poder crear, editar, eliminar y consultar sitios, para registrar y mantener actualizada la información de los lugares donde se ejecutan perforaciones o se ubican los pozos.”

### Criterios de aceptación:

• Cada sitio representa una ubicación física o geográfica donde pueden existir uno o más pozos.
• Un sitio puede tener cero, uno o varios pozos asociados (relación 1:N).
• Debe evitarse la creación de sitios duplicados con igual nombre y coordenadas.
• Solo los roles Administrador y Perforador pueden acceder a estas rutas.
• El campo id_sitio se genera automáticamente al crear el registro.

### Prioridad: Alta

### Estimación: 8 puntos

### Notas adicionales:

• Los campos geográficos del sitio deben permitir validar latitud y longitud.

### Enlaces

--

### Definition of ready:

• Esquema Sitio definido en schemas.ts.
• Roles Administrador y Perforador configurados.
• Relación entre Sitio y Pozo definida (1:N).
• Validaciones geográficas establecidas (formato de coordenadas).

### Definition of done:

• CRUD de sitios implementado y funcional.
• Control de permisos por rol verificado.
• Documentación Swagger en /docs.
• Prueba de creación, edición, eliminación y consulta.
• Prueba de integración validando que un pozo se asocie correctamente a un sitio.
