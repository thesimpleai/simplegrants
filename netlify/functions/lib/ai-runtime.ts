import { randomUUID } from "node:crypto";
import { HttpError, json } from "./core";

export type AIFailure = "timeout" | "response";
export class AIExecutionError extends Error {
  constructor(public kind: AIFailure) {
    super(kind);
  }
}
export interface AIRequestBudget {
  signal: AbortSignal;
  remaining(): number;
  assert(): void;
  read<T>(work: PromiseLike<T>): Promise<T>;
  close(): void;
}
export function waitForAISignal<T>(
  work: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new AIExecutionError("timeout"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new AIExecutionError("timeout"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(work).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        signal.aborted
          ? reject(new AIExecutionError("timeout"))
          : resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
export function createAIRequestBudget(milliseconds = 27000): AIRequestBudget {
  const deadline = Date.now() + milliseconds;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  const assert = () => {
    if (controller.signal.aborted || Date.now() >= deadline)
      throw new AIExecutionError("timeout");
  };
  return {
    signal: controller.signal,
    remaining: () => Math.max(0, deadline - Date.now()),
    assert,
    read: async (work) => {
      assert();
      const value = await waitForAISignal(work, controller.signal);
      assert();
      return value;
    },
    close: () => clearTimeout(timer),
  };
}

/** Only fixed stages and numeric provider status are recorded, never provider messages or source material. */
export function aiFailureResponse(
  error: unknown,
  budget: AIRequestBudget,
  stage: string,
) {
  if (error instanceof HttpError && error.status < 500 && error.status !== 429)
    return json({ error: error.message }, error.status);
  const object = error && typeof error === "object" ? error : {};
  const rawStatus =
    !(error instanceof HttpError) &&
    "status" in object &&
    typeof object.status === "number"
      ? object.status
      : undefined;
  const providerStatus =
    rawStatus &&
    [400, 401, 403, 404, 408, 413, 415, 429, 500, 502, 503, 504].includes(
      rawStatus,
    )
      ? rawStatus
      : undefined;
  const timeout =
    budget.signal.aborted ||
    budget.remaining() === 0 ||
    (error instanceof AIExecutionError && error.kind === "timeout") ||
    providerStatus === 408 ||
    providerStatus === 504 ||
    (error instanceof Error &&
      ["AbortError", "TimeoutError", "APIConnectionTimeoutError"].includes(
        error.name,
      ));
  let code = "SG_AI_UNAVAILABLE",
    status = 503;
  let message =
    "The AI service could not complete this step. Please try again.";
  if (timeout) {
    code = "SG_AI_TIMEOUT";
    status = 504;
    message =
      "This AI step took too long. Your uploaded documents are safe. Try again with fewer or smaller documents.";
  } else if (
    providerStatus === 429 ||
    (error instanceof HttpError && error.status === 429)
  ) {
    code = "SG_AI_QUOTA";
    status = 429;
    message =
      error instanceof HttpError
        ? error.message
        : "The AI service has reached its usage limit. Please try again later.";
  } else if ([401, 403, 404].includes(providerStatus || 0)) {
    code = "SG_AI_PROVIDER";
    message =
      "The AI provider or selected model is unavailable. Ask an administrator to check the Gemini key and model settings.";
  } else if (error instanceof HttpError && error.status === 503) {
    code = "SG_AI_SETUP";
    message =
      "AI is not fully configured. Ask an administrator to check the server settings.";
  } else if (
    (error instanceof AIExecutionError && error.kind === "response") ||
    (error instanceof Error && error.name === "ZodError")
  ) {
    code = "SG_AI_RESPONSE";
    status = 502;
    message =
      "The AI returned information that could not be checked safely. Please try again.";
  }
  const reference = randomUUID();
  console.error("Simple Grants AI step unavailable", {
    stage,
    code,
    providerStatus: providerStatus ?? "OTHER",
    reference,
  });
  return json(
    { error: `${message} Reference: ${reference} (${code}).`, code, reference },
    status,
  );
}
