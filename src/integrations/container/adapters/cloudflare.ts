/**
 * Cloudflare Durable Objects Container Adapter
 *
 * Implements the sandbox abstraction for Cloudflare's container-based Durable Objects.
 * Includes retry logic with exponential backoff for cold start handling.
 */

import { Container } from '@cloudflare/containers';
import type { ISandbox, ISandboxClient, SandboxFetchOptions } from '../abstractions';
import { logWithContext } from '../../../core/log';
import { getErrorMessage, getErrorStack } from '../../../utils';

/**
 * Default configuration for Cloudflare container operations
 */
const DEFAULT_OPTIONS: Required<SandboxFetchOptions> = {
  sandboxName: 'unknown',
  route: 'unknown',
  timeout: 900000, // 15 minutes - Claude Code can take time for complex issues
  maxRetries: 5,
  initialDelayMs: 2000,
};

/**
 * Helper function to delay execution
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if error message indicates a container cold start error
 */
function isContainerColdStartErrorMessage(errorMessage: string): boolean {
  return (
    errorMessage.includes('not listening') ||
    errorMessage.includes('TCP address') ||
    errorMessage.includes('connection refused') ||
    errorMessage.includes('ECONNREFUSED') ||
    errorMessage.includes('Error proxying request')
  );
}

/**
 * Check if error is a container cold start error
 */
function isContainerColdStartError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return isContainerColdStartErrorMessage(errorMessage);
}

/**
 * Check if response body contains a cold start error
 */
async function isResponseColdStartError(
  response: Response
): Promise<{ isColdStart: boolean; errorText: string }> {
  if (response.ok) {
    return { isColdStart: false, errorText: '' };
  }

  try {
    const errorText = await response.text();
    return {
      isColdStart: isContainerColdStartErrorMessage(errorText),
      errorText,
    };
  } catch {
    return { isColdStart: false, errorText: 'Unable to read response body' };
  }
}

/**
 * Cloudflare Durable Object Container implementation of ISandbox
 */
export class CloudflareSandbox implements ISandbox {
  readonly name: string;
  private readonly container: DurableObjectStub<Container<unknown>>;

  constructor(name: string, container: DurableObjectStub<Container<unknown>>) {
    this.name = name;
    this.container = container;
  }

  /**
   * Execute a fetch request within the Cloudflare container
   * Includes retry logic with exponential backoff for cold starts
   */
  async fetch(request: Request, options?: SandboxFetchOptions): Promise<Response> {
    const opts = { ...DEFAULT_OPTIONS, ...options, sandboxName: this.name };
    const { route, timeout, maxRetries, initialDelayMs } = opts;
    const startTime = Date.now();

    logWithContext('SANDBOX_FETCH', `Starting fetch to ${this.name} for route ${route}`, {
      url: request.url,
      method: request.method,
      sandboxName: this.name,
      route,
      maxRetries,
      initialDelayMs,
    });

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Create a timeout promise for this attempt
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Sandbox fetch timeout after ${timeout}ms`)), timeout);
        });

        // Clone the request for retry (Request body can only be read once)
        const requestClone = request.clone();

        // Race between the actual fetch and timeout
        const response = await Promise.race([this.container.fetch(requestClone), timeoutPromise]);

        const duration = Date.now() - startTime;

        // Check if response contains a cold start error (500 with specific error message)
        if (!response.ok) {
          const { isColdStart, errorText } = await isResponseColdStartError(response.clone());

          if (isColdStart && attempt < maxRetries) {
            const delayMs = initialDelayMs * Math.pow(2, attempt);
            logWithContext(
              'SANDBOX_FETCH',
              `Container cold start error in response, waiting ${delayMs}ms before retry`,
              {
                sandboxName: this.name,
                route,
                status: response.status,
                errorText: errorText.substring(0, 200),
                attempt: attempt + 1,
                nextAttempt: attempt + 2,
                delayMs,
              }
            );
            await delay(delayMs);
            continue;
          }

          // Not a cold start error or exhausted retries - return the error response
          logWithContext('SANDBOX_FETCH', `Sandbox fetch returned error response`, {
            sandboxName: this.name,
            route,
            status: response.status,
            statusText: response.statusText,
            duration: `${duration}ms`,
            attempt: attempt + 1,
            errorText: errorText.substring(0, 200),
          });

          // Return a new response with the error text (original was consumed)
          return new Response(errorText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }

        logWithContext('SANDBOX_FETCH', `Sandbox fetch completed successfully`, {
          sandboxName: this.name,
          route,
          status: response.status,
          statusText: response.statusText,
          duration: `${duration}ms`,
          attempt: attempt + 1,
        });

        return response;
      } catch (error) {
        lastError = error;
        const duration = Date.now() - startTime;

        logWithContext('SANDBOX_FETCH', `Sandbox fetch attempt ${attempt + 1} failed`, {
          sandboxName: this.name,
          route,
          error: error instanceof Error ? error.message : String(error),
          duration: `${duration}ms`,
          attempt: attempt + 1,
          maxRetries,
          isColdStartError: isContainerColdStartError(error),
        });

        // If this is a cold start error and we have retries left, wait and retry
        if (isContainerColdStartError(error) && attempt < maxRetries) {
          const delayMs = initialDelayMs * Math.pow(2, attempt); // Exponential backoff
          logWithContext(
            'SANDBOX_FETCH',
            `Container cold start detected, waiting ${delayMs}ms before retry`,
            {
              sandboxName: this.name,
              attempt: attempt + 1,
              nextAttempt: attempt + 2,
              delayMs,
            }
          );
          await delay(delayMs);
          continue;
        }

        // For non-cold-start errors or if we've exhausted retries, break out
        break;
      }
    }

    const duration = Date.now() - startTime;

    logWithContext('SANDBOX_FETCH', `Sandbox fetch failed after all retries`, {
      sandboxName: this.name,
      route,
      error: lastError instanceof Error ? lastError.message : String(lastError),
      duration: `${duration}ms`,
      totalAttempts: maxRetries + 1,
    });

    // Return a proper error response instead of throwing
    return new Response(
      JSON.stringify({
        error: `Sandbox fetch failed`,
        message: lastError instanceof Error ? lastError.message : String(lastError),
        sandboxName: this.name,
        route,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  /**
   * Check if the container is ready (always returns true for Cloudflare - lazy initialization)
   */
  async isReady(): Promise<boolean> {
    return true;
  }

  /**
   * Terminate is a no-op for Cloudflare containers (managed by the platform)
   */
  async terminate(): Promise<void> {
    logWithContext('SANDBOX_FETCH', `Terminate called for ${this.name} - no-op for Cloudflare`);
  }
}

/**
 * Cloudflare Durable Objects implementation of ISandboxClient
 */
export class CloudflareSandboxClient implements ISandboxClient {
  private readonly namespace: DurableObjectNamespace<Container<unknown>>;

  constructor(namespace: DurableObjectNamespace<Container<unknown>>) {
    this.namespace = namespace;
  }

  /**
   * Get or create a sandbox instance by name
   * Uses Cloudflare's idFromName for consistent sandbox identity
   */
  getSandbox(sandboxName: string): ISandbox {
    const id = this.namespace.idFromName(sandboxName);
    const container = this.namespace.get(id);
    return new CloudflareSandbox(sandboxName, container);
  }
}

/**
 * Convenience function to create a Cloudflare sandbox from namespace binding
 * @deprecated Use createSandboxClient from abstractions.ts instead
 */
export function fromCloudflareNamespace(
  namespace: DurableObjectNamespace<Container<unknown>>
): ISandboxClient {
  return new CloudflareSandboxClient(namespace);
}

/**
 * Cloudflare Durable Object Container class for running workloads.
 * This class is the actual container that runs inside Cloudflare's container runtime.
 * It extends the @cloudflare/containers Container class and handles issue processing.
 *
 * Referenced in wrangler.jsonc as the MY_CONTAINER durable object class.
 */
export class MyContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = '15m'; // Extended timeout for Claude Code processing (can take several minutes)
  envVars: Record<string, string> = {
    MESSAGE: 'I was passed in via the container class!',
  };

  // Override fetch to handle environment variable setting for specific requests
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    logWithContext('CONTAINER', 'Container request received', {
      method: request.method,
      pathname: url.pathname,
      headers: Object.fromEntries(request.headers.entries()),
    });

    // Handle process-issue requests by setting environment variables
    if (url.pathname === '/process-issue' && request.method === 'POST') {
      logWithContext('CONTAINER', 'Processing issue request');

      try {
        const issueContext = (await request.json()) as Record<string, any>;

        logWithContext('CONTAINER', 'Issue context received', {
          issueId: issueContext.ISSUE_ID,
          repository: issueContext.REPOSITORY_NAME,
          envVarCount: Object.keys(issueContext).length,
        });

        // Set environment variables for this container instance
        // Note: Skip AGENT_SESSION_BLOB as it can exceed the 5000 byte env var limit
        // Session blob is passed directly in the request body and read by the container's main.ts
        const SKIP_ENV_VARS = ['AGENT_SESSION_BLOB'];
        let envVarsSet = 0;
        Object.entries(issueContext).forEach(([key, value]) => {
          if (typeof value === 'string' && !SKIP_ENV_VARS.includes(key)) {
            this.envVars[key] = value;
            envVarsSet++;
          }
        });

        logWithContext('CONTAINER', 'Environment variables set', {
          envVarsSet,
          totalEnvVars: Object.keys(issueContext).length,
        });

        logWithContext('CONTAINER', 'Forwarding request to container');

        // Create a new request with the JSON data to avoid ReadableStream being disturbed
        const newRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: JSON.stringify(issueContext),
        });

        const response = await super.fetch(newRequest);

        logWithContext('CONTAINER', 'Container response received', {
          status: response.status,
          statusText: response.statusText,
        });

        return response;
      } catch (error) {
        logWithContext('CONTAINER', 'Error processing issue request', {
          error: getErrorMessage(error),
          stack: getErrorStack(error),
        });

        return new Response(
          JSON.stringify({
            error: 'Failed to process issue context',
            message: (error as Error).message,
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // For all other requests, use default behavior
    logWithContext('CONTAINER', 'Using default container behavior');
    return super.fetch(request);
  }

  override onStart() {
    logWithContext('CONTAINER_LIFECYCLE', 'Container started successfully', {
      port: this.defaultPort,
      sleepAfter: this.sleepAfter,
    });
  }

  override onStop() {
    logWithContext('CONTAINER_LIFECYCLE', 'Container shut down successfully');
  }

  override onError(error: unknown) {
    logWithContext('CONTAINER_LIFECYCLE', 'Container error occurred', {
      error: getErrorMessage(error),
      stack: getErrorStack(error),
    });
  }
}
