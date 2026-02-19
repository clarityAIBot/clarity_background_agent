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

# Check for issue number argument
if [ -z "$1" ]; then
  echo "Usage: $0 <issue_number>"
  echo "Example: $0 10"
  exit 1
fi

ISSUE_NUMBER="$1"

echo "Fetching comments for issue #$ISSUE_NUMBER in $GITHUB_REPO..."
echo ""

# Get issue details first
echo "=== Issue Details ==="
curl -s -X GET \
  -H "Authorization: token $GITHUB_PAT" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER" | \
  jq -r '"Title: \(.title)\nState: \(.state)\nCreated: \(.created_at)\nBody: \(.body)"'

echo ""
echo "=== Comments ==="

# Get comments
COMMENTS=$(curl -s -X GET \
  -H "Authorization: token $GITHUB_PAT" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$GITHUB_REPO/issues/$ISSUE_NUMBER/comments")

# Check if there are comments
COMMENT_COUNT=$(echo "$COMMENTS" | jq 'length')

if [ "$COMMENT_COUNT" -eq 0 ]; then
  echo "No comments yet."
else
  echo "$COMMENTS" | jq -r '.[] | "---\nFrom: \(.user.login)\nAt: \(.created_at)\n\(.body)\n"'
fi

echo ""
echo "=== Linked PRs ==="

# Search for PRs that mention this issue
PRS=$(curl -s -X GET \
  -H "Authorization: token $GITHUB_PAT" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$GITHUB_REPO/pulls?state=all" | \
  jq -r --arg issue "#$ISSUE_NUMBER" '.[] | select(.body | contains($issue) or .title | contains($issue)) | "PR #\(.number): \(.title) [\(.state)]\n  \(.html_url)"')

if [ -z "$PRS" ]; then
  echo "No linked PRs found."
else
  echo "$PRS"
fi
