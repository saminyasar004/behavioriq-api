FROM node:20-alpine

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source
COPY . .

# Generate Prisma client
RUN yarn db:generate

# Push the prisma db
RUN yarn db:push

# Seed the database
RUN yarn db:seed

# Build TypeScript
RUN yarn build

# Expose port
ARG PORT
EXPOSE ${PORT}

# Run migrations and start server
CMD ["sh", "-c", "yarn db:generate && yarn db:push && yarn db:seed && yarn start"]
