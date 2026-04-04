import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { getAPIProvider, isFirstPartyAnthropicBaseUrl, _resetProviderDebugFlag } from "../providers";

describe("getAPIProvider", () => {
  const envKeys = [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "API_PROVIDER",
    "DEBUG_PROVIDER",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) savedEnv[key] = process.env[key];
    // Clear the one-time debug flag before each test
    _resetProviderDebugFlag();
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test('returns "firstParty" by default', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_BASE;
    expect(getAPIProvider()).toBe("firstParty");
  });

  test('returns "bedrock" when CLAUDE_CODE_USE_BEDROCK is set', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    expect(getAPIProvider()).toBe("bedrock");
  });

  test('returns "vertex" when CLAUDE_CODE_USE_VERTEX is set', () => {
    process.env.CLAUDE_CODE_USE_VERTEX = "1";
    expect(getAPIProvider()).toBe("vertex");
  });

  test('returns "foundry" when CLAUDE_CODE_USE_FOUNDRY is set', () => {
    process.env.CLAUDE_CODE_USE_FOUNDRY = "1";
    expect(getAPIProvider()).toBe("foundry");
  });

  test("bedrock takes precedence over vertex", () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    process.env.CLAUDE_CODE_USE_VERTEX = "1";
    expect(getAPIProvider()).toBe("bedrock");
  });

  test("bedrock wins when all three env vars are set", () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    process.env.CLAUDE_CODE_USE_VERTEX = "1";
    process.env.CLAUDE_CODE_USE_FOUNDRY = "1";
    expect(getAPIProvider()).toBe("bedrock");
  });

  test('"true" is truthy', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = "true";
    expect(getAPIProvider()).toBe("bedrock");
  });

  test('"0" is not truthy', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_BASE;
    process.env.CLAUDE_CODE_USE_BEDROCK = "0";
    expect(getAPIProvider()).toBe("firstParty");
  });

  test('empty string is not truthy', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_BASE;
    process.env.CLAUDE_CODE_USE_BEDROCK = "";
    expect(getAPIProvider()).toBe("firstParty");
  });

  // OpenAI-compatible provider tests
  test('returns "openai" when OPENAI_API_KEY is set', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    process.env.OPENAI_API_KEY = "sk-test-key";
    expect(getAPIProvider()).toBe("openai");
  });

  test('returns "openai" when OPENAI_BASE_URL is set', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_BASE_URL = "https://api.chatanywhere.tech/v1";
    expect(getAPIProvider()).toBe("openai");
  });

  test('returns "openai" when both OPENAI_API_KEY and OPENAI_BASE_URL are set', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.OPENAI_BASE_URL = "https://api.chatanywhere.tech/v1";
    expect(getAPIProvider()).toBe("openai");
  });

  test('returns "openai" when OPENAI_API_BASE is set (alias for OPENAI_BASE_URL)', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    process.env.OPENAI_API_BASE = "https://api.chatanywhere.tech/v1";
    expect(getAPIProvider()).toBe("openai");
  });

  test('returns "openai" when OPENAI_API_KEY and OPENAI_API_BASE are set', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    process.env.OPENAI_API_KEY = "sk-test-key";
    delete process.env.OPENAI_BASE_URL;
    process.env.OPENAI_API_BASE = "https://api.chatanywhere.tech/v1";
    expect(getAPIProvider()).toBe("openai");
  });

  test("bedrock takes precedence over openai", () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    process.env.OPENAI_API_KEY = "sk-test-key";
    expect(getAPIProvider()).toBe("bedrock");
  });

  test("vertex takes precedence over openai", () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    process.env.CLAUDE_CODE_USE_VERTEX = "1";
    process.env.OPENAI_API_KEY = "sk-test-key";
    expect(getAPIProvider()).toBe("vertex");
  });

  test("foundry takes precedence over openai", () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    process.env.CLAUDE_CODE_USE_FOUNDRY = "1";
    process.env.OPENAI_API_KEY = "sk-test-key";
    expect(getAPIProvider()).toBe("foundry");
  });

  // API_PROVIDER explicit override tests
  test('API_PROVIDER=openai forces openai even without OPENAI_API_KEY', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_BASE;
    process.env.API_PROVIDER = "openai";
    expect(getAPIProvider()).toBe("openai");
  });

  test('API_PROVIDER=openai wins over CLAUDE_CODE_USE_BEDROCK', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    process.env.API_PROVIDER = "openai";
    // API_PROVIDER is the highest-priority explicit override
    expect(getAPIProvider()).toBe("openai");
  });

  test('API_PROVIDER=bedrock forces bedrock', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.OPENAI_API_KEY;
    process.env.API_PROVIDER = "bedrock";
    expect(getAPIProvider()).toBe("bedrock");
  });

  test('API_PROVIDER=firstParty forces firstParty', () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.API_PROVIDER = "firstParty";
    expect(getAPIProvider()).toBe("firstParty");
  });

  test('API_PROVIDER=anthropic is alias for firstParty', () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.API_PROVIDER = "anthropic";
    expect(getAPIProvider()).toBe("firstParty");
  });

  test('API_PROVIDER is case-insensitive', () => {
    delete process.env.OPENAI_API_KEY;
    process.env.API_PROVIDER = "OPENAI";
    expect(getAPIProvider()).toBe("openai");
  });

  test('unknown API_PROVIDER value falls through to auto-detection', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_BASE;
    process.env.API_PROVIDER = "unknown-provider";
    expect(getAPIProvider()).toBe("firstParty");
  });

  // DEBUG_PROVIDER logging tests
  test('DEBUG_PROVIDER=1 logs to stderr on first call', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.OPENAI_BASE_URL = "https://api.chatanywhere.tech/v1";
    process.env.DEBUG_PROVIDER = "1";
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const provider = getAPIProvider();
      expect(provider).toBe("openai");
      expect(spy).toHaveBeenCalledTimes(1);
      const logLine = String(spy.mock.calls[0]?.[0]);
      expect(logLine).toContain("[DEBUG_PROVIDER]");
      expect(logLine).toContain("resolved=openai");
      expect(logLine).toContain("OPENAI_API_KEY=(set)");
      expect(logLine).toContain("OPENAI_BASE_URL=https://api.chatanywhere.tech/v1");
    } finally {
      spy.mockRestore();
    }
  });

  test('DEBUG_PROVIDER=1 only logs once across multiple calls', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.OPENAI_API_KEY;
    process.env.DEBUG_PROVIDER = "1";
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      getAPIProvider();
      getAPIProvider();
      getAPIProvider();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  test('DEBUG_PROVIDER not set means no stderr log', () => {
    delete process.env.DEBUG_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      getAPIProvider();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("isFirstPartyAnthropicBaseUrl", () => {
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const originalUserType = process.env.USER_TYPE;

  afterEach(() => {
    if (originalBaseUrl !== undefined) {
      process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.ANTHROPIC_BASE_URL;
    }
    if (originalUserType !== undefined) {
      process.env.USER_TYPE = originalUserType;
    } else {
      delete process.env.USER_TYPE;
    }
  });

  test("returns true when ANTHROPIC_BASE_URL is not set", () => {
    delete process.env.ANTHROPIC_BASE_URL;
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
  });

  test("returns true for api.anthropic.com", () => {
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
  });

  test("returns false for custom URL", () => {
    process.env.ANTHROPIC_BASE_URL = "https://my-proxy.com";
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false);
  });

  test("returns false for invalid URL", () => {
    process.env.ANTHROPIC_BASE_URL = "not-a-url";
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false);
  });

  test("returns true for staging URL when USER_TYPE is ant", () => {
    process.env.ANTHROPIC_BASE_URL = "https://api-staging.anthropic.com";
    process.env.USER_TYPE = "ant";
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
  });

  test("returns true for URL with path", () => {
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
  });

  test("returns true for trailing slash", () => {
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com/";
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true);
  });

  test("returns false for subdomain attack", () => {
    process.env.ANTHROPIC_BASE_URL = "https://evil-api.anthropic.com";
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false);
  });
});
