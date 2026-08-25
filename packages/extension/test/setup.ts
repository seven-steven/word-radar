/**
 * Test setup: mock Chrome APIs for unit tests.
 * This file is loaded automatically by vitest.config.ts.
 */
import { vi } from "vitest";

// Load actual locale files for realistic i18n testing
async function loadLocaleFile(locale: string): Promise<Record<string, { message: string }>> {
  try {
    // Direct import instead of dynamic import to avoid vite issues
    if (locale === "en") {
      const messages = await import("../_locales/en/messages.json", {
        assert: { type: "json" },
      });
      return messages.default;
    } else {
      const messages = await import("../_locales/zh_CN/messages.json", {
        assert: { type: "json" },
      });
      return messages.default;
    }
  } catch {
    return {};
  }
}

// Load locale files synchronously for test environment
let enMessages: Record<string, { message: string }> = {};
let zhMessages: Record<string, { message: string }> = {};

// Load locales immediately
loadLocaleFile("en").then((msgs) => { enMessages = msgs; });
loadLocaleFile("zh_CN").then((msgs) => { zhMessages = msgs; });

// Determine which locale to use in tests (default to English for consistency)
const testLocale = "en";

/**
 * Perform real Chrome i18n substitution with $1, $2, $3... placeholders
 * Mimics chrome.i18n.getMessage behavior with substitutions array
 */
function i18nSubstitute(message: string, substitutions?: string | string[]): string {
  if (!substitutions) return message;

  const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
  let result = message;

  // Replace $1, $2, $3... with corresponding substitution values
  for (let i = 0; i < subs.length; i++) {
    const placeholder = `$${i + 1}`;
    result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), subs[i]);
  }

  return result;
}

// Get messages for current test locale
function getMessages(): Record<string, { message: string }> {
  return testLocale === "en" ? enMessages : zhMessages;
}

// Mock chrome.i18n.getMessage with real substitution logic
global.chrome = {
  i18n: {
    getMessage: vi.fn((key: string, substitutions?: string | string[]) => {
      const messages = getMessages();
      const entry = messages[key];
      const message = entry?.message || key; // Fallback to key if not found
      return i18nSubstitute(message, substitutions);
    }),
  },
} as never;

// Mock other chrome APIs if needed for tests
(global.chrome as any).tabs = {
  query: vi.fn(),
  sendMessage: vi.fn(),
  create: vi.fn(),
};

(global.chrome as any).scripting = {
  executeScript: vi.fn(),
};

(global.chrome as any).runtime = {
  getPlatformInfo: vi.fn(),
};

(global.chrome as any).action = {
  setBadgeText: vi.fn(),
  setBadgeBackgroundColor: vi.fn(),
  setIcon: vi.fn(),
};

(global.chrome as any).storage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
  },
};
