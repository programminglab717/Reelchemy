const failures = {
  "budget-configuration": {
    status: 503,
    code: "AI_BUDGET_CONFIGURATION",
    message:
      "The AI director's usage allowance needs operator attention. Continue editing manually.",
  },
  "global-budget": {
    status: 503,
    code: "AI_SERVICE_ALLOWANCE",
    message:
      "The AI director's service allowance is temporarily unavailable. Try later or continue editing manually.",
  },
  "studio-budget": {
    status: 429,
    code: "AI_STUDIO_ALLOWANCE",
    message:
      "Your studio's AI director allowance is currently exhausted. Try later or continue editing manually.",
  },
  "budget-capacity": {
    status: 503,
    code: "AI_BUSY",
    message:
      "The AI director is busy. Try again shortly or continue editing manually.",
  },
  "request-size": {
    status: 413,
    code: "AI_REQUEST_SIZE",
    message:
      "This storyboard is too large for the AI director's current request allowance. Shorten the instruction or continue editing manually.",
  },
  configuration: {
    status: 503,
    code: "AI_CONFIGURATION",
    message:
      "The AI director is not configured correctly. Contact the studio operator or continue editing manually.",
  },
  unavailable: {
    status: 502,
    code: "AI_UNAVAILABLE",
    message:
      "The AI director could not complete this request. Try again later or continue editing manually.",
  },
  authentication: {
    status: 502,
    code: "AI_KEY_REJECTED",
    message:
      "The AI provider rejected the saved key. Check your AI provider key in Account settings or continue editing manually.",
  },
  model: {
    status: 502,
    code: "AI_MODEL_UNAVAILABLE",
    message:
      "The AI provider did not recognise the model or endpoint. Check your AI provider settings or continue editing manually.",
  },
  "provider-rate": {
    status: 429,
    code: "AI_PROVIDER_RATE_LIMITED",
    message:
      "The AI provider is limiting requests for this key. Try again shortly or continue editing manually.",
  },
  timeout: {
    status: 504,
    code: "AI_TIMEOUT",
    message:
      "The AI director took too long to respond. Try again later or continue editing manually.",
  },
  response: {
    status: 502,
    code: "AI_INVALID_RESPONSE",
    message:
      "The AI director returned an unusable storyboard. Try another instruction or continue editing manually.",
  },
} as const;

// Only fixed, public-safe messages cross the provider/API boundary. In
// particular, do not attach upstream errors or response bodies as a cause.
export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(
    kind: keyof typeof failures,
    readonly retryAfter?: number,
  ) {
    const failure = failures[kind];
    super(failure.message);
    this.name = "ProviderError";
    this.status = failure.status;
    this.code = failure.code;
  }
}
