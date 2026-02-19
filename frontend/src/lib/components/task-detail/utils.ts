/**
 * Utility functions for TaskDetailView components
 */

import type { RequestDetail } from "$lib/api";

// Format duration
export function formatDuration(ms: number | null): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// Format cost
export function formatCost(cents: number | null): string {
  if (!cents) return "-";
  return `$${(cents / 100).toFixed(2)}`;
}

// Format relative time
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Get icon path for message type
export function getMessageIcon(type: string): string {
  const icons: Record<string, string> = {
    initial_request: "M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z",
    clarification_ask: "M8.5 19H3v-5.5L14.5 2 22 9.5z M15 6l6 6",
    clarification_answer: "M22 11.08V12a10 10 0 1 1-5.93-9.14",
    follow_up_request: "M12 2v10l4.24 4.24",
    processing_started: "M5 3l14 9-14 9V3z",
    processing_update: "M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z",
    pr_created: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    pr_updated: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    error: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
    retry: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
    cancelled: "M6 18L18 6M6 6l12 12",
    agent_thinking: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    agent_tool_call: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    agent_tool_result: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    agent_file_change: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    agent_terminal: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    agent_summary: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
  };
  return icons[type] || "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
}

// Get color class for message type
export function getMessageColor(type: string): string {
  const colors: Record<string, string> = {
    initial_request: "text-blue-400",
    clarification_ask: "text-amber-400",
    clarification_answer: "text-green-400",
    follow_up_request: "text-purple-400",
    processing_started: "text-cyan-400",
    processing_update: "text-cyan-300",
    pr_created: "text-green-500",
    pr_updated: "text-green-400",
    error: "text-red-500",
    retry: "text-orange-400",
    cancelled: "text-gray-400",
    agent_thinking: "text-violet-400",
    agent_tool_call: "text-indigo-400",
    agent_tool_result: "text-teal-400",
    agent_file_change: "text-yellow-400",
    agent_terminal: "text-emerald-400",
    agent_summary: "text-sky-400",
  };
  return colors[type] || "text-gray-400";
}

// Get background color class for message type
export function getMessageBgColor(type: string): string {
  const colors: Record<string, string> = {
    initial_request: "bg-blue-500/10 border-blue-500/20",
    clarification_ask: "bg-amber-500/10 border-amber-500/20",
    clarification_answer: "bg-green-500/10 border-green-500/20",
    follow_up_request: "bg-purple-500/10 border-purple-500/20",
    processing_started: "bg-cyan-500/10 border-cyan-500/20",
    processing_update: "bg-cyan-400/10 border-cyan-400/20",
    pr_created: "bg-green-500/10 border-green-500/20",
    pr_updated: "bg-green-400/10 border-green-400/20",
    error: "bg-red-500/10 border-red-500/20",
    retry: "bg-orange-500/10 border-orange-500/20",
    cancelled: "bg-gray-500/10 border-gray-500/20",
    agent_thinking: "bg-violet-500/10 border-violet-500/20",
    agent_tool_call: "bg-indigo-500/10 border-indigo-500/20",
    agent_tool_result: "bg-teal-500/10 border-teal-500/20",
    agent_file_change: "bg-yellow-500/10 border-yellow-500/20",
    agent_terminal: "bg-emerald-500/10 border-emerald-500/20",
    agent_summary: "bg-sky-500/10 border-sky-500/20",
  };
  return colors[type] || "bg-gray-500/10 border-gray-500/20";
}

// Format message type for display
export function formatMessageType(type: string): string {
  const labels: Record<string, string> = {
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
  return labels[type] || type;
}

// Check if message is an agent activity
export function isAgentActivity(type: string): boolean {
  return type.startsWith("agent_");
}

/**
 * Format the entire thread as an LLM-friendly prompt for task handover
 */
export function formatThreadForLLM(detail: RequestDetail): string {
  const req = detail.request;
  const lines: string[] = [];

  // Header with context
  lines.push("# Task Handover Context");
  lines.push("");
  lines.push("## Task Information");
  lines.push(`- **Repository**: ${req.repo}`);
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

  // Original request
  lines.push("## Original Request");
  lines.push("");
  lines.push(req.description || req.title || "No description provided");
  lines.push("");

  // Conversation thread
  lines.push("## Conversation Thread");
  lines.push("");

  for (const message of detail.messages) {
    const timestamp = new Date(message.createdAt).toISOString();
    const actor = message.actorName || message.source;
    const typeLabel = formatMessageType(message.type);

    lines.push(`### [${typeLabel}] ${actor} - ${timestamp}`);
    lines.push("");

    // Add content based on message type
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
      lines.push(message.metadata.toolOutput.substring(0, 2000));
      if (message.metadata.toolOutput.length > 2000) {
        lines.push("... (truncated)");
      }
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
        lines.push(message.metadata.stdout.substring(0, 1000));
        lines.push("```");
      }
      if (message.metadata.stderr) {
        lines.push("**Error**:");
        lines.push("```");
        lines.push(message.metadata.stderr.substring(0, 500));
        lines.push("```");
      }
    } else if (message.type === "error" && message.metadata?.errorMessage) {
      lines.push(`**Error**: ${message.metadata.errorMessage}`);
      if (message.metadata.errorStack) {
        lines.push("```");
        lines.push(message.metadata.errorStack.substring(0, 1000));
        lines.push("```");
      }
    } else {
      lines.push(message.content);
    }

    lines.push("");
  }

  // Instructions for the LLM
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
