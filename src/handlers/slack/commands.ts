import { logWithContext } from "../../core/log";
import { openFeatureRequestModal, sendClarificationWithButtons } from "./interactivity";
import { getDb } from "../../db/client";
import { AppConfigRepository } from "../../db/repositories";
import { RequestService } from "../../services";
import { decrypt } from "../../core/crypto";
import { getClarityTaskUrl } from "../../core/constants";
import { verifySlackRequestSignature, convertGithubToSlackMarkdown, truncateForSlack } from "../../integrations/slack";
import type { Env } from "../../core/types";
import {
  getErrorMessage,
  detectLLMProviders,
  formatDuration,
  formatCostUsd,
} from "../../utils";

/**
 * Add a reaction emoji to a Slack message
 * Used for status indicators: ⏳ (processing), ✅ (success), ❌ (error)
 */
export async function addSlackReaction(
  botToken: string,
  channelId: string,
  timestamp: string,
  emoji: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        timestamp,
        name: emoji,
      }),
    });

    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
    };

    if (!result.ok && result.error !== "already_reacted") {
      logWithContext("SLACK", "Failed to add reaction", {
        error: result.error,
        channelId,
        emoji,
      });
    }

    return result;
  } catch (error) {
    logWithContext("SLACK", "Error adding reaction", {
      error: getErrorMessage(error),
      channelId,
      emoji,
    });
    return { ok: false, error: getErrorMessage(error) };
  }
}

/**
 * Remove a reaction emoji from a Slack message
 */
export async function removeSlackReaction(
  botToken: string,
  channelId: string,
  timestamp: string,
  emoji: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("https://slack.com/api/reactions.remove", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        timestamp,
        name: emoji,
      }),
    });

    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
    };

    if (!result.ok && result.error !== "no_reaction") {
      logWithContext("SLACK", "Failed to remove reaction", {
        error: result.error,
        channelId,
        emoji,
      });
    }

    return result;
  } catch (error) {
    logWithContext("SLACK", "Error removing reaction", {
      error: getErrorMessage(error),
      channelId,
      emoji,
    });
    return { ok: false, error: getErrorMessage(error) };
  }
}

/**
 * Post a simple text message to a Slack channel/thread
 * Used for acknowledgments and status updates
 */
export async function postSlackMessage(
  botToken: string,
  channelId: string,
  text: string,
  threadTs?: string
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: threadTs || undefined,
        text,
      }),
    });

    const result = (await response.json()) as {
      ok: boolean;
      ts?: string;
      error?: string;
    };

    if (!result.ok) {
      logWithContext("SLACK", "Failed to post message", {
        error: result.error,
        channelId,
      });
    }

    return result;
  } catch (error) {
    logWithContext("SLACK", "Error posting message", {
      error: getErrorMessage(error),
      channelId,
    });
    return { ok: false, error: getErrorMessage(error) };
  }
}

interface SlackCommand {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}

/**
 * Parse Slack slash command from URL-encoded form data
 */
function parseSlackCommand(body: string): SlackCommand {
  const params = new URLSearchParams(body);
  return {
    token: params.get("token") || "",
    team_id: params.get("team_id") || "",
    team_domain: params.get("team_domain") || "",
    channel_id: params.get("channel_id") || "",
    channel_name: params.get("channel_name") || "",
    user_id: params.get("user_id") || "",
    user_name: params.get("user_name") || "",
    command: params.get("command") || "",
    text: params.get("text") || "",
    response_url: params.get("response_url") || "",
    trigger_id: params.get("trigger_id") || "",
  };
}


/**
 * Handle Slack slash command: /claude-feature [repo] [description]
 * IMPORTANT: Slack has a 3-second timeout for slash commands.
 * We must respond quickly to avoid operation_timeout errors.
 */
export async function handleSlackCommand(
  request: Request,
  env: Env
): Promise<Response> {
  logWithContext("SLACK", "Handling slash command", {
    method: request.method,
  });

  const db = getDb(env);
  const configRepo = new AppConfigRepository(db);

  // Fetch all configs in parallel to avoid timeout (Slack has 3s limit)
  const [slackConfig, githubConfig, llmConfig, systemDefaultsConfig] = await Promise.all([
    configRepo.getSlackConfig(),
    configRepo.getGitHubConfig(),
    configRepo.getLLMConfig(),
    configRepo.getSystemDefaultsConfig(),
  ]);

  // Read body first (needed for both signature verification and parsing)
  const body = await request.text();

  // Get signing secret - first try env, then try stored config
  let signingSecret = env.SLACK_SIGNING_SECRET;

  if (!signingSecret && slackConfig?.signingSecretEncrypted) {
    try {
      signingSecret = await decrypt(slackConfig.signingSecretEncrypted, env.ENCRYPTION_KEY!);
      logWithContext("SLACK", "Using stored Slack signing secret");
    } catch (error) {
      logWithContext("SLACK", "Failed to decrypt Slack signing secret", {
        error: getErrorMessage(error)
      });
    }
  }

  // Verify Slack signature if signing secret is available
  if (signingSecret) {
    const isValid = await verifySlackRequestSignature(body, request, signingSecret);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid request signature" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } else {
    logWithContext("SLACK", "No Slack signing secret configured - skipping signature verification");
  }

  // Parse the command
  const command = parseSlackCommand(body);

  logWithContext("SLACK", "Parsed command", {
    command: command.command,
    text: command.text,
    user: command.user_name,
    channel: command.channel_name,
  });

  // Check bot token (already fetched above)
  if (!slackConfig?.botTokenEncrypted) {
    return new Response(
      JSON.stringify({
        response_type: "ephemeral",
        text: "Slack integration not fully configured. Please run /slack-setup first.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const botToken = await decrypt(slackConfig.botTokenEncrypted, env.ENCRYPTION_KEY!);

  // Get available repositories (already fetched above)
  const availableRepos = githubConfig?.repositories || [];

  logWithContext("SLACK", "Available repositories", {
    count: availableRepos.length,
    repos: availableRepos.map((r) => r.name),
  });

  if (availableRepos.length === 0) {
    return new Response(
      JSON.stringify({
        response_type: "ephemeral",
        text: "No repositories are configured. Please ensure the GitHub App is installed on at least one repository.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Determine configured LLM providers
  const llmProviders = detectLLMProviders(llmConfig);
  const { hasAnthropicKey, configuredOpenCodeProvider } = llmProviders;

  logWithContext("SLACK", "LLM config check", {
    hasLLMConfig: !!llmConfig,
    hasAnthropicKey,
    configuredOpenCodeProvider,
  });

  // Open interactive modal for feature request
  logWithContext("SLACK", "Opening feature request modal", {
    triggerId: command.trigger_id,
    repoCount: availableRepos.length,
    channelId: command.channel_id,
    hasAnthropicKey,
    configuredOpenCodeProvider,
  });

  const modalOpened = await openFeatureRequestModal(
    command.trigger_id,
    botToken,
    availableRepos.map(r => ({ id: r.id, name: r.name, full_name: r.fullName })),
    command.channel_id,
    hasAnthropicKey,
    configuredOpenCodeProvider,
    systemDefaultsConfig?.defaultRepository
  );

  if (!modalOpened) {
    return new Response(
      JSON.stringify({
        response_type: "ephemeral",
        text: "Failed to open the feature request form. Please try again.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Return empty response - modal handles the rest
  return new Response("", { status: 200 });
}

/**
 * Handle notification when clarification is needed
 * This notifies Slack when Clarity AI needs more information before implementing
 * Uses interactive buttons for user response
 */
export async function handleSlackClarificationNotification(
  env: Env,
  issueNumber: number,
  _repositoryName: string,
  clarifyingQuestions: string,
  requestId: string
): Promise<void> {
  try {
    const db = getDb(env);
    const requestService = new RequestService(db);
    const configRepo = new AppConfigRepository(db);

    // Get the feature request state from PostgreSQL
    const request = await requestService.requests.findByRequestId(requestId);

    if (!request) {
      logWithContext("SLACK", "Feature request not found for clarification", {
        requestId,
      });
      return;
    }

    logWithContext("SLACK", "Retrieved state for clarification", {
      requestId,
      hasSlackChannelId: !!request.slackChannelId,
      hasSlackThreadTs: !!request.slackThreadTs,
      slackThreadTs: request.slackThreadTs,
    });

    if (!request.slackChannelId) {
      logWithContext("SLACK", "No Slack channel ID found, skipping notification", {
        requestId,
      });
      return;
    }

    // Get bot token from config
    const slackConfig = await configRepo.getSlackConfig();

    if (!slackConfig?.botTokenEncrypted) {
      logWithContext("SLACK", "No bot token found, cannot send clarification", {
        requestId,
      });
      return;
    }

    const botToken = await decrypt(slackConfig.botTokenEncrypted, env.ENCRYPTION_KEY!);

    logWithContext("SLACK", "Sending clarification with interactive buttons", {
      requestId,
      issueNumber,
      channelId: request.slackChannelId,
      threadTs: request.slackThreadTs,
    });

    // Send clarification with interactive buttons (in the original thread if available)
    const result = await sendClarificationWithButtons(
      request.slackChannelId,
      botToken,
      clarifyingQuestions,
      requestId,
      issueNumber,
      request.issueUrl || `https://github.com/issues/${issueNumber}`,
      request.slackUserName || "unknown",
      request.slackThreadTs || undefined
    );

    if (result.ok && result.ts) {
      logWithContext("SLACK", "Clarification message posted, storing thread mapping", {
        requestId,
        messageTs: result.ts,
      });

      // Update the feature request with the thread info
      await requestService.updateSlackThreadTs(requestId, result.ts);

      logWithContext("SLACK", "Clarification notification sent with buttons", {
        requestId,
        issueNumber,
        threadTs: result.ts,
      });
    } else {
      logWithContext("SLACK", "Failed to post clarification message", {
        requestId,
      });
    }
  } catch (error) {
    logWithContext("SLACK", "Error sending clarification notification", {
      error: getErrorMessage(error),
      requestId,
    });
  }
}

/**
 * Handle GitHub webhook notifications for PR creation
 * This notifies Slack when a PR is created for a tracked feature request
 */
export async function handleSlackPRNotification(
  env: Env,
  prUrl: string,
  prNumber: number,
  requestId: string,
  costUsd?: number,
  durationMs?: number,
  isFollowUp?: boolean,
  summary?: string
): Promise<void> {
  try {
    const db = getDb(env);
    const requestService = new RequestService(db);
    const configRepo = new AppConfigRepository(db);

    // Get the feature request state from PostgreSQL
    const request = await requestService.requests.findByRequestId(requestId);

    if (!request) {
      logWithContext("SLACK", "Feature request not found for PR notification", {
        requestId,
      });
      return;
    }

    if (!request.slackChannelId) {
      logWithContext("SLACK", "No Slack channel ID found, skipping PR notification", {
        requestId,
      });
      return;
    }

    // Get bot token from config
    const slackConfig = await configRepo.getSlackConfig();

    if (!slackConfig?.botTokenEncrypted) {
      logWithContext("SLACK", "No bot token found, cannot send PR notification", {
        requestId,
      });
      return;
    }

    const botToken = await decrypt(slackConfig.botTokenEncrypted, env.ENCRYPTION_KEY!);

    logWithContext("SLACK", "Sending PR notification to Slack", {
      requestId,
      prNumber,
      channelId: request.slackChannelId,
      threadTs: request.slackThreadTs,
      issueNumber: request.issueNumber,
      isFollowUp,
    });

    // Different message for follow-up vs new PR
    const headerText = isFollowUp
      ? `:white_check_mark: *Pull Request Updated!*\n\nI've pushed the additional changes you requested to the existing PR.`
      : `:tada: *Pull Request Created!*\n\nI've finished working on your request and created a PR for review.`;

    const clarityTaskUrl = getClarityTaskUrl(requestId);

    // Parse summary to extract key sections (Type and Slack Summary / Summary from doc/ai-task/issue-<N>.md)
    const parseSummary = (rawSummary?: string): { type?: string; description?: string; wasTruncated?: boolean } => {
      if (!rawSummary) return {};

      // Extract Type (e.g., "Bug Fix", "Feature", etc.)
      const typeMatch = rawSummary.match(/##\s*Type\s*\n+([^\n#]+)/i);
      const type = typeMatch?.[1]?.trim();

      // Prefer ## Slack Summary (concise, written for Slack) over ## Summary
      const slackSummaryMatch = rawSummary.match(/##\s*Slack Summary\s*\n+([\s\S]*?)(?=\n##|\n---|\n\n\n|$)/i);
      const summaryMatch = rawSummary.match(/##\s*Summary\s*\n+([\s\S]*?)(?=\n##|\n---|\n\n\n|$)/i);

      let description = slackSummaryMatch?.[1]?.trim() || summaryMatch?.[1]?.trim();
      let wasTruncated = false;

      if (description) {
        // Convert GitHub markdown to Slack mrkdwn format
        description = convertGithubToSlackMarkdown(description);

        // Truncate if too long (Slack section block limit is 3000, use 2000 for safety)
        if (description.length > 2000) {
          description = truncateForSlack(description, 2000, "...");
          wasTruncated = true;
        }
      }

      return { type, description, wasTruncated };
    };

    const parsedSummary = parseSummary(summary);

    // Build summary text if available, add deeplink if truncated
    let summaryText: string | null = null;
    if (parsedSummary.description) {
      summaryText = parsedSummary.type
        ? `*${parsedSummary.type}:* ${parsedSummary.description}`
        : parsedSummary.description;

      // Add link to full summary if truncated
      if (parsedSummary.wasTruncated) {
        summaryText += ` <${clarityTaskUrl}|See full summary>`;
      }
    }

    const blocks = [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: headerText,
        },
      },
      {
        type: "section" as const,
        fields: [
          { type: "mrkdwn" as const, text: `*PR:*\n<${prUrl}|#${prNumber}>` },
          { type: "mrkdwn" as const, text: `*Repository:*\n<https://github.com/${request.repo}|${request.repo}>` },
        ],
      },
      // Conditionally include summary section
      ...(summaryText
        ? [
            {
              type: "section" as const,
              text: {
                type: "mrkdwn" as const,
                text: summaryText,
              },
            },
          ]
        : []),
      {
        type: "actions" as const,
        block_id: `pr_actions_${requestId}`,
        elements: [
          {
            type: "button" as const,
            text: { type: "plain_text" as const, text: "View Pull Request", emoji: true },
            url: prUrl,
            action_id: "view_pr_link",
          },
          {
            type: "button" as const,
            text: { type: "plain_text" as const, text: "View in Clarity", emoji: true },
            url: clarityTaskUrl,
            action_id: "view_clarity_link",
          },
          {
            type: "button" as const,
            text: { type: "plain_text" as const, text: "Suggest More Changes", emoji: true },
            style: "primary" as const,
            action_id: "suggest_more_changes",
            value: requestId,
          },
        ],
      },
      {
        type: "context" as const,
        elements: [
          {
            type: "mrkdwn" as const,
            text: `_Requested by @${request.slackUserName || "unknown"} | ${formatDuration(durationMs)} | ${formatCostUsd(costUsd)}_`,
          },
        ],
      },
    ];

    logWithContext("SLACK", "PR notification button value", {
      requestId,
      prNumber,
      issueNumber: request.issueNumber,
      blocksCount: blocks.length,
    });

    // Post to the thread if we have one, otherwise to the channel
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: request.slackChannelId,
        thread_ts: request.slackThreadTs, // Post in thread if available
        blocks,
        text: `PR #${prNumber} created: ${prUrl}`,
      }),
    });

    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
      response_metadata?: { messages?: string[] };
    };

    if (result.ok) {
      logWithContext("SLACK", "PR notification sent to Slack successfully", {
        requestId,
        prNumber,
        channelId: request.slackChannelId,
        threadTs: request.slackThreadTs,
        hasIssueNumber: !!request.issueNumber,
      });

      // Log any warnings from Slack (blocks might be silently dropped)
      if (result.response_metadata?.messages) {
        logWithContext("SLACK", "Slack API warnings", {
          warnings: result.response_metadata.messages,
          requestId,
        });
      }
    } else {
      logWithContext("SLACK", "Failed to send PR notification to Slack", {
        requestId,
        error: result.error,
        responseMetadata: result.response_metadata,
      });
    }

    // Update request status in PostgreSQL
    await requestService.requests.updatePRDetails(requestId, prUrl, prNumber, "");
  } catch (error) {
    logWithContext("SLACK", "Error sending PR notification", {
      error: getErrorMessage(error),
      requestId,
    });
  }
}

/**
 * Handle error notification to Slack
 * Notifies the user when processing fails
 */
export async function handleSlackErrorNotification(
  env: Env,
  requestId: string,
  errorMessage: string,
  issueNumber?: number
): Promise<void> {
  try {
    const db = getDb(env);
    const requestService = new RequestService(db);
    const configRepo = new AppConfigRepository(db);

    // Get the feature request state from PostgreSQL
    const request = await requestService.requests.findByRequestId(requestId);

    if (!request) {
      logWithContext("SLACK", "Feature request not found for error notification", {
        requestId,
      });
      return;
    }

    if (!request.slackChannelId) {
      logWithContext("SLACK", "No Slack channel ID found, skipping error notification", {
        requestId,
      });
      return;
    }

    // Get bot token from config
    const slackConfig = await configRepo.getSlackConfig();

    if (!slackConfig?.botTokenEncrypted) {
      logWithContext("SLACK", "No bot token found, cannot send error notification", {
        requestId,
      });
      return;
    }

    const botToken = await decrypt(slackConfig.botTokenEncrypted, env.ENCRYPTION_KEY!);

    // Truncate error message if too long
    const truncatedError = errorMessage.length > 500
      ? errorMessage.substring(0, 500) + "..."
      : errorMessage;

    const clarityTaskUrl = getClarityTaskUrl(requestId);

    const actionElements: any[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "Retry", emoji: true },
        style: "primary",
        action_id: "retry_failed_request",
        value: JSON.stringify({ requestId, issueNumber }),
      },
      {
        type: "button",
        text: { type: "plain_text", text: "View in Clarity", emoji: true },
        url: clarityTaskUrl,
        action_id: "view_clarity_link",
      },
    ];

    // Add view issue button if we have the URL
    if (request.issueUrl) {
      actionElements.push({
        type: "button",
        text: { type: "plain_text", text: "View Issue", emoji: true },
        url: request.issueUrl,
        action_id: "view_issue_link",
      });
    }

    const blocks: any[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:x: *Processing Failed*\n\nI encountered an error while working on your request.`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Error:*\n\`\`\`${truncatedError}\`\`\``,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Tracking ID: \`${requestId}\`${issueNumber ? ` | Issue #${issueNumber}` : ""}${request.repo ? ` | ${request.repo}` : ""}`,
          },
        ],
      },
      {
        type: "actions",
        block_id: `error_actions_${requestId}`,
        elements: actionElements,
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "_Click Retry to attempt processing again, or contact support if the issue persists._",
          },
        ],
      },
    ];

    // Post to the thread if we have one, otherwise to the channel
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: request.slackChannelId,
        thread_ts: request.slackThreadTs, // Post in thread if available
        blocks,
        text: `Processing failed: ${truncatedError}`,
      }),
    });

    const result = (await response.json()) as { ok: boolean; error?: string };

    if (result.ok) {
      logWithContext("SLACK", "Error notification sent to Slack", {
        requestId,
        channelId: request.slackChannelId,
        threadTs: request.slackThreadTs,
      });
    } else {
      logWithContext("SLACK", "Failed to send error notification to Slack", {
        requestId,
        error: result.error,
      });
    }
  } catch (error) {
    logWithContext("SLACK", "Exception sending error notification", {
      error: getErrorMessage(error),
      requestId,
    });
  }
}

/**
 * Handle notification when analysis is complete without a PR
 * This notifies Slack with the summary when Clarity AI analyzed the request
 */
export async function handleSlackNoCodeChangesNotification(
  env: Env,
  requestId: string,
  solution: string,
  issueNumber?: number,
  costUsd?: number,
  durationMs?: number
): Promise<void> {
  try {
    const db = getDb(env);
    const requestService = new RequestService(db);
    const configRepo = new AppConfigRepository(db);

    // Get the feature request state from PostgreSQL
    const request = await requestService.requests.findByRequestId(requestId);

    if (!request) {
      logWithContext("SLACK", "Feature request not found for analysis notification", {
        requestId,
      });
      return;
    }

    if (!request.slackChannelId) {
      logWithContext("SLACK", "No Slack channel ID found, skipping analysis notification", {
        requestId,
      });
      return;
    }

    // Get bot token from config
    const slackConfig = await configRepo.getSlackConfig();

    if (!slackConfig?.botTokenEncrypted) {
      logWithContext("SLACK", "No bot token found, cannot send analysis notification", {
        requestId,
      });
      return;
    }

    const botToken = await decrypt(slackConfig.botTokenEncrypted, env.ENCRYPTION_KEY!);

    logWithContext("SLACK", "Sending analysis notification to Slack", {
      requestId,
      channelId: request.slackChannelId,
      threadTs: request.slackThreadTs,
      issueNumber,
    });

    const clarityTaskUrl = getClarityTaskUrl(requestId);

    // Format and truncate solution for Slack
    const formattedSolution = solution ? convertGithubToSlackMarkdown(solution) : solution;
    const wasTruncated = formattedSolution && formattedSolution.length > 2000;
    const truncatedSolution = formattedSolution
      ? truncateForSlack(formattedSolution, 2000, "...")
      : formattedSolution;

    const blocks: any[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: *Analysis Complete*\n\nI've finished analyzing your request.`,
        },
      },
    ];

    // Add solution/summary with deeplink if truncated
    if (truncatedSolution) {
      const summaryText = wasTruncated
        ? `*Summary:*\n${truncatedSolution} <${clarityTaskUrl}|See full summary>`
        : `*Summary:*\n${truncatedSolution}`;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: summaryText,
        },
      });
    }

    const actionElements: any[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "View in Clarity", emoji: true },
        url: clarityTaskUrl,
        action_id: "view_clarity_link",
      },
    ];

    // Add view issue button if we have the URL
    if (request.issueUrl) {
      actionElements.push({
        type: "button",
        text: { type: "plain_text", text: "View Issue", emoji: true },
        url: request.issueUrl,
        action_id: "view_issue_link",
      });
    }

    blocks.push({
      type: "actions",
      block_id: `analysis_actions_${requestId}`,
      elements: actionElements,
    });

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_Requested by @${request.slackUserName || "unknown"} | ${formatDuration(durationMs)} | ${formatCostUsd(costUsd)}_`,
        },
      ],
    });

    // Post to the thread if we have one, otherwise to the channel
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: request.slackChannelId,
        thread_ts: request.slackThreadTs,
        blocks,
        text: `Analysis complete`,
      }),
    });

    const result = (await response.json()) as { ok: boolean; error?: string };

    if (result.ok) {
      logWithContext("SLACK", "Analysis notification sent to Slack", {
        requestId,
        channelId: request.slackChannelId,
        threadTs: request.slackThreadTs,
      });
    } else {
      logWithContext("SLACK", "Failed to send analysis notification to Slack", {
        requestId,
        error: result.error,
      });
    }
  } catch (error) {
    logWithContext("SLACK", "Exception sending analysis notification", {
      error: getErrorMessage(error),
      requestId,
    });
  }
}

/**
 * Post a GitHub comment to a Slack thread
 */
export async function postSlackComment(
  channelId: string,
  botToken: string,
  threadTs: string,
  commentBody: string,
  authorName: string,
  issueUrl: string
): Promise<void> {
  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: threadTs,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*New comment by ${authorName}* on <${issueUrl}|issue>:`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: commentBody.length > 2500 ? commentBody.substring(0, 2500) + "..." : commentBody,
            },
          }
        ],
        text: `New comment on issue by ${authorName}`,
      }),
    });

    const result = (await response.json()) as { ok: boolean; error?: string };

    if (!result.ok) {
      logWithContext("SLACK", "Failed to post comment to Slack", {
        error: result.error,
        channelId,
        threadTs
      });
    } else {
      logWithContext("SLACK", "Posted comment to Slack thread", {
        channelId,
        threadTs
      });
    }
  } catch (error) {
    logWithContext("SLACK", "Error posting comment to Slack", {
      error: getErrorMessage(error)
    });
  }
}
