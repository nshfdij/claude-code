import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'openai'

/**
 * Resolve which API provider to use.
 *
 * Precedence (highest → lowest):
 *   1. `API_PROVIDER` explicit override (values: openai | bedrock | vertex | foundry | firstParty)
 *   2. `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` / `CLAUDE_CODE_USE_FOUNDRY`
 *   3. `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_API_BASE` (auto-detect OpenAI)
 *   4. Default: firstParty (Anthropic)
 *
 * Set `DEBUG_PROVIDER=1` to print the resolved provider and the inputs that
 * drove the decision to stderr (useful for diagnosing routing issues).
 */
export function getAPIProvider(): APIProvider {
  // 1. Explicit override wins.
  const explicitProvider = process.env.API_PROVIDER?.toLowerCase()
  if (explicitProvider) {
    switch (explicitProvider) {
      case 'openai':
        return _debugProvider('openai', 'API_PROVIDER=openai')
      case 'bedrock':
        return _debugProvider('bedrock', 'API_PROVIDER=bedrock')
      case 'vertex':
        return _debugProvider('vertex', 'API_PROVIDER=vertex')
      case 'foundry':
        return _debugProvider('foundry', 'API_PROVIDER=foundry')
      case 'firstparty':
      case 'anthropic':
        return _debugProvider('firstParty', 'API_PROVIDER=firstParty')
    }
  }

  // 2. Dedicated provider flags.
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)) {
    return _debugProvider('bedrock', 'CLAUDE_CODE_USE_BEDROCK=1')
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)) {
    return _debugProvider('vertex', 'CLAUDE_CODE_USE_VERTEX=1')
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)) {
    return _debugProvider('foundry', 'CLAUDE_CODE_USE_FOUNDRY=1')
  }

  // 3. OpenAI-compatible auto-detection.
  if (
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_BASE_URL ||
    process.env.OPENAI_API_BASE
  ) {
    const reason = [
      process.env.OPENAI_API_KEY && 'OPENAI_API_KEY',
      process.env.OPENAI_BASE_URL && 'OPENAI_BASE_URL',
      process.env.OPENAI_API_BASE && 'OPENAI_API_BASE',
    ]
      .filter(Boolean)
      .join(', ')
    return _debugProvider('openai', reason)
  }

  // 4. Default.
  return _debugProvider('firstParty', '(default)')
}

/**
 * Emit a one-time debug line to stderr when DEBUG_PROVIDER=1 is set and
 * return the provider unchanged so callers can use it inline.
 */
let _providerDebugLogged = false
function _debugProvider(provider: APIProvider, reason: string): APIProvider {
  if (isEnvTruthy(process.env.DEBUG_PROVIDER) && !_providerDebugLogged) {
    _providerDebugLogged = true
    // biome-ignore lint/suspicious/noConsole: intentional debug output to stderr
    console.error(
      `[DEBUG_PROVIDER] resolved=${provider} reason=${reason}` +
        ` | API_PROVIDER=${process.env.API_PROVIDER ?? '(unset)'}` +
        ` OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? '(set)' : '(unset)'}` +
        ` OPENAI_BASE_URL=${process.env.OPENAI_BASE_URL ?? '(unset)'}` +
        ` OPENAI_API_BASE=${process.env.OPENAI_API_BASE ?? '(unset)'}` +
        ` CLAUDE_CODE_USE_BEDROCK=${process.env.CLAUDE_CODE_USE_BEDROCK ?? '(unset)'}` +
        ` CLAUDE_CODE_USE_VERTEX=${process.env.CLAUDE_CODE_USE_VERTEX ?? '(unset)'}` +
        ` CLAUDE_CODE_USE_FOUNDRY=${process.env.CLAUDE_CODE_USE_FOUNDRY ?? '(unset)'}`,
    )
  }
  return provider
}

/** Reset the debug-logged flag (for use in tests only). */
export function _resetProviderDebugFlag(): void {
  _providerDebugLogged = false
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
