# ADR-002: Ralph Patterns for Autonomous Claude Code Execution

**Status**: Proposed
**Date**: 2026-01-12
**Author**: Engineering Team

## Context

### Problem Statement

Clarity AI currently runs Claude Code in containers to process GitHub issues and Slack feature requests. However, the current implementation lacks:

1. **Intelligent completion detection** - No structured way to know when Claude is "done" vs needs clarification
2. **Stuck loop prevention** - Claude can get stuck retrying the same failing approach
3. **Progress tracking** - Limited visibility into what Claude accomplished each iteration
4. **Session continuity** - Each execution starts fresh without context from previous attempts
5. **Error pattern detection** - No mechanism to detect repeated failures

### Reference Implementation

We studied [Ralph for Claude Code](https://github.com/frankbria/ralph-claude-code), an autonomous development loop wrapper that solves these problems through:
- Structured status reporting
- Circuit breaker pattern
- Response analysis
- Session continuity
- Multi-signal exit detection

### Business Drivers

- **Reduced failures**: Detect stuck loops before wasting compute time
- **Better UX**: Clearer signals when clarification is needed vs work is complete
- **Cost efficiency**: Stop processing when no progress is being made
- **Reliability**: Graceful handling of errors with intelligent retry logic

## Decision

We will adapt key patterns from Ralph for Claude Code to Clarity AI's Cloudflare Workers/Containers architecture.

### Patterns to Adapt

#### 1. Structured Status Reporting (CLARITY_STATUS Block)

Modify the Claude Code prompt to request structured output at the end of each execution:

```
---CLARITY_STATUS---
STATUS: IN_PROGRESS | COMPLETE | NEEDS_CLARIFICATION | BLOCKED
EXIT_SIGNAL: false | true
FILES_MODIFIED: <number>
PR_READY: false | true
CLARIFICATION_NEEDED: false | true
CLARIFICATION_QUESTIONS: <questions if needed>
WORK_SUMMARY: <one line summary>
RECOMMENDATION: <next action>
---END_CLARITY_STATUS---
```

**Key Fields**:
| Field | Values | Purpose |
|-------|--------|---------|
| STATUS | IN_PROGRESS, COMPLETE, NEEDS_CLARIFICATION, BLOCKED | Current state |
| EXIT_SIGNAL | true/false | Should processing stop |
| PR_READY | true/false | Is a PR ready to create |
| CLARIFICATION_NEEDED | true/false | Does Claude need more info |
| CLARIFICATION_QUESTIONS | String | Questions to ask user |

#### 2. Circuit Breaker Pattern

Implement a state machine to prevent infinite loops:

```
CLOSED ──(no progress ≥2 loops)──> HALF_OPEN
  ▲                                    │
  └─(progress detected)─────────────────

HALF_OPEN ──(no progress ≥3 loops)──> OPEN
  ▲                                     │
  └─(progress detected)──────────────────

OPEN ──(manual reset / new request)──> CLOSED
```

**State stored in FeatureRequestDO**:
```typescript
interface CircuitBreakerState {
  state: 'CLOSED' | 'HALF_OPEN' | 'OPEN';
  lastChangeAt: string;
  consecutiveNoProgress: number;
  consecutiveSameError: number;
  lastProgressLoop: number;
  totalOpens: number;
  reason: string;
  currentLoop: number;
}
```

#### 3. Response Analyzer

Parse Claude's output to extract signals:

```typescript
interface AnalysisResult {
  hasCompletionSignal: boolean;
  needsClarification: boolean;
  isStuck: boolean;
  hasProgress: boolean;
  filesModified: number;
  prReady: boolean;
  confidenceScore: number;
  exitSignal: boolean;
  workSummary: string;
  clarificationQuestions?: string;
}
```

**Detection Patterns**:
- Completion: "done", "complete", "finished", "ready for review"
- Clarification: "need more information", "unclear", "please clarify"
- Stuck: Same error appearing 3+ times
- No progress: Zero files modified for 2+ loops

#### 4. Two-Stage Error Detection

Prevent false positives in error detection:

```typescript
function detectErrors(output: string): string[] {
  // Stage 1: Filter JSON field patterns (avoid "is_error": false)
  const filtered = output
    .split('\n')
    .filter(line => !/"[^"]*error[^"]*":/.test(line));

  // Stage 2: Match actual error contexts
  const errorPattern = /^(Error:|ERROR:|error:|\]: error|Exception|Fatal|FATAL)/;
  return filtered.filter(line => errorPattern.test(line));
}
```

#### 5. Session Continuity (Optional - Phase 2)

Use Claude Code's `--continue` flag with session ID persistence:

```typescript
interface SessionState {
  sessionId: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string; // 24 hours default
}
```

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CLARITY AI WITH RALPH PATTERNS                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────┐                      ┌──────────────────────────────────────┐  │
│  │   Slack /   │                      │  Cloudflare Worker                    │  │
│  │   GitHub    │─────────────────────▶│                                      │  │
│  │   Request   │                      │  ┌────────────────────────────────┐  │  │
│  └─────────────┘                      │  │  FeatureRequestDO              │  │  │
│                                       │  │  ┌────────────────────────────┐│  │  │
│                                       │  │  │ circuit_breaker_state     ││  │  │
│                                       │  │  │ - state: CLOSED           ││  │  │
│                                       │  │  │ - consecutive_no_progress ││  │  │
│                                       │  │  │ - consecutive_same_error  ││  │  │
│                                       │  │  └────────────────────────────┘│  │  │
│                                       │  │  ┌────────────────────────────┐│  │  │
│                                       │  │  │ loop_history (last 5)     ││  │  │
│                                       │  │  │ - files_modified          ││  │  │
│                                       │  │  │ - errors_detected         ││  │  │
│                                       │  │  │ - status_block            ││  │  │
│                                       │  │  └────────────────────────────┘│  │  │
│                                       │  └────────────────────────────────┘  │  │
│                                       │                                      │  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│  │
│  │                         CONTAINER EXECUTION FLOW                         ││  │
│  │                                                                          ││  │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐  ││  │
│  │  │ 1. Check     │    │ 2. Execute   │    │ 3. Analyze Response     │  ││  │
│  │  │ Circuit      │───▶│ Claude Code  │───▶│ - Parse CLARITY_STATUS  │  ││  │
│  │  │ Breaker      │    │ with prompt  │    │ - Detect errors         │  ││  │
│  │  └──────────────┘    └──────────────┘    │ - Calculate progress    │  ││  │
│  │         │                                └──────────────────────────┘  ││  │
│  │         │                                           │                   ││  │
│  │         │                                           ▼                   ││  │
│  │         │                                ┌──────────────────────────┐  ││  │
│  │         │                                │ 4. Update Circuit State  │  ││  │
│  │         │                                │ - Record progress        │  ││  │
│  │         │                                │ - Check transitions      │  ││  │
│  │         │                                └──────────────────────────┘  ││  │
│  │         │                                           │                   ││  │
│  │         ▼                                           ▼                   ││  │
│  │  ┌───────────────────────────────────────────────────────────────────┐ ││  │
│  │  │                    EXIT DECISION                                   │ ││  │
│  │  │  COMPLETE: EXIT_SIGNAL=true OR PR_READY=true                      │ ││  │
│  │  │  CLARIFY:  CLARIFICATION_NEEDED=true → Send to Slack/GitHub       │ ││  │
│  │  │  RETRY:    Still making progress → Continue loop                  │ ││  │
│  │  │  HALT:     Circuit breaker OPEN → Stop with error                 │ ││  │
│  │  └───────────────────────────────────────────────────────────────────┘ ││  │
│  └──────────────────────────────────────────────────────────────────────────┘│  │
│                                                                                │  │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Implementation Components

#### Component 1: Update Claude Code Prompt

Add structured status reporting to `container_src/src/prompts/issue_processor.md`:

```markdown
## Status Reporting (CRITICAL)

At the END of your response, you MUST include this status block:

\`\`\`
---CLARITY_STATUS---
STATUS: <IN_PROGRESS|COMPLETE|NEEDS_CLARIFICATION|BLOCKED>
EXIT_SIGNAL: <true|false>
FILES_MODIFIED: <number>
PR_READY: <true|false>
CLARIFICATION_NEEDED: <true|false>
CLARIFICATION_QUESTIONS: <questions if CLARIFICATION_NEEDED is true>
WORK_SUMMARY: <one line summary of what you did>
RECOMMENDATION: <what should happen next>
---END_CLARITY_STATUS---
\`\`\`

### When to use each STATUS:
- **COMPLETE**: All requirements implemented, tests pass, PR ready
- **NEEDS_CLARIFICATION**: Requirements unclear, need user input
- **BLOCKED**: Cannot proceed (missing dependencies, permissions, etc.)
- **IN_PROGRESS**: Making progress but not done yet

### When to set EXIT_SIGNAL=true:
1. STATUS is COMPLETE and PR is ready
2. STATUS is NEEDS_CLARIFICATION (need user input to continue)
3. STATUS is BLOCKED (cannot proceed without external action)
```

#### Component 2: Response Analyzer (container_src/src/responseAnalyzer.ts)

```typescript
export interface ClarityStatus {
  status: 'IN_PROGRESS' | 'COMPLETE' | 'NEEDS_CLARIFICATION' | 'BLOCKED';
  exitSignal: boolean;
  filesModified: number;
  prReady: boolean;
  clarificationNeeded: boolean;
  clarificationQuestions?: string;
  workSummary: string;
  recommendation: string;
}

export interface AnalysisResult {
  clarityStatus: ClarityStatus | null;
  hasStatusBlock: boolean;
  detectedErrors: string[];
  completionKeywords: string[];
  clarificationKeywords: string[];
  confidenceScore: number;
}

export function analyzeResponse(output: string): AnalysisResult {
  const result: AnalysisResult = {
    clarityStatus: null,
    hasStatusBlock: false,
    detectedErrors: [],
    completionKeywords: [],
    clarificationKeywords: [],
    confidenceScore: 0,
  };

  // 1. Parse structured status block
  const statusMatch = output.match(/---CLARITY_STATUS---([\s\S]*?)---END_CLARITY_STATUS---/);
  if (statusMatch) {
    result.hasStatusBlock = true;
    result.clarityStatus = parseStatusBlock(statusMatch[1]);
    result.confidenceScore += 50; // High confidence from structured output
  }

  // 2. Detect errors (two-stage filtering)
  result.detectedErrors = detectErrors(output);

  // 3. Scan for completion keywords
  const completionKeywords = ['done', 'complete', 'finished', 'ready for review', 'pr created'];
  result.completionKeywords = completionKeywords.filter(kw =>
    output.toLowerCase().includes(kw)
  );
  result.confidenceScore += result.completionKeywords.length * 10;

  // 4. Scan for clarification keywords
  const clarificationKeywords = ['need more information', 'unclear', 'please clarify', 'which option'];
  result.clarificationKeywords = clarificationKeywords.filter(kw =>
    output.toLowerCase().includes(kw)
  );

  return result;
}

function parseStatusBlock(block: string): ClarityStatus {
  const getValue = (key: string): string => {
    const match = block.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
    return match ? match[1].trim() : '';
  };

  return {
    status: getValue('STATUS') as ClarityStatus['status'] || 'IN_PROGRESS',
    exitSignal: getValue('EXIT_SIGNAL').toLowerCase() === 'true',
    filesModified: parseInt(getValue('FILES_MODIFIED')) || 0,
    prReady: getValue('PR_READY').toLowerCase() === 'true',
    clarificationNeeded: getValue('CLARIFICATION_NEEDED').toLowerCase() === 'true',
    clarificationQuestions: getValue('CLARIFICATION_QUESTIONS') || undefined,
    workSummary: getValue('WORK_SUMMARY'),
    recommendation: getValue('RECOMMENDATION'),
  };
}

function detectErrors(output: string): string[] {
  // Stage 1: Filter JSON field patterns
  const lines = output.split('\n').filter(line =>
    !/"[^"]*error[^"]*":/.test(line)
  );

  // Stage 2: Match actual error contexts
  const errorPattern = /^(Error:|ERROR:|error:|\]: error|Exception|Fatal|FATAL|failed:|FAILED)/i;
  return lines.filter(line => errorPattern.test(line.trim()));
}
```

#### Component 3: Circuit Breaker (container_src/src/circuitBreaker.ts)

```typescript
export interface CircuitBreakerState {
  state: 'CLOSED' | 'HALF_OPEN' | 'OPEN';
  lastChangeAt: string;
  consecutiveNoProgress: number;
  consecutiveSameError: number;
  lastProgressLoop: number;
  totalOpens: number;
  reason: string;
  currentLoop: number;
  errorHistory: string[]; // Last 5 error patterns
}

export const DEFAULT_CIRCUIT_STATE: CircuitBreakerState = {
  state: 'CLOSED',
  lastChangeAt: new Date().toISOString(),
  consecutiveNoProgress: 0,
  consecutiveSameError: 0,
  lastProgressLoop: 0,
  totalOpens: 0,
  reason: 'Initial state',
  currentLoop: 0,
  errorHistory: [],
};

// Thresholds
const NO_PROGRESS_THRESHOLD_CLOSED = 2;
const NO_PROGRESS_THRESHOLD_HALF_OPEN = 3;
const SAME_ERROR_THRESHOLD = 5;

export function updateCircuitBreaker(
  state: CircuitBreakerState,
  analysis: AnalysisResult
): CircuitBreakerState {
  const newState = { ...state };
  newState.currentLoop += 1;

  // Check for progress
  const hasProgress =
    (analysis.clarityStatus?.filesModified ?? 0) > 0 ||
    analysis.clarityStatus?.prReady === true;

  // Check for repeated errors
  const currentErrors = analysis.detectedErrors.join('|');
  const isSameError = newState.errorHistory.length > 0 &&
    newState.errorHistory[newState.errorHistory.length - 1] === currentErrors;

  // Update error history (keep last 5)
  if (currentErrors) {
    newState.errorHistory = [...newState.errorHistory.slice(-4), currentErrors];
  }

  // Update counters
  if (hasProgress) {
    newState.consecutiveNoProgress = 0;
    newState.consecutiveSameError = 0;
    newState.lastProgressLoop = newState.currentLoop;
  } else {
    newState.consecutiveNoProgress += 1;
  }

  if (isSameError && currentErrors) {
    newState.consecutiveSameError += 1;
  } else if (!isSameError) {
    newState.consecutiveSameError = 0;
  }

  // State transitions
  switch (state.state) {
    case 'CLOSED':
      if (newState.consecutiveNoProgress >= NO_PROGRESS_THRESHOLD_CLOSED) {
        newState.state = 'HALF_OPEN';
        newState.reason = `No progress for ${newState.consecutiveNoProgress} loops`;
        newState.lastChangeAt = new Date().toISOString();
      }
      if (newState.consecutiveSameError >= SAME_ERROR_THRESHOLD) {
        newState.state = 'OPEN';
        newState.reason = `Same error repeated ${newState.consecutiveSameError} times`;
        newState.lastChangeAt = new Date().toISOString();
        newState.totalOpens += 1;
      }
      break;

    case 'HALF_OPEN':
      if (hasProgress) {
        newState.state = 'CLOSED';
        newState.reason = 'Progress detected, recovering';
        newState.lastChangeAt = new Date().toISOString();
      } else if (newState.consecutiveNoProgress >= NO_PROGRESS_THRESHOLD_HALF_OPEN) {
        newState.state = 'OPEN';
        newState.reason = `No progress for ${newState.consecutiveNoProgress} loops`;
        newState.lastChangeAt = new Date().toISOString();
        newState.totalOpens += 1;
      }
      break;

    case 'OPEN':
      // Stays open until manual reset or new request
      break;
  }

  return newState;
}

export function shouldHalt(state: CircuitBreakerState): boolean {
  return state.state === 'OPEN';
}

export function resetCircuitBreaker(): CircuitBreakerState {
  return {
    ...DEFAULT_CIRCUIT_STATE,
    lastChangeAt: new Date().toISOString(),
    reason: 'Manual reset',
  };
}
```

#### Component 4: Integration in Container Main (container_src/src/main.ts)

```typescript
// In processIssue function, after Claude Code execution:

import { analyzeResponse, AnalysisResult } from './responseAnalyzer';
import {
  CircuitBreakerState,
  updateCircuitBreaker,
  shouldHalt,
  DEFAULT_CIRCUIT_STATE
} from './circuitBreaker';

async function processWithCircuitBreaker(
  claudeOutput: string,
  currentState: CircuitBreakerState
): Promise<{
  analysis: AnalysisResult;
  circuitState: CircuitBreakerState;
  action: 'CONTINUE' | 'HALT' | 'CLARIFY' | 'COMPLETE';
}> {
  // Analyze Claude's response
  const analysis = analyzeResponse(claudeOutput);

  // Update circuit breaker
  const newCircuitState = updateCircuitBreaker(currentState, analysis);

  // Determine action
  let action: 'CONTINUE' | 'HALT' | 'CLARIFY' | 'COMPLETE';

  if (shouldHalt(newCircuitState)) {
    action = 'HALT';
  } else if (analysis.clarityStatus?.clarificationNeeded) {
    action = 'CLARIFY';
  } else if (analysis.clarityStatus?.prReady || analysis.clarityStatus?.status === 'COMPLETE') {
    action = 'COMPLETE';
  } else {
    action = 'CONTINUE';
  }

  return { analysis, circuitState: newCircuitState, action };
}
```

#### Component 5: FeatureRequestDO Updates

Add circuit breaker state to the Durable Object:

```typescript
// In src/durable_objects/feature_request.ts

interface FeatureRequest {
  // ... existing fields ...

  // Circuit breaker state
  circuitBreakerState?: string; // JSON stringified CircuitBreakerState
  loopHistory?: string; // JSON stringified array of loop results
}

// Add methods:
async updateCircuitState(state: CircuitBreakerState): Promise<void>
async getCircuitState(): Promise<CircuitBreakerState>
async addLoopResult(result: LoopResult): Promise<void>
async getLoopHistory(): Promise<LoopResult[]>
```

### Implementation Phases

#### Phase 1: Structured Status Reporting (High Priority)
1. Update `issue_processor.md` prompt with CLARITY_STATUS block
2. Implement `responseAnalyzer.ts` in container
3. Parse status block in container main
4. Use status to determine clarification vs completion

**Deliverables**: Better clarification detection, cleaner exit conditions

#### Phase 2: Circuit Breaker (High Priority)
1. Implement `circuitBreaker.ts` in container
2. Add circuit state to FeatureRequestDO
3. Integrate circuit breaker check in processing loop
4. Add logging for state transitions

**Deliverables**: Stuck loop prevention, better error handling

#### Phase 3: Response Analysis Enhancements (Medium Priority)
1. Add two-stage error detection
2. Implement confidence scoring
3. Add loop history tracking
4. Improve clarification question extraction

**Deliverables**: More accurate progress detection, better error patterns

#### Phase 4: Session Continuity (Low Priority - Future)
1. Implement session state in FeatureRequestDO
2. Use `--continue` flag with Claude Code CLI
3. Add session expiration (24 hours)
4. Auto-reset on circuit breaker open

**Deliverables**: Better context preservation across retries

## Consequences

### Positive

- **Reduced stuck loops**: Circuit breaker prevents infinite retries
- **Better UX**: Clearer signals for clarification vs completion
- **Cost savings**: Stop processing when no progress is made
- **Debugging**: Loop history and circuit state aid troubleshooting
- **Reliability**: Structured output parsing is more robust than keyword scanning

### Negative

- **Prompt complexity**: Claude Code prompt gets longer with status instructions
- **False positives**: May exit early if status block parsing fails
- **Migration**: Existing requests won't have circuit breaker state

### Neutral

- **Compute overhead**: Analysis adds minimal processing time
- **Storage**: Circuit state adds ~1KB per request

## Alternatives Considered

### Option 1: Time-based Timeout Only
Simply timeout after N minutes regardless of progress.

**Pros**: Simple to implement
**Cons**: Wastes time on stuck loops, exits too early on complex tasks

### Option 2: Retry Count Only
Retry N times then fail.

**Pros**: Simple, predictable
**Cons**: No intelligence about progress vs stuck

### Option 3: Full Ralph Loop (Not Selected)
Run multiple Claude Code iterations in a loop within the container.

**Pros**: Full autonomous development capability
**Cons**: Too complex for current use case, longer execution times

## References

- [Ralph for Claude Code](https://github.com/frankbria/ralph-claude-code)
- [Circuit Breaker Pattern (Michael Nygard)](https://martinfowler.com/bliki/CircuitBreaker.html)
- [ADR-001: Slack to GitHub Bridge](./ADR-001-slack-to-github-actions-bridge.md)
