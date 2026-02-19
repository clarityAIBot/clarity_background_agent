export interface GitHubStatus {
  configured: boolean;
  repositoryCount?: number;
  repositories?: Repository[];
  appId?: string;
}

export interface ClaudeStatus {
  configured: boolean;
}

export interface LLMStatus {
  configured: boolean;
  providers: {
    anthropic: boolean;
    openai: boolean;
    google: boolean;
    groq: boolean;
    deepseek: boolean;
    mistral: boolean;
    together: boolean;
    fireworks: boolean;
  };
  updatedAt: string | null;
}

export interface LLMSetupRequest {
  anthropic_api_key?: string;
  openai_api_key?: string;
  google_api_key?: string;
  groq_api_key?: string;
  deepseek_api_key?: string;
  mistral_api_key?: string;
  together_api_key?: string;
  fireworks_api_key?: string;
}

export interface LLMSetupResponse {
  success: boolean;
  message: string;
  configuredProviders: string[];
}

export interface SlackStatus {
  configured: boolean;
}

export interface Repository {
  id: number;
  name: string;
  fullName: string;
}

export interface StatusResponse {
  installation?: {
    appId: string;
    repositoryCount: number;
    repositories: Repository[];
    owner?: { login: string; type: string };
    hasCredentials?: boolean;
    webhookCount?: number;
    lastWebhookAt?: string;
  };
  claude?: {
    configured: boolean;
  };
  slack?: {
    configured: boolean;
  };
}

// API calls with session authentication via cookies
async function fetchWithToken(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  // Always include credentials for session cookies
  return fetch(url, { ...options, headers, credentials: 'include' });
}

// Common response handler for JSON endpoints
async function handleJsonResponse<T>(res: Response, errorPrefix: string): Promise<T> {
  if (!res.ok) {
    if (res.status === 401) {
      // Session expired - redirect to login page
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
      throw new Error('Session expired');
    }
    const result = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || `${errorPrefix}`);
  }
  return res.json();
}

export async function getAllStatus(): Promise<StatusResponse> {
  const res = await fetchWithToken('/api/status');
  return handleJsonResponse(res, 'Failed to fetch status');
}

export async function getGitHubStatus(): Promise<GitHubStatus> {
  const status = await getAllStatus();
  return {
    configured: !!status.installation?.appId,
    repositoryCount: status.installation?.repositoryCount,
    repositories: status.installation?.repositories,
    appId: status.installation?.appId
  };
}

export async function getClaudeStatus(): Promise<ClaudeStatus> {
  const status = await getAllStatus();
  return {
    configured: !!status.claude?.configured
  };
}

export async function getSlackStatus(): Promise<SlackStatus> {
  const status = await getAllStatus();
  return {
    configured: !!status.slack?.configured
  };
}

export interface RequestHistoryItem {
  requestId: string;
  issueNumber: number | null;
  repositoryName: string | null;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  // Additional fields from FeatureRequest
  prUrl?: string | null;
  prNumber?: number | null;
  origin?: string;
  issueUrl?: string | null;
  // Slack deep link fields
  slackChannelId?: string | null;
  slackThreadTs?: string | null;
  // Agent configuration
  agentType?: 'claude-code' | 'opencode' | null;
  agentProvider?: 'anthropic' | 'openai' | 'google' | 'groq' | 'deepseek' | 'mistral' | 'together' | 'fireworks' | null;
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedHistoryResponse {
  history: RequestHistoryItem[];
  pagination: PaginationInfo;
}

export async function getRequestHistory(page: number = 1, pageSize: number = 100): Promise<PaginatedHistoryResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const res = await fetchWithToken(`/api/history?${params}`);
  return handleJsonResponse(res, 'Failed to fetch history');
}

export async function setClaudeApiKey(apiKey: string): Promise<{ success: boolean }> {
  const res = await fetchWithToken('/api/claude-setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anthropic_api_key: apiKey })
  });
  return handleJsonResponse(res, 'Failed to set API key');
}

// LLM Multi-Provider API functions
export async function getLLMStatus(): Promise<LLMStatus> {
  const res = await fetchWithToken('/api/llm-status');
  return handleJsonResponse(res, 'Failed to fetch LLM status');
}

export async function setLLMConfig(config: LLMSetupRequest): Promise<LLMSetupResponse> {
  const res = await fetchWithToken('/api/llm-setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  return handleJsonResponse(res, 'Failed to save LLM configuration');
}

export async function deleteLLMConfig(provider?: string): Promise<{ success: boolean; message: string }> {
  const url = provider
    ? `/api/llm-delete?provider=${encodeURIComponent(provider)}`
    : '/api/llm-delete';

  const res = await fetchWithToken(url, { method: 'DELETE' });
  return handleJsonResponse(res, 'Failed to delete LLM configuration');
}

export function getLLMSetupUrl(): string {
  return '/llm-setup';
}

export async function saveSlackCredentials(signingSecret: string, botToken: string): Promise<{ success: boolean }> {
  const res = await fetchWithToken('/api/slack-setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signing_secret: signingSecret,
      bot_token: botToken
    })
  });
  return handleJsonResponse(res, 'Failed to save credentials');
}

export function getGitHubSetupUrl(): string {
  return '/gh-setup';
}

export function getGitHubStatusUrl(): string {
  return '/gh-status';
}

export function getSlackSetupUrl(): string {
  return '/slack-setup';
}

export function getClaudeSetupUrl(): string {
  return '/claude-setup';
}

export function getSettingsUrl(): string {
  return '/settings';
}

// Endpoints info
export function getEndpoints(): { url: string; description: string }[] {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return [
    { url: `${origin}/webhooks/github`, description: 'GitHub webhook receiver' },
    { url: `${origin}/slack/command`, description: 'Slash command handler' },
    { url: `${origin}/slack/interactivity`, description: 'Modal & button handler' },
    { url: `${origin}/slack/events`, description: 'Thread reply handler' }
  ];
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface DeleteGitHubAppResponse {
  success: boolean;
  appId?: string;
  message: string;
}

export async function deleteGitHubApp(): Promise<DeleteGitHubAppResponse> {
  const res = await fetchWithToken('/api/gh-delete', { method: 'DELETE' });
  return handleJsonResponse(res, 'Failed to delete GitHub app');
}

export interface DeleteSlackConfigResponse {
  success: boolean;
  message: string;
}

// Auth Configuration types
export interface AuthConfig {
  allowedDomains?: string[];      // e.g., ['cleartax.in'] - empty = allow all
  allowedEmails?: string[];       // e.g., ['contractor@gmail.com'] - bypass domain check
  defaultPolicyId?: string;       // Default: 'developer'
}

// System Defaults types
export interface SystemDefaultsConfig {
  defaultAgentType: 'claude-code' | 'opencode';
  defaultAgentProvider: 'anthropic' | 'openai' | 'google' | 'groq' | 'deepseek' | 'mistral' | 'together' | 'fireworks';
  defaultAgentModel?: string;
  defaultRepository?: string;
  defaultBranch?: string;
  githubOrganizationName?: string;
  customDefaultPrompt?: string;
  auth?: AuthConfig;
}

export async function deleteSlackConfig(): Promise<DeleteSlackConfigResponse> {
  const res = await fetchWithToken('/api/slack-delete', { method: 'DELETE' });
  return handleJsonResponse(res, 'Failed to delete Slack configuration');
}

// System Defaults API functions
export async function getSystemDefaults(): Promise<SystemDefaultsConfig> {
  const res = await fetchWithToken('/api/config/system-defaults');
  return handleJsonResponse(res, 'Failed to fetch system defaults');
}

export async function updateSystemDefaults(config: Partial<SystemDefaultsConfig>): Promise<{ success: boolean }> {
  const res = await fetchWithToken('/api/config/system-defaults', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  return handleJsonResponse(res, 'Failed to save system defaults');
}

// Message types for task detail view
export type MessageType =
  | 'initial_request'
  | 'clarification_ask'
  | 'clarification_answer'
  | 'follow_up_request'
  | 'processing_started'
  | 'processing_update'
  | 'pr_created'
  | 'pr_updated'
  | 'error'
  | 'retry'
  | 'cancelled'
  | 'agent_thinking'
  | 'agent_tool_call'
  | 'agent_tool_result'
  | 'agent_file_change'
  | 'agent_terminal'
  | 'agent_summary';

export interface RequestMessage {
  id: number;
  requestId: string;
  type: MessageType;
  source: 'slack' | 'github' | 'web' | 'system';
  content: string;
  actorId: string | null;
  actorName: string | null;
  metadata: {
    slackTs?: string;
    slackThreadTs?: string;
    slackChannelId?: string;
    issueCommentId?: number;
    prCommentId?: number;
    commitSha?: string;
    durationMs?: number;
    costCents?: number;
    fromStatus?: string;
    toStatus?: string;
    errorCode?: string;
    errorMessage?: string;
    errorStack?: string;
    retryCount?: number;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolOutput?: string;
    toolDurationMs?: number;
    filePath?: string;
    fileAction?: 'created' | 'modified' | 'deleted';
    diffPreview?: string;
    command?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    turnNumber?: number;
    turnId?: string;
    triggeredBy?: 'slack' | 'github' | 'web';
  } | null;
  createdAt: string;
}

export interface RequestDetail {
  request: {
    requestId: string;
    origin: string;
    repo: string;
    title: string;
    description: string;
    status: string;
    slackUserId: string | null;
    slackUserName: string | null;
    slackChannelId: string | null;
    slackThreadTs: string | null;
    issueUrl: string | null;
    issueNumber: number | null;
    issueId: number | null;
    issueTitle: string | null;
    issueBody: string | null;
    issueLabels: string[] | null;
    issueAuthor: string | null;
    prUrl: string | null;
    prNumber: number | null;
    prBranchName: string | null;
    summary: string | null;
    totalDurationMs: number | null;
    totalCostCents: number | null;
    agentType: 'claude-code' | 'opencode' | null;
    agentProvider: 'anthropic' | 'openai' | 'google' | 'groq' | 'deepseek' | 'mistral' | 'together' | 'fireworks' | null;
    createdAt: string;
    updatedAt: string;
  };
  messages: RequestMessage[];
}

export async function getRequestDetail(requestId: string): Promise<RequestDetail> {
  const res = await fetchWithToken(`/api/requests/${requestId}`);
  if (res.status === 404) throw new Error('Request not found');
  return handleJsonResponse(res, 'Failed to fetch request detail');
}

// Session metadata for task detail view (lazy loaded)
export interface SessionMetadata {
  id: number;
  requestId: string;
  sessionId: string;
  agentType: 'claude-code' | 'opencode';
  blobSizeBytes: number;
  createdAt: string;
  expiresAt: string | null;
  blob?: string; // Base64-encoded gzipped session content (only when includeBlob=true)
}

export interface SessionResponse {
  hasSession: boolean;
  session: SessionMetadata | null;
}

// Generate signed handover URLs for curl/CLI download (valid 1 hour)
// Returns both markdown handover URL and session .jsonl URL (if session exists)
export interface HandoverUrlResponse {
  url: string;           // Markdown handover URL
  sessionUrl: string | null;  // Session .jsonl download URL (null if no session)
  sessionId: string | null;
  hasSession: boolean;
  expires: number;
}

export async function getHandoverUrl(requestId: string): Promise<HandoverUrlResponse> {
  const res = await fetchWithToken(`/api/requests/${requestId}/handover-url`, { method: 'POST' });
  return handleJsonResponse(res, 'Failed to generate handover URL');
}

// Get session metadata only (lightweight)
export async function getRequestSession(requestId: string): Promise<SessionResponse> {
  const res = await fetchWithToken(`/api/requests/${requestId}/session`);
  return handleJsonResponse(res, 'Failed to fetch session');
}

// Get session with blob content (heavier - use on demand)
export async function getRequestSessionWithBlob(requestId: string): Promise<SessionResponse> {
  const res = await fetchWithToken(`/api/requests/${requestId}/session?includeBlob=true`);
  return handleJsonResponse(res, 'Failed to fetch session content');
}

// ============================================
// Google SSO Authentication
// ============================================

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  pictureUrl: string | null;
  isSuperAdmin: boolean;
  status: 'active' | 'inactive' | 'suspended';
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthPolicy {
  policyId: string;
  statements: Array<{
    effect: 'allow' | 'deny';
    actions: string[];
    resources: string[];
  }>;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user?: AuthUser;
  policy?: AuthPolicy | null;
}

export interface AuthStatusResponse {
  googleOAuthConfigured: boolean;
  hasSession: boolean;
}

// Check if Google SSO is configured and if user has session
export async function getAuthStatus(): Promise<AuthStatusResponse> {
  const res = await fetch('/api/auth/status');
  return handleJsonResponse(res, 'Failed to fetch auth status');
}

// Get current authenticated user
export async function getAuthMe(): Promise<AuthMeResponse> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) {
    return { authenticated: false };
  }
  return handleJsonResponse(res, 'Failed to fetch user info');
}

// Start Google OAuth flow - redirect to Google
export function startGoogleLogin(returnUrl?: string): void {
  const url = returnUrl
    ? `/api/auth/google?return=${encodeURIComponent(returnUrl)}`
    : '/api/auth/google';
  window.location.href = url;
}

// Logout from Google SSO
export async function logoutGoogle(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include'
  });
}

// Refresh session
export async function refreshSession(): Promise<{ success: boolean }> {
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include'
  });
  return handleJsonResponse(res, 'Failed to refresh session');
}

// ============================================
// Users Management API
// ============================================

export interface User {
  id: string;
  email: string;
  name: string | null;
  pictureUrl: string | null;
  isSuperAdmin: boolean;
  status: 'active' | 'inactive';
  lastLoginAt: string | null;
  createdAt: string;
  policies?: UserPolicy[];
}

export interface UserPolicy {
  policyId: string;
  policyName: string;
  enabled: boolean;
  expiresAt: string | null;
}

export interface Policy {
  id: string;
  name: string;
  description: string | null;
  isBuiltIn: boolean;
  createdAt: string;
}

export interface UsersListResponse {
  users: User[];
  total: number;
}

export interface PoliciesListResponse {
  policies: Policy[];
  total: number;
}

export interface UserStats {
  total: number;
  active: number;
  inactive: number;
  superAdmins: number;
}

// Get all users with optional filters
export async function getUsers(params?: { search?: string; status?: 'active' | 'inactive' }): Promise<UsersListResponse> {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);
  if (params?.status) query.set('status', params.status);

  const url = query.toString() ? `/api/users?${query}` : '/api/users';
  const res = await fetchWithToken(url);
  return handleJsonResponse(res, 'Failed to fetch users');
}

// Get specific user by ID
export async function getUser(userId: string): Promise<{ user: User }> {
  const res = await fetchWithToken(`/api/users/${userId}`);
  return handleJsonResponse(res, 'Failed to fetch user');
}

// Update user status
export async function updateUserStatus(userId: string, status: 'active' | 'inactive'): Promise<{ success: boolean; user: User }> {
  const res = await fetchWithToken(`/api/users/${userId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  return handleJsonResponse(res, 'Failed to update user status');
}

// Grant or revoke super admin privileges
export async function updateUserSuperAdmin(userId: string, isSuperAdmin: boolean): Promise<{ success: boolean; user: User }> {
  const res = await fetchWithToken(`/api/users/${userId}/super-admin`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isSuperAdmin })
  });
  return handleJsonResponse(res, 'Failed to update super admin status');
}

// Assign policy to user
export async function assignPolicyToUser(
  userId: string,
  policyId: string,
  expiresAt?: string,
  createdBy?: string
): Promise<{ success: boolean; userPolicy: UserPolicy }> {
  const res = await fetchWithToken(`/api/users/${userId}/policies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ policyId, expiresAt, createdBy })
  });
  return handleJsonResponse(res, 'Failed to assign policy');
}

// Remove policy from user
export async function removePolicyFromUser(userId: string, policyId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetchWithToken(`/api/users/${userId}/policies/${policyId}`, {
    method: 'DELETE'
  });
  return handleJsonResponse(res, 'Failed to remove policy');
}

// Get user statistics
export async function getUserStats(): Promise<UserStats> {
  const res = await fetchWithToken('/api/users/stats');
  return handleJsonResponse(res, 'Failed to fetch user stats');
}

// Get all available policies
export async function getPolicies(): Promise<PoliciesListResponse> {
  const res = await fetchWithToken('/api/policies');
  return handleJsonResponse(res, 'Failed to fetch policies');
}
