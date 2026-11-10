import { useEffect, useRef, useState } from "react";

interface TurnstileOptions {
  sitekey: string;
  action: "simple-grants-sign-in";
  theme: "light";
  size: "flexible";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
}
interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  remove: (widgetId: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const scriptUrl =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${scriptUrl}"]`,
    );
    const created = !script;
    if (!script) {
      script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      script.defer = true;
    }
    const element = script;
    const timeout = window.setTimeout(() => fail(), 20000);
    function cleanup() {
      window.clearTimeout(timeout);
      element.removeEventListener("load", ready);
      element.removeEventListener("error", fail);
    }
    function ready() {
      cleanup();
      if (window.turnstile) resolve(window.turnstile);
      else {
        element.remove();
        reject(new Error("Verification is unavailable."));
      }
    }
    function fail() {
      cleanup();
      element.remove();
      reject(new Error("Verification is unavailable."));
    }
    element.addEventListener("load", ready, { once: true });
    element.addEventListener("error", fail, { once: true });
    if (created) document.head.appendChild(element);
  }).catch((error: unknown) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

type TurnstileProps = {
  siteKey: string;
  onToken: (token: string | null) => void;
  resetKey?: number;
  disabled?: boolean;
};

export default function Turnstile({
  siteKey,
  onToken,
  resetKey = 0,
  disabled = false,
}: TurnstileProps) {
  const container = useRef<HTMLDivElement>(null);
  const tokenCallback = useRef(onToken);
  tokenCallback.current = onToken;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<
    "loading" | "waiting" | "verified" | "error"
  >("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let api: TurnstileApi | null = null;
    let widgetId: string | null = null;
    tokenCallback.current(null);
    setError("");
    setStatus("loading");
    if (!siteKey.trim()) {
      setStatus("error");
      setError(
        "Sign-in verification is not configured. Please contact the site administrator.",
      );
      return;
    }
    loadTurnstile()
      .then((loadedApi) => {
        if (!active || !container.current) return;
        api = loadedApi;
        widgetId = api.render(container.current, {
          sitekey: siteKey,
          action: "simple-grants-sign-in",
          theme: "light",
          size: "flexible",
          callback: (token) => {
            if (!active) return;
            tokenCallback.current(token);
            setError("");
            setStatus("verified");
          },
          "expired-callback": () => {
            if (!active) return;
            tokenCallback.current(null);
            setStatus("error");
            setError("Verification expired. Please complete the check again.");
          },
          "error-callback": () => {
            if (!active) return;
            tokenCallback.current(null);
            setStatus("error");
            setError(
              "We couldn’t complete the verification. Please try the check again.",
            );
          },
        });
        setStatus((current) => (current === "loading" ? "waiting" : current));
      })
      .catch(() => {
        if (!active) return;
        tokenCallback.current(null);
        setStatus("error");
        setError(
          "We couldn’t load sign-in verification. Check your connection and try again.",
        );
      });
    return () => {
      active = false;
      if (api && widgetId !== null) {
        try {
          api.remove(widgetId);
        } catch {
          // A widget can already be removed during a navigation or reset.
        }
      }
      tokenCallback.current(null);
    };
  }, [siteKey, resetKey, attempt]);

  return (
    <div
      className="stack"
      aria-label="Sign-in verification"
      aria-disabled={disabled}
    >
      <div
        ref={container}
        inert={disabled || undefined}
        style={disabled ? { pointerEvents: "none", opacity: 0.65 } : undefined}
      />
      <div aria-live="polite" className="small muted">
        {status === "loading" && "Loading sign-in verification…"}
        {status === "verified" && "Verification complete."}
      </div>
      {error && (
        <div className="stack">
          <p className="error-box" role="alert">
            {error}
          </p>
          {!!siteKey.trim() && (
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try verification again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
