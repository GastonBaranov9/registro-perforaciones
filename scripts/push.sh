#!/bin/sh
#########################################################################################
#                                      PUSH                                             #
#########################################################################################
set -eu #-u  variables sin definir=error.  -e  Error si $? != 0    -x Muestra las órdenes
DIR_SCRIPT=$(dirname $(readlink -f $0) );

if [ -e ${DIR_SCRIPT}/../.env ] 
then
    export $(grep -v '^#' ${DIR_SCRIPT}/../.env | xargs -0)
    echo "OK\t\t.env"
else
    echo "Error:\tNo existe el .env"
    exit 1;
fi

# Hacer build
docker compose -f docker-compose.build.yaml build

# Hacer login
docker login ${DOCKER_REGISTRY} -u ${DOCKER_USER} --password ${DOCKER_PASS}

# Hacer push
docker push ${DOCKER_USER}/api
docker push ${DOCKER_USER}/front

echo "fin push"