/**
 * Application constants and configuration
 */

/**
 * Queue provider types
 * Defines which queue implementation to use
 */
export const QUEUE_PROVIDER = {
  CLOUDFLARE: 'cloudflare',
  SQS: 'sqs',
  REDIS: 'redis',
} as const;

export type QueueProviderType = typeof QUEUE_PROVIDER[keyof typeof QUEUE_PROVIDER];

/**
 * Current queue provider configuration
 * Change this to switch between queue implementations
 */
export const CURRENT_QUEUE_PROVIDER: QueueProviderType = QUEUE_PROVIDER.CLOUDFLARE;

/**
 * Sandbox/Container provider types
 * Defines which sandbox implementation to use for code execution
 */
export const SANDBOX_PROVIDER = {
  CLOUDFLARE: 'cloudflare',  // Cloudflare Durable Objects with Containers
  E2B: 'e2b',                // E2B Code Interpreter
  DOCKER: 'docker',          // Local Docker containers
} as const;

export type SandboxProviderType = typeof SANDBOX_PROVIDER[keyof typeof SANDBOX_PROVIDER];

/**
 * Current sandbox provider configuration
 * Change this to switch between sandbox implementations
 */
export const CURRENT_SANDBOX_PROVIDER: SandboxProviderType = SANDBOX_PROVIDER.CLOUDFLARE;

/**
 * Clarity endpoint configuration
 * Set via initClarityEndpoint() at worker startup
 */
let clarityEndpoint: string | null = null;

/**
 * Initialize the Clarity endpoint from environment
 * Call this once at worker startup with env.CLARITY_ENDPOINT
 * @param endpoint - The CLARITY_ENDPOINT value from env
 */
export function initClarityEndpoint(endpoint: string): void {
  if (!endpoint) {
    throw new Error("CLARITY_ENDPOINT environment variable is not configured");
  }
  clarityEndpoint = endpoint;
}

/**
 * Get the configured Clarity endpoint
 * @throws Error if endpoint not initialized
 */
export function getClarityEndpoint(): string {
  if (!clarityEndpoint) {
    throw new Error("CLARITY_ENDPOINT not initialized. Call initClarityEndpoint() at startup.");
  }
  return clarityEndpoint;
}

/**
 * Generate a deep link to a specific task in the Clarity dashboard
 * @param requestId - The unique identifier for the task/request
 * @returns Full URL to the task detail page
 * @throws Error if endpoint not initialized
 */
export function getClarityTaskUrl(requestId: string): string {
  return `${getClarityEndpoint()}/?task=${requestId}`;
}

/**
 * Generate a URL to the LLM setup page
 * @returns Full URL to the LLM configuration page
 * @throws Error if endpoint not initialized
 */
export function getClarityLLMSetupUrl(): string {
  return `${getClarityEndpoint()}/llm-setup`;
}
