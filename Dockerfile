# syntax=docker/dockerfile:1
# Single image for both the hosted SaaS and self-hosted installs.
ARG NODE_IMAGE=node:22-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# Optional build secret "ca": extra CA bundle for builds behind a TLS-inspecting proxy.
RUN corepack enable
WORKDIR /app

# Build the web bundle with all dependencies
FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Production dependencies only
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile --prod

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY drizzle ./drizzle
COPY --from=build /app/dist/web ./dist/web
USER node
EXPOSE 8080
# Node runs the TypeScript server directly (type stripping); no compile step.
CMD ["node", "src/server/index.ts"]
