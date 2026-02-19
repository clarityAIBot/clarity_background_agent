/**
 * Slack message formatting utilities
 */

/**
 * Convert GitHub-flavored markdown to Slack mrkdwn format
 *
 * Slack uses a simplified markdown format called "mrkdwn" which differs from
 * GitHub-flavored markdown in several ways:
 * - Bold: **text** -> *text*
 * - Headers: # text -> *text* (no header support)
 * - Code blocks and inline code work the same
 *
 * @param text - GitHub-flavored markdown text
 * @returns Slack mrkdwn formatted text
 */
export function convertGithubToSlackMarkdown(text: string): string {
  return text
    // Convert headers: # -> *bold* (Slack doesn't have headers)
    .replace(/^### (.+)$/gm, "*$1*")
    .replace(/^## (.+)$/gm, "*$1*")
    .replace(/^# (.+)$/gm, "*$1*")
    // Convert bold: **text** -> *text*
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    // Convert checkboxes/emojis
    .replace(/:white_check_mark:/g, "✅")
    .replace(/:x:/g, "❌")
    .replace(/:warning:/g, "⚠️")
    // Convert code blocks: ```code``` stays the same in Slack
    // Convert inline code: `code` stays the same in Slack
    // Convert bullet points: - stays the same
    // Remove horizontal rules (---)
    .replace(/^---$/gm, "")
    // Clean up multiple newlines
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Truncate text for Slack block limits
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default 2500 for section blocks)
 * @param suffix - Suffix to append when truncated
 * @returns Truncated text
 */
export function truncateForSlack(
  text: string,
  maxLength: number = 2500,
  suffix: string = "\n\n_...truncated_"
): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - suffix.length) + suffix;
}
