/**
 * Unified error handling utilities
 */

import { isClarityError, type ErrorCategory } from "../core/errors";

/**
 * Extract error message from unknown error type
 * Replaces repeated: error instanceof Error ? error.message : String(error)
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Extract error stack from unknown error type
 */
export function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/**
 * Get both message and stack from error.
 * When error is a ClarityError, includes category, code, and suggestion.
 */
export function getErrorDetails(error: unknown): {
  message: string;
  stack?: string;
  category?: ErrorCategory;
  code?: string;
  suggestion?: string;
} {
  if (isClarityError(error)) {
    return {
      message: error.message,
      stack: error.stack,
      category: error.category,
      code: error.code,
      suggestion: error.suggestion,
    };
  }
  return {
    message: getErrorMessage(error),
    stack: getErrorStack(error),
  };
}
