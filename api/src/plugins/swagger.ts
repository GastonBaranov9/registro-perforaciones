import swagger from "@fastify/swagger";
import type { FastifySwaggerOptions } from "@fastify/swagger";
import swaggerui from "@fastify/swagger-ui";
import fp from "fastify-plugin";

// declare namespace fastify {
//   export interface FastifySchema {
//       summary?: string;
//       description?: string;
//       tags?: string[];
//   }
// }

//En vez de exportar la función la encapsulamos con fastify plugin.
export default fp<FastifySwaggerOptions>(async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "Test swagger",
        description: "Testing the Fastify swagger API",
        version: "0.1.0",
      },
      servers: [
        {
          url: "http://localhost:3000",
          description: "Development server",
        },
      ],
      tags: [
        {
          name: "informes",
          description: "Generar y consultar los informes",
        },
        {
          name: "intervalos-diametro-perforaciones",
          description:
            "Generar y consultar intervalos de diametro de la perforacion",
        },
        {
          name: "intervalos-litologicos",
          description: "Generar y consultar informe",
        },
        {
          name: "niveles-aporte",
          description: "Generar y consultar los niveles de aporte de los pozos",
        },
        {
          name: "sitios",
          description: "Generar y consultar los sitios",
        },
        {
          name: "login",
          description: "Autenticación de usuarios",
        },
        {
          name: "pozos",
          description: "Gestión de perforaciones",
        },
        {
          name: "roles",
          description: "Administración de roles y permisos",
        },

        { name: "usuarios", description: "Gestión de usuarios del sistema" },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      externalDocs: {
        url: "https://swagger.io",
        description: "Find more info here",
      },
    },
  });

  await fastify.register(swaggerui, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "none",
      deepLinking: false,
    },
    uiHooks: {
      onRequest: function (request, reply, next) {
        next();
      },
      preHandler: function (request, reply, next) {
        next();
      },
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
    transformSpecification: (swaggerObject, request, reply) => {
      return swaggerObject;
    },
    transformSpecificationClone: true,
  });
});
