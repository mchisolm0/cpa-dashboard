FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY src ./src
RUN mkdir /index && chown bun:bun /index
ENV BIND_HOST=0.0.0.0 PORT=3000 ARCHIVE_ROOT=/archive INDEX_PATH=/index/index.sqlite
USER bun
VOLUME ["/index"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD bun -e 'const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/healthz`); process.exit(r.ok ? 0 : 1)'
CMD ["bun", "src/server.ts"]
