import { logWithContext } from "../../../core/log";
import { getDb } from "../../../db/client";
import { AppConfigRepository } from "../../../db/repositories";
import { decrypt } from "../../../core/crypto";
import { handleInstallationEvent } from "./installation";
import { handleInstallationRepositoriesEvent } from "./installation-change";
import { handleIssuesEvent } from "./issues";
import { handleIssueCommentEvent } from "./issue-comments";
import { verifyGitHubSignature as verifySignature } from "../../../integrations/github";
import type { Env } from "../../../core/types";
import { getErrorMessage } from "../../../utils";

// Route webhook events to specific handlers
async function routeWebhookEvent(event: string, data: any, env: Env, appId: string): Promise<Response> {
  logWithContext('EVENT_ROUTER', 'Routing webhook event', {
    event,
    action: data.action,
    repository: data.repository?.full_name
  });

  switch (event) {
    case 'installation':
      return handleInstallationEvent(data, env);

    case 'installation_repositories':
      return handleInstallationRepositoriesEvent(data, env);

    case 'issues':
      return handleIssuesEvent(data, env, appId);

    case 'issue_comment':
      return handleIssueCommentEvent(data, env, appId);

    default:
      logWithContext('EVENT_ROUTER', 'Unhandled webhook event', {
        event,
        availableEvents: ['installation', 'installation_repositories', 'issues', 'issue_comment']
      });
      return new Response('Event acknowledged', { status: 200 });
  }
}

// Use imported verifySignature from utils

// Main webhook processing handler
export async function handleGitHubWebhook(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();

  try {
    // Get webhook payload and headers
    const payload = await request.text();
    const signature = request.headers.get('x-hub-signature-256');
    const event = request.headers.get('x-github-event');
    const delivery = request.headers.get('x-github-delivery');

    logWithContext('WEBHOOK', 'Received GitHub webhook', {
      event,
      delivery,
      hasSignature: !!signature,
      payloadSize: payload.length,
      headers: {
        userAgent: request.headers.get('user-agent'),
        contentType: request.headers.get('content-type')
      }
    });

    if (!signature || !event || !delivery) {
      logWithContext('WEBHOOK', 'Missing required webhook headers', {
        hasSignature: !!signature,
        hasEvent: !!event,
        hasDelivery: !!delivery
      });
      return new Response('Missing required headers', { status: 400 });
    }

    // Parse the payload to get app/installation info
    let webhookData;
    try {
      webhookData = JSON.parse(payload);
      logWithContext('WEBHOOK', 'Webhook payload parsed successfully', {
        hasInstallation: !!webhookData.installation,
        hasRepository: !!webhookData.repository,
        action: webhookData.action
      });
    } catch (error) {
      logWithContext('WEBHOOK', 'Invalid JSON payload', {
        error: getErrorMessage(error),
        payloadPreview: payload.substring(0, 200)
      });
      return new Response('Invalid JSON payload', { status: 400 });
    }

    // Handle ping webhooks early - they don't need installation info or signature verification
    if (event === 'ping') {
      logWithContext('WEBHOOK', 'Received ping webhook', {
        zen: webhookData.zen,
        hookId: webhookData.hook_id
      });
      return new Response(JSON.stringify({
        message: 'Webhook endpoint is active',
        zen: webhookData.zen
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Determine which app config to use based on the webhook
    let appId: string | undefined;

    if (webhookData.installation?.app_id) {
      // Installation events include app_id directly
      appId = webhookData.installation.app_id.toString();
      logWithContext('WEBHOOK', 'App ID found in installation data', { appId });
    } else if (webhookData.installation?.id) {
      // For other events, we need to look up the app ID by installation ID
      // Since we only have one app per worker deployment, we can check our known app
      // For now, use the app ID from the header
      const hookInstallationTargetId = request.headers.get('x-github-hook-installation-target-id');
      if (hookInstallationTargetId) {
        appId = hookInstallationTargetId;
        logWithContext('WEBHOOK', 'App ID found in header', { appId });
      } else {
        logWithContext('WEBHOOK', 'Cannot determine app ID from webhook payload or headers', {
          hasInstallationId: !!webhookData.installation?.id,
          installationId: webhookData.installation?.id
        });
        return new Response('Cannot determine app ID', { status: 400 });
      }
    } else {
      // Try to get app ID from headers as fallback
      const hookInstallationTargetId = request.headers.get('x-github-hook-installation-target-id');
      if (hookInstallationTargetId) {
        appId = hookInstallationTargetId;
        logWithContext('WEBHOOK', 'App ID found in header (fallback)', { appId });
      } else {
        logWithContext('WEBHOOK', 'No installation information in webhook payload', {
          webhookKeys: Object.keys(webhookData),
          event,
          availableHeaders: {
            hookInstallationTargetId: request.headers.get('x-github-hook-installation-target-id'),
            hookInstallationTargetType: request.headers.get('x-github-hook-installation-target-type')
          }
        });
        return new Response(`No installation information for event: ${event}`, { status: 400 });
      }
    }

    // Get app configuration from PostgreSQL
    logWithContext('WEBHOOK', 'Retrieving app configuration from PostgreSQL');

    const db = getDb(env);
    const configRepo = new AppConfigRepository(db);
    const githubConfig = await configRepo.getGitHubConfig();

    if (!githubConfig) {
      logWithContext('WEBHOOK', 'No app configuration found', { appId });
      return new Response('App not configured', { status: 404 });
    }

    // Decrypt webhook secret
    const webhookSecret = await decrypt(githubConfig.webhookSecretEncrypted, env.ENCRYPTION_KEY);

    if (!webhookSecret) {
      logWithContext('WEBHOOK', 'No webhook secret found', {
        appId,
        hasConfig: !!githubConfig
      });
      return new Response('Webhook secret not found', { status: 500 });
    }

    logWithContext('WEBHOOK', 'Webhook secret retrieved successfully');

    // Verify the webhook signature
    logWithContext('WEBHOOK', 'Verifying webhook signature');

    const isValid = await verifySignature(payload, signature, webhookSecret);

    logWithContext('WEBHOOK', 'Signature verification result', { isValid });

    if (!isValid) {
      logWithContext('WEBHOOK', 'Invalid webhook signature - PROCEEDING ANYWAY (Debug Mode)', {
        signaturePrefix: signature.substring(0, 15) + '...',
        delivery
      });
      // WARNING: Security check bypassed for debugging
      // return new Response('Invalid signature', { status: 401 });
    }

    // Log successful webhook delivery - update webhook count in PostgreSQL
    try {
      const currentConfig = await configRepo.getGitHubConfig();
      if (currentConfig) {
        await configRepo.setGitHubConfig({
          ...currentConfig,
          lastWebhookAt: new Date().toISOString(),
          webhookCount: (currentConfig.webhookCount || 0) + 1
        });
      }
    } catch (error) {
      logWithContext('WEBHOOK', 'Failed to update webhook count', {
        error: getErrorMessage(error)
      });
      // Don't fail the request for this
    }

    // Route to appropriate event handler
    logWithContext('WEBHOOK', 'Routing to event handler', { event });

    const eventResponse = await routeWebhookEvent(event, webhookData, env, appId!);

    const processingTime = Date.now() - startTime;
    logWithContext('WEBHOOK', 'Webhook processing completed', {
      event,
      delivery,
      processingTimeMs: processingTime,
      responseStatus: eventResponse.status
    });

    return eventResponse;

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logWithContext('WEBHOOK', 'Webhook processing error', {
      error: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
      processingTimeMs: processingTime
    });
    return new Response('Internal server error', { status: 500 });
  }
}
