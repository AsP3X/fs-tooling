export {};

declare global {
  const chrome: {
    runtime: {
      id?: string;
      lastError?: { message: string };
      sendMessage: (message: unknown) => Promise<unknown>;
      onMessage: {
        addListener: (
          fn: (
            message: { type?: string; apiKey?: string; origin?: string; path?: string; method?: string; body?: string },
            sender: unknown,
            sendResponse: (response: unknown) => void,
          ) => boolean | void,
        ) => void;
      };
    };
    storage: {
      local: {
        get: (keys: string | string[]) => Promise<Record<string, unknown>>;
        set: (items: Record<string, unknown>) => Promise<void>;
        remove: (keys: string | string[]) => Promise<void>;
      };
    };
  };
}
