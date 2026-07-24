FROM node:24-alpine AS base
WORKDIR /api
EXPOSE 3000

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci              
COPY tsconfig.json ./
COPY src ./src
COPY public ./public  

RUN npm run build       

FROM base AS production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
USER node:node
COPY --from=build /api/dist ./dist
COPY --from=build /api/public ./public

CMD ["npm","start"]
