import { z } from "zod";
import type { providerConfiguration } from "../lib/provider-config";
import { ProviderError } from "../lib/provider-error";
import { readProviderResponse } from "../lib/provider-response";
import { providerTokens } from "../lib/provider-usage";
import type { ProviderAccounting } from "../lib/provider-usage-store";

// A multi-turn, image-capable call for the director, on the studio's resolved
// provider (Anthropic Messages or an OpenAI-compatible chat API such as
// OpenAI or Google Gemini), with the same accounting as planning.
export type LlmConfiguration = Exclude<
  ReturnType<typeof providerConfiguration>,
  { provider: "mock" }
>;
export type LlmPart = { text: string } | { png: Buffer };
export type LlmMessage = {
  role: "user" | "assistant";
  content: string | LlmPart[];
};
export type LlmResult = { text: string; truncated: boolean };
export type Llm = (request: {
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}) => Promise<LlmResult>;

const parts = (content: LlmMessage["content"]): LlmPart[] =>
  typeof content === "string" ? [{ text: content }] : content;
function anthropicBody(
  model: string,
  system: string,
  messages: LlmMessage[],
  maxTokens: number,
) {
  return {
    model,
    max_tokens: maxTokens,
    system,
    messages: messages.map((message) => ({
      role: message.role,
      content: parts(message.content).map((part) =>
        "png" in part
          ? {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: part.png.toString("base64"),
              },
            }
          : { type: "text", text: part.text },
      ),
    })),
  };
}
function compatibleBody(
  endpoint: string,
  model: string,
  system: string,
  messages: LlmMessage[],
  maxTokens: number,
) {
  // OpenAI's current models take max_completion_tokens and only the default
  // temperature; other compatible APIs (e.g. Gemini) take max_tokens.
  const openai = new URL(endpoint).hostname === "api.openai.com";
  return {
    model,
    ...(openai
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens, temperature: 0.7 }),
    messages: [
      { role: "system", content: system },
      ...messages.map((message) => ({
        role: message.role,
        content: parts(message.content).map((part) =>
          "png" in part
            ? {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${part.png.toString("base64")}`,
                },
              }
            : { type: "text", text: part.text },
        ),
      })),
    ],
  };
}
export function providerLlm(
  config: LlmConfiguration,
  accounting?: ProviderAccounting,
): Llm {
  return async ({
    system,
    messages,
    maxTokens,
    timeoutMs = 300000,
    signal,
  }) => {
    const images = messages.reduce(
      (n, m) => n + parts(m.content).filter((p) => "png" in p).length,
      0,
    );
    const textBytes = Buffer.byteLength(
      system +
        messages
          .flatMap((m) => parts(m.content))
          .map((p) => ("text" in p ? p.text : ""))
          .join(""),
    );
    const body =
      config.provider === "anthropic"
        ? anthropicBody(config.model, system, messages, maxTokens)
        : compatibleBody(
            config.endpoint,
            config.model,
            system,
            messages,
            maxTokens,
          );
    const lease = accounting?.begin({
      provider: config.provider,
      model: config.model,
      payloadBytes: textBytes,
      outputTokens: maxTokens,
      images,
    });
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let data: unknown;
    try {
      let response: Response;
      try {
        response = await fetch(config.endpoint, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          headers: {
            ...(config.provider === "anthropic"
              ? { "x-api-key": config.key, "anthropic-version": "2023-06-01" }
              : { Authorization: `Bearer ${config.key}` }),
            "Content-Type": "application/json",
          },
          signal: combined,
          body: JSON.stringify(body),
        });
      } catch {
        throw new ProviderError(combined.aborted ? "timeout" : "unavailable");
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new ProviderError(
          response.status === 401 || response.status === 403
            ? "authentication"
            : response.status === 404
              ? "model"
              : response.status === 429
                ? "provider-rate"
                : "unavailable",
        );
      }
      data = await readProviderResponse(response, combined);
      lease?.record(providerTokens(config.provider, data));
    } finally {
      lease?.uncertain();
    }
    try {
      if (config.provider === "anthropic") {
        const reply = z
          .object({
            content: z
              .array(
                z.object({ type: z.string(), text: z.string().optional() }),
              )
              .max(100),
            stop_reason: z.string().nullable().optional(),
          })
          .parse(data);
        return {
          text: reply.content
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
            .join(""),
          truncated: reply.stop_reason === "max_tokens",
        };
      }
      const reply = z
        .object({
          choices: z
            .array(
              z.object({
                message: z.object({ content: z.string().nullable() }),
                finish_reason: z.string().nullable().optional(),
              }),
            )
            .min(1),
        })
        .parse(data);
      return {
        text: reply.choices[0].message.content ?? "",
        truncated: reply.choices[0].finish_reason === "length",
      };
    } catch {
      throw new ProviderError("response");
    }
  };
}
