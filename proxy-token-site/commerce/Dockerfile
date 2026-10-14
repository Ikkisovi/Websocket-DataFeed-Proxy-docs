ARG PORTAL_BASE_IMAGE
FROM node:22.23.2-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${PORTAL_BASE_IMAGE}
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.revision=${SOURCE_COMMIT}
COPY --from=dependencies --chown=node:node /app/node_modules /app/node_modules
COPY --chown=node:node package.json package-lock.json server.js /app/
COPY --chown=node:node commerce/store.cjs commerce/admin.cjs commerce/001-commerce.sql /app/commerce/
COPY --chown=node:node commerce/portal-store.cjs commerce/portal-admin.cjs commerce/002-portal.sql /app/commerce/
CMD ["node", "server.js"]
