# ADR-005: Google SSO Login and IAM-Style Policy Authorization

**Status**: Mostly Implemented
**Date**: 2026-01-16
**Updated**: 2026-01-22
**Author**: Engineering Team

## Implementation Status

### Completed
- [x] `system_defaults` config type added to `configTypeEnum` in `src/db/schema.ts`
- [x] `SystemDefaultsConfig` interface implemented with agent/repository defaults:
  - `defaultAgentType`, `defaultAgentProvider`, `defaultAgentModel`
  - `defaultRepository`, `defaultBranch`
  - `githubOrganizationName`
  - `customDefaultPrompt`
- [x] `agentTypeEnum` and `agentProviderEnum` implemented for multi-agent support
- [x] Agent configuration fields added to `featureRequests` table (`agentType`, `agentProvider`, `agentModel`, `agentSessionId`)
- [x] Config API routes for managing `system_defaults` (`/api/config/*`)
- [x] `AuthConfig` interface added to `SystemDefaultsConfig`:
  - `auth.allowedDomains` - restrict login to specific Google Workspace domains
  - `auth.allowedEmails` - allow specific email addresses (bypass domain check)
  - `auth.defaultPolicyId` - default policy for new users (defaults to 'developer')
- [x] Auth Settings UI added to `/settings` page (with "Coming Soon" badge)

- [x] Database schema for auth tables in `src/db/schema.ts`:
  - `users` table with email, googleId, oauthTokens (JSONB), isSuperAdmin, status
  - `policies` table with IAM-style PolicyDocument (JSONB)
  - `userPolicies` table for user-to-policy assignments
  - `policyVersions` table for audit trail
  - `sessions` table for JWT token tracking
  - `OAuthTokens` interface for multi-provider token storage
  - `DEFAULT_POLICIES` constant with super_admin, admin, developer policies
- [x] `AuthService` class in `src/services/auth-service.ts`:
  - Google OAuth token exchange (`exchangeCodeForTokens`)
  - Token refresh (`refreshAccessToken`)
  - User info retrieval (`getGoogleUserInfo`)
  - Domain/email restriction check (`isUserAllowed`)
  - First user detection (`isFirstUser`)
  - User find/create with policy assignment (`findOrCreateUser`)
  - JWT session creation/verification (`createSession`, `verifySession`)
  - Session logout (`logout`)
  - Auto-refresh Google access tokens (`getGoogleAccessToken`)
- [x] Auth API routes in `src/handlers/api/auth.ts`:
  - `GET /api/auth/google` - Redirect to Google OAuth
  - `GET /api/auth/callback` - Handle OAuth callback
  - `GET /api/auth/me` - Get current user and policy
  - `POST /api/auth/logout` - Logout
  - `POST /api/auth/refresh` - Refresh session
  - `GET /api/auth/status` - Check if OAuth is configured
- [x] Environment variables added to `Env` type:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `JWT_SECRET`
- [x] `AuthorizationService` class in `src/services/authorization-service.ts`:
  - IAM-style policy evaluation with deny-precedence
  - Wildcard pattern matching for actions and resources
  - Super admin bypass logic
  - `checkAuthorization()` helper function
- [x] Frontend auth store in `frontend/src/lib/stores/auth.svelte.ts`:
  - Svelte 5 runes-based reactive state
  - `init()`, `logout()`, `refresh()` methods
  - Reactive `user`, `loading`, `isAuthenticated` properties
- [x] Users management page in `frontend/src/routes/users/+page.svelte`:
  - List users with search and status filtering
  - User stats display
  - Policy assignment/removal
  - Status updates (activate/deactivate)
- [x] Users API routes in `src/handlers/api/users.ts`:
  - `GET /api/users` - List users with filtering
  - Authorization middleware checking `configure:*` on `clarity:config/users`
  - Policy assignment endpoints
- [x] Policies API routes in `src/handlers/api/policies.ts`:
  - `GET /api/policies` - List available policies

### Not Yet Implemented
- [x] ~~Run database migrations (`drizzle-kit push` or `npm run db:push`)~~ - DONE
- [x] ~~Login page UI~~ - DONE (implemented as `LoginPage.svelte` component rendered in layout when unauthenticated)
- [x] ~~Remove "Coming Soon" badge from Auth Settings in `/settings` page~~ - DONE (badge removed)
- [x] ~~Protected route middleware~~ - DONE (implemented in `src/index.ts:74-84` using `validateSession`)

### Current Authentication
The system currently uses simple token-based authentication via `SETUP_SECRET` environment variable (see `src/core/auth.ts`). This protects setup and admin API routes but does not provide:
- Individual user tracking
- Fine-grained access control
- Session management

## Context

### Current State

Clarity AI currently has no authentication system. The frontend is publicly accessible, and API endpoints rely on GitHub App tokens for authorization. This limits:

1. **User Tracking**: Cannot associate tasks with individual users
2. **Access Control**: No way to restrict features or repositories
3. **Billing**: Cannot implement usage-based pricing per user/organization
4. **Audit Logging**: Cannot track who initiated which tasks

### Motivation

As Clarity AI transitions to a deployed product, we need:

1. **Authentication**: Verify user identity via Google SSO
2. **Authorization**: IAM-style policy-based access control
3. **User Management**: Create, update, deactivate users
4. **Permission System**: Fine-grained, resource-level permissions using AWS IAM-style policies

**Note**: Each deployment is for a single organization, so we don't need a separate organizations table. The deployment itself represents the organization.

### Why IAM-Style Policies?

Inspired by the implementation in `dynamo-v2/clarity-mcp-server`, we adopt an AWS IAM-style policy system because:

- **Flexible**: Supports any action/resource combination without code changes
- **Familiar**: Follows AWS IAM patterns developers already know
- **Deny Precedence**: Explicit Deny always overrides Allow (security-first)
- **Wildcard Support**: Pattern matching for actions and resources (`athena:*`, `repo:owner/*`)
- **Audit Trail**: Version history for all policy changes
- **Multi-Policy**: Users can have multiple policies that merge for evaluation

## Decision

Implement Google SSO authentication with IAM-style policy-based authorization using PostgreSQL and Cloudflare Workers.

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User                    Frontend                 Worker              Google │
│   │                        │                        │                    │   │
│   │  Click "Login"         │                        │                    │   │
│   │───────────────────────>│                        │                    │   │
│   │                        │                        │                    │   │
│   │                        │  Redirect to Google    │                    │   │
│   │<───────────────────────│                        │                    │   │
│   │                        │                        │                    │   │
│   │  Google OAuth Flow     │                        │                    │   │
│   │──────────────────────────────────────────────────────────────────────>│   │
│   │                        │                        │                    │   │
│   │  Redirect with code    │                        │                    │   │
│   │<──────────────────────────────────────────────────────────────────────│   │
│   │                        │                        │                    │   │
│   │  /auth/callback?code=  │                        │                    │   │
│   │───────────────────────>│                        │                    │   │
│   │                        │                        │                    │   │
│   │                        │  POST /api/auth/google │                    │   │
│   │                        │───────────────────────>│                    │   │
│   │                        │                        │                    │   │
│   │                        │                        │ Exchange code      │   │
│   │                        │                        │──────────────────>│   │
│   │                        │                        │                    │   │
│   │                        │                        │ Token + Profile    │   │
│   │                        │                        │<──────────────────│   │
│   │                        │                        │                    │   │
│   │                        │                        │ Find/Create User   │   │
│   │                        │                        │ Load Policy        │   │
│   │                        │                        │ Generate JWT       │   │
│   │                        │                        │                    │   │
│   │                        │  JWT Token             │                    │   │
│   │                        │<───────────────────────│                    │   │
│   │                        │                        │                    │   │
│   │  Store in localStorage │                        │                    │   │
│   │  Redirect to /         │                        │                    │   │
│   │<───────────────────────│                        │                    │   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Database Schema (IAM-Style)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DATABASE SCHEMA (IAM-Style Policies)                       │
│                     (Single-Org Deployment Model)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐      ┌─────────────────────┐                       │
│  │      app_config      │      │        users         │                       │
│  ├─────────────────────┤      ├─────────────────────┤                       │
│  │ id (PK)             │      │ id (PK, UUID)       │                       │
│  │ type (enum)         │      │ email (unique)      │                       │
│  │ config (JSONB)      │      │ name                │                       │
│  │ created_at          │      │ picture_url         │                       │
│  │ updated_at          │      │ google_id (unique)  │                       │
│  └─────────────────────┘      │ is_super_admin      │                       │
│                               │ status              │                       │
│  Config Types:                │ last_login_at       │                       │
│  • github                     │ created_at          │                       │
│  • slack                      │ updated_at          │                       │
│  • llm                        └─────────────────────┘                       │
│  • system_defaults                   │                                      │
│                                      │ 1:N                                  │
│                                      ▼                                      │
│  ┌─────────────────────┐      ┌─────────────────────┐                       │
│  │      policies        │      │    user_policies    │                       │
│  ├─────────────────────┤      ├─────────────────────┤                       │
│  │ id (PK, VARCHAR)    │<─────│ policy_id (FK)      │                       │
│  │ name                │      │ user_id (FK)        │──────> users          │
│  │ description         │      │ enabled             │                       │
│  │ version             │      │ expires_at          │                       │
│  │ statements (JSONB)  │      │ created_at          │                       │
│  │ created_by          │      │ created_by          │                       │
│  │ created_at          │      └─────────────────────┘                       │
│  │ updated_at          │                                                     │
│  └─────────────────────┘      ┌─────────────────────┐                       │
│                               │   policy_versions   │                       │
│  ┌─────────────────────┐      ├─────────────────────┤                       │
│  │       sessions       │      │ id (PK)             │                       │
│  ├─────────────────────┤      │ policy_id           │                       │
│  │ id (PK)             │      │ version_number      │                       │
│  │ user_id (FK)        │      │ statements (JSONB)  │                       │
│  │ token_hash          │      │ changed_by          │                       │
│  │ expires_at          │      │ change_type         │                       │
│  │ ip_address          │      │ change_comment      │                       │
│  │ user_agent          │      │ created_at          │                       │
│  │ created_at          │      └─────────────────────┘                       │
│  └─────────────────────┘                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Policy JSON Structure (IAM-Style)

Stored in `policies.statements` as JSONB:

```json
{
  "Version": "2025-01-01",
  "Statement": [
    {
      "Sid": "AllowRepoAccess",
      "Effect": "Allow",
      "Action": ["repo:*"],
      "Resource": ["clarity:repo/YourOrg/*"]
    },
    {
      "Sid": "AllowConfigureAccess",
      "Effect": "Allow",
      "Action": ["configure:*"],
      "Resource": ["clarity:config/*"]
    }
  ]
}
```

**Two Core Permission Types:**
1. **Repo Access** (`repo:*`) - Access to GitHub repositories via Clarity AI
2. **Configure Access** (`configure:*`) - Access to system configuration (integrations, settings)

**Key Design Principles:**
- `Effect`: "Allow" or "Deny" (Deny takes precedence)
- `Action`: `repo:*` or `configure:*`
- `Resource`: Patterns like `clarity:repo/owner/name`, `clarity:config/*`
- **Default Deny**: No access without explicit Allow
- **Deny Precedence**: Explicit Deny overrides any Allow

### Drizzle Schema Definition

```typescript
// src/db/schema/auth.ts

import {
  pgTable,
  pgEnum,
  varchar,
  text,
  timestamp,
  boolean,
  uuid,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core';

// ============= Users =============

export type UserStatus = 'active' | 'inactive' | 'pending' | 'suspended';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  pictureUrl: text('picture_url'),
  googleId: varchar('google_id', { length: 100 }).unique(),
  isSuperAdmin: boolean('is_super_admin').default(false).notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull().$type<UserStatus>(),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  emailIdx: index('user_email_idx').on(table.email),
  googleIdIdx: index('user_google_id_idx').on(table.googleId),
}));

// ============= Policies (IAM-Style) =============

export type PolicyEffect = 'Allow' | 'Deny';

export interface PolicyStatement {
  Sid?: string;           // Statement ID for documentation
  Effect: PolicyEffect;   // "Allow" or "Deny"
  Action: string[];       // Action patterns (supports wildcards)
  Resource: string[];     // Resource patterns (supports wildcards)
}

export interface PolicyDocument {
  Version: string;
  Statement: PolicyStatement[];
}

export const policies = pgTable('policies', {
  id: varchar('id', { length: 50 }).primaryKey(),  // e.g., 'pol_analytics_read'
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description'),
  version: varchar('version', { length: 20 }).default('2025-01-01'),
  statements: jsonb('statements').notNull().$type<PolicyDocument>(),
  createdBy: varchar('created_by', { length: 255 }),  // Email of creator
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  nameIdx: index('policy_name_idx').on(table.name),
}));

// ============= User Policies (Assignments) =============

export const userPolicies = pgTable('user_policies', {
  id: varchar('id', { length: 50 }).primaryKey(),  // e.g., 'up_abc123'
  userId: uuid('user_id').references(() => users.id).notNull(),
  policyId: varchar('policy_id', { length: 50 }).references(() => policies.id).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  expiresAt: timestamp('expires_at'),
  createdBy: varchar('created_by', { length: 255 }),  // Email of who assigned
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('user_policy_user_idx').on(table.userId),
  policyIdx: index('user_policy_policy_idx').on(table.policyId),
  userPolicyUnique: index('user_policy_unique_idx').on(table.userId, table.policyId),
}));

// ============= Policy Versions (Audit Trail) =============

export const policyVersions = pgTable('policy_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  policyId: varchar('policy_id', { length: 50 }).notNull(),
  versionNumber: integer('version_number').notNull(),
  name: varchar('name', { length: 255 }),
  description: text('description'),
  version: varchar('version', { length: 20 }),
  statements: jsonb('statements').$type<PolicyDocument>(),
  changedBy: varchar('changed_by', { length: 255 }),  // Email
  changeType: varchar('change_type', { length: 50 }),  // 'created', 'updated', 'deleted'
  changeComment: text('change_comment'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  policyVersionIdx: index('policy_version_idx').on(table.policyId, table.versionNumber),
}));

// ============= Sessions =============

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('session_user_idx').on(table.userId),
  tokenIdx: index('session_token_idx').on(table.tokenHash),
  expiresIdx: index('session_expires_idx').on(table.expiresAt),
}));
```

### Available Actions

```typescript
// Clarity AI Actions - Two core permission types
const CLARITY_ACTIONS = {
  // Repository access - use Clarity AI on repositories
  'repo:*': 'Full access to repositories (view, create tasks, execute Clarity AI)',

  // Configure access - system settings and integrations
  'configure:*': 'Full access to configuration (GitHub, Slack, LLM setup, users, policies)',

  // Wildcard (super admin)
  '*': 'All actions (super admin)',
} as const;
```

### Resource Patterns

```typescript
// Resource pattern format: clarity:{type}/{identifier}
const RESOURCE_PATTERNS = {
  // Repositories
  'clarity:repo/{owner}/{name}': 'Specific repository',
  'clarity:repo/{owner}/*': 'All repos in org',
  'clarity:repo/*': 'All repositories',

  // Configuration
  'clarity:config/github': 'GitHub integration settings',
  'clarity:config/slack': 'Slack integration settings',
  'clarity:config/llm': 'LLM provider settings',
  'clarity:config/users': 'User management',
  'clarity:config/policies': 'Policy management',
  'clarity:config/*': 'All configuration',

  // Wildcard
  '*': 'All resources',
} as const;
```

### Policy Enforcer

```typescript
// src/services/policy-enforcer.ts

import type { PolicyDocument, PolicyStatement } from '../db/schema/auth';

export class PolicyEnforcer {
  /**
   * Check if action is allowed on resource.
   * Applies deny-precedence: explicit Deny overrides Allow.
   */
  static checkAccess(
    policy: PolicyDocument | null,
    action: string,
    resource: string,
    userEmail?: string
  ): void {
    if (!policy) {
      throw new PermissionError(
        'Access denied: No policy assigned. Contact admin to assign appropriate policy.'
      );
    }

    if (!this.isActionAllowed(policy, action, resource)) {
      throw new PermissionError(
        `Access denied: Policy does not allow action '${action}' on resource '${resource}'`
      );
    }
  }

  /**
   * Check if action is allowed (returns boolean)
   */
  static isActionAllowed(
    policy: PolicyDocument,
    action: string,
    resource: string
  ): boolean {
    // Check for explicit deny first (highest precedence)
    for (const stmt of policy.Statement) {
      if (stmt.Effect === 'Deny') {
        if (this.matchesAction(stmt, action) && this.matchesResource(stmt, resource)) {
          return false;  // Explicit deny
        }
      }
    }

    // Check for allow
    for (const stmt of policy.Statement) {
      if (stmt.Effect === 'Allow') {
        if (this.matchesAction(stmt, action) && this.matchesResource(stmt, resource)) {
          return true;
        }
      }
    }

    // Default deny
    return false;
  }

  /**
   * Check if statement matches the given action
   */
  private static matchesAction(stmt: PolicyStatement, action: string): boolean {
    return stmt.Action.some(pattern => this.matchesPattern(action, pattern));
  }

  /**
   * Check if statement matches the given resource
   */
  private static matchesResource(stmt: PolicyStatement, resource: string): boolean {
    return stmt.Resource.some(pattern => this.matchesPattern(resource, pattern));
  }

  /**
   * Match value against wildcard pattern
   */
  private static matchesPattern(value: string, pattern: string): boolean {
    // Exact match
    if (pattern === value) return true;

    // Full wildcard
    if (pattern === '*') return true;

    // Prefix wildcard (e.g., "repo:*" matches "repo:read")
    if (pattern.endsWith('*') && !pattern.slice(0, -1).includes('*')) {
      return value.startsWith(pattern.slice(0, -1));
    }

    // Suffix wildcard (e.g., "*:read" matches "repo:read")
    if (pattern.startsWith('*') && !pattern.slice(1).includes('*')) {
      return value.endsWith(pattern.slice(1));
    }

    // Complex patterns: use glob matching
    return this.globMatch(value, pattern);
  }

  /**
   * Simple glob matching for complex patterns
   */
  private static globMatch(value: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regexPattern}$`).test(value);
  }
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}
```

### Default Policies

Three built-in policies created during initial setup:

```typescript
// 1. Super Admin - full access (repo + configure)
const superAdminPolicy: PolicyDocument = {
  Version: '2025-01-01',
  Statement: [
    {
      Sid: 'AllowEverything',
      Effect: 'Allow',
      Action: ['*'],
      Resource: ['*'],
    },
  ],
};

// 2. Admin - configure access only (setup integrations, manage users/policies)
const adminPolicy: PolicyDocument = {
  Version: '2025-01-01',
  Statement: [
    {
      Sid: 'AllowConfigureAccess',
      Effect: 'Allow',
      Action: ['configure:*'],
      Resource: ['clarity:config/*'],
    },
  ],
};

// 3. Developer - repo access only (use Clarity AI on repos, no config access)
// DEFAULT POLICY - assigned automatically to new users
const developerPolicy: PolicyDocument = {
  Version: '2025-01-01',
  Statement: [
    {
      Sid: 'AllowRepoAccess',
      Effect: 'Allow',
      Action: ['repo:*'],
      Resource: ['clarity:repo/*'],
    },
  ],
};
```

| Policy | Action | Use Case |
|--------|--------|----------|
| **Super Admin** | `*` | Full access - first user, org owners |
| **Admin** | `configure:*` | Setup integrations, manage users/policies |
| **Developer** | `repo:*` | Use Clarity AI on repositories **(DEFAULT)** |

**Policy Assignment Rules:**
- **First User**: The first user to sign up automatically becomes **Super Admin** (full access)
- **Subsequent Users**: New users automatically get the **Developer** policy (configurable via `auth.defaultPolicyId`)
- **Policy Changes**: Only users with `configure:*` permission (Admin/Super Admin) can assign or change policies

## Implementation Plan

### Phase 1: Database Schema ✅ COMPLETE
- [x] Create migration for app_config table (completed)
- [x] Add `system_defaults` to configTypeEnum
- [x] Add `SystemDefaultsConfig` interface
- [x] Add Drizzle schema definitions for auth tables in `src/db/schema.ts`:
  - `users` table with email, googleId, isSuperAdmin, status
  - `policies` table with IAM-style PolicyDocument (JSONB)
  - `userPolicies` table for user-to-policy assignments
  - `policyVersions` table for audit trail
  - `sessions` table for JWT token tracking
  - `DEFAULT_POLICIES` constant with super_admin, admin, developer policies
- [x] Run migrations (`npm run db:push`) - DONE

### Phase 2: Auth Service ✅ COMPLETE
- [x] Implement AuthService class (`src/services/auth-service.ts`)
- [x] Add Google OAuth token exchange
- [x] Add domain/email restriction logic (from system_defaults)
- [x] Add super admin logic (first user becomes super admin)
- [x] Add user find/create logic
- [x] Add JWT generation/verification
- [x] Add session management

### Phase 3: Policy Service ✅ COMPLETE
- [x] Implement AuthorizationService class (`src/services/authorization-service.ts`)
  - IAM-style policy evaluation with deny-precedence
  - Wildcard pattern matching for actions and resources
  - Super admin bypass logic
- [x] Add pattern matching (wildcards via regex)
- [x] Add multi-policy merge logic (checks all user policies)
- [ ] Add policy version tracking (schema exists, CRUD not implemented)

### Phase 4: API Routes ✅ COMPLETE
- [x] Add /api/auth/google route
- [x] Add /api/auth/callback route
- [x] Add /api/auth/me route
- [x] Add /api/auth/logout route
- [x] Add /api/auth/refresh route
- [x] Add /api/auth/status route
- [x] Add auth middleware in users routes (`src/handlers/api/users.ts`)
- [x] Add /api/users routes (list, update status, assign/remove policies)
- [x] Add /api/policies routes (list policies)

### Phase 5: Frontend ✅ MOSTLY COMPLETE
- [x] Create auth store (`frontend/src/lib/stores/auth.svelte.ts`)
- [x] Create Users management page (`frontend/src/routes/users/+page.svelte`)
- [x] Add auth state reactive store
- [x] Create Login page UI (`frontend/src/lib/components/LoginPage.svelte` - rendered in layout when unauthenticated)
- [x] Add LoginButton component (Google Sign-in button in LoginPage.svelte)
- [x] Add user menu/avatar to header (`frontend/src/lib/components/UserMenu.svelte` - used in main page header)
- [x] Protect routes requiring auth (backend route guards in `src/index.ts:74-84`, frontend via layout auth check)
- [ ] Add policy editor UI (create/edit custom policies)

### Phase 6: Integration
- [ ] Update existing API routes with auth/policy checks
- [ ] Add user tracking to feature_requests
- [ ] Update GitHub webhook handler
- [ ] Update Slack handler
- [ ] Add audit logging

## Security Considerations

1. **Default Deny**: No access without explicit Allow statement
2. **Deny Precedence**: Explicit Deny always overrides Allow (AWS IAM style)
3. **Token Security**: JWT tokens with server-side session tracking
4. **Domain Restriction**: Optional restriction to specific Google Workspace domains
5. **Super Admin Bypass**: `is_super_admin` flag bypasses policy checks
6. **Audit Trail**: All policy changes tracked in policy_versions table
7. **Token Expiration**: Sessions expire after 7 days
8. **Rate Limiting**: Add rate limiting on /api/auth/* routes

## Environment Variables

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...

# JWT
JWT_SECRET=your-256-bit-secret-key

# Database (existing)
DATABASE_URL=postgres://...
```

## References

- [AWS IAM Policy Reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies.html)
- [dynamo-v2/clarity-mcp-server Policy Implementation](../../dynamo-v2/clarity-mcp-server/clarity/pkg/auth/)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Cloudflare Worker JWT](https://github.com/tsndr/cloudflare-worker-jwt)
- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)
