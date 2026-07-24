## Historia de usuario: Gestión de intervalos

### Título: Gestión de intervalos

Administración de intervalos (diámetro, litológico y niveles de aporte) asociados a cada pozo.

### Descripción:

“Como administrador o perforador, quiero poder crear, editar, eliminar y visualizar los intervalos técnicos de cada pozo, para registrar la información geológica y estructural de las perforaciones.”

### Criterios de aceptación:

• Cada intervalo técnico pertenece a un pozo identificado por id_pozo.
• Los tipos de intervalos gestionados son:

- Intervalo de diámetro → /pozos/:id_pozo/intervalo_diametro_perforacion
- Intervalo litológico → /pozos/:id_pozo/intervalo_litologico
- Niveles de aporte → /pozos/:id_pozo/niveles-aporte

• No superponer intervalos dentro de un mismo pozo.
• Mantener consistencia entre profundidad inicial y final.

### Prioridad: Alta

### Estimación: 10 puntos

### Notas adicionales:

• Los tres tipos de intervalos comparten la misma estructura lógica de CRUD y control de permisos.

### Enlaces

--

### Definition of ready:

• Esquemas de Pozo y los tres tipos de intervalos definidos en schemas.
• Roles Administrador y Perforador configurados y autenticados.
• Base de datos lista con relaciones 1:N (un pozo puede tener múltiples intervalos).

### Definition of done:

• CRUD completo implementado para los cuatros tipos de intervalos.
• Control de acceso por rol verificado.
• Documentación visible en Swagger /docs.
• Pruebas exitosas para crear, obtener, editar y eliminar intervalos.
