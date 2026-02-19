/**
 * Integration tests for ClaudeCodeStrategy.
 *
 * These tests use the REAL Claude Agent SDK - no mocking.
 * Requires ANTHROPIC_API_KEY to be set.
 *
 * Run with: npm test -- --run claude-code.strategy.test.ts
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { ClaudeCodeStrategy } from '../src/agents/strategies/claude-code.strategy.js';
import type { AgentContext, AgentConfig, IssueContext } from '../src/agents/types.js';

// Skip tests if no API key
const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!hasApiKey)('ClaudeCodeStrategy - Real SDK Integration', () => {
  let strategy: ClaudeCodeStrategy;

  beforeAll(() => {
    strategy = new ClaudeCodeStrategy();
  });

  afterEach(async () => {
    await strategy.cleanup();
  });

  /**
   * Helper to create test context
   */
  function createTestContext(prompt: string, overrides: Partial<AgentContext> = {}): AgentContext {
    const config: AgentConfig = {
      type: 'claude-code',
      maxTurns: 3,
      timeout: 60000,
      ...overrides.config,
    };

    const issueContext: IssueContext = {
      issueId: 'test-123',
      issueNumber: '1',
      title: 'Test Issue',
      description: 'Test description',
      labels: ['test'],
      repositoryUrl: 'https://github.com/test/test',
      repositoryName: 'test/test',
      author: 'test-user',
      ...overrides.issueContext,
    };

    return {
      workspaceDir: process.cwd(),
      prompt,
      config,
      issueContext,
      githubToken: 'test-token',
      requestId: 'test-req-123',
      ...overrides,
    };
  }

  describe('Basic Execution', () => {
    it('should execute a simple prompt and return result', async () => {
      const context = createTestContext(
        'Respond with exactly: "Hello from test" - nothing else.'
      );

      const result = await strategy.execute(context);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
      expect(typeof result.message).toBe('string');
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.costUsd).toBeGreaterThanOrEqual(0);
      expect(result.metadata?.agent).toBe('claude-code');
    }, 60000); // 60s timeout for API call
  });

  describe('Session ID Capture (ADR-001 Phase 0)', () => {
    it('should capture session ID from SDK init message', async () => {
      const context = createTestContext(
        'Say "test" and nothing else.'
      );

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      // Session ID should be captured from init message
      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(result.sessionId!.length).toBeGreaterThan(0);

      console.log('Captured session ID:', result.sessionId);
    }, 60000);
  });

  describe('Progress Callbacks', () => {
    it('should emit progress events during execution', async () => {
      const progressEvents: Array<{ type: string; message?: string }> = [];

      const context = createTestContext(
        'Say "progress test" and nothing else.',
        {
          onProgress: (event) => {
            progressEvents.push({ type: event.type, message: event.message });
          },
        }
      );

      await strategy.execute(context);

      // Should have at least started and completed events
      const eventTypes = progressEvents.map(e => e.type);
      expect(eventTypes).toContain('started');
      expect(eventTypes).toContain('completed');

      console.log('Progress events:', eventTypes);
    }, 60000);
  });

  describe('Validation', () => {
    it('should validate context has required fields', async () => {
      const context = createTestContext('test prompt');
      const result = await strategy.validate(context);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail validation with empty prompt', async () => {
      const context = createTestContext('');
      const result = await strategy.validate(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Prompt is required');
    });
  });

  describe('Capabilities', () => {
    it('should return correct capabilities', () => {
      const capabilities = strategy.getCapabilities();

      expect(capabilities.supportsStreaming).toBe(false);
      expect(capabilities.supportsSessionManagement).toBe(true);  // ADR-001: Session management supported
      expect(capabilities.supportsSkills).toBe(true);             // Skills from user/project directories
      expect(capabilities.supportedProviders).toContain('anthropic');
      expect(capabilities.maxContextLength).toBe(200000);
    });
  });

  describe('Session Resumption (ADR-001)', () => {
    it('should capture session ID and use it for resumption', async () => {
      // Step 1: Execute first query and capture session ID
      const firstContext = createTestContext(
        'Remember: the secret number is 42. Respond with "Stored" only.'
      );

      const firstResult = await strategy.execute(firstContext);
      expect(firstResult.success).toBe(true);
      expect(firstResult.sessionId).toBeDefined();

      const capturedSessionId = firstResult.sessionId!;
      console.log('First execution - captured session ID:', capturedSessionId);

      // Step 2: Execute second query with resumeSessionId
      const secondContext = createTestContext(
        'What was the secret number I told you? Respond with just the number.',
        {
          resumeSessionId: capturedSessionId
        }
      );

      const secondResult = await strategy.execute(secondContext);
      expect(secondResult.success).toBe(true);

      // The resumed session should have context from the first execution
      console.log('Second execution result:', secondResult.message);

      // Session ID should be the same when resuming
      expect(secondResult.sessionId).toBe(capturedSessionId);
    }, 120000); // 120s timeout for two API calls
  });

  describe('Strategy Properties', () => {
    it('should have correct name and displayName', () => {
      expect(strategy.name).toBe('claude-code');
      expect(strategy.displayName).toBe('Claude Code');
    });

    it('supportsStreaming should return false', () => {
      expect(strategy.supportsStreaming()).toBe(false);
    });
  });
});

// Separate describe for tests that don't need API key
describe('ClaudeCodeStrategy - Unit Tests (No API)', () => {
  let strategy: ClaudeCodeStrategy;

  beforeAll(() => {
    strategy = new ClaudeCodeStrategy();
  });

  it('should validate missing API key', async () => {
    // Temporarily remove API key
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const context: AgentContext = {
        workspaceDir: '/tmp',
        prompt: 'test',
        config: { type: 'claude-code' },
        issueContext: {
          issueId: 'test',
          issueNumber: '1',
          title: 'Test',
          description: 'Test',
          labels: [],
          repositoryUrl: 'https://github.com/test/test',
          repositoryName: 'test/test',
          author: 'test',
        },
        githubToken: 'test',
      };

      const result = await strategy.validate(context);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('ANTHROPIC_API_KEY is required for Claude Code');
    } finally {
      // Restore API key
      if (originalKey) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    }
  });
});
