import { logWithContext } from "../../core/log";
import { decrypt } from "../../core/crypto";
import { addSlackReaction, removeSlackReaction } from "../../handlers/slack/commands";
import { AppConfigRepository } from "../../db/repositories";
import { RequestService } from "../../services";

// Slack reaction emoji constants
export const REACTION_PROCESSING = "clarity-loading";
export const REACTION_CLARIFICATION = "speech_balloon";
export const REACTION_SUCCESS = "white_check_mark";
export const REACTION_ERROR = "x";

export interface SlackContext {
  botToken: string;
  channelId: string;
  messageTs: string;
}

/**
 * Get Slack context for a request (bot token, channel, message ts)
 * Returns null if Slack context is not available
 */
export async function getSlackContext(
  configRepo: AppConfigRepository,
  requestService: RequestService,
  requestId: string,
  encryptionKey: string
): Promise<SlackContext | null> {
  const slackConfig = await configRepo.getSlackConfig();
  const request = await requestService.requests.findByRequestId(requestId);

  const messageTs = request?.slackTriggerMessageTs || request?.slackThreadTs;

  if (!slackConfig?.botTokenEncrypted || !request?.slackChannelId || !messageTs) {
    return null;
  }

  const botToken = await decrypt(slackConfig.botTokenEncrypted, encryptionKey);

  return {
    botToken,
    channelId: request.slackChannelId,
    messageTs,
  };
}

/**
 * Update Slack reaction - removes old reaction and adds new one
 * Silently handles errors to not interrupt main processing
 */
export async function updateSlackReaction(
  context: SlackContext,
  removeReaction: string,
  addReaction: string,
  requestId: string
): Promise<void> {
  try {
    await removeSlackReaction(context.botToken, context.channelId, context.messageTs, removeReaction);
    await addSlackReaction(context.botToken, context.channelId, context.messageTs, addReaction);
    logWithContext("SLACK_REACTIONS", "Updated reactions", {
      requestId,
      removed: removeReaction,
      added: addReaction,
    });
  } catch (error) {
    logWithContext("SLACK_REACTIONS", "Failed to update reactions", {
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * Set processing reaction (remove clarification, add hourglass)
 */
export async function setProcessingReaction(
  context: SlackContext,
  requestId: string
): Promise<void> {
  await updateSlackReaction(context, REACTION_CLARIFICATION, REACTION_PROCESSING, requestId);
}

/**
 * Set clarification reaction (remove hourglass, add speech balloon)
 */
export async function setClarificationReaction(
  context: SlackContext,
  requestId: string
): Promise<void> {
  await updateSlackReaction(context, REACTION_PROCESSING, REACTION_CLARIFICATION, requestId);
}

/**
 * Set success reaction (remove hourglass, add checkmark)
 */
export async function setSuccessReaction(
  context: SlackContext,
  requestId: string
): Promise<void> {
  await updateSlackReaction(context, REACTION_PROCESSING, REACTION_SUCCESS, requestId);
}

/**
 * Set error reaction (remove hourglass, add X)
 */
export async function setErrorReaction(
  context: SlackContext,
  requestId: string
): Promise<void> {
  await updateSlackReaction(context, REACTION_PROCESSING, REACTION_ERROR, requestId);
}

/**
 * Set retry reaction (remove error, add hourglass)
 */
export async function setRetryReaction(
  context: SlackContext,
  requestId: string
): Promise<void> {
  await updateSlackReaction(context, REACTION_ERROR, REACTION_PROCESSING, requestId);
}
