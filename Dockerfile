FROM mcr.microsoft.com/playwright:v1.53.1-jammy

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production
RUN npx playwright install --with-deps

# Copy source code
COPY . .

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "index.js"] 
