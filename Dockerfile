FROM node:22-bookworm-slim AS app-deps

WORKDIR /opt/sms
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM app-deps AS build

COPY prisma ./prisma
RUN npx prisma generate
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci
COPY frontend ./frontend
RUN npm --prefix frontend run build
COPY src ./src
COPY scripts ./scripts

FROM node:22-bookworm-slim AS production-deps

WORKDIR /opt/sms
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /opt/sms
RUN groupadd --system --gid 10001 sms \
  && useradd --system --uid 10001 --gid sms --home-dir /nonexistent --shell /usr/sbin/nologin sms
COPY --from=production-deps /opt/sms/node_modules ./node_modules
COPY --from=build /opt/sms/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /opt/sms/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /opt/sms/src ./src
COPY --from=build /opt/sms/package.json ./package.json
USER sms
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/server.js"]

FROM build AS migration

ENV NODE_ENV=production
WORKDIR /opt/sms
CMD ["npx", "prisma", "migrate", "deploy"]

FROM nginx:1.27-alpine AS frontend

RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /opt/sms/frontend/dist /usr/share/nginx/html
COPY deploy/self-host/nginx.conf /etc/nginx/conf.d/default.conf
