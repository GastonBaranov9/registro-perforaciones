#!/bin/sh
#########################################################################################
#                                      DEPLOY REMOTO                                    #
#########################################################################################
set -eu  #-u  variables sin definir=error.       -e  Error si $? != 0

DIR_SCRIPT=$(dirname $(readlink -f $0) );
if [ -e ${DIR_SCRIPT}/../.env ] 
then
    echo ".env OK..."
else
    echo "No existe el archivo .env con las variables de entorno"
    exit 1;
fi
export $(grep -v '^#' ${DIR_SCRIPT}/../.env | xargs -0)

REMOTE_DIR=/home/grupo05/pozos
# 
ssh ${REMOTE_USER}@${REMOTE_HOST} "mkdir -p ${REMOTE_DIR}/proxy"

# Copiamos el docker-compose file
scp ${DIR_SCRIPT}/../docker-compose.production.yaml ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}
# Copiamos el template de nginx
scp ${DIR_SCRIPT}/../proxy/https.conf.template ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/proxy/https.conf.template

# Hacemos login en docker, si son img publicas no seria necesario
# ssh ${REMOTE_USER}@${REMOTE_HOST} "docker login ${DOCKER_REGISTRY} -u ${DOCKER_USER} --password ${DOCKER_PASS}"

# Paramos todo.
ssh ${REMOTE_USER}@${REMOTE_HOST} "docker compose -f ${REMOTE_DIR}/docker-compose.production.yaml down"

# Hacemos pull.
ssh ${REMOTE_USER}@${REMOTE_HOST} "docker compose -f ${REMOTE_DIR}/docker-compose.production.yaml pull"

# Levantamos
ssh ${REMOTE_USER}@${REMOTE_HOST} "docker compose -f ${REMOTE_DIR}/docker-compose.production.yaml up -d"
