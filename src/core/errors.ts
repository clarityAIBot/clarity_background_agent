/**
 * Structured error types with categories and recovery suggestions.
 * Inspired by construct-cli's ConstructError pattern.
 */

export type ErrorCategory =
  | "CONTAINER"   // Container start/communication failures
  | "GITHUB"      // GitHub API errors (token, PR creation)
  | "CONFIG"      // Missing config, encryption key, etc.
  | "QUEUE"       // Queue processing failures
  | "SLACK"       // Slack API errors
  | "AGENT"       // Agent execution errors (Claude, OpenCode)
  | "GIT"         // Git clone/push/pull failures
  | "TIMEOUT";    // Operation timeouts

export interface ClarityErrorOptions {
  category: ErrorCategory;
  operation: string;
  message: string;
  suggestion: string;
  cause?: Error;
}

export class ClarityError extends Error {
  readonly category: ErrorCategory;
  readonly operation: string;
  readonly suggestion: string;
  readonly cause?: Error;

  constructor(opts: ClarityErrorOptions) {
    super(opts.message);
    this.name = "ClarityError";
    this.category = opts.category;
    this.operation = opts.operation;
    this.suggestion = opts.suggestion;
    this.cause = opts.cause;
  }

  /** Error code for DB storage, e.g. "CONFIG_ERROR" */
  get code(): string {
    return `${this.category}_ERROR`;
  }

  /** Formatted string with full context */
  toDetailedString(): string {
    const parts = [`[${this.category}] ${this.operation} failed: ${this.message}`];
    if (this.cause) {
      parts.push(`  Cause: ${this.cause.message}`);
    }
    parts.push(`  → ${this.suggestion}`);
    return parts.join("\n");
  }
}

export function isClarityError(error: unknown): error is ClarityError {
  return error instanceof ClarityError;
}
