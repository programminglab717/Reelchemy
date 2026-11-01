const failures = {
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
  constructor(kind: keyof typeof failures) {
    const failure = failures[kind];
    super(failure.message);
    this.name = "ProviderError";
    this.status = failure.status;
    this.code = failure.code;
  }
}
