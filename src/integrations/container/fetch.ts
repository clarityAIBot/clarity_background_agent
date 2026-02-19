import { Container } from '@cloudflare/containers';
import { logWithContext } from '../../core/log';

export interface ContainerFetchOptions {
  containerName?: string;
  route?: string;
  timeout?: number;
  maxRetries?: number;
  initialDelayMs?: number;
}

// Helper function to delay execution
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if error message indicates a container cold start error
function isContainerColdStartErrorMessage(errorMessage: string): boolean {
  return errorMessage.includes('not listening') ||
         errorMessage.includes('TCP address') ||
         errorMessage.includes('connection refused') ||
         errorMessage.includes('ECONNREFUSED') ||
         errorMessage.includes('Error proxying request');
}

// Check if error is a container cold start error
function isContainerColdStartError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return isContainerColdStartErrorMessage(errorMessage);
}

// Check if response body contains a cold start error
async function isResponseColdStartError(response: Response): Promise<{ isColdStart: boolean; errorText: string }> {
  if (response.ok) {
    return { isColdStart: false, errorText: '' };
  }

  try {
    const errorText = await response.text();
    return {
      isColdStart: isContainerColdStartErrorMessage(errorText),
      errorText
    };
  } catch {
    return { isColdStart: false, errorText: 'Unable to read response body' };
  }
}

/**
 * Wrapper for container.fetch calls with enhanced logging, error handling, retry logic, and timing
 * Includes exponential backoff for container cold starts
 */
export async function containerFetch(
  container: DurableObjectStub<Container<unknown>> | Container<unknown>,
  request: Request,
  options: ContainerFetchOptions = {}
): Promise<Response> {
  const {
    containerName = 'unknown',
    route = 'unknown',
    timeout = 900000, // 15 minutes - Claude Code can take time for complex issues
    maxRetries = 5,
    initialDelayMs = 2000
  } = options;
  const startTime = Date.now();

  logWithContext('CONTAINER_FETCH', `Starting fetch to ${containerName} for route ${route}`, {
    url: request.url,
    method: request.method,
    containerName,
    route,
    maxRetries,
    initialDelayMs
  });

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Create a timeout promise for this attempt
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Container fetch timeout after ${timeout}ms`)), timeout);
      });

      // Clone the request for retry (Request body can only be read once)
      const requestClone = request.clone();

      // Race between the actual fetch and timeout
      const response = await Promise.race([
        container.fetch(requestClone),
        timeoutPromise
      ]);

      const duration = Date.now() - startTime;

      // Check if response contains a cold start error (500 with specific error message)
      if (!response.ok) {
        const { isColdStart, errorText } = await isResponseColdStartError(response.clone());

        if (isColdStart && attempt < maxRetries) {
          const delayMs = initialDelayMs * Math.pow(2, attempt);
          logWithContext('CONTAINER_FETCH', `Container cold start error in response, waiting ${delayMs}ms before retry`, {
            containerName,
            route,
            status: response.status,
            errorText: errorText.substring(0, 200),
            attempt: attempt + 1,
            nextAttempt: attempt + 2,
            delayMs
          });
          await delay(delayMs);
          continue;
        }

        // Not a cold start error or exhausted retries - return the error response
        logWithContext('CONTAINER_FETCH', `Container fetch returned error response`, {
          containerName,
          route,
          status: response.status,
          statusText: response.statusText,
          duration: `${duration}ms`,
          attempt: attempt + 1,
          errorText: errorText.substring(0, 200)
        });

        // Return a new response with the error text (original was consumed)
        return new Response(errorText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }

      logWithContext('CONTAINER_FETCH', `Container fetch completed successfully`, {
        containerName,
        route,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        attempt: attempt + 1
      });

      return response;
    } catch (error) {
      lastError = error;
      const duration = Date.now() - startTime;

      logWithContext('CONTAINER_FETCH', `Container fetch attempt ${attempt + 1} failed`, {
        containerName,
        route,
        error: error instanceof Error ? error.message : String(error),
        duration: `${duration}ms`,
        attempt: attempt + 1,
        maxRetries,
        isColdStartError: isContainerColdStartError(error)
      });

      // If this is a cold start error and we have retries left, wait and retry
      if (isContainerColdStartError(error) && attempt < maxRetries) {
        const delayMs = initialDelayMs * Math.pow(2, attempt); // Exponential backoff
        logWithContext('CONTAINER_FETCH', `Container cold start detected, waiting ${delayMs}ms before retry`, {
          containerName,
          attempt: attempt + 1,
          nextAttempt: attempt + 2,
          delayMs
        });
        await delay(delayMs);
        continue;
      }

      // For non-cold-start errors or if we've exhausted retries, break out
      break;
    }
  }

  const duration = Date.now() - startTime;

  logWithContext('CONTAINER_FETCH', `Container fetch failed after all retries`, {
    containerName,
    route,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    duration: `${duration}ms`,
    totalAttempts: maxRetries + 1
  });

  // Return a proper error response instead of throwing
  return new Response(
    JSON.stringify({
      error: `Container fetch failed`,
      message: lastError instanceof Error ? lastError.message : String(lastError),
      containerName,
      route
    }),
    {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
}

/**
 * Helper function to extract route information from request URL
 */
export function getRouteFromRequest(request: Request): string {
  try {
    const url = new URL(request.url);
    return url.pathname;
  } catch {
    return 'unknown';
  }
}