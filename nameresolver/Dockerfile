# Standalone SF7 name resolver. node:sqlite is built-in (Node >= 22.5), so no
# native build step. Runtime config.json (broker creds) is mounted at
# /app/config.json — never baked in. SQLite lives in the /app/data volume.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 8090
CMD ["node", "src/index.js", "config.json"]
