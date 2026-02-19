import { Octokit } from '@octokit/rest';
import { createLogger } from './logger.js';

// Create logger for this module
const logger = createLogger('GitHubClient');

export class ContainerGitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    this.octokit = new Octokit({
      auth: token,
      userAgent: 'Claude-Code-Container/1.0.0'
    });
    this.owner = owner;
    this.repo = repo;

    logger.log('GITHUB_CLIENT', 'GitHub client initialized', {
      owner,
      repo,
      hasToken: !!token
    });
  }

  // Create a comment on an issue or PR
  async createComment(issueNumber: number, body: string): Promise<void> {
    try {
      logger.log('GITHUB_CLIENT', 'Creating comment', {
        issueNumber,
        bodyLength: body.length
      });

      await this.octokit.rest.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body
      });

      logger.log('GITHUB_CLIENT', 'Comment created successfully', { issueNumber });
    } catch (error) {
      logger.log('GITHUB_CLIENT', 'Failed to create comment', {
        error: (error as Error).message,
        issueNumber
      });
      throw error;
    }
  }

  // Create a pull request
  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string = 'main'
  ): Promise<{ number: number; html_url: string }> {
    try {
      logger.log('GITHUB_CLIENT', 'Creating pull request', {
        title,
        head,
        base,
        bodyLength: body.length
      });

      const response = await this.octokit.rest.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title,
        body,
        head,
        base
      });

      logger.log('GITHUB_CLIENT', 'Pull request created successfully', {
        number: response.data.number,
        url: response.data.html_url
      });

      return {
        number: response.data.number,
        html_url: response.data.html_url
      };
    } catch (error) {
      // If a PR already exists for this branch (retry scenario), find and return it
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('A pull request already exists')) {
        logger.log('GITHUB_CLIENT', 'PR already exists, finding existing one', { head });
        try {
          const existing = await this.octokit.rest.pulls.list({
            owner: this.owner,
            repo: this.repo,
            head: `${this.owner}:${head}`,
            state: 'open',
            per_page: 1,
          });
          if (existing.data.length > 0) {
            const pr = existing.data[0];
            // Update the PR title and body with the latest attempt
            await this.octokit.rest.pulls.update({
              owner: this.owner,
              repo: this.repo,
              pull_number: pr.number,
              title,
              body,
            });
            logger.log('GITHUB_CLIENT', 'Updated existing PR', {
              number: pr.number,
              url: pr.html_url,
            });
            return { number: pr.number, html_url: pr.html_url };
          }
        } catch (listError) {
          logger.log('GITHUB_CLIENT', 'Failed to find existing PR', {
            error: (listError as Error).message,
          });
        }
      }
      logger.log('GITHUB_CLIENT', 'Failed to create pull request', {
        error: (error as Error).message,
        title,
        head,
        base
      });
      throw error;
    }
  }

  // Get repository information to determine default branch
  async getRepository(): Promise<{ default_branch: string }> {
    try {
      const response = await this.octokit.rest.repos.get({
        owner: this.owner,
        repo: this.repo
      });

      return {
        default_branch: response.data.default_branch
      };
    } catch (error) {
      logger.log('GITHUB_CLIENT', 'Failed to get repository info', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  // Get pull request details including the branch name
  async getPullRequest(prNumber: number): Promise<{ head_branch: string; title: string; body: string | null }> {
    try {
      logger.log('GITHUB_CLIENT', 'Getting pull request details', { prNumber });

      const response = await this.octokit.rest.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber
      });

      logger.log('GITHUB_CLIENT', 'Pull request details retrieved', {
        prNumber,
        headBranch: response.data.head.ref,
        title: response.data.title
      });

      return {
        head_branch: response.data.head.ref,
        title: response.data.title,
        body: response.data.body
      };
    } catch (error) {
      logger.log('GITHUB_CLIENT', 'Failed to get pull request details', {
        error: (error as Error).message,
        prNumber
      });
      throw error;
    }
  }

  // Push branch to remote
  async pushBranch(branchName: string): Promise<void> {
    // This will be handled by git operations in the main file
    // Just logging for now since we're using git commands directly
    logger.log('GITHUB_CLIENT', 'Branch push requested', { branchName });
  }
}