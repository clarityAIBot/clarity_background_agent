# Database Migration Plan: postgres → clarity

## Overview

Migrate Clarity AI tables from the default `postgres` database to a dedicated `clarity` database with proper role-based access control.

## Current State

- **Database**: `postgres` (default)
- **User**: Master admin with full privileges
- **Issue**: Using admin credentials in application is a security risk

## Environment Variables (in `.env`)

| Variable | Purpose |
|----------|---------|
| `MASTER_DATABASE_URL` | Admin connection (for migrations, setup) |
| `DATABASE_URL` | Application connection (least privilege) |

## Target State

- **Database**: `clarity` (dedicated)
- **Role**: `clarity_rw` (read/write role)
- **User**: `clarity_user` (application user)
- **Access**: Least privilege principle

## Migration Steps

### Phase 1: Create New Database and Roles (Run as Admin)

**Connect using `MASTER_DATABASE_URL`**

```bash
# Connect as admin
psql "$MASTER_DATABASE_URL"
```

```sql
-- Step 1: Create the clarity database
CREATE DATABASE clarity;

-- Step 2: Create the read/write role
CREATE ROLE clarity_rw WITH LOGIN;

-- Step 3: Connect to clarity database and grant permissions
\c clarity

-- Grant connect permission
GRANT CONNECT ON DATABASE clarity TO clarity_rw;

-- Grant read/write access to all tables (current and future)
GRANT pg_read_all_data, pg_write_all_data TO clarity_rw;

-- Step 4: Create application user with secure password
-- (generate password: openssl rand -base64 32)
CREATE USER clarity_user WITH PASSWORD 'REPLACE_WITH_SECURE_PASSWORD';

-- Step 5: Assign role to user
GRANT clarity_rw TO clarity_user;

-- Step 6: Grant schema permissions
GRANT USAGE ON SCHEMA public TO clarity_rw;
GRANT CREATE ON SCHEMA public TO clarity_rw;

-- Step 7: Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clarity_rw;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO clarity_rw;
```

### Phase 2: Export Tables from postgres Database

**Application Tables:**
| Table | Description |
|-------|-------------|
| `app_config` | Application configuration (GitHub, Claude, Slack) |
| `feature_requests` | Main feature request tracking |
| `request_messages` | Conversation messages |

**Drizzle Migration Tracking Table:**
| Table | Description |
|-------|-------------|
| `__drizzle_migrations` | Tracks applied migrations (hash, created_at) |

**PostgreSQL Enums:**
| Enum | Values |
|------|--------|
| `config_type` | github, claude, slack |
| `message_source` | slack, github, web, system |
| `message_type` | initial_request, clarification_ask, ... (17 values) |
| `request_origin` | slack, github_issue, web |
| `request_status` | pending, issue_created, processing, ... (8 values) |
| `task_status` | pending, processing, completed, error |

**Sequences (auto-generated for IDENTITY columns):**
- `app_config_id_seq`
- `feature_requests_id_seq`
- `request_messages_id_seq`

**Use `MASTER_DATABASE_URL` for export (admin access required)**

```bash
# Option 1: Export schema and data separately
pg_dump "$MASTER_DATABASE_URL" \
  --table=app_config \
  --table=feature_requests \
  --table=request_messages \
  --table=__drizzle_migrations \
  --schema-only \
  -f clarity_schema.sql

# Export data separately
pg_dump "$MASTER_DATABASE_URL" \
  --table=app_config \
  --table=feature_requests \
  --table=request_messages \
  --table=__drizzle_migrations \
  --data-only \
  -f clarity_data.sql
```

**Option 2: Full dump (recommended)**
```bash
# Full dump with all enums, tables, sequences, constraints, and data
pg_dump "$MASTER_DATABASE_URL" \
  -t 'app_config' \
  -t 'feature_requests' \
  -t 'request_messages' \
  -t '__drizzle_migrations' \
  --no-owner \
  --no-privileges \
  -f clarity_full_dump.sql
```

### Phase 3: Import to clarity Database

**Use `DATABASE_URL` (new clarity_user connection) for import**

```bash
# Option 1: If using separate files
psql "$DATABASE_URL" -f clarity_schema.sql
psql "$DATABASE_URL" -f clarity_data.sql

# Option 2: If using full dump (recommended)
psql "$DATABASE_URL" -f clarity_full_dump.sql

# Run pending migrations (agent support)
psql "$DATABASE_URL" -f drizzle/0003_add_agent_support.sql
```

**Note:** After import, verify sequences are properly set:
```sql
-- Reset sequences to max id + 1 (if needed)
SELECT setval('app_config_id_seq', COALESCE((SELECT MAX(id) FROM app_config), 0) + 1, false);
SELECT setval('feature_requests_id_seq', COALESCE((SELECT MAX(id) FROM feature_requests), 0) + 1, false);
SELECT setval('request_messages_id_seq', COALESCE((SELECT MAX(id) FROM request_messages), 0) + 1, false);
```

### Phase 4: Verify Migration

```sql
-- Connect as clarity_user to verify access
\c clarity clarity_user

-- Check tables exist
\dt

-- Verify row counts match
SELECT 'app_config' as table_name, COUNT(*) as count FROM app_config
UNION ALL
SELECT 'feature_requests', COUNT(*) FROM feature_requests
UNION ALL
SELECT 'request_messages', COUNT(*) FROM request_messages;

-- Test CRUD operations
SELECT * FROM feature_requests LIMIT 1;
```

### Phase 5: Update Connection Strings

#### 5a. Update Local .env File

Update `DATABASE_URL` in `.env` file with the new database name (`clarity`) and new user credentials (`clarity_user`).

> **Note:** Connection credentials are stored in `.env` file (not committed to git).

#### 5b. Update Hyperdrive Configuration

**Update in Cloudflare Dashboard:**
1. Go to Cloudflare Dashboard → Workers & Pages
2. Select your Clarity AI worker
3. Go to Settings → Variables
4. Update `HYPERDRIVE_ID` or recreate Hyperdrive with new connection string pointing to `clarity` database

**Or recreate Hyperdrive via CLI:**
```bash
# Delete old hyperdrive
wrangler hyperdrive delete clarity-db

# Create new hyperdrive with new connection (use credentials from .env)
wrangler hyperdrive create clarity-db \
  --connection-string="$DATABASE_URL"
```

### Phase 6: Cleanup Old Database (After Verification)

**Use `MASTER_DATABASE_URL` for cleanup (admin access required)**

```bash
# Connect as admin to postgres database
psql "$MASTER_DATABASE_URL"
```

```sql
-- ONLY run after successful migration verification and 24-48 hours monitoring

-- Drop drizzle migrations table
DROP TABLE IF EXISTS __drizzle_migrations CASCADE;

-- Drop application tables (order matters due to foreign keys)
DROP TABLE IF EXISTS request_messages CASCADE;
DROP TABLE IF EXISTS feature_requests CASCADE;
DROP TABLE IF EXISTS app_config CASCADE;

-- Drop all enums
DROP TYPE IF EXISTS request_status CASCADE;
DROP TYPE IF EXISTS task_status CASCADE;
DROP TYPE IF EXISTS config_type CASCADE;
DROP TYPE IF EXISTS request_origin CASCADE;
DROP TYPE IF EXISTS message_type CASCADE;
DROP TYPE IF EXISTS message_source CASCADE;

-- Verify cleanup
\dt
\dT
```

## Rollback Plan

If migration fails:

1. Keep old `postgres` database untouched until verification passes
2. Revert Hyperdrive connection string to original
3. Drop `clarity` database and start fresh if needed:
   ```sql
   DROP DATABASE IF EXISTS clarity;
   DROP USER IF EXISTS clarity_user;
   DROP ROLE IF EXISTS clarity_rw;
   ```

## Security Considerations

1. **Password Generation**: Use a strong, random password for `clarity_user`
   ```bash
   openssl rand -base64 32
   ```

2. **Connection Encryption**: Ensure SSL/TLS is enabled (`sslmode=verify-full`)

3. **IP Allowlisting**: Only allow connections from Cloudflare IPs (if supported by your DB provider)

4. **Audit**: Enable query logging for the new database

5. **Credentials Storage**: All credentials stored in `.env` file (not committed to git)

## Checklist

### Setup (using MASTER_DATABASE_URL)
- [ ] Create `clarity` database
- [ ] Create `clarity_rw` role
- [ ] Create `clarity_user` with secure password
- [ ] Grant appropriate permissions

### Export (using MASTER_DATABASE_URL)
- [ ] Export schema from postgres
- [ ] Export data from postgres

### Import (using DATABASE_URL - new clarity_user)
- [ ] Update `.env` with new `DATABASE_URL` pointing to clarity db
- [ ] Import schema to clarity
- [ ] Import data to clarity
- [ ] Run pending migrations (0003_add_agent_support.sql)
- [ ] Verify sequences are set correctly

### Verify
- [ ] Verify table counts match
- [ ] Test CRUD operations as clarity_user
- [ ] Update Hyperdrive connection string
- [ ] Deploy and test application
- [ ] Monitor for errors (24-48 hours)

### Cleanup (using MASTER_DATABASE_URL)
- [ ] Drop `__drizzle_migrations` from postgres
- [ ] Drop `request_messages` from postgres
- [ ] Drop `feature_requests` from postgres
- [ ] Drop `app_config` from postgres
- [ ] Drop all enums from postgres
- [ ] Document new credentials securely
