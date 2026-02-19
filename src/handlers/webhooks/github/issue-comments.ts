import { GitHubAPI } from "../../../integrations/github/client";
import { logWithContext } from "../../../core/log";
import { postSlackComment } from "../../slack/commands";
import { getDb } from "../../../db/client";
import { AppConfigRepository } from "../../../db/repositories";
import { RequestService } from "../../../services";
import { getGitHubToken } from "../../../integrations/github/token";
import { decrypt } from "../../../core/crypto";
import { createQueueProducer } from "../../../queue/abstractions";
import type { QueueMessage } from "../../../queue/types";
import type { Env } from "../../../core/types";

// Handle issue_comment events - specifically for clarification responses
export async function handleIssueCommentEvent(
  data: any,
  env: Env,
  appId: string
): Promise<Response> {
  const action = data.action;
  const comment = data.comment;
  const issue = data.issue;
  const repository = data.repository;

  logWithContext("ISSUE_COMMENT_EVENT", "Processing issue comment event", {
    action,
    issueNumber: issue.number,
    commentId: comment.id,
    commentAuthor: comment.user?.login,
    repository: repository.full_name,
  });

  // Only process new comments (not edits or deletions)
  if (action !== "created") {
    logWithContext("ISSUE_COMMENT_EVENT", "Skipping non-created comment action", {
      action,
    });
    return new Response("Comment action skipped", { status: 200 });
  }

  // Ignore comments from bots (including our own bot)
  if (comment.user?.type === "Bot") {
    logWithContext("ISSUE_COMMENT_EVENT", "Skipping bot comment", {
      botName: comment.user?.login,
    });
    return new Response("Bot comment skipped", { status: 200 });
  }

  const db = getDb(env);
  const requestService = new RequestService(db);
  const configRepo = new AppConfigRepository(db);

  // MIRROR TO SLACK: Check if this issue is linked to a Slack thread
  try {
    logWithContext("ISSUE_COMMENT_EVENT", "Checking for linked Slack thread", {
      issueNumber: issue.number,
      repositoryName: repository.full_name
    });

    // Find the feature request by GitHub issue
    const request = await requestService.findByGitHubIssue(
      repository.full_name,
      issue.number
    );

    if (request) {
      logWithContext("ISSUE_COMMENT_EVENT", "Issue request details retrieved", {
        hasDetails: true,
        requestId: request.requestId,
        hasThreadTs: !!request.slackThreadTs,
        hasChannelId: !!request.slackChannelId
      });

      if (request.slackThreadTs && request.slackChannelId) {
        // Get bot token from PostgreSQL
        const slackConfig = await configRepo.getSlackConfig();

        if (slackConfig?.botTokenEncrypted) {
          const botToken = await decrypt(slackConfig.botTokenEncrypted, env.ENCRYPTION_KEY);

          logWithContext("ISSUE_COMMENT_EVENT", "Posting comment to Slack", {
            channelId: request.slackChannelId,
            threadTs: request.slackThreadTs
          });

          await postSlackComment(
            request.slackChannelId,
            botToken,
            request.slackThreadTs,
            comment.body,
            comment.user.login,
            comment.html_url
          );
        } else {
          logWithContext("ISSUE_COMMENT_EVENT", "Missing Slack bot token");
        }
      } else {
        logWithContext("ISSUE_COMMENT_EVENT", "No linked Slack thread found for this issue");
      }
    } else {
      logWithContext("ISSUE_COMMENT_EVENT", "No feature request found for this issue", {
        issueNumber: issue.number,
        repository: repository.full_name
      });
    }
  } catch (error) {
    logWithContext("ISSUE_COMMENT_EVENT", "Failed to mirror comment to Slack", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Check if issue has 'clarity-ai' label
  const issueLabels = issue.labels?.map((label: any) => label.name) || [];
  const hasClarityLabel = issueLabels.includes("clarity-ai");

  if (!hasClarityLabel) {
    logWithContext("ISSUE_COMMENT_EVENT", "Skipping comment - issue has no clarity-ai label", {
      issueNumber: issue.number,
      labels: issueLabels,
    });
    return new Response("Issue has no clarity-ai label", { status: 200 });
  }

  // Check if this issue is awaiting clarification by looking in PostgreSQL
  const awaitingRequest = await requestService.findByGitHubIssue(
    repository.full_name,
    issue.number
  );

  if (!awaitingRequest) {
    logWithContext("ISSUE_COMMENT_EVENT", "No feature request found for this issue", {
      issueNumber: issue.number,
      repository: repository.full_name,
    });
    return new Response("No pending clarification request", { status: 200 });
  }

  // Check the status field (not taskStatus) for awaiting_clarification
  if (awaitingRequest.status !== "awaiting_clarification") {
    logWithContext("ISSUE_COMMENT_EVENT", "Request not in awaiting_clarification state", {
      requestId: awaitingRequest.requestId,
      currentStatus: awaitingRequest.status,
    });
    return new Response("Request not awaiting clarification", { status: 200 });
  }

  logWithContext("ISSUE_COMMENT_EVENT", "Found pending clarification request", {
    requestId: awaitingRequest.requestId,
    issueNumber: issue.number,
  });

  // Get GitHub token and post acknowledgment comment
  let githubToken: string;
  try {
    githubToken = await getGitHubToken(env);
  } catch (error) {
    logWithContext("ISSUE_COMMENT_EVENT", "Failed to get GitHub token", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response("Failed to get GitHub credentials", { status: 500 });
  }

  const githubAPI = new GitHubAPI(githubToken);

  try {
    await githubAPI.createComment(
      repository.owner.login,
      repository.name,
      issue.number,
      `🤖 **Clarity AI**\n\nThank you for the clarification! I'm now continuing with the implementation based on your response.\n\n---\n🚀 Processing...`
    );
  } catch (error) {
    logWithContext("ISSUE_COMMENT_EVENT", "Failed to post acknowledgment", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Log the clarification answer and update status atomically
  await requestService.handleClarificationAnswer(
    awaitingRequest.requestId,
    comment.body,
    { id: comment.user?.login || "unknown", name: comment.user?.login || "unknown" },
    "github",
    { issueNumber: issue.number, commentId: comment.id, commentUrl: comment.html_url }
  );

  // Re-queue the issue for processing with clarification context
  const queueMessage = {
    requestId: awaitingRequest.requestId,
    repo: repository.full_name,
    description: issue.body || issue.title,
    issueId: issue.id,
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueBody: issue.body || "",
    issueLabels: issue.labels?.map((label: any) => label.name) || [],
    issueAuthor: issue.user.login,
    repositoryUrl: repository.clone_url,
    repositoryName: repository.full_name,
    repositoryId: repository.id,
    repositoryOwner: repository.owner.login,
    repositoryNameOnly: repository.name,
    appId,
    // Follow-up fields
    isFollowUp: true,
    followUpRequest: comment.body,
    followUpAuthor: comment.user?.login,
    existingPrNumber: awaitingRequest.prNumber ?? undefined,
    existingPrUrl: awaitingRequest.prUrl ?? undefined,
    triggeredBy: 'github' as const,
  };

  const queueProducer = createQueueProducer<QueueMessage>({ cloudflareQueue: env.ISSUE_QUEUE });
  await queueProducer.send(queueMessage);

  logWithContext("ISSUE_COMMENT_EVENT", "Re-queued issue with clarification", {
    requestId: awaitingRequest.requestId,
    issueNumber: issue.number,
    clarificationLength: comment.body?.length,
  });

  return new Response("Clarification received, re-queued for processing", { status: 200 });
}
