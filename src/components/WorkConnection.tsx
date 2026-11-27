import { useEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import type { Organisation } from "../types";
import { supabase } from "../lib/supabase";
import Brand from "./Brand";
import { Busy } from "./ui";

class WorkRequestError extends Error {
  constructor(readonly status: number) {
    super("Simple Grants could not complete the connection request.");
  }
}

async function workRequest<T>(
  path: string,
  signal?: AbortSignal,
  init?: RequestInit,
) {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw new WorkRequestError(401);
  const response = await fetch(`/api/work-oauth/${path}`, {
    ...init,
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) throw new WorkRequestError(response.status);
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new WorkRequestError(404);
  return (await response.json()) as T;
}

export function WorkConsent({
  requestId,
  organisations,
  email,
  loaded,
  workspaceError,
  retryWorkspace,
}: {
  requestId: string;
  organisations: Organisation[];
  email?: string;
  loaded: boolean;
  workspaceError: boolean;
  retryWorkspace: () => Promise<void>;
}) {
  const [request, setRequest] = useState<"loading" | "pending" | "unavailable">(
    "loading",
  );
  const [orgId, setOrgId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const updating = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void workRequest<{ pending: boolean }>(
      `consent?request=${encodeURIComponent(requestId)}`,
      controller.signal,
    )
      .then(({ pending }) => setRequest(pending ? "pending" : "unavailable"))
      .catch(() => {
        if (!controller.signal.aborted) setRequest("unavailable");
      });
    return () => controller.abort();
  }, [requestId]);

  async function decide(deny: boolean) {
    if (updating.current || (!deny && !orgId)) return;
    updating.current = true;
    setBusy(true);
    setError("");
    try {
      const { redirectUrl } = await workRequest<{ redirectUrl: string }>(
        "consent",
        undefined,
        {
          method: "POST",
          body: JSON.stringify(
            deny ? { requestId, deny: true } : { requestId, orgId },
          ),
        },
      );
      const callback = new URL(redirectUrl);
      if (
        !["https://chatgpt.com", "https://chat.openai.com"].includes(
          callback.origin,
        ) ||
        callback.username ||
        callback.password
      )
        throw new Error("Invalid ChatGPT callback.");
      window.location.assign(callback.href);
    } catch {
      setError(
        "The request could not be completed. Retry here or start a new connection in ChatGPT.",
      );
      setBusy(false);
      updating.current = false;
    }
  }

  return (
    <main className="work-consent">
      <section className="card stack" aria-labelledby="work-consent-title">
        <a className="brand" href="/" aria-label="Simple Grants home">
          <Brand />
        </a>
        <h1 id="work-consent-title">Connect ChatGPT Work</h1>
        {request === "loading" ? (
          <Busy label="Checking the connection request…" />
        ) : request === "unavailable" ? (
          <>
            <p>
              Start a new connection from ChatGPT Work and complete it in the
              same browser.
            </p>
            <a className="text-link" href="/">
              Go to Simple Grants
            </a>
          </>
        ) : (
          <>
            <p>
              Choose one organisation. ChatGPT can read grant information and
              eligible evidence. If your role allows editing, it can also save
              notes, grant leads and application drafts.
            </p>
            {email && <p className="small muted">Signed in as {email}</p>}
            {workspaceError ? (
              <button
                className="button secondary align-start"
                onClick={() => void retryWorkspace()}
              >
                Retry loading organisations
              </button>
            ) : !loaded ? (
              <Busy label="Loading your organisations…" />
            ) : organisations.length === 0 ? (
              <p>Add an organisation in Simple Grants before connecting.</p>
            ) : (
              <label className="form-field">
                Organisation
                <select
                  value={orgId}
                  onChange={(event) => setOrgId(event.target.value)}
                  disabled={busy}
                >
                  <option value="">Choose an organisation</option>
                  {organisations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="small muted">
              You can disconnect any time in Organisation settings.
            </p>
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
            <div className="button-group">
              <button
                className="button primary"
                disabled={busy || !loaded || workspaceError || !orgId}
                onClick={() => void decide(false)}
              >
                {busy ? "Returning to ChatGPT…" : "Allow access"}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void decide(true)}
              >
                Decline
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export function WorkConnectionSettings({ orgId }: { orgId: string }) {
  const [connection, setConnection] = useState<
    "connected" | "disconnected" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void workRequest<{ connected: boolean }>(
      `connections?orgId=${encodeURIComponent(orgId)}`,
      controller.signal,
    )
      .then(({ connected }) =>
        setConnection(connected ? "connected" : "disconnected"),
      )
      .catch((issue) => {
        if (
          controller.signal.aborted ||
          (issue instanceof WorkRequestError &&
            [401, 404].includes(issue.status))
        )
          return;
        setError(
          "Couldn’t check your ChatGPT connection. Reload this page to retry.",
        );
      });
    return () => controller.abort();
  }, [orgId]);

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await workRequest("connections", undefined, {
        method: "DELETE",
        body: JSON.stringify({ orgId }),
      });
      setConnection("disconnected");
    } catch {
      setError("Couldn’t disconnect ChatGPT. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!connection && !error) return null;
  return (
    <section className="card stack" aria-label="ChatGPT Work connection">
      <h2 className="inline-heading">
        <Link2 size={20} aria-hidden="true" /> ChatGPT Work
      </h2>
      {connection && (
        <p className="muted" role="status">
          {connection === "connected"
            ? "Your ChatGPT account has access to this organisation."
            : "To connect this organisation, start in the Simple Grants plugin in ChatGPT Work."}
        </p>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {connection === "connected" && (
        <button
          className="button secondary align-start"
          disabled={busy}
          onClick={() => void disconnect()}
        >
          {busy ? "Disconnecting…" : "Disconnect ChatGPT"}
        </button>
      )}
    </section>
  );
}
