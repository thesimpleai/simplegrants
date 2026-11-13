import { randomUUID } from "node:crypto";
import { HttpError, json } from "./core";

export type AIFailure = "timeout" | "response";
export class AIExecutionError extends Error {
  constructor(
    public kind: AIFailure,
    public reason?: "MODEL_OUTPUT_LIMIT" | "EMPTY_TEXT" | "INVALID_JSON",
  ) {
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

function isProviderTimeout(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (
    ["AbortError", "TimeoutError", "APIConnectionTimeoutError"].includes(
      String(record.name ?? ""),
    )
  )
    return true;
  if (
    [
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "ABORT_ERR",
    ].includes(String(record.code ?? ""))
  )
    return true;
  // Inspect only for fixed signatures; the message itself is never logged or returned.
  if (
    typeof record.message === "string" &&
    /(?:request|connection|operation|fetch|network|deadline|signal).{0,60}(?:timed out|timeout|aborted|exceeded)|(?:timed out|timeout|aborted).{0,40}(?:request|connection|operation|fetch|network|signal)/i.test(
      record.message,
    )
  )
    return true;
  return (
    depth < 2 && !!record.cause && isProviderTimeout(record.cause, depth + 1)
  );
}
/** Classify SDK wrappers without retaining provider messages, URLs or payloads. */
export function providerFailure(
  error: unknown,
  depth = 0,
): {
  status?: number;
  reason: "TIMEOUT" | "NETWORK" | "PROVIDER" | "OTHER";
} {
  const timedOut = isProviderTimeout(error);
  if (!error || typeof error !== "object" || error instanceof HttpError)
    return { reason: "OTHER" };
  const record = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (
    typeof record.status === "number" &&
    Number.isInteger(record.status) &&
    record.status >= 400 &&
    record.status <= 599
  )
    return {
      status: record.status,
      reason: [408, 504].includes(record.status) ? "TIMEOUT" : "PROVIDER",
    };
  if (timedOut) return { reason: "TIMEOUT" };
  if (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "EAI_AGAIN",
      "ENETUNREACH",
      "UND_ERR_SOCKET",
    ].includes(String(record.code ?? "")) ||
    (typeof record.message === "string" &&
      /\b(?:fetch failed|network error|socket hang up)\b/i.test(record.message))
  )
    return { reason: "NETWORK" };
  return depth < 2 && record.cause
    ? providerFailure(record.cause, depth + 1)
    : { reason: "OTHER" };
}
const providerCodes = new Set([
  "RESOURCE_EXHAUSTED",
  "INVALID_ARGUMENT",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "UNAVAILABLE",
  "INTERNAL",
  "DEADLINE_EXCEEDED",
  "FAILED_PRECONDITION",
  "UNKNOWN",
]);
function validationDiagnostic(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  // Reconstruct field diagnostics rather than logging Google's free-form
  // message, which can quote document content or inline binary data.
  const text = value.slice(0, 8000);
  const requestFields = new Set(
    (
      "generation_config generationConfig response_schema responseSchema response_json_schema responseJsonSchema contents tools parts inline_data inlineData mime_type mimeType data text role google_search googleSearch " +
      "type properties required items enum nullable anyOf any_of additionalProperties additional_properties minItems min_items maxItems max_items minLength min_length maxLength max_length minimum maximum format pattern propertyOrdering property_ordering " +
      "temperature max_output_tokens maxOutputTokens response_mime_type responseMimeType thinking_config thinkingConfig thinking_budget thinkingBudget thinking_level thinkingLevel " +
      "profile name legal_name abn acnc_registered state description focus_areas website checks field issue source suggestion evidence quote missing_information verified_fields documents information category label source_quote mandatory conditional condition_applies critical missing " +
      "opportunities title funder summary source_index source_url guidelines_text amount_min amount_max opens_on closes_at location requirements sections question answer word_limit needs_review budget item amount notes submission_checklist human_review_required"
    ).split(" "),
  );
  const fields = [
    ...new Set(
      text.match(
        /\b(?:generation_config|generationConfig|response_schema|responseSchema|response_json_schema|responseJsonSchema|contents|tools)(?=[.\[])[.\[\]A-Za-z0-9_-]{1,230}/g,
      ) ?? [],
    ),
  ]
    .filter((path) =>
      (path.match(/[A-Za-z_][A-Za-z0-9_-]*/g) ?? []).every((name) =>
        requestFields.has(name),
      ),
    )
    .slice(0, 4);
  const unknown = [
    ...text.matchAll(/Unknown name ["']([A-Za-z_][A-Za-z0-9_]{0,63})["']/g),
  ]
    .map((match) => match[1])
    .filter((name) => requestFields.has(name))
    .slice(0, 4);
  const issue = /Unknown name|Cannot find field/i.test(text)
    ? "Unknown request field"
    : /non-empty|must not be empty/i.test(text)
      ? "Empty required schema value"
      : /unsupported|not supported/i.test(text)
        ? "Unsupported request field or value"
        : "Invalid request field value";
  return fields.length || unknown.length
    ? [issue, ...unknown, ...fields].join(": ")
    : "Gemini rejected the request; no safe field detail was available";
}
function providerDiagnostics(error: unknown) {
  const knownTypes = new Set([
    "ApiError",
    "TypeError",
    "SyntaxError",
    "Error",
    "AbortError",
    "TimeoutError",
    "ZodError",
    "AIExecutionError",
    "HttpError",
  ]);
  const record =
    error && typeof error === "object"
      ? (error as { name?: unknown; message?: unknown })
      : {};
  const errorType =
    typeof record.name === "string" && knownTypes.has(record.name)
      ? record.name
      : "OTHER";
  let providerCode = "OTHER";
  let providerMessage: string | undefined;
  // ApiError.message is JSON returned by Google. Extract ONLY the canonical
  // enum, never its free-form message/details (which may echo private inputs).
  if (
    record.name === "ApiError" &&
    typeof record.message === "string" &&
    record.message.length < 100_000
  ) {
    try {
      const providerError = JSON.parse(record.message)?.error;
      const code: unknown = providerError?.status;
      if (typeof code === "string" && providerCodes.has(code))
        providerCode = code;
      if (providerCode === "INVALID_ARGUMENT") {
        const violations = Array.isArray(providerError?.details)
          ? providerError.details.flatMap(
              (detail: {
                fieldViolations?: { field?: unknown; description?: unknown }[];
              }) =>
                Array.isArray(detail?.fieldViolations)
                  ? detail.fieldViolations
                      .slice(0, 4)
                      .flatMap((item) =>
                        [item.field, item.description].filter(
                          (part) => typeof part === "string",
                        ),
                      )
                  : [],
            )
          : [];
        providerMessage = validationDiagnostic(
          [providerError?.message, ...violations]
            .filter((part) => typeof part === "string")
            .join("\n"),
        );
      }
    } catch {
      /* Non-JSON provider bodies remain private. */
    }
  }
  return {
    errorType,
    providerCode,
    ...(providerMessage ? { providerMessage } : {}),
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
  const failure = providerFailure(error);
  const providerStatus = failure.status;
  const timeout =
    budget.signal.aborted ||
    budget.remaining() === 0 ||
    (error instanceof AIExecutionError && error.kind === "timeout") ||
    providerStatus === 408 ||
    providerStatus === 504 ||
    (!providerStatus && isProviderTimeout(error));
  let code = "SG_AI_UNAVAILABLE",
    status = 503;
  let message =
    "The AI service could not complete this step. Please try again.";
  if (timeout) {
    code = "SG_AI_TIMEOUT";
    status = 504;
    message = stage.startsWith("discover")
      ? "The grant search took too long. Try again, or add a grant using its official guidelines."
      : "This AI step took too long. Your saved information is safe. Please try again.";
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
  } else if ([400, 401, 402, 403, 404, 415].includes(providerStatus || 0)) {
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
  const failureReason =
    error instanceof AIExecutionError &&
    ["MODEL_OUTPUT_LIMIT", "EMPTY_TEXT", "INVALID_JSON"].includes(
      error.reason || "",
    )
      ? error.reason
      : error instanceof Error && error.name === "ZodError"
        ? "SCHEMA_MISMATCH"
        : timeout
          ? "TIMEOUT"
          : failure.reason;
  console.error("Simple Grants AI step unavailable", {
    stage,
    code,
    providerStatus: providerStatus ?? "OTHER",
    failureReason,
    ...providerDiagnostics(error),
    reference,
  });
  return json(
    { error: `${message} Reference: ${reference} (${code}).`, code, reference },
    status,
  );
}
