/**
 * AgentExecutor - Orchestrates agent execution with common operations.
 *
 * This class handles:
 * - Workspace setup (git clone)
 * - GitHub client initialization
 * - Agent strategy delegation
 * - Git operations (commit, push)
 * - PR creation (skipped for doc-only changes)
 * - Clarifying questions handling
 *
 * The actual AI execution is delegated to the strategy.
 *
 * @version 2026-01-21 - Added doc-only change detection
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { simpleGit } from 'simple-git';

import type { IAgentStrategy } from './strategy.interface.js';
import type {
  AgentContext,
  AgentResult,
  AgentConfig,
  IssueContext,
  AgentProgressEvent,
  DownloadedAttachment,
} from './types.js';
import { AgentStrategyFactory } from './factory.js';
import { ContainerGitHubClient } from '../github_client.js';
import { SlackProgressReporter } from './slack-progress.js';
import { createLogger } from '../logger.js';
import { loadSkills } from '../skills/skill-loader.js';

// Create logger for this module
const logger = createLogger('AgentExecutor');

export class AgentExecutor {
  private strategy: IAgentStrategy | null = null;
  private workspaceDir: string | null = null;
  private githubClient: ContainerGitHubClient | null = null;
  private isExecuting = false;

  /**
   * Execute a task with the given configuration.
   *
   * This is the main entry point that orchestrates the entire flow:
   * 1. Initialize GitHub client
   * 2. Get PR branch for follow-ups
   * 3. Setup workspace
   * 4. Prepare prompt
   * 5. Execute strategy
   * 6. Handle results (clarification, PR creation, comments)
   */
  async execute(
    issueContext: IssueContext,
    config: AgentConfig,
    githubToken: string,
    promptBuilder: (issueContext: IssueContext, attachments?: DownloadedAttachment[]) => Promise<string>,
    onProgress?: (event: AgentProgressEvent) => void,
    // Session resumption (ADR-001)
    sessionOptions?: {
      resumeSessionId?: string;
      sessionBlob?: string;
    },
    // Slack attachment downloader (defined in main.ts)
    downloadAttachments?: (workspaceDir: string) => Promise<DownloadedAttachment[]>
  ): Promise<AgentResult> {
    this.isExecuting = true;
    let slackProgress: SlackProgressReporter | undefined;

    logger.log('EXECUTE', 'Starting execution', {
      agentType: config.type,
      provider: config.provider,
      issueNumber: issueContext.issueNumber,
      hasExistingPR: !!issueContext.existingPrNumber,
      hasUserMessage: !!issueContext.followUpRequest,
      hasSessionToResume: !!sessionOptions?.resumeSessionId
    });

    try {
      // 0. Load skills for the specific agent type
      const loadedSkills = await loadSkills(config.type);
      logger.log('EXECUTE', 'Skills loaded', {
        agentType: config.type,
        count: loadedSkills.length,
        skills: loadedSkills
      });

      // 1. Create strategy
      this.strategy = AgentStrategyFactory.create(config);

      // 2. Initialize GitHub client
      const [owner, repo] = issueContext.repositoryName.split('/');
      this.githubClient = new ContainerGitHubClient(githubToken, owner, repo);

      // 3. Get PR branch if modifying existing PR
      let prBranchName: string | undefined;
      if (issueContext.existingPrNumber) {
        const prDetails = await this.githubClient.getPullRequest(
          parseInt(issueContext.existingPrNumber)
        );
        prBranchName = prDetails.head_branch;
        logger.log('EXECUTE', 'Retrieved PR branch for existing PR', {
          prNumber: issueContext.existingPrNumber,
          branchName: prBranchName
        });
      }

      // 4. Setup workspace
      this.workspaceDir = await this.setupWorkspace(
        issueContext.repositoryUrl,
        issueContext.issueNumber,
        githubToken,
        prBranchName
      );

      logger.log('EXECUTE', 'Workspace setup completed', { workspaceDir: this.workspaceDir });

      // 4a. Create Slack progress reporter if routing info available
      if (issueContext.slackChannelId && issueContext.slackThreadTs && issueContext.slackBotToken) {
        slackProgress = new SlackProgressReporter(
          issueContext.slackBotToken,
          issueContext.slackChannelId,
          issueContext.slackThreadTs,
          issueContext.issueNumber
        );
        logger.log('EXECUTE', 'Slack progress reporter created', {
          channelId: issueContext.slackChannelId,
        });
      }

      // Wrap onProgress to also forward to Slack
      const wrappedOnProgress = (event: AgentProgressEvent) => {
        onProgress?.(event);
        slackProgress?.onProgress(event);
      };

      // 4b. Download Slack attachments if present
      let downloadedAttachments: DownloadedAttachment[] | undefined;
      if (downloadAttachments) {
        downloadedAttachments = await downloadAttachments(this.workspaceDir);
        if (downloadedAttachments.length > 0) {
          logger.log('EXECUTE', 'Attachments downloaded', {
            count: downloadedAttachments.length,
          });
        }
      }

      // 5. Prepare prompt
      const prompt = await promptBuilder(issueContext, downloadedAttachments);
      logger.log('EXECUTE', 'Prompt prepared', { promptLength: prompt.length });

      // 6. Create agent context
      const agentContext: AgentContext = {
        workspaceDir: this.workspaceDir,
        prompt,
        config,
        issueContext,
        githubToken,
        requestId: issueContext.issueId,
        onProgress: wrappedOnProgress,
        // Session resumption (ADR-001)
        resumeSessionId: sessionOptions?.resumeSessionId,
        sessionBlob: sessionOptions?.sessionBlob
      };

      // 7. Validate before execution
      const validation = await this.strategy.validate(agentContext);
      if (!validation.valid) {
        return {
          success: false,
          message: `Validation failed: ${validation.errors?.join(', ')}`,
          error: validation.errors?.join(', ')
        };
      }

      // 8. Change to workspace directory and execute strategy
      const originalCwd = process.cwd();
      process.chdir(this.workspaceDir);

      let strategyResult: AgentResult;
      try {
        strategyResult = await this.strategy.execute(agentContext);
      } finally {
        process.chdir(originalCwd);
      }

      // 9. Handle strategy result
      if (!strategyResult.success) {
        return strategyResult;
      }

      // 10. Check for clarifying questions
      const clarifyingQuestions = await this.readClarifyingQuestions(
        this.workspaceDir,
        issueContext.issueNumber
      );

      if (clarifyingQuestions) {
        logger.log('EXECUTE', 'Clarifying questions found');
        await this.postClarifyingQuestions(issueContext, clarifyingQuestions);

        return {
          success: true,
          message: 'Clarifying questions posted - awaiting user response',
          needsClarification: true,
          clarifyingQuestions,
          costUsd: strategyResult.costUsd,
          durationMs: strategyResult.durationMs,
          metadata: strategyResult.metadata,
          // Session persistence (ADR-001) - store session even when awaiting clarification
          sessionId: strategyResult.sessionId,
          sessionBlob: strategyResult.sessionBlob,
        };
      }

      // 11. Check for file changes
      const hasChanges = await this.detectGitChanges(this.workspaceDir);
      const docOnlyChanges = hasChanges ? await this.isDocOnlyChanges(this.workspaceDir) : false;
      // For follow-ups with existing PR, we should commit even doc-only changes
      const isFollowUpWithExistingPr = prBranchName && issueContext.existingPrUrl && issueContext.existingPrNumber;
      logger.log('EXECUTE', 'Change detection completed', { hasChanges, docOnlyChanges, isFollowUpWithExistingPr });

      // Extract solution from strategy result
      const solution = (strategyResult.metadata as any)?.solution || strategyResult.message;

      if (hasChanges && (!docOnlyChanges || isFollowUpWithExistingPr)) {
        // 12. Handle PR creation or update (code changes, or doc changes for follow-ups)
        const prResult = await this.handlePullRequest(
          issueContext,
          solution,
          prBranchName
        );

        onProgress?.({
          type: 'completed',
          message: `Pull request ${prResult.prNumber ? 'updated' : 'created'}`,
          timestamp: new Date()
        });

        return {
          success: true,
          message: prResult.message,
          prUrl: prResult.prUrl,
          prNumber: prResult.prNumber,
          prBranchName: prResult.prBranchName,
          summary: prResult.summary,
          costUsd: strategyResult.costUsd,
          durationMs: strategyResult.durationMs,
          metadata: strategyResult.metadata,
          // Session persistence (ADR-001)
          sessionId: strategyResult.sessionId,
          sessionBlob: strategyResult.sessionBlob,
        };
      } else if (docOnlyChanges) {
        // Only doc/markdown files changed - don't create PR, notify via Slack instead
        logger.log('EXECUTE', 'Doc-only changes detected, skipping PR creation');

        await this.githubClient.createComment(
          parseInt(issueContext.issueNumber),
          `${solution}\n\n---\n🤖 Generated with [${this.strategy.displayName}](https://claude.ai/code)`
        );

        onProgress?.({
          type: 'completed',
          message: 'Analysis complete',
          timestamp: new Date()
        });

        return {
          success: true,
          message: 'Analysis complete',
          summary: solution,
          isDocOnlyChanges: true,
          costUsd: strategyResult.costUsd,
          durationMs: strategyResult.durationMs,
          metadata: strategyResult.metadata,
          // Session persistence (ADR-001)
          sessionId: strategyResult.sessionId,
          sessionBlob: strategyResult.sessionBlob,
        };
      } else {
        // No changes at all - post solution as comment
        await this.githubClient.createComment(
          parseInt(issueContext.issueNumber),
          `${solution}\n\n---\n🤖 Generated with [${this.strategy.displayName}](https://claude.ai/code)`
        );

        onProgress?.({
          type: 'completed',
          message: 'Solution posted as comment',
          timestamp: new Date()
        });

        return {
          success: true,
          message: 'Solution posted as comment (no file changes)',
          summary: solution,
          costUsd: strategyResult.costUsd,
          durationMs: strategyResult.durationMs,
          metadata: strategyResult.metadata,
          // Session persistence (ADR-001)
          sessionId: strategyResult.sessionId,
          sessionBlob: strategyResult.sessionBlob,
        };
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.log('EXECUTE', 'Error during execution', { error: errorMessage });

      onProgress?.({
        type: 'error',
        message: errorMessage,
        timestamp: new Date()
      });

      return {
        success: false,
        message: 'Failed to process issue',
        error: errorMessage
      };
    } finally {
      // Clean up Slack progress message before final notifications
      try {
        await slackProgress?.cleanup();
      } catch (e) {
        logger.log('EXECUTE', 'Slack progress cleanup failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await this.cleanup();
      this.isExecuting = false;
    }
  }

  /**
   * Abort current execution
   */
  async abort(): Promise<void> {
    if (this.strategy && this.isExecuting) {
      await this.strategy.abort();
    }
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    if (this.strategy) {
      await this.strategy.cleanup();
    }
    this.strategy = null;
    this.workspaceDir = null;
    this.githubClient = null;
  }

  // ============= Private Helper Methods =============

  private async setupWorkspace(
    repositoryUrl: string,
    issueNumber: string,
    githubToken: string,
    prBranchName?: string
  ): Promise<string> {
    const workspaceDir = `/tmp/workspace/issue-${issueNumber}`;

    logger.log('WORKSPACE', 'Setting up workspace', {
      workspaceDir,
      repositoryUrl,
      prBranchName: prBranchName || 'default'
    });

    // Ensure we're not in the workspace directory before cleanup
    try {
      if (process.cwd().startsWith(workspaceDir)) {
        process.chdir('/');
      }
    } catch {
      process.chdir('/');
    }

    // Cleanup existing workspace
    try {
      const { execSync } = await import('child_process');
      execSync(`rm -rf "${workspaceDir}"`, { timeout: 30000 });
    } catch {
      // Ignore cleanup errors
    }

    // Create parent directory
    await fs.mkdir(path.dirname(workspaceDir), { recursive: true });

    // Construct authenticated clone URL
    const authenticatedUrl = repositoryUrl.replace(
      'https://github.com/',
      `https://x-access-token:${githubToken}@github.com/`
    );

    // Clone repository
    const cloneArgs = prBranchName
      ? ['clone', '--branch', prBranchName, '--single-branch', '--no-tags', authenticatedUrl, workspaceDir]
      : ['clone', '--depth', '1', '--single-branch', '--no-tags', '--filter=blob:none', authenticatedUrl, workspaceDir];

    await new Promise<void>((resolve, reject) => {
      const gitProcess = spawn('git', cloneArgs, { cwd: '/' });

      const timeoutId = setTimeout(() => {
        gitProcess.kill('SIGKILL');
        reject(new Error('Git clone timed out after 300s'));
      }, 300000);

      gitProcess.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code === 0) resolve();
        else reject(new Error(`Git clone failed with code ${code}`));
      });

      gitProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });

    // Configure git
    const git = simpleGit(workspaceDir);
    await git.addConfig('user.name', 'Claude Code Bot');
    await git.addConfig('user.email', 'claude-code@anthropic.com');
    await git.fetch('origin');

    // For follow-up requests, reset local branch to latest remote state
    // This handles cases where retries have already pushed commits
    if (prBranchName) {
      try {
        await git.reset(['--hard', `origin/${prBranchName}`]);
        logger.log('WORKSPACE', 'Reset branch to latest remote state', { branch: prBranchName });
      } catch (resetError) {
        logger.log('WORKSPACE', 'Reset to remote skipped (branch may not exist remotely)', {
          branch: prBranchName,
          reason: resetError instanceof Error ? resetError.message : String(resetError)
        });
      }
    }

    logger.log('WORKSPACE', 'Workspace setup completed');

    return workspaceDir;
  }

  private async detectGitChanges(workspaceDir: string): Promise<boolean> {
    try {
      process.chdir(workspaceDir);
      const git = simpleGit({ baseDir: workspaceDir });
      const status = await git.status();
      return !status.isClean();
    } catch {
      return false;
    }
  }

  /**
   * Check if all changed files are documentation-only (markdown, doc folder, etc.)
   * Returns true if ONLY doc files are changed (no actual code changes)
   */
  private async isDocOnlyChanges(workspaceDir: string): Promise<boolean> {
    try {
      const git = simpleGit({ baseDir: workspaceDir });
      const status = await git.status();

      // Get all changed files (modified, created, deleted, renamed)
      const allChangedFiles = [
        ...status.modified,
        ...status.created,
        ...status.deleted,
        ...status.renamed.map(r => r.to),
        ...status.not_added,
      ];

      if (allChangedFiles.length === 0) {
        return false; // No changes at all
      }

      // Check if ALL changed files are doc-only
      const docPatterns = [
        /^doc\//i,           // doc/ folder
        /^docs\//i,          // docs/ folder
        /\.md$/i,            // Markdown files
        /^readme/i,          // README files
        /^changelog/i,       // CHANGELOG files
        /^license/i,         // LICENSE files
        /^\.github\//i,      // GitHub config/templates
      ];

      const isDocFile = (filePath: string): boolean => {
        return docPatterns.some(pattern => pattern.test(filePath));
      };

      const allAreDocFiles = allChangedFiles.every(isDocFile);

      logger.log('EXECUTOR', 'Doc-only change detection', {
        totalChanges: allChangedFiles.length,
        changedFiles: allChangedFiles.slice(0, 10), // Log first 10 files
        isDocOnly: allAreDocFiles,
      });

      return allAreDocFiles;
    } catch (error) {
      logger.log('EXECUTOR', 'Error checking doc-only changes', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async readClarifyingQuestions(
    workspaceDir: string,
    issueNumber: string
  ): Promise<string | null> {
    const questionsPath = path.join(
      workspaceDir,
      'doc',
      'ai-task',
      `issue-${issueNumber}-questions.md`
    );

    try {
      let content = await fs.readFile(questionsPath, 'utf8');

      // Clean up misleading status lines
      content = content
        .split('\n')
        .filter(line => {
          const lowerLine = line.toLowerCase();
          if (lowerLine.includes('status:') && (
            lowerLine.includes('complete') ||
            lowerLine.includes('done') ||
            lowerLine.includes('✅')
          )) {
            return false;
          }
          return true;
        })
        .join('\n');

      return content.trim();
    } catch {
      return null;
    }
  }

  private async postClarifyingQuestions(
    issueContext: IssueContext,
    questions: string
  ): Promise<void> {
    if (!this.githubClient) return;

    const comment = `🤔 **Clarity AI needs some clarification**

Before I proceed with the implementation, I have a few questions to ensure I build exactly what you need:

${questions}

---
Please reply to this comment with your answers. Once you respond, I'll continue with the implementation.

🤖 Powered by Clarity AI`;

    await this.githubClient.createComment(
      parseInt(issueContext.issueNumber),
      comment
    );
  }

  private async handlePullRequest(
    issueContext: IssueContext,
    solution: string,
    existingBranch?: string
  ): Promise<{ message: string; prUrl?: string; prNumber?: number; prBranchName?: string; summary?: string }> {
    if (!this.workspaceDir || !this.githubClient) {
      throw new Error('Workspace or GitHub client not initialized');
    }

    const git = simpleGit({ baseDir: this.workspaceDir });

    if (existingBranch && issueContext.existingPrUrl && issueContext.existingPrNumber) {
      // Follow-up: commit to existing branch
      const commitMessage = `Follow-up changes for PR #${issueContext.existingPrNumber}

Requested by: ${issueContext.followUpAuthor || 'user'}
Changes: ${issueContext.followUpRequest?.substring(0, 100) || 'Additional changes requested'}

🤖 Generated with ${this.strategy?.displayName || 'Clarity AI'}`;

      await this.commitAndPush(git, existingBranch, commitMessage);

      await this.githubClient.createComment(
        parseInt(issueContext.existingPrNumber),
        `✅ **Follow-up changes applied**

I've pushed additional changes to this PR as requested by ${issueContext.followUpAuthor || 'user'}:

> ${issueContext.followUpRequest || 'Additional changes'}

${solution}

---
🤖 Generated with [${this.strategy?.displayName || 'Clarity AI'}](https://claude.ai/code)`
      );

      // Read PR summary if available (for follow-ups too)
      const prSummary = await this.readPRSummary(issueContext.issueNumber);

      return {
        message: `Follow-up changes pushed to existing PR: ${issueContext.existingPrUrl}`,
        prUrl: issueContext.existingPrUrl,
        prNumber: parseInt(issueContext.existingPrNumber),
        prBranchName: existingBranch,
        summary: prSummary || undefined
      };
    } else {
      // New request: create new branch and PR
      // Use requestId (issueId) for unique branch name to avoid conflicts on retries
      const branchName = `clarity-ai/issue-${issueContext.issueId}`;

      // Check if branch already exists (locally or remotely) and handle retries
      try {
        const branches = await git.branch(['-a']);
        const localBranchExists = branches.all.includes(branchName);
        const remoteBranchExists = branches.all.includes(`remotes/origin/${branchName}`);

        if (localBranchExists) {
          // Local branch exists - switch to it (retry scenario)
          logger.log('PR', 'Reusing existing local branch', { branch: branchName });
          await git.checkout(branchName);
        } else if (remoteBranchExists) {
          // Only remote branch exists - create local tracking branch
          logger.log('PR', 'Creating local branch from remote', { branch: branchName });
          await git.checkout(['-b', branchName, `origin/${branchName}`]);
        } else {
          // No existing branch - create new one
          await git.checkoutLocalBranch(branchName);
        }
      } catch (branchError) {
        // If branch operations fail, log and rethrow
        logger.log('PR', 'Branch operation failed', {
          error: branchError instanceof Error ? branchError.message : String(branchError)
        });
        throw branchError;
      }
      await this.commitAndPush(
        git,
        branchName,
        `Fix issue #${issueContext.issueNumber}: ${issueContext.title}`,
        true // setUpstream for new branches
      );

      // Read PR summary if available
      const prSummary = await this.readPRSummary(issueContext.issueNumber);

      const repoInfo = await this.githubClient.getRepository();
      const prTitle = prSummary
        ? prSummary.split('\n')[0].trim()
        : `Fix issue #${issueContext.issueNumber}`;
      const prBody = this.generatePRBody(prSummary, solution, issueContext.issueNumber);

      const pullRequest = await this.githubClient.createPullRequest(
        prTitle,
        prBody,
        branchName,
        repoInfo.default_branch
      );

      await this.githubClient.createComment(
        parseInt(issueContext.issueNumber),
        `🔧 I've created a pull request with a potential fix: ${pullRequest.html_url}\n\n${solution}\n\n---\n🤖 Generated with [${this.strategy?.displayName || 'Clarity AI'}](https://claude.ai/code)`
      );

      return {
        message: `Pull request created successfully: ${pullRequest.html_url}`,
        prUrl: pullRequest.html_url,
        prNumber: pullRequest.number,
        prBranchName: branchName,
        summary: prSummary || undefined
      };
    }
  }

  /**
   * Commit and push changes to a branch.
   * Handles non-fast-forward scenarios by pulling with rebase before push.
   */
  private async commitAndPush(
    git: ReturnType<typeof simpleGit>,
    branchName: string,
    commitMessage: string,
    setUpstream: boolean = false
  ): Promise<void> {
    await git.add('.');
    await git.commit(commitMessage);

    // Try pull-rebase first to integrate any remote changes cleanly.
    // If it fails (new branch, or conflicts from a previous retry), we fall
    // back to --force-with-lease which is safe for isolated agent branches.
    let needsForce = false;
    try {
      await git.pull('origin', branchName, { '--rebase': 'true' });
      logger.log('PR', 'Pulled remote changes before push', { branch: branchName });
    } catch (pullError) {
      // Abort any in-progress rebase so the working tree is clean for push
      try { await git.rebase(['--abort']); } catch { /* no rebase in progress */ }
      needsForce = true;
      logger.log('PR', 'Pull-rebase failed, will force-push', {
        branch: branchName,
        reason: pullError instanceof Error ? pullError.message : String(pullError)
      });
    }

    const pushArgs = setUpstream ? ['--set-upstream'] : [];
    if (needsForce) pushArgs.push('--force-with-lease');

    await git.push('origin', branchName, pushArgs);
    logger.log('PR', 'Pushed to remote', { branch: branchName, forced: needsForce });
  }

  private async readPRSummary(issueNumber: string): Promise<string | null> {
    if (!this.workspaceDir) return null;

    const summaryPath = path.join(
      this.workspaceDir,
      'doc',
      'ai-task',
      `issue-${issueNumber}.md`
    );

    try {
      return (await fs.readFile(summaryPath, 'utf8')).trim();
    } catch {
      return null;
    }
  }

  private generatePRBody(
    prSummary: string | null,
    _solution: string,
    issueNumber: string
  ): string {
    let body = prSummary?.trim() || 'Automated fix generated by Clarity AI.';
    body += `\n\n---\nFixes #${issueNumber}\n\n🤖 This pull request was generated automatically by [Clarity AI](https://claude.ai/code) in response to the issue above.`;
    return body;
  }
}
