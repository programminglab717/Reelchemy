# Same runtime pin as .node-version; registry pulls retain normal TLS/digest checks.
ARG NODE_VERSION=24.19.0
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates chromium ffmpeg fonts-liberation tini util-linux \
    && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium \
    NEXT_TELEMETRY_DISABLED=1 \
    RAYON_NUM_THREADS=2
WORKDIR /app
ENTRYPOINT ["/usr/bin/tini", "-g", "-s", "--"]

FROM base AS dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca --mount=type=cache,target=/root/.npm \
    if [ -f /run/secrets/build_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/build_ca npm ci --cache /root/.npm; \
    else npm ci --cache /root/.npm; fi

FROM base AS source
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN mkdir -p .data artifacts .next node_modules/.cache \
    && chown node:node /app \
    && chown -R node:node .data artifacts .next node_modules/.cache \
    && chmod 700 .data artifacts
USER node

FROM source AS build
RUN npm run build
# The image carries code/build output; live state only belongs on runtime volumes.
RUN rm -rf .data artifacts && mkdir -m 700 .data artifacts

FROM build AS test
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl libnss3-tools \
    && rm -rf /var/lib/apt/lists/*
USER node
ENV REELCHEMY_CONTAINER_TESTS=1 \
    AI_PROVIDER=mock \
    EMAIL_DELIVERY=file
CMD ["npm", "run", "test:production"]

FROM build AS app
ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
