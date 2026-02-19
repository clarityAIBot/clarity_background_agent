/**
 * Formatting utilities for display
 */

/**
 * Format duration in milliseconds to human-readable string
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "2m 30s" or "45s"
 */
export function formatDuration(ms?: number): string {
  if (!ms) return "N/A";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Format cost in cents to human-readable string
 * @param costCents - Cost in cents
 * @returns Formatted string like "$0.05" or "N/A"
 */
export function formatCost(costCents?: number): string {
  if (costCents === undefined || costCents === null) return "N/A";
  return `$${(costCents / 100).toFixed(2)}`;
}

/**
 * Format cost in dollars to human-readable string
 * @param costUsd - Cost in USD
 * @returns Formatted string like "$0.05" or "N/A"
 */
export function formatCostUsd(costUsd?: number): string {
  if (costUsd === undefined || costUsd === null) return "N/A";
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Truncate text with ellipsis
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default 100)
 * @returns Truncated text with "..." if needed
 */
export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}
