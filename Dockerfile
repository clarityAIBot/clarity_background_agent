# syntax=docker/dockerfile:1
# Build version: 7 - Use SDKs only (no CLI tools needed)

FROM node:22-slim AS base

# Update package lists and install dependencies
RUN apt-get update && \
    apt-get install -y \
        python3 \
        python3-pip \
        git \
        build-essential \
        python3-dev \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for running the container
RUN useradd -m -s /bin/bash claude && \
    mkdir -p /tmp/workspace && \
    chown -R claude:claude /tmp/workspace && \
    chmod 755 /tmp/workspace && \
    mkdir -p /home/claude/.claude/skills && \
    chown -R claude:claude /home/claude/.claude

# Note: CLI tools (claude-code, opencode-ai) are NOT installed globally.
# The container uses SDKs programmatically via npm packages:
# - @anthropic-ai/claude-agent-sdk (Claude Code SDK)
# - @opencode-ai/sdk (OpenCode SDK)

# Set destination for COPY
WORKDIR /app

# Copy package files first for better caching
COPY container_src/package*.json ./

# Install npm dependencies
RUN npm install

# Copy TypeScript configuration
COPY container_src/tsconfig.json ./

# Copy source code
COPY container_src/src/ ./src/

# Build TypeScript
RUN npm run build

# Copy prompt files to dist (TypeScript doesn't copy non-ts files)
RUN cp -r src/prompts dist/prompts

# Copy local skills to user's ~/.claude/skills/ directory
# Skills are loaded at build time for faster startup
COPY --chown=claude:claude container_src/skills/ /home/claude/.claude/skills/

# Change ownership of app directory to claude user
RUN chown -R claude:claude /app

EXPOSE 8080

# Switch to non-root user
USER claude

CMD ["node", "dist/main.js"]
