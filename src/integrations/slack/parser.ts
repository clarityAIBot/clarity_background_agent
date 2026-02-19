/**
 * Parser for @clarity mention commands
 * Format: @clarity [options] prompt
 *
 * Options (all optional, comma-separated inside brackets):
 *   repo=owner/repo     Target repository
 *   branch=main         Base branch
 *   model=opus          AI model to use
 *   type=feature        Request type (feature, bug, refactor, docs, question)
 *
 * Special Keywords:
 *   agent               Force creation of a new agent (instead of follow-up)
 *
 * Examples:
 *   @clarity fix the login bug
 *   @clarity [repo=speak] add dark mode
 *   @clarity [repo=speak, branch=develop] refactor auth module
 *   @clarity [type=bug] fix the crash on login
 *   @clarity agent start fresh with a new approach   (forces new agent in thread)
 */

export interface ClarityCommandOptions {
  repo?: string;
  branch?: string;
  model?: string;
  type?: 'feature' | 'bug' | 'refactor' | 'docs' | 'question';
}

export interface ClarityCommand {
  options: ClarityCommandOptions;
  prompt: string;
  forceNewAgent: boolean; // True if user specified "agent" keyword to force new agent
}

/**
 * Parse a @clarity mention command from Slack message text
 *
 * @param text - The raw message text from Slack (includes <@BOT_ID> mention)
 * @returns Parsed command with options and prompt
 */
export function parseClarityCommand(text: string): ClarityCommand {
  // Remove @clarity mention (Slack format: <@U12345678>)
  // This handles the Slack user mention format
  const withoutMention = text.replace(/<@[A-Z0-9]+>/gi, '').trim();

  // Extract bracketed options [key=value, ...]
  const optionsMatch = withoutMention.match(/^\[(.*?)\]/);
  const options: ClarityCommandOptions = {};

  if (optionsMatch) {
    const optionsStr = optionsMatch[1];
    const validTypes = ['feature', 'bug', 'refactor', 'docs', 'question'];

    for (const pair of optionsStr.split(',')) {
      const [rawKey, rawValue] = pair.split('=').map(s => s.trim());
      const key = rawKey?.toLowerCase();
      const value = rawValue;

      if (!key || !value) continue;

      switch (key) {
        case 'repo':
          options.repo = value;
          break;
        case 'branch':
          options.branch = value;
          break;
        case 'model':
          options.model = value;
          break;
        case 'type':
          if (validTypes.includes(value.toLowerCase())) {
            options.type = value.toLowerCase() as ClarityCommandOptions['type'];
          }
          break;
      }
    }
  }

  // Everything after options is the prompt
  let prompt = optionsMatch
    ? withoutMention.slice(optionsMatch[0].length).trim()
    : withoutMention;

  // Check for "agent" keyword at the start to force new agent creation
  // Format: @clarity agent [options] prompt  OR  @clarity agent prompt
  let forceNewAgent = false;
  if (prompt.toLowerCase().startsWith('agent ')) {
    forceNewAgent = true;
    prompt = prompt.slice(6).trim(); // Remove "agent " prefix
  }

  return { options, prompt, forceNewAgent };
}

/**
 * Resolve repository name from various formats
 * - "speak" -> needs to match against available repos
 * - "owner/speak" -> full name
 * - "speak-app" -> needs to match against available repos
 *
 * @param repoInput - User-provided repo identifier
 * @param availableRepos - List of available repositories
 * @returns Full repository name (owner/repo) or undefined
 */
export function resolveRepository(
  repoInput: string | undefined,
  availableRepos: Array<{ name: string; fullName: string }>
): string | undefined {
  if (!repoInput) return undefined;

  // If already in owner/repo format, validate it exists
  if (repoInput.includes('/')) {
    const match = availableRepos.find(
      r => r.fullName.toLowerCase() === repoInput.toLowerCase()
    );
    return match?.fullName;
  }

  // Try to match by repo name only
  const match = availableRepos.find(
    r => r.name.toLowerCase() === repoInput.toLowerCase()
  );
  return match?.fullName;
}

/**
 * Extract a title from the prompt (first sentence or first N characters)
 *
 * @param prompt - The full prompt text
 * @param maxLength - Maximum title length (default 100)
 * @returns Extracted title
 */
export function extractTitle(prompt: string, maxLength: number = 100): string {
  // Try to get first sentence
  const sentenceMatch = prompt.match(/^[^.!?]+[.!?]?/);
  const firstSentence = sentenceMatch ? sentenceMatch[0].trim() : prompt;

  // Truncate if too long
  if (firstSentence.length > maxLength) {
    return firstSentence.substring(0, maxLength - 3) + '...';
  }

  return firstSentence;
}
