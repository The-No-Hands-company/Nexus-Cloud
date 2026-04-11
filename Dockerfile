FROM oven/bun:1

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Ensure data directory exists for the JSON registry
RUN mkdir -p /app/data

EXPOSE 8787

CMD ["bun", "run", "src/index.ts"]
