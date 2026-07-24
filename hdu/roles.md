## Historia de usuario: Gestión de roles

### Título: Gestión de roles

Administración de roles del sistema por parte del Administrador del sistema.

### Descripción:

“Como administrador, quiero poder crear, editar, eliminar y consultar roles dentro del sistema, para definir los niveles de acceso y permisos de los usuarios.”

### Criterios de aceptación:

• Solo el rol Administrador puede acceder a estas rutas de roles.

- PUT /roles/:id_rol → Editar un rol.
- DELETE /roles/:id_rol → Eliminar un rol.
- GET /roles/:id_rol → Obtener un rol.
- GET /roles → Listar todos los roles.

### Prioridad: Alta

### Estimación: 8 puntos

### Notas adicionales:

• Los roles son utilizados por los módulos de autenticación y control de acceso.

### Enlaces

--

### Definition of ready:

• Esquema Rol definido en schemas.ts.
• Rol Administrador configurado y autenticado.

### Definition of done:

• CRUD funcional completo para roles.
• Control de permisos (solo Administrador del sistema).
• Documentación Swagger en /docs funcionando.
• Prueba de creación, consulta, edición y eliminación exitosos.
