# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE
ARG APP_HOME
ARG APP_PORT
ARG APP_DATA_DIR
ARG NATIVE_BUILD_PACKAGES

FROM ${NODE_IMAGE} AS build

ARG APP_HOME
ARG APP_DATA_DIR
ARG NATIVE_BUILD_PACKAGES
ENV CI=true

WORKDIR ${APP_HOME}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ${NATIVE_BUILD_PACKAGES} \
    && rm -rf /var/lib/apt/lists/*

# The web application depends on the local open-koleo package from the
# repository root, so both package manifests and the wrapper sources are
# part of the dependency layer.
COPY package.json index.js ./
COPY src ./src
COPY web/package.json web/package-lock.json ./web/

WORKDIR ${APP_HOME}/web
RUN npm ci

COPY web ./

# Adonis validates configuration during the build. BuildKit exposes the
# existing .env only for this command and does not persist it in an image layer.
RUN --mount=type=secret,id=app_env,target=${APP_HOME}/web/.env,required=true \
    node ace codegen \
    && npm run build

RUN npm prune --omit=dev && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime

ARG APP_HOME
ARG APP_PORT
ARG APP_DATA_DIR

ENV NODE_ENV=production \
    APP_HOME=${APP_HOME}

WORKDIR ${APP_HOME}

COPY --from=build --chown=node:node ${APP_HOME}/package.json ${APP_HOME}/index.js ./
COPY --from=build --chown=node:node ${APP_HOME}/src ./src

WORKDIR ${APP_HOME}/web
COPY --from=build --chown=node:node ${APP_HOME}/web/build ./
COPY --from=build --chown=node:node ${APP_HOME}/web/node_modules ./node_modules

RUN mkdir -p "${APP_DATA_DIR}" && chown -R node:node "${APP_DATA_DIR}"

USER node

EXPOSE ${APP_PORT}
STOPSIGNAL SIGTERM

CMD ["node", "bin/server.js"]
