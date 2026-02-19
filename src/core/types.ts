import { Container } from '@cloudflare/containers';

// Hyperdrive binding type
export interface Hyperdrive {
  connectionString: string;
}

// Database environment bindings (for handlers that need DB access)
export interface DbEnv {
  HYPERDRIVE: Hyperdrive;
  ENCRYPTION_KEY?: string;
}

// Full environment bindings for handlers
export interface Env {
  // Database
  HYPERDRIVE: Hyperdrive;
  ENCRYPTION_KEY?: string;

  // Cloudflare bindings
  MY_CONTAINER: DurableObjectNamespace<Container<unknown>>;
  ISSUE_QUEUE: Queue<any>;
  ASSETS: Fetcher;

  // Secrets
  SETUP_SECRET?: string;
  SLACK_SIGNING_SECRET?: string;
  GITHUB_ORG?: string;
  CLARITY_ENDPOINT?: string;

  // Google OAuth (for SSO)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  // JWT signing secret (for session tokens)
  JWT_SECRET?: string;
}

// GitHub App Manifest Template
export interface GitHubAppManifest {
  name: string;
  url: string;
  hook_attributes: {
    url: string;
  };
  redirect_url: string;
  callback_urls: string[];
  setup_url: string;
  public: boolean;
  default_permissions: {
    contents: string;
    metadata: string;
    pull_requests: string;
    issues: string;
  };
  default_events: string[];
}

// GitHub App Data Response
export interface GitHubAppData {
  id: number;
  name: string;
  html_url: string;
  owner?: {
    login: string;
  };
  pem: string;
  webhook_secret: string;
}

// Storage Interfaces for Phase 2
export interface Repository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
}

export interface GitHubAppConfig {
  appId: string;
  privateKey: string; // encrypted
  webhookSecret: string; // encrypted
  installationId?: string;
  repositories: Repository[];
  owner: {
    login: string;
    type: "User" | "Organization";
    id: number;
  };
  permissions: {
    contents: string;
    metadata: string;
    pull_requests: string;
    issues: string;
  };
  events: string[];
  createdAt: string;
  lastWebhookAt?: string;
  webhookCount: number;
  // Claude Code integration
  anthropicApiKey?: string; // encrypted
  claudeSetupAt?: string;
}
