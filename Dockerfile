# Stage 1: Build the application
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies (including devDependencies for building)
COPY package*.json ./
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the NestJS application
RUN npm run build

# Stage 2: Production image
FROM node:24-alpine

WORKDIR /app

# Set Node to production mode
ENV NODE_ENV=production

# Copy package files and install ONLY production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the compiled code from the builder stage
COPY --from=builder /app/dist ./dist

# Create the directory for Baileys auth state so it exists before mounting
RUN mkdir -p /app/auth_info_baileys

# Expose the port the app runs on
EXPOSE 5335

# Start the application
CMD ["node", "dist/main.js"]
