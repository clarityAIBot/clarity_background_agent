# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly. **Do not open a public GitHub issue.**

Instead, please email us at **security@getsupernova.ai** with:

1. A description of the vulnerability
2. Steps to reproduce the issue
3. Any potential impact you've identified

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation plan within 7 days.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | Yes                |

## Security Best Practices for Contributors

- Never commit secrets, API keys, or credentials to the repository
- Use `.dev.vars` for local secrets (already in `.gitignore`)
- All sensitive configuration is stored encrypted in Durable Objects using AES-256-GCM
- GitHub webhook signatures are verified before processing
- Use `wrangler secret put` for production secrets

## Scope

This policy applies to the Clarity AI repository and its deployed instances. Third-party dependencies are outside scope but we welcome reports about known vulnerable dependencies.
