FROM node:24-alpine AS base
WORKDIR /front

# Stage para hacer build de angular
FROM base as build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build --prod

# Stage para generar imagen de producción
FROM nginx:alpine AS production
# Copiamos los archivos estáticos generados.
COPY --from=build /front/dist/front/browser /usr/share/nginx/html
EXPOSE 80
