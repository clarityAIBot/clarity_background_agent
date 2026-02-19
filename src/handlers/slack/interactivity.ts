import { logWithContext } from "../../core/log";
import { getDb } from "../../db/client";
import { AppConfigRepository } from "../../db/repositories";
import { RequestService } from "../../services";
import { decrypt } from "../../core/crypto";
import { getClarityTaskUrl, getClarityLLMSetupUrl } from "../../core/constants";
import { createQueueProducer } from "../../queue/abstractions";
import {
  getSlackUserInfo,
  verifySlackRequestSignature,
  convertGithubToSlackMarkdown,
} from "../../integrations/slack";
import type { QueueMessage } from "../../queue/types";
import type { Env } from "../../core/types";

/**
 * Open a modal for creating a new feature request
 */
// Provider display names for the dropdown
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  groq: "Groq",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  together: "Together AI",
  fireworks: "Fireworks",
};

export async function openFeatureRequestModal(
  triggerId: string,
  botToken: string,
  repositories: Array<{ id?: number; name: string; full_name: string }>,
  channelId?: string,
  hasAnthropicKey?: boolean, // Whether Anthropic API key is configured (for Claude Code)
  configuredOpenCodeProvider?: string, // The LLM provider configured for OpenCode
  defaultRepository?: string // Default repository from system settings (format: owner/repo)
): Promise<boolean> {
  const repoOptions = repositories.map((repo) => ({
    text: { type: "plain_text" as const, text: repo.name },
    value: repo.name,
  }));

  // Find the default repo option if configured
  // defaultRepository format is "owner/repo", we need to match by repo name
  const defaultRepoName = defaultRepository?.split('/').pop();
  const defaultRepoOption = defaultRepoName
    ? repoOptions.find(opt => opt.value === defaultRepoName)
    : undefined;

  // Build agent type options based on configured API keys
  // Value format: "agentType:provider" (e.g., "claude-code:anthropic", "opencode:groq")
  const agentTypeOptions: Array<{ text: { type: "plain_text"; text: string }; value: string }> = [];

  // Add Claude Code option only if Anthropic API key is configured
  // Claude Code always uses Anthropic
  if (hasAnthropicKey) {
    agentTypeOptions.push({
      text: { type: "plain_text", text: "🤖 Claude Code (Anthropic)" },
      value: "claude-code:anthropic",
    });
  }

  // Add OpenCode option if any provider is configured (including Anthropic)
  // OpenCode can use Anthropic or any other provider
  if (configuredOpenCodeProvider) {
    // Non-Anthropic provider configured
    const providerName = PROVIDER_DISPLAY_NAMES[configuredOpenCodeProvider] || configuredOpenCodeProvider;
    agentTypeOptions.push({
      text: { type: "plain_text", text: `💻 OpenCode (${providerName})` },
      value: `opencode:${configuredOpenCodeProvider}`,
    });
  } else if (hasAnthropicKey) {
    // Only Anthropic configured - OpenCode can also use Anthropic
    agentTypeOptions.push({
      text: { type: "plain_text", text: "💻 OpenCode (Anthropic)" },
      value: "opencode:anthropic",
    });
  }

  // Check if no API keys are configured
  const noApiKeysConfigured = agentTypeOptions.length === 0;

  const modal = {
    type: "modal" as const,
    callback_id: "feature_request_modal",
    private_metadata: JSON.stringify({ channelId: channelId || "" }),
    title: { type: "plain_text" as const, text: "New Feature Request" },
    submit: { type: "plain_text" as const, text: "Submit" },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks: [
      // Show agent dropdown or warning based on API key configuration (at the top)
      ...(noApiKeysConfigured
        ? [
            {
              type: "section",
              block_id: "no_api_keys_warning",
              text: {
                type: "mrkdwn",
                text: `:warning: *No API keys configured*\nPlease configure at least one LLM provider API key in Settings before creating a feature request.\n\n<${getClarityLLMSetupUrl()}|Configure API Keys>`,
              },
            },
          ]
        : [
            {
              type: "input",
              block_id: "agent_type_block",
              label: { type: "plain_text", text: "AI Agent" },
              element: {
                type: "static_select",
                action_id: "agent_type_select",
                placeholder: { type: "plain_text", text: "Select an AI agent" },
                options: agentTypeOptions,
                initial_option: agentTypeOptions[0],
              },
            },
          ]),
      {
        type: "input",
        block_id: "type_block",
        label: { type: "plain_text", text: "Request Type" },
        element: {
          type: "static_select",
          action_id: "type_select",
          options: [
            { text: { type: "plain_text", text: "✨ New Feature" }, value: "feature" },
            { text: { type: "plain_text", text: "🐛 Bug Fix" }, value: "bug" },
            { text: { type: "plain_text", text: "🔧 Refactor" }, value: "refactor" },
            { text: { type: "plain_text", text: "📝 Documentation" }, value: "docs" },
            { text: { type: "plain_text", text: "❓ Ask Question" }, value: "question" },
          ],
          initial_option: { text: { type: "plain_text", text: "✨ New Feature" }, value: "feature" },
        },
      },
      {
        type: "input",
        block_id: "repo_block",
        label: { type: "plain_text", text: "Repository" },
        element: {
          type: "static_select",
          action_id: "repo_select",
          placeholder: { type: "plain_text", text: "Select a repository" },
          options: repoOptions.length > 0 ? repoOptions : [
            { text: { type: "plain_text", text: "No repos available" }, value: "none" }
          ],
          // Pre-select: default repo from settings > single repo > nothing
          ...(defaultRepoOption
            ? { initial_option: defaultRepoOption }
            : repoOptions.length === 1
              ? { initial_option: repoOptions[0] }
              : {}),
        },
      },
      {
        type: "input",
        block_id: "title_block",
        label: { type: "plain_text", text: "Feature Title" },
        element: {
          type: "plain_text_input",
          action_id: "title_input",
          placeholder: { type: "plain_text", text: "Brief title for the feature" },
          max_length: 100,
        },
      },
      {
        type: "input",
        block_id: "description_block",
        label: { type: "plain_text", text: "Description" },
        element: {
          type: "plain_text_input",
          action_id: "description_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "Describe the feature you want..." },
          max_length: 3000,
        },
      },
    ],
  };

  const response = await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trigger_id: triggerId,
      view: modal,
    }),
  });

  const result = (await response.json()) as { ok: boolean; error?: string };

  if (!result.ok) {
    logWithContext("SLACK_MODAL", "Failed to open modal", { error: result.error });
  }

  return result.ok;
}

/**
 * Send clarification questions with interactive buttons
 */
export async function sendClarificationWithButtons(
  channelId: string,
  botToken: string,
  questions: string,
  requestId: string,
  issueNumber: number,
  issueUrl: string,
  slackUserName: string,
  threadTs?: string // Optional thread_ts to reply in existing thread
): Promise<{ ok: boolean; ts?: string }> {
  // Convert GitHub markdown to Slack format and truncate if needed
  const slackFormattedQuestions = convertGithubToSlackMarkdown(questions);
  const truncatedQuestions =
    slackFormattedQuestions.length > 2500
      ? slackFormattedQuestions.substring(0, 2500) + "\n\n_...see GitHub issue for full details_"
      : slackFormattedQuestions;

  const clarityTaskUrl = getClarityTaskUrl(requestId);

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      thread_ts: threadTs, // Reply in thread if provided
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Clarity AI needs clarification", emoji: true },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Before implementing your feature request, I have a few questions:`,
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: truncatedQuestions },
        },
        { type: "divider" },
        {
          type: "section",
          text: { type: "mrkdwn", text: "*How would you like to respond?*" },
        },
        {
          type: "actions",
          block_id: `clarification_actions_${requestId}`,
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Answer in Form", emoji: true },
              style: "primary",
              action_id: "open_clarification_form",
              value: JSON.stringify({ requestId, issueNumber }),
            },
            {
              type: "button",
              text: { type: "plain_text", text: "View in Clarity", emoji: true },
              url: clarityTaskUrl,
              action_id: "view_clarity_link",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Go to GitHub Issue", emoji: true },
              url: issueUrl,
              action_id: "go_to_github",
            },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `_Requested by @${slackUserName} • Tracking ID: \`${requestId}\` • Issue #${issueNumber}_`,
            },
          ],
        },
      ],
      text: `Clarity AI needs clarification for your feature request.`,
    }),
  });

  return (await response.json()) as { ok: boolean; ts?: string; error?: string };
}

/**
 * Post a confirmation message when a feature request is submitted
 * This creates a thread where all updates will be posted
 */
export async function postConfirmationMessage(
  channelId: string,
  botToken: string,
  requestId: string,
  issueNumber: number,
  issueUrl: string,
  title: string,
  description: string,
  repo: string,
  username: string,
  threadTs?: string, // Optional: reply to existing thread instead of creating new one
  isFromMention?: boolean // If true, skip title since it's auto-generated from description
): Promise<{ ok: boolean; ts?: string }> {
  // Truncate description if too long for Slack block (3000 chars limit)
  const truncatedDescription = description.length > 2000
    ? description.substring(0, 2000) + "\n\n_...description truncated, see Clarity dashboard for full details_"
    : description;

  const clarityTaskUrl = getClarityTaskUrl(requestId);

  // For @clarity mentions, title is auto-generated from description - don't show duplicate
  // For /clarity command, title is user-provided - show it
  const messageText = isFromMention
    ? `${truncatedDescription}\n\nClarity AI is now analyzing your request and will start working on it shortly.`
    : `*${title}*\n\n${truncatedDescription}\n\nClarity AI is now analyzing your request and will start working on it shortly.`;

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      thread_ts: threadTs, // Reply to thread if provided
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Task Submitted", emoji: true },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: messageText,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Repository:*\n\`${repo}\`` },
            { type: "mrkdwn", text: `*Issue:*\n<${issueUrl}|#${issueNumber}>` },
          ],
        },
        {
          type: "actions",
          block_id: `confirmation_actions_${requestId}`,
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "View in Clarity", emoji: true },
              url: clarityTaskUrl,
              action_id: "view_clarity_link",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "View GitHub Issue", emoji: true },
              url: issueUrl,
              action_id: "view_issue_link",
            },
          ],
        },
        { type: "divider" },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `_Requested by @${username} • Tracking ID: \`${requestId}\` • Updates will appear in this thread_`,
            },
          ],
        },
      ],
      text: `Feature request "${title}" submitted. Clarity AI is working on it.`,
    }),
  });

  const result = (await response.json()) as { ok: boolean; ts?: string; error?: string };

  if (!result.ok) {
    logWithContext("SLACK_INTERACTIVITY", "Failed to post confirmation message", {
      error: result.error,
      channelId,
    });
  }

  return result;
}

/**
 * Open a modal for answering clarification questions
 */
export async function openClarificationModal(
  triggerId: string,
  botToken: string,
  requestId: string,
  issueNumber: number,
  questions: string
): Promise<boolean> {
  const modal = {
    type: "modal" as const,
    callback_id: "clarification_response_modal",
    private_metadata: JSON.stringify({ requestId, issueNumber }),
    title: { type: "plain_text" as const, text: "Answer Questions" },
    submit: { type: "plain_text" as const, text: "Submit Answers" },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Questions from Clarity AI:*\n\n${questions.substring(0, 2500)}`,
        },
      },
      { type: "divider" },
      {
        type: "input",
        block_id: "answers_block",
        label: { type: "plain_text", text: "Your Answers" },
        element: {
          type: "plain_text_input",
          action_id: "answers_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Provide your answers to the questions above...",
          },
          max_length: 3000,
        },
      },
      {
        type: "input",
        block_id: "additional_context_block",
        label: { type: "plain_text", text: "Additional Context (Optional)" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "context_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Any other details that might help...",
          },
          max_length: 1000,
        },
      },
    ],
  };

  const response = await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trigger_id: triggerId,
      view: modal,
    }),
  });

  const result = (await response.json()) as { ok: boolean; error?: string };
  return result.ok;
}

/**
 * Handle Slack interactivity (button clicks, modal submissions)
 */
export async function handleSlackInteractivity(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await request.text();

  const db = getDb(env);
  const configRepo = new AppConfigRepository(db);
  const requestService = new RequestService(db);

  // Get signing secret
  let signingSecret = env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    try {
      const slackConfig = await configRepo.getSlackConfig();
      if (slackConfig?.signingSecretEncrypted) {
        signingSecret = await decrypt(slackConfig.signingSecretEncrypted, env.ENCRYPTION_KEY!);
      }
    } catch (error) {
      logWithContext("SLACK_INTERACTIVITY", "Failed to get signing secret", {
        error: error instanceof Error ? error.message : String(error),
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

  // Parse the payload
  const params = new URLSearchParams(body);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return new Response("Missing payload", { status: 400 });
  }

  const payload = JSON.parse(payloadStr);

  logWithContext("SLACK_INTERACTIVITY", "Received interactivity", {
    type: payload.type,
    callbackId: payload.view?.callback_id || payload.callback_id,
    actionId: payload.actions?.[0]?.action_id,
  });

  // Get bot token from PostgreSQL
  const slackConfig = await configRepo.getSlackConfig();

  if (!slackConfig?.botTokenEncrypted) {
    logWithContext("SLACK_INTERACTIVITY", "No bot token available");
    return new Response("Configuration error", { status: 500 });
  }

  const botToken = await decrypt(slackConfig.botTokenEncrypted, env.ENCRYPTION_KEY!);

  // Handle different interaction types
  switch (payload.type) {
    case "view_submission":
      return handleViewSubmission(payload, env, botToken, requestService);

    case "block_actions":
      return handleBlockActions(payload, env, botToken, requestService);

    default:
      logWithContext("SLACK_INTERACTIVITY", "Unknown interaction type", { type: payload.type });
      return new Response("OK", { status: 200 });
  }
}

/**
 * Handle modal form submissions
 * IMPORTANT: Slack has a 3-second timeout for view_submission responses.
 * We validate input and queue heavy work to avoid timeouts.
 */
async function handleViewSubmission(
  payload: any,
  env: Env,
  botToken: string,
  requestService: RequestService
): Promise<Response> {
  const callbackId = payload.view.callback_id;
  const values = payload.view.state.values;
  const user = payload.user;

  logWithContext("SLACK_INTERACTIVITY", "Processing view submission", { callbackId });

  if (callbackId === "feature_request_modal") {
    // Extract form values
    const repo = values.repo_block?.repo_select?.selected_option?.value;
    const title = values.title_block?.title_input?.value;
    const description = values.description_block?.description_input?.value;
    const requestType = values.type_block?.type_select?.selected_option?.value || "feature";

    // Parse agent selection - format is "agentType:provider" (e.g., "claude-code:anthropic", "opencode:groq")
    const agentSelection = values.agent_type_block?.agent_type_select?.selected_option?.value || "claude-code:anthropic";
    const [agentType, agentProvider] = agentSelection.split(":");

    // Extract channel ID from private_metadata
    let channelId: string | undefined;
    try {
      const metadata = JSON.parse(payload.view.private_metadata || "{}");
      channelId = metadata.channelId;
    } catch {
      logWithContext("SLACK_INTERACTIVITY", "Failed to parse private_metadata");
    }

    // Validate required fields - return error immediately if invalid
    if (!repo || repo === "none" || !title || !description) {
      return new Response(
        JSON.stringify({
          response_action: "errors",
          errors: {
            repo_block: !repo || repo === "none" ? "Please select a repository" : undefined,
            title_block: !title ? "Please enter a title" : undefined,
            description_block: !description ? "Please enter a description" : undefined,
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Generate request ID
    const requestId = `fr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Resolve user display name from Slack API
    const userInfo = await getSlackUserInfo(user.id, botToken);

    // Queue the feature request creation for async processing
    // This avoids the 3-second Slack timeout by deferring heavy work to the queue
    const queueProducer = createQueueProducer<QueueMessage>({ cloudflareQueue: env.ISSUE_QUEUE });
    await queueProducer.send({
      type: "slack_feature_request",
      requestId,
      repo,
      title,
      description,
      requestType,
      agentType,
      agentProvider,
      channelId,
      slackUserId: user.id,
      slackUserName: userInfo.displayName,
      botToken, // Pass bot token for Slack API calls
    });

    logWithContext("SLACK_INTERACTIVITY", "Feature request queued for async processing", {
      requestId,
      repo,
      channelId,
      agentType,
      agentProvider,
    });

    // Return immediately to acknowledge modal - Slack will close it
    return new Response(JSON.stringify({ response_action: "clear" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (callbackId === "clarification_response_modal") {
    // Handle clarification response submission
    // IMPORTANT: Slack has a 3-second timeout for view_submission responses.
    // We validate input and queue everything for async processing in the consumer.
    const metadata = JSON.parse(payload.view.private_metadata || "{}");
    const { requestId, issueNumber } = metadata;
    const answers = values.answers_block?.answers_input?.value;
    const additionalContext = values.additional_context_block?.context_input?.value;

    if (!answers) {
      return new Response(
        JSON.stringify({
          response_action: "errors",
          errors: { answers_block: "Please provide your answers" },
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const fullResponse = additionalContext
      ? `${answers}\n\n**Additional Context:**\n${additionalContext}`
      : answers;

    // Queue for async processing - consumer handles DB lookup, status update, and re-processing
    const queueProducer = createQueueProducer<QueueMessage>({ cloudflareQueue: env.ISSUE_QUEUE });
    await queueProducer.send({
      type: "slack_clarification_answer",
      requestId,
      issueNumber,
      answers: fullResponse,
      slackUserId: user.id,
    });

    logWithContext("SLACK_INTERACTIVITY", "Clarification answer queued for async processing", {
      requestId,
      issueNumber,
    });

    return new Response(JSON.stringify({ response_action: "clear" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (callbackId === "suggest_changes_modal") {
    // Handle suggest changes submission
    const metadata = JSON.parse(payload.view.private_metadata || "{}");
    const { requestId } = metadata;
    const suggestedChanges = values.changes_block?.changes_input?.value;

    if (!suggestedChanges) {
      return new Response(
        JSON.stringify({
          response_action: "errors",
          errors: { changes_block: "Please describe the changes you'd like" },
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Queue for async processing - consumer handles DB lookup, follow-up logging, and re-queuing
    const queueProducer = createQueueProducer<QueueMessage>({ cloudflareQueue: env.ISSUE_QUEUE });
    await queueProducer.send({
      type: "slack_suggest_changes",
      requestId,
      suggestedChanges,
      slackUserId: user.id,
    });

    logWithContext("SLACK_INTERACTIVITY", "Suggest changes queued for async processing", {
      requestId,
      changesLength: suggestedChanges.length,
    });

    return new Response(JSON.stringify({ response_action: "clear" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ response_action: "clear" }), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handle button clicks and other block actions
 */
async function handleBlockActions(
  payload: any,
  env: Env,
  botToken: string,
  requestService: RequestService
): Promise<Response> {
  const action = payload.actions[0];
  const actionId = action.action_id;
  const triggerId = payload.trigger_id;

  logWithContext("SLACK_INTERACTIVITY", "Processing block action", { actionId });

  if (actionId === "open_clarification_form") {
    // Open the clarification response modal
    const { requestId, issueNumber } = JSON.parse(action.value);

    // For clarifying questions, we use a default message
    // (clarifyingQuestions field not in schema, would need to be stored in request_messages)
    const questions = "Please provide additional details about your request.";

    await openClarificationModal(triggerId, botToken, requestId, issueNumber, questions);

    return new Response("", { status: 200 });
  }

  if (actionId === "retry_failed_request") {
    // Handle retry button click
    // IMPORTANT: Slack has a 3-second timeout for block_actions responses.
    // Queue the retry work asynchronously to avoid timeout.
    const { requestId, issueNumber } = JSON.parse(action.value);
    const user = payload.user;
    const channelId = payload.channel?.id;
    const threadTs = payload.message?.thread_ts;

    logWithContext("SLACK_INTERACTIVITY", "Retry button clicked", {
      requestId,
      issueNumber,
    });

    // Queue the retry operation asynchronously
    const queueProducer = createQueueProducer<QueueMessage>({ cloudflareQueue: env.ISSUE_QUEUE });
    await queueProducer.send({
      type: "slack_retry_request",
      requestId,
      issueNumber,
      userId: user?.id || "unknown",
      userName: user?.username || "unknown",
      channelId,
      threadTs,
      botToken,
    });

    logWithContext("SLACK_INTERACTIVITY", "Retry request queued for async processing", {
      requestId,
      issueNumber,
    });

    return new Response("", { status: 200 });
  }

  if (actionId === "suggest_more_changes") {
    // Handle "Suggest More Changes" button click - open a modal
    // IMPORTANT: Slack has a 3-second timeout for block_actions responses.
    // We open the modal immediately without DB lookup to avoid timeout.
    // All details will be fetched from DB when the modal is submitted.
    const requestId = action.value;

    logWithContext("SLACK_INTERACTIVITY", "Suggest more changes button clicked", {
      requestId,
    });

    // Open a modal for the user to describe additional changes
    // Only requestId is stored in metadata - other details fetched on submission
    const modal = {
      type: "modal" as const,
      callback_id: "suggest_changes_modal",
      private_metadata: JSON.stringify({ requestId }),
      title: { type: "plain_text" as const, text: "Suggest Changes" },
      submit: { type: "plain_text" as const, text: "Submit" },
      close: { type: "plain_text" as const, text: "Cancel" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Describe the additional changes you'd like me to make. I'll update the PR with your suggestions.",
          },
        },
        { type: "divider" },
        {
          type: "input",
          block_id: "changes_block",
          label: { type: "plain_text", text: "Requested Changes" },
          element: {
            type: "plain_text_input",
            action_id: "changes_input",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "Describe what changes you'd like to make to the PR...",
            },
            max_length: 3000,
          },
        },
      ],
    };

    const response = await fetch("https://slack.com/api/views.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        trigger_id: triggerId,
        view: modal,
      }),
    });

    const result = (await response.json()) as { ok: boolean; error?: string };

    if (!result.ok) {
      logWithContext("SLACK_INTERACTIVITY", "Failed to open suggest changes modal", {
        error: result.error,
      });
    }

    return new Response("", { status: 200 });
  }

  return new Response("", { status: 200 });
}
