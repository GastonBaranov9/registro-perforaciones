## Historia de usuario: Gestión de informes de perforación

### Título: Informes

Creación, edición, visualización y eliminación de informes por Administrador o Perforador.

### Descripción:

“Como administrador o perforador, quiero poder crear, editar, ver y eliminar informes de perforación, para registrar y consultar los resultados y observaciones de cada perforacion realizada.”

### Criterios de aceptación:

• El Administrador puede crear, editar, ver, eliminar y listar todos los informes.
• El Perforador puede crear, editar y ver solo sus propios informes.
• Campos de entrada y salida se definen según el esquema Informe.
• Los campos id_informe y id_pozo se generan automáticamente.

### Prioridad: Alta

### Estimación: 8 puntos

### Notas adicionales:

• Los informes deben asociarse a un pozo (id_pozo) y un usuario autor (por token o rol).

### Enlaces

--

### Definition of ready:

• Esquema Informe definido.
• Roles Administrador y Perforador creados y autenticados.
• Base de datos lista para almacenar informes con relación a pozos y usuarios.

### Definition of done:

• CRUD de informes funcional y validado.
• Documentación Swagger probada.
• Control de acceso por rol implementado.
• Tests de API funcionado (crear, listar, editar, borrar, permisos).
