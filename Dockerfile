FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY web ./web
COPY vite.config.js ./
RUN npm run build
FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATABASE_PATH=/app/data/radar.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir data && chown node:node data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
USER node
EXPOSE 3000
CMD ["node","--env-file-if-exists=.env","server/index.js"]
