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
ARG BUILD_DB_CONNECTION
ARG BUILD_SQLITE_BUSY_TIMEOUT_MS
ARG BUILD_DB_BACKUP_DIR
ARG BUILD_DB_BACKUP_RETENTION_COUNT
ARG BUILD_TICKET_SALES_MAX_ADVANCE_DAYS
ARG BUILD_BODY_PARSER_FORM_LIMIT
ARG BUILD_BODY_PARSER_JSON_LIMIT
ARG BUILD_BODY_PARSER_MULTIPART_LIMIT
ARG BUILD_HEALTH_WORKER_STALE_SECONDS
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

# Adonis validates configuration during the build. BuildKit exposes secrets
# from web/.env only for this command. Non-secret operational settings come
# from .env_conf through build args, so they do not have to be duplicated in
# web/.env and are not persisted as ENV entries in the runtime image.
RUN --mount=type=secret,id=app_env,target=${APP_HOME}/web/.env,required=true \
    export DB_CONNECTION="${BUILD_DB_CONNECTION}" \
    SQLITE_BUSY_TIMEOUT_MS="${BUILD_SQLITE_BUSY_TIMEOUT_MS}" \
    DB_BACKUP_DIR="${BUILD_DB_BACKUP_DIR}" \
    DB_BACKUP_RETENTION_COUNT="${BUILD_DB_BACKUP_RETENTION_COUNT}" \
    TICKET_SALES_MAX_ADVANCE_DAYS="${BUILD_TICKET_SALES_MAX_ADVANCE_DAYS}" \
    BODY_PARSER_FORM_LIMIT="${BUILD_BODY_PARSER_FORM_LIMIT}" \
    BODY_PARSER_JSON_LIMIT="${BUILD_BODY_PARSER_JSON_LIMIT}" \
    BODY_PARSER_MULTIPART_LIMIT="${BUILD_BODY_PARSER_MULTIPART_LIMIT}" \
    HEALTH_WORKER_STALE_SECONDS="${BUILD_HEALTH_WORKER_STALE_SECONDS}" \
    && node ace codegen \
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
