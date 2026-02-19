#!/bin/bash

# Load environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
fi

# Check required environment variables
if [ -z "$GITHUB_PAT" ]; then
  echo "Error: GITHUB_PAT not set in .env file"
  exit 1
fi

if [ -z "$GITHUB_REPO" ]; then
  echo "Error: GITHUB_REPO not set in .env file"
  exit 1
fi

# Default issue title and body
TITLE="${1:-Test issue - Add sample feature}"
BODY="${2:-This is a test issue for the Claude Code automation. Please implement a simple feature as requested in the title.}"

echo "Creating issue in $GITHUB_REPO..."
echo "Title: $TITLE"
echo ""

# Create JSON payload using jq for proper escaping
JSON_PAYLOAD=$(jq -n \
  --arg title "$TITLE" \
  --arg body "$BODY" \
  '{title: $title, body: $body}')

# Create the issue
RESPONSE=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_PAT" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/$GITHUB_REPO/issues" \
  -d "$JSON_PAYLOAD")

# Extract issue number and URL
ISSUE_NUMBER=$(echo "$RESPONSE" | jq -r '.number // empty')
ISSUE_URL=$(echo "$RESPONSE" | jq -r '.html_url // empty')

if [ -n "$ISSUE_NUMBER" ]; then
  echo "Issue created successfully!"
  echo "Issue #$ISSUE_NUMBER: $ISSUE_URL"
else
  echo "Failed to create issue. Response:"
  echo "$RESPONSE" | jq .
  exit 1
fi
