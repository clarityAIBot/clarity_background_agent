import { handleOAuthCallback } from './handlers/setup/github-oauth';
import { handleClaudeSetup } from './handlers/setup/claude-setup';
import { handleLLMSetup, handleLLMStatus, handleLLMDelete } from './handlers/setup/llm-setup';
import { handleGitHubSetup } from './handlers/setup/github-setup';
import { handleGitHubStatus } from './handlers/setup/github-status';
import { handleGitHubWebhook } from './handlers/webhooks/github/router';
import { handleSlackCommand } from './handlers/slack/commands';
import { handleSlackSetup } from './handlers/setup/slack-setup';
import { handleSlackOAuthCallback } from './handlers/setup/slack-oauth';
import { configApi } from './handlers/api/config';
import { authApi } from './handlers/api/auth';
import { usersApi, policiesApi } from './handlers/api';
import { handleQueueMessage } from './queue/consumer';
import { logWithContext } from './core/log';
import { validateSession, unauthorizedResponse } from './core/auth';
import { initClarityEndpoint } from './core/constants';
import { getDb } from './db/client';
import { AppConfigRepository } from './db/repositories';
import { RequestService } from './services';
import { getErrorMessage, getErrorStack } from './utils';
import type { Env } from './core/types';

// Re-export MyContainer from integrations (Cloudflare-specific container class)
export { MyContainer } from './integrations/container';

export default {
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    // Initialize clarity endpoint from env
    if (env.CLARITY_ENDPOINT) {
      initClarityEndpoint(env.CLARITY_ENDPOINT);
    }
    await handleQueueMessage(batch, env);
  },

  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    // Initialize clarity endpoint from env
    if (env.CLARITY_ENDPOINT) {
      initClarityEndpoint(env.CLARITY_ENDPOINT);
    }

    const startTime = Date.now();
    const url = new URL(request.url);
    // Remove trailing slash if present (except for root /)
    const pathname = url.pathname.endsWith('/') && url.pathname.length > 1
      ? url.pathname.slice(0, -1)
      : url.pathname;

    logWithContext('MAIN_HANDLER', 'Incoming request details', {
      originalUrl: request.url,
      normalizedPathname: pathname,
      method: request.method
    });

    // Log all incoming requests
    logWithContext('MAIN_HANDLER', 'Incoming request', {
      method: request.method,
      pathname,
      origin: url.origin,
      userAgent: request.headers.get('user-agent'),
      contentType: request.headers.get('content-type'),
      referer: request.headers.get('referer'),
      cfRay: request.headers.get('cf-ray'),
      cfCountry: request.headers.get('cf-ipcountry')
    });

    let response: Response;
    let routeMatched = false;

    try {
      // Protected API routes - require session authentication
      const isProtectedRoute = ['/api/status', '/api/claude-setup', '/api/llm-setup', '/api/llm-status', '/api/llm-delete', '/api/slack-setup', '/api/slack-delete', '/api/history', '/api/gh-delete'].includes(pathname) || pathname.startsWith('/api/config/') || pathname.startsWith('/api/users') || pathname.startsWith('/api/policies');
      if (isProtectedRoute) {
        const authResult = await validateSession(request, env);
        if (!authResult.authenticated) {
          return unauthorizedResponse(request);
        }

        // Store auth result in request for downstream handlers to check roles
        (request as any).auth = authResult;
      }

      // API Config routes (system-defaults, etc.) - handled by configApi Hono app
      if (pathname.startsWith('/api/config/')) {
        logWithContext('MAIN_HANDLER', 'Routing to config API', { pathname });
        routeMatched = true;
        // configApi routes are mounted at /api/config, so we strip that prefix
        const configPath = pathname.replace('/api/config', '');
        const configUrl = new URL(request.url);
        configUrl.pathname = configPath;
        response = await configApi.fetch(new Request(configUrl.toString(), request), env);
      }

      // API Auth routes (Google SSO) - handled by authApi Hono app
      // These routes are NOT protected by SETUP_SECRET (they handle their own auth)
      else if (pathname.startsWith('/api/auth/')) {
        logWithContext('MAIN_HANDLER', 'Routing to auth API', { pathname });
        routeMatched = true;
        // authApi routes are mounted at /api/auth, so we strip that prefix
        const authPath = pathname.replace('/api/auth', '');
        const authUrl = new URL(request.url);
        authUrl.pathname = authPath;
        response = await authApi.fetch(new Request(authUrl.toString(), request), env);
      }

      // API Users routes (super admin only) - handled by usersApi Hono app
      else if (pathname.startsWith('/api/users')) {
        logWithContext('MAIN_HANDLER', 'Routing to users API', { pathname });
        routeMatched = true;
        response = await usersApi.fetch(request, env);
      }

      // API Policies routes (super admin only) - handled by policiesApi Hono app
      else if (pathname.startsWith('/api/policies')) {
        logWithContext('MAIN_HANDLER', 'Routing to policies API', { pathname });
        routeMatched = true;
        response = await policiesApi.fetch(request, env);
      }

      // API Status endpoint (for SvelteKit frontend)
      else if (pathname === '/api/status') {
        logWithContext('MAIN_HANDLER', 'Routing to API status');
        routeMatched = true;
        response = await handleGitHubStatus(request, env);
      }

      // API Claude setup endpoint (for SvelteKit frontend) - legacy, kept for backwards compatibility
      else if (pathname === '/api/claude-setup' && request.method === 'POST') {
        logWithContext('MAIN_HANDLER', 'Routing to API Claude setup');
        routeMatched = true;
        response = await handleClaudeSetup(request, url.origin, env);
      }

      // API LLM setup endpoint (for SvelteKit frontend) - multi-provider support
      else if (pathname === '/api/llm-setup' && request.method === 'POST') {
        logWithContext('MAIN_HANDLER', 'Routing to API LLM setup');
        routeMatched = true;
        response = await handleLLMSetup(request, url.origin, env);
      }

      // API LLM status endpoint (for SvelteKit frontend) - check which providers are configured
      else if (pathname === '/api/llm-status' && request.method === 'GET') {
        logWithContext('MAIN_HANDLER', 'Routing to API LLM status');
        routeMatched = true;
        response = await handleLLMStatus(request, url.origin, env);
      }

      // API LLM delete endpoint (for SvelteKit frontend) - delete provider config
      else if (pathname === '/api/llm-delete' && request.method === 'DELETE') {
        logWithContext('MAIN_HANDLER', 'Routing to API LLM delete');
        routeMatched = true;
        response = await handleLLMDelete(request, url.origin, env);
      }

      // API Slack setup endpoint (for SvelteKit frontend) - handles credential submission
      else if (pathname === '/api/slack-setup' && request.method === 'POST') {
        logWithContext('MAIN_HANDLER', 'Routing to API Slack setup');
        routeMatched = true;
        response = await handleSlackSetup(request, url.origin, env);
      }

      // API Request History endpoint (for SvelteKit frontend) - now from PostgreSQL with pagination
      else if (pathname === '/api/history' && request.method === 'GET') {
        logWithContext('MAIN_HANDLER', 'Routing to API history');
        routeMatched = true;

        try {
          // Parse pagination params
          const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
          const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '100', 10)));
          const offset = (page - 1) * pageSize;

          const db = getDb(env);
          const requestService = new RequestService(db);
          const result = await requestService.getRecentRequestsPaginated(pageSize, offset);
          response = new Response(JSON.stringify({
            history: result.requests,
            pagination: {
              page: result.page,
              pageSize: result.pageSize,
              total: result.total,
              totalPages: result.totalPages,
            }
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          logWithContext('MAIN_HANDLER', 'Error fetching history', {
            error: getErrorMessage(error)
          });
          response = new Response(JSON.stringify({ error: 'Failed to fetch history' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // API Session endpoint - get session metadata for a request (lazy loaded)
      // Use ?includeBlob=true to also include the session blob content
      // Must come BEFORE the generic /api/requests/:id endpoint
      else if (pathname.match(/^\/api\/requests\/[^/]+\/session$/) && request.method === 'GET') {
        const requestId = pathname.replace('/api/requests/', '').replace('/session', '');
        const includeBlob = url.searchParams.get('includeBlob') === 'true';
        logWithContext('MAIN_HANDLER', 'Routing to API session endpoint', { requestId, includeBlob });
        routeMatched = true;

        const authResult = await validateSession(request, env);
        if (!authResult.authenticated) {
          response = unauthorizedResponse(request);
        } else {
          try {
            const db = getDb(env);
            const { AgentSessionsRepository } = await import('./db/repositories');
            const sessionsRepo = new AgentSessionsRepository(db);

            const session = await sessionsRepo.getForRequest(requestId);
            if (!session) {
              response = new Response(JSON.stringify({
                hasSession: false,
                session: null
              }), {
                headers: { 'Content-Type': 'application/json' }
              });
            } else {
              // Return session metadata, optionally with blob
              const sessionData: Record<string, unknown> = {
                id: session.id,
                requestId: session.requestId,
                sessionId: session.sessionId,
                agentType: session.agentType,
                blobSizeBytes: session.blobSizeBytes,
                createdAt: session.createdAt,
                expiresAt: session.expiresAt
              };

              // Include blob content only when requested
              if (includeBlob) {
                sessionData.blob = session.sessionBlob;
              }

              response = new Response(JSON.stringify({
                hasSession: true,
                session: sessionData
              }), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
          } catch (error) {
            logWithContext('MAIN_HANDLER', 'Error fetching session', {
              error: getErrorMessage(error)
            });
            response = new Response(JSON.stringify({ error: 'Failed to fetch session' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      }

      // API Handover signed URL endpoint - generate time-limited download links (1 hour)
      // Returns signed URLs for both markdown handover and session .jsonl download
      // Must come BEFORE the generic /api/requests/:id endpoint
      else if (pathname.match(/^\/api\/requests\/[^/]+\/handover-url$/) && request.method === 'POST') {
        const requestId = pathname.replace('/api/requests/', '').replace('/handover-url', '');
        logWithContext('MAIN_HANDLER', 'Routing to API handover-url endpoint', { requestId });
        routeMatched = true;

        const authResult = await validateSession(request, env);
        if (!authResult.authenticated) {
          response = unauthorizedResponse(request);
        } else {
          try {
            const { generateSignedToken } = await import('./utils/signed-url');
            const secret = env.JWT_SECRET || env.ENCRYPTION_KEY || '';
            const { token, expires } = await generateSignedToken(requestId, secret);
            const handoverUrl = `${url.origin}/api/requests/${requestId}/handover?token=${token}`;
            const sessionUrl = `${url.origin}/api/requests/${requestId}/handover?token=${token}&format=session`;

            // Check if session exists
            const db = getDb(env);
            const { AgentSessionsRepository } = await import('./db/repositories');
            const sessionsRepo = new AgentSessionsRepository(db);
            const session = await sessionsRepo.getForRequest(requestId);

            response = new Response(JSON.stringify({
              url: handoverUrl,
              sessionUrl: session ? sessionUrl : null,
              sessionId: session?.sessionId ?? null,
              hasSession: !!session,
              expires,
            }), {
              headers: { 'Content-Type': 'application/json' },
            });
          } catch (error) {
            logWithContext('MAIN_HANDLER', 'Error generating handover URL', {
              error: getErrorMessage(error)
            });
            response = new Response(JSON.stringify({ error: 'Failed to generate URL' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      }

      // API Handover endpoint - download task context as markdown for local Claude Code
      // Accepts either session cookie OR signed token query param
      else if (pathname.match(/^\/api\/requests\/[^/]+\/handover$/) && request.method === 'GET') {
        const requestId = pathname.replace('/api/requests/', '').replace('/handover', '');
        logWithContext('MAIN_HANDLER', 'Routing to API handover endpoint', { requestId });
        routeMatched = true;

        // Auth: signed token (for curl) OR session cookie (for browser)
        let authorized = false;
        const token = url.searchParams.get('token');
        if (token) {
          const { verifySignedToken } = await import('./utils/signed-url');
          const secret = env.JWT_SECRET || env.ENCRYPTION_KEY || '';
          const tokenRequestId = await verifySignedToken(token, secret);
          authorized = tokenRequestId === requestId;
          if (!authorized) {
            logWithContext('MAIN_HANDLER', 'Invalid or expired handover token', { requestId });
          }
        } else {
          const authResult = await validateSession(request, env);
          authorized = authResult.authenticated;
        }

        if (!authorized) {
          response = new Response('Unauthorized or expired link', { status: 401 });
        } else {
          const format = url.searchParams.get('format');

          if (format === 'session') {
            // Return decompressed session .jsonl
            try {
              const db = getDb(env);
              const { AgentSessionsRepository } = await import('./db/repositories');
              const sessionsRepo = new AgentSessionsRepository(db);
              const session = await sessionsRepo.getForRequest(requestId);

              if (!session) {
                response = new Response('No session found for this request', { status: 404 });
              } else {
                // Decompress: base64 decode → gunzip
                const compressed = Uint8Array.from(atob(session.sessionBlob), c => c.charCodeAt(0));
                const ds = new DecompressionStream('gzip');
                const writer = ds.writable.getWriter();
                writer.write(compressed);
                writer.close();

                const decompressedStream = ds.readable;
                response = new Response(decompressedStream, {
                  headers: {
                    'Content-Type': 'application/x-ndjson; charset=utf-8',
                    'Content-Disposition': `attachment; filename="${session.sessionId}.jsonl"`,
                  },
                });
              }
            } catch (error) {
              logWithContext('MAIN_HANDLER', 'Error downloading session', {
                error: getErrorMessage(error)
              });
              response = new Response('Failed to download session', { status: 500 });
            }
          } else {
            // Return markdown handover
            try {
              const db = getDb(env);
              const requestService = new RequestService(db);
              const result = await requestService.getRequestWithMessages(requestId);

              if (!result) {
                response = new Response('Request not found', { status: 404 });
              } else {
                const { formatThreadForLLM } = await import('./utils/handover');
                const markdown = formatThreadForLLM(result);
                response = new Response(markdown, {
                  headers: {
                    'Content-Type': 'text/markdown; charset=utf-8',
                    'Content-Disposition': `attachment; filename="task-handover-${requestId}.md"`,
                  },
                });
              }
            } catch (error) {
              logWithContext('MAIN_HANDLER', 'Error generating handover', {
                error: getErrorMessage(error)
              });
              response = new Response('Failed to generate handover', { status: 500 });
            }
          }
        }
      }

      // API Request Detail endpoint - get full message thread for a specific request
      else if (pathname.startsWith('/api/requests/') && request.method === 'GET') {
        const requestId = pathname.replace('/api/requests/', '');
        logWithContext('MAIN_HANDLER', 'Routing to API request detail', { requestId });
        routeMatched = true;

        // Validate auth for this endpoint too
        const authResult = await validateSession(request, env);
        if (!authResult.authenticated) {
          response = unauthorizedResponse(request);
        } else {
          try {
            const db = getDb(env);
            const requestService = new RequestService(db);

            // Get the feature request with messages
            const result = await requestService.getRequestWithMessages(requestId);
            if (!result) {
              response = new Response(JSON.stringify({ error: 'Request not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              });
            } else {
              response = new Response(JSON.stringify(result), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
          } catch (error) {
            logWithContext('MAIN_HANDLER', 'Error fetching request detail', {
              error: getErrorMessage(error)
            });
            response = new Response(JSON.stringify({ error: 'Failed to fetch request detail' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      }

      // API Debug endpoint - now from PostgreSQL
      else if (pathname === '/api/debug-info' && request.method === 'GET') {
        logWithContext('MAIN_HANDLER', 'Routing to API debug info');
        routeMatched = true;

        try {
          const db = getDb(env);
          const configRepo = new AppConfigRepository(db);
          const requestService = new RequestService(db);

          const configs = await configRepo.getAllConfigs();
          const requestCount = await requestService.getRequestCount();

          response = new Response(JSON.stringify({
            database: 'postgresql',
            hasGitHubConfig: !!configs.github,
            hasLLMConfig: !!configs.llm,
            hasSlackConfig: !!configs.slack,
            totalRequests: requestCount
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          logWithContext('MAIN_HANDLER', 'Error fetching debug info', {
            error: getErrorMessage(error)
          });
          response = new Response(JSON.stringify({ error: 'Failed to fetch debug info' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Claude Code Setup Route (HTML page - let SPA handle)
      else if (pathname === '/claude-setup' && request.method === 'POST') {
        logWithContext('MAIN_HANDLER', 'Routing to Claude setup POST');
        routeMatched = true;
        response = await handleClaudeSetup(request, url.origin, env);
      }

      // GitHub App Setup Routes
      else if (pathname === '/gh-setup' && request.method === 'POST') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub setup POST');
        routeMatched = true;
        response = await handleGitHubSetup(request, url.origin);
      }

      else if (pathname.startsWith('/api/gh-callback')) {
        logWithContext('MAIN_HANDLER', 'Routing to OAuth callback (startsWith match)');
        routeMatched = true;
        response = await handleOAuthCallback(request, url, env);
      }

      // API Delete GitHub app endpoint (for SvelteKit frontend) - now from PostgreSQL
      else if (pathname === '/api/gh-delete' && request.method === 'DELETE') {
        logWithContext('MAIN_HANDLER', 'Routing to API GitHub delete');
        routeMatched = true;

        try {
          const db = getDb(env);
          const configRepo = new AppConfigRepository(db);

          // Get current config for appId before deleting
          const githubConfig = await configRepo.getGitHubConfig();
          const appId = githubConfig?.appId;

          // Delete GitHub config from PostgreSQL
          await configRepo.deleteGitHubConfig();

          response = new Response(JSON.stringify({
            success: true,
            appId,
            message: 'GitHub app config deleted. Please delete the app from GitHub settings manually.'
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          logWithContext('MAIN_HANDLER', 'Error deleting GitHub config', {
            error: getErrorMessage(error)
          });
          response = new Response(JSON.stringify({ error: 'Failed to delete GitHub config' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // API Delete Slack config endpoint (for SvelteKit frontend)
      else if (pathname === '/api/slack-delete' && request.method === 'DELETE') {
        logWithContext('MAIN_HANDLER', 'Routing to API Slack delete');
        routeMatched = true;

        try {
          const db = getDb(env);
          const configRepo = new AppConfigRepository(db);

          // Delete Slack config from PostgreSQL
          await configRepo.deleteSlackConfig();

          response = new Response(JSON.stringify({
            success: true,
            message: 'Slack configuration deleted successfully.'
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          logWithContext('MAIN_HANDLER', 'Error deleting Slack config', {
            error: getErrorMessage(error)
          });
          response = new Response(JSON.stringify({ error: 'Failed to delete Slack config' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Status endpoint to check stored configurations (JSON API)
      else if (pathname === '/gh-status') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub status');
        routeMatched = true;
        response = await handleGitHubStatus(request, env);
      }

      // GitHub webhook endpoint
      else if (pathname === '/webhooks/github') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub webhook handler');
        routeMatched = true;
        response = await handleGitHubWebhook(request, env);
      }

      // Slack App Setup Routes
      // Note: /slack-setup is now handled by SvelteKit frontend (falls through to ASSETS)

      else if (pathname === '/slack-setup/callback') {
        logWithContext('MAIN_HANDLER', 'Routing to Slack OAuth callback');
        routeMatched = true;
        response = await handleSlackOAuthCallback(request, env);
      }

      // Slack slash command endpoint
      else if (pathname === '/slack/command' && request.method === 'POST') {
        logWithContext('MAIN_HANDLER', 'Routing to Slack command handler');
        routeMatched = true;
        response = await handleSlackCommand(request, env);
      }

      // Slack events endpoint (for thread replies)
      else if (pathname === '/slack/events' && request.method === 'POST') {
        logWithContext('MAIN_HANDLER', 'Routing to Slack events handler');
        routeMatched = true;
        const { handleSlackEvents } = await import('./handlers/slack/events');
        response = await handleSlackEvents(request, env);
      }

      // Slack interactivity endpoint (for modals and button clicks)
      else if (pathname === '/slack/interactivity' && request.method === 'POST') {
        logWithContext('MAIN_HANDLER', 'Routing to Slack interactivity handler');
        routeMatched = true;
        const { handleSlackInteractivity } = await import('./handlers/slack/interactivity');
        response = await handleSlackInteractivity(request, env);
      }

      // Let unmatched routes fall through to SvelteKit SPA (served by Cloudflare Assets)
      else {
        logWithContext('MAIN_HANDLER', 'Route not matched by Worker, falling through to assets');
        // Return null/undefined to let assets binding handle it with not_found_handling: "single-page-application"
        return env.ASSETS.fetch(request);
      }

      const processingTime = Date.now() - startTime;

      logWithContext('MAIN_HANDLER', 'Request completed successfully', {
        pathname,
        method: request.method,
        status: response.status,
        statusText: response.statusText,
        processingTimeMs: processingTime,
        routeMatched
      });

      return response;

    } catch (error) {
      const processingTime = Date.now() - startTime;

      logWithContext('MAIN_HANDLER', 'Request failed with error', {
        pathname,
        method: request.method,
        error: getErrorMessage(error),
        stack: getErrorStack(error),
        processingTimeMs: processingTime,
        routeMatched
      });

      return new Response(JSON.stringify({
        error: 'Internal server error',
        message: getErrorMessage(error),
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
};
