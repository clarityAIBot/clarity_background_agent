/**
 * Server-side task handover formatter.
 * Generates LLM-friendly markdown from a request + messages for local Claude Code usage.
 */

interface RequestMessage {
  type: string;
  source: string;
  content: string;
  actorName?: string | null;
  createdAt: Date | string;
  metadata?: Record<string, any> | null;
}

interface RequestWithMessages {
  request: {
    requestId: string;
    repo?: string | null;
    repositoryName?: string | null;
    title?: string | null;
    description?: string | null;
    status: string;
    issueNumber?: number | null;
    issueUrl?: string | null;
    prNumber?: number | null;
    prUrl?: string | null;
    createdAt: Date | string;
  };
  messages: RequestMessage[];
}

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  initial_request: "Request",
  clarification_ask: "Clarification Needed",
  clarification_answer: "Response",
  follow_up_request: "Follow-up",
  processing_started: "Started",
  processing_update: "Update",
  pr_created: "PR Created",
  pr_updated: "PR Updated",
  error: "Error",
  retry: "Retry",
  cancelled: "Cancelled",
  agent_thinking: "Thinking",
  agent_tool_call: "Tool Call",
  agent_tool_result: "Tool Result",
  agent_file_change: "File Change",
  agent_terminal: "Terminal",
  agent_summary: "Summary",
};

export function formatThreadForLLM(detail: RequestWithMessages): string {
  const req = detail.request;
  const repo = req.repo || req.repositoryName || "unknown";
  const lines: string[] = [];

  lines.push("# Task Handover Context");
  lines.push("");
  lines.push("## Task Information");
  lines.push(`- **Repository**: ${repo}`);
  lines.push(`- **Request ID**: ${req.requestId}`);
  if (req.issueNumber) {
    lines.push(`- **Issue**: #${req.issueNumber}${req.issueUrl ? ` (${req.issueUrl})` : ""}`);
  }
  if (req.prNumber) {
    lines.push(`- **Pull Request**: #${req.prNumber}${req.prUrl ? ` (${req.prUrl})` : ""}`);
  }
  lines.push(`- **Status**: ${req.status}`);
  lines.push(`- **Created**: ${new Date(req.createdAt).toISOString()}`);
  lines.push("");

  lines.push("## Original Request");
  lines.push("");
  lines.push(req.description || req.title || "No description provided");
  lines.push("");

  lines.push("## Conversation Thread");
  lines.push("");

  for (const message of detail.messages) {
    const timestamp = new Date(message.createdAt).toISOString();
    const actor = message.actorName || message.source;
    const typeLabel = MESSAGE_TYPE_LABELS[message.type] || message.type;

    lines.push(`### [${typeLabel}] ${actor} - ${timestamp}`);
    lines.push("");

    if (message.type === "agent_tool_call" && message.metadata?.toolName) {
      lines.push(`**Tool**: ${message.metadata.toolName}`);
      if (message.metadata.toolInput) {
        lines.push("**Input**:");
        lines.push("```json");
        lines.push(JSON.stringify(message.metadata.toolInput, null, 2));
        lines.push("```");
      }
    } else if (message.type === "agent_tool_result" && message.metadata?.toolOutput) {
      lines.push("**Output**:");
      lines.push("```");
      const output = String(message.metadata.toolOutput);
      lines.push(output.substring(0, 2000));
      if (output.length > 2000) lines.push("... (truncated)");
      lines.push("```");
    } else if (message.type === "agent_file_change" && message.metadata?.filePath) {
      lines.push(`**File**: ${message.metadata.filePath}`);
      lines.push(`**Action**: ${message.metadata.fileAction || "modified"}`);
      if (message.metadata.diffPreview) {
        lines.push("**Diff**:");
        lines.push("```diff");
        lines.push(message.metadata.diffPreview);
        lines.push("```");
      }
    } else if (message.type === "agent_terminal" && message.metadata?.command) {
      lines.push(`**Command**: \`${message.metadata.command}\``);
      if (message.metadata.stdout) {
        lines.push("**Output**:");
        lines.push("```");
        lines.push(String(message.metadata.stdout).substring(0, 1000));
        lines.push("```");
      }
      if (message.metadata.stderr) {
        lines.push("**Error**:");
        lines.push("```");
        lines.push(String(message.metadata.stderr).substring(0, 500));
        lines.push("```");
      }
    } else if (message.type === "error" && message.metadata?.errorMessage) {
      lines.push(`**Error**: ${message.metadata.errorMessage}`);
      if (message.metadata.errorStack) {
        lines.push("```");
        lines.push(String(message.metadata.errorStack).substring(0, 1000));
        lines.push("```");
      }
    } else {
      lines.push(message.content);
    }

    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Instructions");
  lines.push("");
  lines.push("Please continue working on this task. Review the conversation above to understand the context, what has been done, and what still needs to be completed.");
  if (req.status === "error") {
    lines.push("");
    lines.push("**Note**: The previous attempt resulted in an error. Please investigate and fix the issue.");
  } else if (req.status === "pr_created") {
    lines.push("");
    lines.push("**Note**: A PR has been created. Review the changes and complete any remaining work or requested modifications.");
  }

  return lines.join("\n");
}
