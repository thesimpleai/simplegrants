import { useRef, useState } from "react";
import { ArrowRight, Leaf, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { safeAuthReturnPath } from "../lib/auth-links";
import { Busy, Notice } from "./ui";

type Confirmation = { tokenHash: string; next: string };

type AuthConfirmProps = {
  /** Parsed and removed from the URL once, before React is rendered. */
  confirmation: Confirmation | null;
  onComplete: (next: string) => void;
};

/** A deliberate click consumes the one-time link; visiting this page never does. */
export default function AuthConfirm({
  confirmation,
  onComplete,
}: AuthConfirmProps) {
  const [link] = useState(() => confirmation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const canConfirm = Boolean(link?.tokenHash && supabase);

  async function confirmSignIn() {
    if (!link || !supabase || inFlight.current || error) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const { data, error: verificationError } = await supabase.auth.verifyOtp({
        token_hash: link.tokenHash,
        type: "email",
      });
      if (verificationError || !data.session) {
        throw new Error("Sign-in could not be completed.");
      }
      onComplete(safeAuthReturnPath(link.next));
    } catch {
      // Never show SDK errors or the token in the interface or logs.
      setError(
        "This sign-in link could not be used. It may have expired or already been used. Please request a new link.",
      );
      setBusy(false);
      inFlight.current = false;
    }
  }

  return (
    <div className="login-page">
      <div className="login-story">
        <a className="brand" href="/" aria-label="Simple Grants home">
          <span className="brand-symbol">
            <Leaf size={24} />
          </span>
          simple<span>grant</span>
          <span className="brand-period">.</span>
        </a>
        <div>
          <span className="hero-eyebrow">GOOD WORK DESERVES GOOD SUPPORT</span>
          <h1>
            Your next chapter.
            <br />
            One simple step.
          </h1>
          <p>Your organisations, your grants, and the difference you make.</p>
        </div>
        <small>Made for Australian community organisations.</small>
      </div>
      <main className="login-form">
        <span className="eyebrow">SIMPLE GRANTS SIGN-IN</span>
        <h2>
          {canConfirm ? "You’re nearly there." : "Let’s get you a new link."}
        </h2>
        <div className="stack">
          {canConfirm ? (
            <>
              <p>Choose Sign in to open your Simple Grants workspace.</p>
              <Notice>
                <span className="inline-heading">
                  <ShieldCheck size={18} aria-hidden="true" />
                  This one-time link is only used when you choose to sign in.
                </span>
              </Notice>
              {error ? (
                <p className="error-box" role="alert">
                  {error}
                </p>
              ) : (
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={confirmSignIn}
                >
                  {busy ? (
                    <Busy label="Signing you in…" />
                  ) : (
                    <>
                      Sign in <ArrowRight size={17} />
                    </>
                  )}
                </button>
              )}
            </>
          ) : (
            <p>
              This sign-in link is missing or cannot be used. Return to sign-in
              and request a new email link.
            </p>
          )}
          <a className="text-link" href="/">
            Back to sign-in
          </a>
        </div>
        <p className="muted small">
          One login. All your organisations. A little less to remember.
        </p>
      </main>
    </div>
  );
}
