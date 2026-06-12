---
paths:
  - "src/lib/auth/**"
  - "src/lib/mcp/**"
  - "src/lib/env.ts"
---
# Validate Configuration Formats at Parse Time

Validate configuration values when config is loaded (startup), not when they are first used (request time). A bad URL or mismatched type accepted at startup surfaces later as a cryptic production 500.

Applies to config strings used as URLs (JWKS endpoints, OAuth providers, external services) and schema-dependent values (enums, types matching database columns): construct/validate them inside the config loader with try/catch and fail fast with a named error.

## Bad

```typescript
function getJwksResolver(jwksUrl: string) {
  return async () => {
    const response = await fetch(new URL(jwksUrl)) // throws at request time
  }
}
```

## Good

```typescript
function getExternalAuthProviders(config: Config) {
  const providers = config.MCP_EXTERNAL_AUTH_PROVIDERS
  try {
    new URL(providers.jwksUrl) // fail fast at config load
  } catch {
    throw new Error(`Invalid JWKS URL: ${providers.jwksUrl}`)
  }
  return providers
}
```

Source: rule pass 2026-06-11 - fixes `coderabbit-auth-guards-fixes`, `oauth-revoked-boolean-to-date`
