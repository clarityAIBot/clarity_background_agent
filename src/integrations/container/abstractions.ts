/**
 * Container/Sandbox Abstraction Layer
 *
 * Provider-agnostic interfaces for sandbox execution.
 * Supports switching between Cloudflare Durable Objects, E2B, Docker, etc.
 */

import { CURRENT_SANDBOX_PROVIDER, SANDBOX_PROVIDER, type SandboxProviderType } from '../../core/constants';
import { CloudflareSandboxClient } from './adapters/cloudflare';

/**
 * Options for sandbox fetch operations
 */
export interface SandboxFetchOptions {
  /** Name identifier for the sandbox instance */
  sandboxName?: string;
  /** Route being called within the sandbox */
  route?: string;
  /** Request timeout in milliseconds (default: 15 minutes for long-running tasks) */
  timeout?: number;
  /** Maximum retry attempts for transient failures */
  maxRetries?: number;
  /** Initial delay in ms before first retry (doubles with each retry) */
  initialDelayMs?: number;
}

/**
 * Result from sandbox execution
 */
export interface SandboxExecutionResult {
  success: boolean;
  response?: Response;
  error?: string;
  /** Duration of execution in milliseconds */
  durationMs?: number;
}

/**
 * Provider-agnostic sandbox client interface
 * Implementations handle the specifics of each sandbox provider
 */
export interface ISandboxClient {
  /**
   * Get or create a sandbox instance by name
   * @param sandboxName - Unique identifier for the sandbox
   * @returns A sandbox instance handle
   */
  getSandbox(sandboxName: string): ISandbox;
}

/**
 * Provider-agnostic sandbox instance interface
 */
export interface ISandbox {
  /** Unique name/identifier for this sandbox */
  readonly name: string;

  /**
   * Execute a fetch request within the sandbox
   * @param request - The request to execute
   * @param options - Fetch options including timeout and retry config
   * @returns Response from the sandbox
   */
  fetch(request: Request, options?: SandboxFetchOptions): Promise<Response>;

  /**
   * Check if the sandbox is ready to accept requests
   * @returns True if sandbox is ready
   */
  isReady?(): Promise<boolean>;

  /**
   * Gracefully terminate the sandbox
   */
  terminate?(): Promise<void>;
}

/**
 * Configuration for creating a sandbox client
 */
export interface SandboxClientConfig {
  /** Cloudflare-specific: MY_CONTAINER namespace binding */
  cloudflareNamespace?: any;
  /** E2B-specific: API key */
  e2bApiKey?: string;
  /** Docker-specific: Docker host URL */
  dockerHost?: string;
}

/**
 * Factory function to create a sandbox client based on provider configuration
 */
export function createSandboxClient(
  config: SandboxClientConfig,
  providerOverride?: SandboxProviderType
): ISandboxClient {
  const provider = providerOverride ?? CURRENT_SANDBOX_PROVIDER;

  switch (provider) {
    case SANDBOX_PROVIDER.CLOUDFLARE:
      if (!config.cloudflareNamespace) {
        throw new Error('Cloudflare sandbox requires MY_CONTAINER namespace binding');
      }
      return new CloudflareSandboxClient(config.cloudflareNamespace);

    case SANDBOX_PROVIDER.E2B:
      throw new Error('E2B sandbox provider not yet implemented. Configure e2bApiKey when ready.');

    case SANDBOX_PROVIDER.DOCKER:
      throw new Error('Docker sandbox provider not yet implemented. Configure dockerHost when ready.');

    default:
      throw new Error(`Unknown sandbox provider: ${provider}`);
  }
}

/**
 * Convenience function to create a sandbox and execute a request in one call
 * Used for simple one-off sandbox operations
 */
export async function executeSandboxRequest(
  config: SandboxClientConfig,
  sandboxName: string,
  request: Request,
  options?: SandboxFetchOptions
): Promise<Response> {
  const client = createSandboxClient(config);
  const sandbox = client.getSandbox(sandboxName);
  return sandbox.fetch(request, options);
}
