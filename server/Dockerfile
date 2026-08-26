# Multi-stage build for Node.js API
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY schema.sql ./

EXPOSE 4003

CMD ["node", "dist/server.js"]
