import { logWithContext } from "../../core/log";
import { getDb } from "../../db/client";
import { AppConfigRepository } from "../../db/repositories";
import { decrypt } from "../../core/crypto";
import { verifySlackRequestSignature, parseClarityCommand } from "../../integrations/slack";
import { postSlackMessage } from "./commands";
import { createQueueProducer } from "../../queue/abstractions";
import type { SlackAppMentionMessage, SlackFileAttachment } from "../../queue/types";
import type { Env } from "../../core/types";
import { getErrorMessage } from "../../utils";
import { getClarityEndpoint } from "../../core/constants";

/**
 * Handle Slack Events API requests
 *
 * This handler is minimal by design - it validates the request and queues
 * the event for async processing. This ensures we respond within Slack's
 * 3-second timeout to avoid retry duplicates.
 */
export async function handleSlackEvents(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await request.text();

  logWithContext("SLACK_EVENTS", "Received Slack event", {
    contentType: request.headers.get("content-type"),
    bodyLength: body.length,
  });

  const db = getDb(env);
  const configRepo = new AppConfigRepository(db);

  // Get signing secret
  let signingSecret = env.SLACK_SIGNING_SECRET;

  if (!signingSecret) {
    try {
      const slackConfig = await configRepo.getSlackConfig();

      if (slackConfig?.signingSecretEncrypted) {
        signingSecret = await decrypt(slackConfig.signingSecretEncrypted, env.ENCRYPTION_KEY!);
      }
    } catch (error) {
      logWithContext("SLACK_EVENTS", "Failed to retrieve stored Slack config", {
        error: getErrorMessage(error),
      });
    }
  }

  // Verify signature
  if (signingSecret) {
    const isValid = await verifySlackRequestSignature(body, request, signingSecret);
    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }
  }

  // Parse the event
  let eventData: any;
  try {
    eventData = JSON.parse(body);
  } catch (error) {
    logWithContext("SLACK_EVENTS", "Invalid JSON", {
      error: getErrorMessage(error),
    });
    return new Response("Invalid JSON", { status: 400 });
  }

  // Handle URL verification challenge (required for Events API setup)
  if (eventData.type === "url_verification") {
    logWithContext("SLACK_EVENTS", "URL verification challenge received");
    return new Response(eventData.challenge, {
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Handle event callbacks
  if (eventData.type === "event_callback") {
    const event = eventData.event;

    logWithContext("SLACK_EVENTS", "Processing event callback", {
      eventType: event.type,
      subtype: event.subtype,
      channel: event.channel,
      threadTs: event.thread_ts,
    });

    // Handle message events (thread replies) - DISABLED
    // Users must use @clarity mention to interact with the bot
    if (event.type === "message" && event.thread_ts && !event.subtype) {
      logWithContext("SLACK_EVENTS", "Skipping thread reply (require @mention)", {
        channel: event.channel,
        threadTs: event.thread_ts,
      });
      return new Response("OK", { status: 200 });
    }

    // Handle app_mention events (@clarity mentions)
    // Queue immediately and return - all processing happens in consumer
    if (event.type === "app_mention") {
      return handleAppMention(event, env);
    }

    // Acknowledge other events
    return new Response("OK", { status: 200 });
  }

  logWithContext("SLACK_EVENTS", "Unknown event type", {
    type: eventData.type,
  });

  return new Response("OK", { status: 200 });
}

/**
 * Handle @clarity app_mention events - MINIMAL HANDLER
 *
 * This handler handles simple commands (help) directly and queues
 * everything else for async processing.
 *
 * This ensures we respond within Slack's 3-second timeout.
 */
async function handleAppMention(event: any, env: Env): Promise<Response> {
  const { text, channel, ts, thread_ts, user, files } = event;

  // Extract file attachments if present (requires files:read OAuth scope)
  const attachments: SlackFileAttachment[] | undefined = files?.length
    ? files
        .filter((f: any) => f.url_private_download && f.name)
        .map((f: any) => ({
          name: f.name,
          mimetype: f.mimetype || "application/octet-stream",
          filetype: f.filetype || "",
          size: f.size || 0,
          urlPrivateDownload: f.url_private_download,
        }))
    : undefined;

  logWithContext("SLACK_EVENTS", "Processing app_mention", {
    channel,
    ts,
    threadTs: thread_ts,
    user,
    textLength: text?.length,
    attachmentCount: attachments?.length ?? 0,
  });

  // Parse the command to check for help
  const { prompt } = parseClarityCommand(text);

  // Handle help command directly (no heavy processing needed)
  if (prompt.toLowerCase() === "help") {
    const db = getDb(env);
    const configRepo = new AppConfigRepository(db);

    try {
      const slackConfig = await configRepo.getSlackConfig();
      if (slackConfig?.botTokenEncrypted) {
        const botToken = await decrypt(slackConfig.botTokenEncrypted, env.ENCRYPTION_KEY!);
        await postSlackMessage(
          botToken,
          channel,
          `*Clarity AI - Help*\n\n` +
          `Mention me with a task and I'll work on it!\n\n` +
          `*Usage:*\n` +
          `\`@clarity [options] <your request>\`\n\n` +
          `*Options (all optional):*\n` +
          `• \`repo=name\` - Target repository (default: system default)\n` +
          `• \`type=feature|bug|refactor|docs|question\` - Request type\n` +
          `• \`branch=main\` - Base branch (coming soon)\n\n` +
          `*Examples:*\n` +
          `• \`@clarity fix the login bug\`\n` +
          `• \`@clarity [repo=myapp] add dark mode\`\n` +
          `• \`@clarity [repo=api, type=bug] fix null pointer exception\`\n` +
          `• \`@clarity [type=docs] add README for auth module\`\n\n` +
          `*In Threads:*\n` +
          `• Mention \`@clarity\` in a thread with an active agent to add follow-up instructions\n` +
          `• Use \`@clarity agent <prompt>\` to force a new agent instead of a follow-up\n\n` +
          `*Status Reactions:*\n` +
          `• ⏳ - Working on it\n` +
          `• ✅ - Completed successfully\n` +
          `• ❌ - Failed (check thread for details)\n\n` +
          `<${getClarityEndpoint()}|📚 View Dashboard & How It Works>`,
          thread_ts || ts
        );
      }
    } catch (error) {
      logWithContext("SLACK_EVENTS", "Failed to send help message", {
        error: getErrorMessage(error),
      });
    }
    return new Response("OK", { status: 200 });
  }

  // Queue everything else for async processing
  try {
    const queueProducer = createQueueProducer<SlackAppMentionMessage>({ cloudflareQueue: env.ISSUE_QUEUE });
    await queueProducer.send({
      type: "slack_app_mention",
      text,
      channel,
      ts,
      threadTs: thread_ts,
      user,
      attachments,
    });

    logWithContext("SLACK_EVENTS", "app_mention queued successfully", {
      channel,
      ts,
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    logWithContext("SLACK_EVENTS", "Failed to queue app_mention", {
      error: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Still return 200 to avoid Slack retries
    return new Response("OK", { status: 200 });
  }
}
