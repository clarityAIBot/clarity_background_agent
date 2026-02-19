import { users, userPolicies, policies, type PolicyDocument, type PolicyStatement } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../db/client';
import { logWithContext } from '../core/log';

/**
 * Authorization service that evaluates IAM-style policies (AWS IAM style)
 *
 * Evaluation Rules:
 * 1. Explicit Deny in ANY policy → DENY (overrides everything)
 * 2. Explicit Allow in ANY policy → ALLOW
 * 3. No matching statement → DENY (default deny)
 */
export class AuthorizationService {
  private db: DrizzleDb;

  constructor(db: DrizzleDb) {
    this.db = db;
  }

  /**
   * Check if a user is authorized to perform an action on a resource
   * Uses AWS IAM-style multi-policy evaluation
   *
   * @param userId User ID
   * @param action Action to check (e.g., "users:read", "users:write", "config:write")
   * @param resource Resource to check (e.g., "users/*", "config/system-defaults")
   * @returns true if authorized, false otherwise
   */
  async isAuthorized(userId: string, action: string, resource: string): Promise<boolean> {
    // Get user
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      logWithContext('AUTH', `User not found: ${userId}`);
      return false;
    }

    // Super admins have full access to everything (bypass all policy checks)
    if (user.isSuperAdmin) {
      logWithContext('AUTH', `Super admin detected for user ${user.email}, granting full access`);
      return true;
    }

    // Get all enabled, non-expired policies for the user
    const userPolicyRecords = await this.db
      .select({
        statements: policies.statements,
        policyId: policies.id,
        policyName: policies.name,
      })
      .from(userPolicies)
      .innerJoin(policies, eq(userPolicies.policyId, policies.id))
      .where(
        sql`${userPolicies.userId} = ${userId}
            AND ${userPolicies.enabled} = true
            AND (${userPolicies.expiresAt} IS NULL OR ${userPolicies.expiresAt} > NOW())`
      );

    if (userPolicyRecords.length === 0) {
      logWithContext('AUTH', `No active policies found for user ${user.email}`);
      return false;
    }

    // AWS IAM-style evaluation: Check for explicit DENY first
    // Deny always takes precedence over allow
    let hasExplicitDeny = false;
    let hasAllowMatch = false;

    for (const record of userPolicyRecords) {
      const policyDoc = record.statements as PolicyDocument;

      for (const statement of policyDoc.Statement) {
        const actionMatches = this.matchesPattern(action, statement.Action);
        const resourceMatches = this.matchesPattern(resource, statement.Resource);

        if (actionMatches && resourceMatches) {
          if (statement.Effect === 'Deny') {
            logWithContext('AUTH', `Explicit DENY found in policy ${record.policyName} for ${user.email}: ${action} on ${resource}`);
            hasExplicitDeny = true;
            // Continue checking to log all denies, but we know the result
          } else if (statement.Effect === 'Allow') {
            hasAllowMatch = true;
            logWithContext('AUTH', `ALLOW found in policy ${record.policyName} for ${user.email}: ${action} on ${resource}`);
          }
        }
      }
    }

    // Deny always wins (AWS IAM rule)
    if (hasExplicitDeny) {
      logWithContext('AUTH', `Access DENIED for ${user.email}: ${action} on ${resource} (explicit deny)`);
      return false;
    }

    // Return true only if we found at least one allow
    if (hasAllowMatch) {
      logWithContext('AUTH', `Access GRANTED for ${user.email}: ${action} on ${resource}`);
      return true;
    }

    // Default deny (no matching allow statement)
    logWithContext('AUTH', `Access DENIED for ${user.email}: ${action} on ${resource} (no matching allow)`);
    return false;
  }

  /**
   * Match a value against an array of patterns (supports wildcards)
   * Implements fast path optimizations for common patterns
   *
   * @param value Value to match
   * @param patterns Array of patterns (e.g., ["users:*", "config:read"])
   * @returns true if value matches any pattern
   */
  private matchesPattern(value: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      // Fast path: exact match or full wildcard
      if (pattern === '*' || pattern === value) {
        return true;
      }

      // Fast path: no wildcards (exact match only)
      if (!pattern.includes('*') && !pattern.includes('?')) {
        continue;
      }

      // Convert glob pattern to regex
      // * matches any sequence of characters
      // ? matches any single character
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
        .replace(/\*/g, '.*')                    // * becomes .*
        .replace(/\?/g, '.');                    // ? becomes .

      const regex = new RegExp(`^${regexPattern}$`);
      if (regex.test(value)) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Helper function to check if a user is authorized
 * Convenience wrapper around AuthorizationService
 */
export async function checkAuthorization(
  db: DrizzleDb,
  userId: string,
  action: string,
  resource: string
): Promise<boolean> {
  const authService = new AuthorizationService(db);
  return authService.isAuthorized(userId, action, resource);
}
