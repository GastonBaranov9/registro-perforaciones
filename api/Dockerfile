FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS base
WORKDIR /api
EXPOSE 3000

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci              
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY db ./db

RUN npm run build

FROM base AS production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node --from=build /api/dist ./dist
COPY --chown=node:node --from=build /api/public ./public
COPY --chown=node:node --from=build /api/db ./db

# Un volumen nuevo copia este subdirectorio con ownership 1000:1000. El
# proceso continúa sin privilegios y solo escribe dentro de `fotos`.
RUN mkdir -p /var/lib/registro-perforaciones/fotos/.trash \
  && chown -R node:node /var/lib/registro-perforaciones/fotos

USER node:node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm","start"]
