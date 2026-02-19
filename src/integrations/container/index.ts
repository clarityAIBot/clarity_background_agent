// Container integration exports

// Sandbox abstractions (provider-agnostic interfaces)
export type {
  ISandbox,
  ISandboxClient,
  SandboxFetchOptions,
  SandboxExecutionResult,
  SandboxClientConfig,
} from './abstractions';
export { createSandboxClient, executeSandboxRequest } from './abstractions';

// Cloudflare adapter
export { CloudflareSandbox, CloudflareSandboxClient, fromCloudflareNamespace, MyContainer } from './adapters/cloudflare';

// Legacy fetch wrapper (deprecated - use createSandboxClient instead)
export { containerFetch, getRouteFromRequest } from './fetch';
