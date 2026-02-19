import { GitHubAPI } from "../../../integrations/github/client";
import { logWithContext } from "../../../core/log";
import { getDb } from "../../../db/client";
import { RequestService } from "../../../services";
import { getGitHubToken } from "../../../integrations/github/token";
import { createQueueProducer } from "../../../queue/abstractions";
import type { QueueMessage } from "../../../queue/types";
import type { Env } from "../../../core/types";

// Queue issue processing via Cloudflare Queue
async function queueIssueForProcessing(
  issue: any,
  repository: any,
  env: Env,
  appId: string
): Promise<void> {
  // Check if issue body contains a Tracking ID from Slack
  // Format: **Tracking ID:** `fr-123456789-abcdef`
  let requestId = `issue-${issue.id}-${Date.now()}`;
  const trackingIdMatch = issue.body?.match(/\*\*Tracking ID:\*\*\s+`([^`]+)`/);

  if (trackingIdMatch && trackingIdMatch[1]) {
    requestId = trackingIdMatch[1];
    logWithContext('ISSUE_QUEUE', 'Found existing Tracking ID in issue body', {
      requestId,
      issueNumber: issue.number
    });
  } else {
    logWithContext('ISSUE_QUEUE', 'No Tracking ID found, generating new Request ID', {
      requestId,
      issueNumber: issue.number
    });
  }

  logWithContext('ISSUE_QUEUE', 'Queueing issue for container processing via Queue', {
    issueNumber: issue.number,
    issueId: issue.id,
    repository: repository.full_name,
    requestId
  });

  // Store the request in PostgreSQL for tracking with initial message
  const db = getDb(env);
  const requestService = new RequestService(db);

  const requestData = {
    requestId,
    origin: 'github_issue' as const,
    repo: repository.full_name,
    description: issue.body || issue.title,
    status: 'pending' as const,
    // Issue fields
    issueId: issue.id,
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueBody: issue.body || "",
    issueLabels: issue.labels?.map((label: any) => label.name) || [],
    issueAuthor: issue.user.login,
    issueUrl: issue.html_url,
    repositoryUrl: repository.clone_url,
    repositoryName: repository.full_name,
    repositoryId: repository.id,
    repositoryOwner: repository.owner.login,
    repositoryNameOnly: repository.name,
    appId,
    taskStatus: 'pending' as const
  };

  // Store in PostgreSQL with initial message
  try {
    await requestService.createRequest(
      requestData,
      { id: issue.user.login, name: issue.user.login },
      'github'
    );
    logWithContext('ISSUE_QUEUE', 'Request stored in PostgreSQL with initial message', {
      requestId,
      issueNumber: issue.number
    });
  } catch (error) {
    // May already exist if this is a retry
    logWithContext('ISSUE_QUEUE', 'Failed to create request (may already exist)', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Send to Cloudflare Queue for processing
  const queueMessage = {
    requestId,
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
    triggeredBy: 'github' as const,
  };

  const queueProducer = createQueueProducer<QueueMessage>({ cloudflareQueue: env.ISSUE_QUEUE });
  await queueProducer.send(queueMessage);

  logWithContext('ISSUE_QUEUE', 'Issue queued successfully', {
    requestId,
    issueNumber: issue.number
  });
}

// Handle issues events
export async function handleIssuesEvent(data: any, env: Env, appId: string): Promise<Response> {
  const action = data.action;
  const issue = data.issue;
  const repository = data.repository;

  logWithContext('ISSUES_EVENT', 'Processing issue event', {
    action,
    issueNumber: issue.number,
    issueTitle: issue.title,
    repository: repository.full_name,
    author: issue.user?.login,
    labels: issue.labels?.map((label: any) => label.name) || []
  });

  // Get GitHub token for API calls
  let githubToken: string;
  try {
    githubToken = await getGitHubToken(env);
  } catch (error) {
    logWithContext('ISSUES_EVENT', 'Failed to get GitHub token', {
      error: error instanceof Error ? error.message : String(error)
    });
    return new Response('Failed to get GitHub credentials', { status: 500 });
  }

  // Create GitHub API client for authenticated requests
  const githubAPI = new GitHubAPI(githubToken);

  // Handle new issue creation with Claude Code
  if (action === 'opened') {
    // Check if issue has 'clarity-ai' label - only process labeled issues
    const issueLabels = issue.labels?.map((label: any) => label.name) || [];
    const hasClarityLabel = issueLabels.includes('clarity-ai');
    const hasSlackLabel = issueLabels.includes('slack');

    if (!hasClarityLabel) {
      logWithContext('ISSUES_EVENT', 'Skipping issue - no clarity-ai label', {
        issueNumber: issue.number,
        labels: issueLabels
      });
      return new Response('Issue skipped - no clarity-ai label', { status: 200 });
    }

    // Skip issues created from Slack - they're already queued by the Slack handler
    if (hasSlackLabel) {
      logWithContext('ISSUES_EVENT', 'Skipping issue - created from Slack, already queued', {
        issueNumber: issue.number,
        labels: issueLabels
      });
      return new Response('Issue skipped - created from Slack, already queued', { status: 200 });
    }

    logWithContext('ISSUES_EVENT', 'Handling new issue creation with clarity-ai label');

    // Post initial acknowledgment comment synchronously (fast)
    try {
      logWithContext('ISSUES_EVENT', 'Posting initial acknowledgment comment');

      await githubAPI.createComment(
        repository.owner.login,
        repository.name,
        issue.number,
        `🤖 **Claude Code Assistant**\n\nI've received this issue and I'm analyzing it now. I'll start working on a solution shortly!\n\n---\n🚀 Powered by Claude Code`
      );

      logWithContext('ISSUES_EVENT', 'Initial comment posted successfully');
    } catch (error) {
      logWithContext('ISSUES_EVENT', 'Failed to post acknowledgment comment', {
        error: error instanceof Error ? error.message : String(error),
        issueNumber: issue.number
      });
    }

    // Queue issue for processing
    try {
      logWithContext('ISSUES_EVENT', 'Queueing issue for container processing');
      await queueIssueForProcessing(issue, repository, env, appId);
      logWithContext('ISSUES_EVENT', 'Issue queued successfully');
    } catch (error) {
      logWithContext('ISSUES_EVENT', 'Failed to queue issue for processing', {
        error: error instanceof Error ? error.message : String(error),
        issueNumber: issue.number
      });

      // Post error comment
      try {
        await githubAPI.createComment(
          repository.owner.login,
          repository.name,
          issue.number,
          `❌ I encountered an error while setting up to work on this issue: ${(error as Error).message}\n\nI'll need human assistance to resolve this.`
        );
      } catch (commentError) {
        logWithContext('ISSUES_EVENT', 'Failed to post error comment', {
          commentError: commentError instanceof Error ? commentError.message : String(commentError)
        });
      }
    }
  }

  // Handle 'labeled' action - trigger processing when clarity-ai label is added to EXISTING issue
  // Skip if issue was just created (opened action already handled it)
  if (action === 'labeled' && data.label?.name === 'clarity-ai') {
    // Skip issues created from Slack - they're already queued by the Slack handler
    const issueLabels = issue.labels?.map((label: any) => label.name) || [];
    if (issueLabels.includes('slack')) {
      logWithContext('ISSUES_EVENT', 'Skipping labeled event - created from Slack, already queued', {
        issueNumber: issue.number,
        labels: issueLabels
      });
      return new Response('Skipped - Slack issue already queued', { status: 200 });
    }

    // Check if issue was created very recently (within last 5 seconds) - if so, skip as 'opened' handler already processed it
    const issueCreatedAt = new Date(issue.created_at).getTime();
    const now = Date.now();
    const timeSinceCreation = now - issueCreatedAt;

    if (timeSinceCreation < 5000) {
      logWithContext('ISSUES_EVENT', 'Skipping labeled event - issue was just created, already processed by opened handler', {
        issueNumber: issue.number,
        timeSinceCreation
      });
      return new Response('Skipped - recently created issue already processed', { status: 200 });
    }

    logWithContext('ISSUES_EVENT', 'clarity-ai label added to existing issue, triggering processing', {
      issueNumber: issue.number,
      issueTitle: issue.title,
      timeSinceCreation
    });

    // Post initial acknowledgment comment
    try {
      await githubAPI.createComment(
        repository.owner.login,
        repository.name,
        issue.number,
        `🤖 **Clarity AI Assistant**\n\nI've been assigned to work on this issue. Analyzing it now and will start working on a solution shortly!\n\n---\n🚀 Powered by Clarity AI`
      );
    } catch (error) {
      logWithContext('ISSUES_EVENT', 'Failed to post acknowledgment comment for labeled issue', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Queue issue for processing
    try {
      await queueIssueForProcessing(issue, repository, env, appId);
      logWithContext('ISSUES_EVENT', 'Labeled issue queued successfully');
    } catch (error) {
      logWithContext('ISSUES_EVENT', 'Failed to queue labeled issue for processing', {
        error: error instanceof Error ? error.message : String(error)
      });

      try {
        await githubAPI.createComment(
          repository.owner.login,
          repository.name,
          issue.number,
          `❌ I encountered an error while setting up to work on this issue: ${(error as Error).message}\n\nI'll need human assistance to resolve this.`
        );
      } catch (commentError) {
        logWithContext('ISSUES_EVENT', 'Failed to post error comment', {
          commentError: commentError instanceof Error ? commentError.message : String(commentError)
        });
      }
    }

    return new Response('Labeled issue queued for processing', { status: 200 });
  }

  // Handle 'labeled' action - trigger RETRY when clarity-ai-retry label is added
  if (action === 'labeled' && data.label?.name === 'clarity-ai-retry') {
    logWithContext('ISSUES_EVENT', 'clarity-ai-retry label added, triggering retry', {
      issueNumber: issue.number,
      issueTitle: issue.title,
    });

    // Remove the retry label so it can be used again later
    try {
      await githubAPI.removeLabel(
        repository.owner.login,
        repository.name,
        issue.number,
        'clarity-ai-retry'
      );
      logWithContext('ISSUES_EVENT', 'Removed clarity-ai-retry label');
    } catch (labelError) {
      logWithContext('ISSUES_EVENT', 'Failed to remove retry label (may not exist)', {
        error: labelError instanceof Error ? labelError.message : String(labelError)
      });
    }

    // Post retry acknowledgment comment
    try {
      await githubAPI.createComment(
        repository.owner.login,
        repository.name,
        issue.number,
        `🔄 **Retrying...**\n\nI'm attempting to process this issue again. Please wait while I analyze and work on it.\n\n---\n🚀 Powered by Clarity AI`
      );
    } catch (error) {
      logWithContext('ISSUES_EVENT', 'Failed to post retry acknowledgment comment', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Queue issue for processing
    try {
      await queueIssueForProcessing(issue, repository, env, appId);
      logWithContext('ISSUES_EVENT', 'Retry issue queued successfully');
    } catch (error) {
      logWithContext('ISSUES_EVENT', 'Failed to queue retry issue for processing', {
        error: error instanceof Error ? error.message : String(error)
      });

      try {
        await githubAPI.createComment(
          repository.owner.login,
          repository.name,
          issue.number,
          `❌ Retry failed: ${(error as Error).message}\n\nPlease contact support if the issue persists.`
        );
      } catch (commentError) {
        logWithContext('ISSUES_EVENT', 'Failed to post retry error comment', {
          commentError: commentError instanceof Error ? commentError.message : String(commentError)
        });
      }
    }

    return new Response('Retry issue queued for processing', { status: 200 });
  }

  // For other issue actions (edited, closed, reopened, etc.), just acknowledge
  // These don't require processing by clarity-ai
  logWithContext('ISSUES_EVENT', 'Issue action acknowledged (no processing needed)', {
    action,
    issueNumber: issue.number
  });

  return new Response('Issue action acknowledged', { status: 200 });
}
