# Prisma 7 pulls `@prisma/streams-local`, which declares `node >= 22`; Yarn refuses install on Node 20.
FROM node:22-alpine

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source
COPY . .

# Prisma client + TypeScript (no DB required). Do NOT run db:push/db:seed here —
# Postgres is not available during `docker build`; compose runs those at startup.
RUN yarn build

# Expose port
ARG PORT
EXPOSE ${PORT}

# Default when run without compose `command:` override
CMD ["yarn", "start"]
