FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Copy migration SQL files into the compiled output location
COPY src/db/migrations ./dist/db/migrations
EXPOSE 4000
CMD ["node", "dist/index.js"]
