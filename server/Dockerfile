# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: Build TypeScript
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 3: Production image
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Copy built output and production dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Note: For seeding (npm run seed), mount the GTFS data directory via docker-compose volume
# e.g., volumes: ["../public/data:/app/public/data"]

EXPOSE 3001

CMD ["node", "dist/index.js"]
