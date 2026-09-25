FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Build the TypeScript code (if there is a build step)
RUN npx tsc || true

# Expose the API port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
