# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# Only production deps in the final image
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
# SQL migrations are read from disk at boot
COPY src/db/migrations ./src/db/migrations
ENV MIGRATIONS_DIR=/app/src/db/migrations
RUN addgroup -S crm && adduser -S crm -G crm \
  && mkdir -p /data/uploads && chown -R crm:crm /data /app
USER crm
ENV UPLOAD_DIR=/data/uploads PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/healthz || exit 1
CMD ["node", "dist/index.js"]
