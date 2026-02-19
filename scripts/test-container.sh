#!/bin/bash

# Load environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
fi

# Check required environment variables
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Error: ANTHROPIC_API_KEY not set in .env file"
  exit 1
fi

if [ -z "$GITHUB_PAT" ]; then
  echo "Error: GITHUB_PAT not set in .env file"
  exit 1
fi

# Stop any existing container
docker stop claude-test 2>/dev/null
docker rm claude-test 2>/dev/null

echo "Starting container..."
docker run -d --name claude-test -p 8080:8080 claude-code-containers-mycontainer:latest

echo "Waiting for container to start..."
sleep 3

echo ""
echo "=== Health Check ==="
curl -s http://localhost:8080/ | jq .

echo ""
echo "=== Testing /process-issue endpoint ==="
echo "Sending request with API key and issue context..."

RESPONSE=$(curl -s -X POST http://localhost:8080/process-issue \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "ANTHROPIC_API_KEY": "$ANTHROPIC_API_KEY",
  "GITHUB_TOKEN": "$GITHUB_PAT",
  "ISSUE_ID": "test-123",
  "ISSUE_NUMBER": "99",
  "ISSUE_TITLE": "Add hello function",
  "ISSUE_BODY": "Please create a simple hello function that returns Hello World",
  "ISSUE_LABELS": "[]",
  "REPOSITORY_URL": "https://github.com/$GITHUB_REPO",
  "REPOSITORY_NAME": "$GITHUB_REPO",
  "ISSUE_AUTHOR": "test-user"
}
EOF
)

echo "$RESPONSE" | jq .

echo ""
echo "=== Container Logs ==="
docker logs claude-test
