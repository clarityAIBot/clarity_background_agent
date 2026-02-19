/**
 * Shared logging utility for Clarity AI Container.
 *
 * Provides consistent, structured logging across all modules.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogOptions {
  level?: LogLevel;
  requestId?: string;
}

/**
 * Log a message with context and optional data.
 *
 * @param context - The module or component name (e.g., 'AgentExecutor', 'GitHubClient')
 * @param message - The log message
 * @param data - Optional structured data to include
 * @param options - Optional log level and request ID
 */
export function log(
  context: string,
  message: string,
  data?: Record<string, unknown>,
  options?: LogOptions
): void {
  const timestamp = new Date().toISOString();
  const level = options?.level || 'INFO';
  const requestId = options?.requestId ? `[${options.requestId}] ` : '';

  const logMessage = `[${timestamp}] [${level}] ${requestId}[${context}] ${message}`;

  if (data) {
    console.log(logMessage, JSON.stringify(data, null, 2));
  } else {
    console.log(logMessage);
  }
}

/**
 * Create a logger instance with a fixed context.
 * Useful for creating module-specific loggers.
 *
 * @param context - The module or component name
 * @returns Logger functions bound to the context
 */
export function createLogger(context: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>, requestId?: string) =>
      log(context, message, data, { level: 'DEBUG', requestId }),

    info: (message: string, data?: Record<string, unknown>, requestId?: string) =>
      log(context, message, data, { level: 'INFO', requestId }),

    warn: (message: string, data?: Record<string, unknown>, requestId?: string) =>
      log(context, message, data, { level: 'WARN', requestId }),

    error: (message: string, data?: Record<string, unknown>, requestId?: string) =>
      log(context, message, data, { level: 'ERROR', requestId }),

    /** Simple log (INFO level, no options) - drop-in replacement for existing log() calls */
    log: (subContext: string, message: string, data?: Record<string, unknown>) =>
      log(`${context}:${subContext}`, message, data),
  };
}
