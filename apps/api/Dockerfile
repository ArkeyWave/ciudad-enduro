# Build from the repo root: docker build -f apps/api/Dockerfile --build-arg BUILD_SHA=<sha> .
FROM node:24-alpine AS build
RUN npm install -g pnpm@12.18.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=api
RUN pnpm --filter api deploy --prod /out

FROM node:24-alpine
# Coolify passes SOURCE_COMMIT; CI passes BUILD_SHA. Empty counts as "unknown" (env.ts).
ARG SOURCE_COMMIT=""
ARG BUILD_SHA=${SOURCE_COMMIT}
ENV NODE_ENV=production \
    BUILD_SHA=${BUILD_SHA}
WORKDIR /app
# Runtime files only, owned by root and read-only for the node user.
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/api/docker-entrypoint.sh ./docker-entrypoint.sh
USER node
EXPOSE 3001
ENTRYPOINT ["/app/docker-entrypoint.sh"]
