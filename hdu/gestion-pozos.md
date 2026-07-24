## Historia de usuario: Gestión de pozos y su ciclo de estados

### Título: Gestión de pozos

Administración completa del ciclo de vida de un pozo (creación, edición, consulta y ciclo de estados).

### Descripción:

“Como administrador o perforador, quiero poder crear, editar y gestionar los pozos en el sistema, incluyendo su estado operativo (ingresando, enviado, confirmado, cerrado), para mantener el seguimiento completo del proceso de perforación.”

### Criterios de aceptación:

• Rutas implementadas:

- POST /pozos → Crear un nuevo pozo (estado inicial: ingresando).
- PUT /pozos/:id_pozo → Editar o completar la información de un pozo.
- GET /pozos/:id_pozo → Obtener un pozo específico.
- GET /pozos → Listar todos los pozos.
  • Gestion del estado de pozo (obtener estado, enviado, confirmado, cerrado)
  • No se permite una transición de estado inválida (retornar 400 Transición inválida).
  • Si el pozo no existe, retornar 404 Pozo no encontrado.

### Prioridad: Alta

### Estimación: 10 puntos

### Notas adicionales:

--

### Enlaces

--

### Definition of ready:

• Esquemas Pozo, Estado y PozoEstadoHist definidos en schemas.ts.
• Roles Administrador y Perforador configurados.

### Definition of done:

• CRUD de pozos completamente funcional.
• Gestión de estados implementada con validaciones.
• Documentación visible en Swagger /docs.
• Tests de API exitosos para creación, edición, consulta y transición de estados.
