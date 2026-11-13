import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import type {
  AIResult,
  Application,
  Frequency,
  Organisation,
  OrgData,
  Profile,
  ProfileStage,
  ReviewCheck,
  UploadBatchResult,
} from "../types";
import type { AppContextValue } from "./contracts";
import { configured, supabase } from "./supabase";
import { DOCUMENT_BUCKET } from "./constants";
import {
  MAX_AI_DOCUMENTS,
  MAX_AI_DOCUMENT_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_UPLOAD_FILES,
  resolveDocumentFormat,
  unsupportedDocumentMessage,
} from "./document-formats";
import { signOutFromSimpleGrant } from "./auth-session";
import { safeAuthReturnPath } from "./auth-links";
import { validExpiryDate } from "./grant-requirements";
import { demoData, demoOrg, demoOrgTwo } from "./demo";
function organisationPreferenceKey(userId: string) {
  let project = configured ? "connected-project" : "demo";
  try {
    project = new URL(import.meta.env.VITE_SUPABASE_URL).host.toLowerCase();
  } catch {
    /* Browser tests and demo mode may have no project URL. */
  }
  return `simple-grants-last-org-v1:${project}:${userId}`;
}
function readOrganisationPreference(userId: string): string | null {
  try {
    return localStorage.getItem(organisationPreferenceKey(userId));
  } catch {
    return null;
  }
}
function saveOrganisationPreference(userId: string, id: string) {
  try {
    localStorage.setItem(organisationPreferenceKey(userId), id);
  } catch {
    /* Preferences must not block access if storage is disabled. */
  }
}
const empty: OrgData = {
  documents: [],
  opportunities: [],
  applications: [],
  projects: [],
  expenses: [],
  messages: [],
};
const Context = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [organisations, setOrganisations] = useState<Organisation[]>(
      configured ? [] : [demoOrg, demoOrgTwo],
    ),
    [orgId, setOrgId] = useState(() =>
      configured
        ? ""
        : ([demoOrg, demoOrgTwo].find(
            (item) =>
              item.id ===
              new URLSearchParams(window.location.search).get("org"),
          )?.id ??
          [demoOrg, demoOrgTwo].find(
            (item) => item.id === readOrganisationPreference("demo"),
          )?.id ??
          demoOrg.id),
    ),
    [data, setData] = useState<OrgData>(configured ? empty : demoData(orgId)),
    [loading, setLoading] = useState(configured),
    [connectionError, setConnectionError] = useState<string | null>(null),
    [organisationsLoaded, setOrganisationsLoaded] = useState(!configured),
    [toast, setToast] = useState("");
  const mounted = useRef(false);
  const currentUserId = useRef<string | null>(null);
  const authRequest = useRef(0);
  const organisationRequest = useRef(0);
  const organisationsReady = useRef(!configured);
  const failureStage = useRef<"session" | "organizations" | "data" | null>(
    null,
  );
  const retryPending = useRef(false);
  const activeOrg = useRef(orgId);
  activeOrg.current = orgId;
  const request = useRef(0),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const org = organisations.find((o) => o.id === orgId) || null;
  const mode = configured ? "live" : "demo";
  function notify(m: string) {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  }
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  function clearConnectionError() {
    failureStage.current = null;
    setConnectionError(null);
  }
  function markOrganisationsLoaded(ready: boolean) {
    organisationsReady.current = ready;
    setOrganisationsLoaded(ready);
  }
  function connectionMessage(
    error: unknown,
    stage: "session" | "organizations" | "data",
  ) {
    if (stage === "session")
      return "We couldn’t restore your sign-in session. Try connecting again, or return to sign-in for a new email link.";
    const detail =
      error && typeof error === "object"
        ? (error as { code?: unknown; status?: unknown; message?: unknown })
        : {};
    const code = typeof detail.code === "string" ? detail.code : "";
    if (
      ["42501", "PGRST301", "PGRST302"].includes(code) ||
      detail.status === 401 ||
      detail.status === 403
    ) {
      return "Your workspace needs an administrator to finish checking its connection. Please contact support, then try again.";
    }
    if (["PGRST106", "PGRST205", "42P01", "3F000"].includes(code)) {
      return "Your workspace connection is not fully set up. Please contact support, then try again.";
    }
    if (
      error instanceof TypeError ||
      /fetch|network|connection|timeout/i.test(
        typeof detail.message === "string" ? detail.message : "",
      )
    ) {
      return "We couldn’t connect to your workspace. Check your internet connection and try again. If it continues, please contact support.";
    }
    return stage === "data"
      ? "This organisation’s records could not be loaded. Please try again. If it continues, please contact support."
      : "Your organisations could not be loaded. Please try again. If it continues, please contact support.";
  }
  function applyIdentity(nextUser: User | null) {
    const nextId = nextUser?.id ?? null;
    if (currentUserId.current !== nextId) {
      currentUserId.current = nextId;
      organisationRequest.current++;
      request.current++;
      activeOrg.current = "";
      markOrganisationsLoaded(false);
      setOrganisations([]);
      setOrgId("");
      setData(empty);
      clearConnectionError();
      setLoading(Boolean(nextUser));
    }
    setUser(nextUser);
    if (!nextUser) {
      clearConnectionError();
      setLoading(false);
    }
  }
  async function restoreSession() {
    if (!supabase) return;
    const current = ++authRequest.current;
    setLoading(true);
    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (!mounted.current || current !== authRequest.current) return;
      if (error) throw error;
      applyIdentity(session?.user ?? null);
    } catch (error) {
      if (!mounted.current || current !== authRequest.current) return;
      failureStage.current = "session";
      setConnectionError(connectionMessage(error, "session"));
      setLoading(false);
    }
  }
  async function loadOrganisations(userId: string) {
    if (!supabase || currentUserId.current !== userId) return;
    const current = ++organisationRequest.current;
    setLoading(true);
    markOrganisationsLoaded(false);
    const isCurrent = () =>
      mounted.current &&
      current === organisationRequest.current &&
      currentUserId.current === userId;
    try {
      const { data: rows, error } = await supabase
        .from("organizations")
        .select("*")
        .order("created_at");
      if (!isCurrent()) return;
      if (error) throw error;
      if (!Array.isArray(rows))
        throw new Error("The workspace response could not be read.");
      setOrganisations(rows);
      const requested = new URLSearchParams(window.location.search).get("org");
      const remembered = readOrganisationPreference(userId);
      const chosen =
        rows.find((item) => item.id === requested)?.id ??
        rows.find((item) => item.id === activeOrg.current)?.id ??
        rows.find((item) => item.id === remembered)?.id ??
        rows[0]?.id ??
        "";
      activeOrg.current = chosen;
      setOrgId(chosen);
      if (chosen) {
        saveOrganisationPreference(userId, chosen);
        const params = new URLSearchParams(window.location.search);
        params.set("org", chosen);
        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}?${params}`,
        );
      }
      markOrganisationsLoaded(true);
      clearConnectionError();
    } catch (error) {
      if (!isCurrent()) return;
      failureStage.current = "organizations";
      setConnectionError(connectionMessage(error, "organizations"));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }
  useEffect(() => {
    if (!supabase) return;
    mounted.current = true;
    void restoreSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      authRequest.current++;
      applyIdentity(session?.user ?? null);
    });
    return () => {
      mounted.current = false;
      authRequest.current++;
      organisationRequest.current++;
      request.current++;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!supabase || !user) return;
    void loadOrganisations(user.id);
    return () => {
      organisationRequest.current++;
    };
  }, [user?.id]);
  async function refresh() {
    if (
      !supabase ||
      !orgId ||
      activeOrg.current !== orgId ||
      !currentUserId.current
    )
      return;
    const current = ++request.current;
    const userId = currentUserId.current;
    const requestedOrg = orgId;
    const isCurrent = () =>
      mounted.current &&
      current === request.current &&
      currentUserId.current === userId &&
      activeOrg.current === requestedOrg;
    setLoading(true);
    const tableNames = [
      "documents",
      "opportunities",
      "applications",
      "funded_projects",
      "expenses",
      "inbox_messages",
    ];
    try {
      const results = await Promise.all(
        tableNames.map((table) =>
          supabase!.from(table).select("*").eq("org_id", requestedOrg),
        ),
      );
      if (!isCurrent()) return;
      for (const result of results) {
        if (result.error) throw result.error;
        if (!Array.isArray(result.data))
          throw new Error("The organisation records could not be read.");
      }
      setData({
        documents: results[0].data ?? [],
        opportunities: results[1].data ?? [],
        applications: results[2].data ?? [],
        projects: results[3].data ?? [],
        expenses: results[4].data ?? [],
        messages: results[5].data ?? [],
      });
      clearConnectionError();
    } catch (error) {
      if (!isCurrent()) return;
      const message = connectionMessage(error, "data");
      failureStage.current = "data";
      setConnectionError(message);
      throw new Error(message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }
  useEffect(() => {
    request.current++;
    if (!orgId) {
      setData(empty);
      return;
    }
    setData(configured ? empty : demoData(orgId));
    if (configured) {
      if (failureStage.current === "data") clearConnectionError();
      void refresh().catch(() => {});
    }
  }, [orgId]);
  async function retryConnection() {
    if (!supabase || retryPending.current) return;
    retryPending.current = true;
    try {
      if (!currentUserId.current || failureStage.current === "session")
        await restoreSession();
      else if (
        organisationsReady.current &&
        activeOrg.current &&
        failureStage.current === "data"
      )
        await refresh();
      else await loadOrganisations(currentUserId.current);
    } catch {
      // Each loader keeps its own persistent, safe diagnostic in context.
    } finally {
      retryPending.current = false;
    }
  }
  function chooseOrganisation(id: string) {
    activeOrg.current = id;
    setOrgId(id);
    const identity = currentUserId.current ?? (configured ? null : "demo");
    if (identity) saveOrganisationPreference(identity, id);
    const params = new URLSearchParams(window.location.search);
    params.set("org", id);
    params.delete("grant");
    params.delete("opportunity");
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${params}`,
    );
  }
  async function createOrg(name: string, frequency: Frequency) {
    if (!name.trim()) throw new Error("Please enter an organisation name.");
    if (
      supabase &&
      (!currentUserId.current ||
        !organisationsReady.current ||
        failureStage.current)
    )
      throw new Error(
        "Reconnect your workspace before adding an organisation.",
      );
    if (supabase) {
      const { data, error } = await supabase.rpc("create_organization", {
        p_name: name.trim(),
        p_frequency: frequency,
      });
      if (error) throw error;
      const o = Array.isArray(data) ? data[0] : data;
      if (!o) throw new Error("The organisation could not be created.");
      setOrganisations((a) => [...a, o]);
      chooseOrganisation(o.id);
    } else {
      const id = crypto.randomUUID();
      const o: Organisation = {
        id,
        name: name.trim(),
        abn: null,
        type: "",
        state: "VIC",
        description: "",
        focus_areas: [],
        profile: { name: name.trim() },
        notification_frequency: frequency,
        verification_status: "draft",
        inbox_alias: `demo-${id.slice(0, 8)}`,
      };
      setOrganisations((a) => [...a, o]);
      chooseOrganisation(id);
    }
    notify("Organisation created. Add your documents to get started.");
  }
  async function updateOrg(patch: Partial<Organisation>) {
    if (!org) throw new Error("Choose an organisation first.");
    if (supabase) {
      const { error } = await supabase
        .from("organizations")
        .update(patch)
        .eq("id", org.id);
      if (error) throw error;
    }
    setOrganisations((a) =>
      a.map((o) => (o.id === org.id ? { ...o, ...patch } : o)),
    );
    notify("Organisation details saved.");
  }
  async function uploadDocuments(
    files: File[],
    category: string,
    expiresOn: string | null = null,
  ): Promise<UploadBatchResult> {
    if (!org) throw new Error("Choose an organisation first.");
    if (!supabase)
      throw new Error(
        "File storage is available after connecting Supabase. This demo does not store your documents.",
      );
    if (expiresOn !== null && !validExpiryDate(expiresOn))
      throw new Error("Enter a valid document expiry date.");
    const result: UploadBatchResult = { saved: [], failed: [], skipped: [] };
    if (!files.length) return result;
    if (files.length > MAX_UPLOAD_FILES)
      throw new Error(
        `Please upload up to ${MAX_UPLOAD_FILES} files at a time.`,
      );
    // Every file is validated before any upload, including files later skipped as duplicates.
    const prepared = files.map((file) => {
      const format = resolveDocumentFormat(file);
      if (!format)
        throw new Error(
          `${file.name}: ${unsupportedDocumentMessage(file.name)}`,
        );
      if (file.size > MAX_DOCUMENT_BYTES)
        throw new Error(
          `${file.name} is too large. Maximum file size is 10 MB.`,
        );
      return { file, format };
    });
    const targetOrg = org.id;
    const targetUser = currentUserId.current;
    const isCurrent = () =>
      activeOrg.current === targetOrg && currentUserId.current === targetUser;
    const key = (name: string, size: number, mime: string) =>
      JSON.stringify([name.normalize("NFC"), size, mime]);
    const existing = new Set(
      data.documents
        .filter((document) => document.org_id === targetOrg)
        .map((document) =>
          key(
            document.name,
            document.size_bytes,
            resolveDocumentFormat({
              name: document.name,
              type: document.mime_type,
            })?.mimeType ??
              document.mime_type.split(";")[0].trim().toLowerCase(),
          ),
        ),
    );
    const selected = new Set<string>();
    const queue = prepared.filter(({ file, format }) => {
      const identity = key(file.name, file.size, format.mimeType);
      const reason = existing.has(identity)
        ? "Same name, size and type already in your library."
        : selected.has(identity)
          ? "Same name, size and type already selected in this batch."
          : "";
      selected.add(identity);
      if (reason) {
        result.skipped.push({ name: file.name, reason });
        return false;
      }
      return true;
    });
    for (let index = 0; index < queue.length; index++) {
      const { file, format } = queue[index];
      if (!isCurrent()) {
        result.skipped.push(
          ...queue.slice(index).map((item) => ({
            name: item.file.name,
            reason:
              "Organisation or sign-in changed before this file was uploaded.",
          })),
        );
        break;
      }
      const path = `${targetOrg}/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      let stored = false;
      try {
        const uploaded = await supabase.storage
          .from(DOCUMENT_BUCKET)
          .upload(path, file, { contentType: format.mimeType });
        if (uploaded.error) throw uploaded.error;
        stored = true;
        if (!isCurrent()) throw new Error("organisation_changed");
        const saved = await supabase.from("documents").insert({
          org_id: targetOrg,
          name: file.name,
          category,
          expires_on: expiresOn,
          storage_path: path,
          mime_type: format.mimeType,
          size_bytes: file.size,
          verified: false,
        });
        if (saved.error) throw saved.error;
        result.saved.push(file.name);
      } catch (error) {
        if (stored) {
          try {
            await supabase.storage.from(DOCUMENT_BUCKET).remove([path]);
          } catch {
            /* A failed cleanup must not stop the remaining batch. */
          }
        }
        const message =
          error &&
          typeof error === "object" &&
          "message" in error &&
          typeof error.message === "string"
            ? error.message
            : "";
        const reason = /organisation_changed/.test(message)
          ? "Upload interrupted because the organisation or sign-in changed."
          : /mime|content.?type|unsupported|file type/i.test(message)
            ? "Your document library needs an update to accept this file type. Please contact support."
            : "Could not upload this file. Check your connection and try this file again.";
        result.failed.push({ name: file.name, reason });
      }
    }
    if (result.saved.length && isCurrent()) {
      try {
        await refresh();
      } catch {
        /* The workspace connection card retries loading saved records. */
      }
    }
    if (isCurrent())
      notify(
        `${result.saved.length} saved · ${result.failed.length} failed · ${result.skipped.length} skipped. Review the upload results.`,
      );
    return result;
  }
  async function updateDocumentExpiry(id: string, expiresOn: string | null) {
    const targetOrg = orgId;
    const targetUser = currentUserId.current;
    if (
      !data.documents.some((doc) => doc.id === id && doc.org_id === targetOrg)
    )
      throw new Error("Choose a document in this organisation.");
    if (expiresOn !== null && !validExpiryDate(expiresOn))
      throw new Error("Enter a valid document expiry date.");
    if (supabase) {
      const { data: saved, error } = await supabase
        .from("documents")
        .update({ expires_on: expiresOn })
        .eq("id", id)
        .eq("org_id", targetOrg)
        .select("id, expires_on")
        .maybeSingle();
      if (error || !saved || saved.id !== id || saved.expires_on !== expiresOn)
        throw new Error(
          "The document expiry could not be saved. Check your access and try again.",
        );
    }
    if (activeOrg.current !== targetOrg || currentUserId.current !== targetUser)
      return;
    setData((current) => ({
      ...current,
      documents: current.documents.map((doc) =>
        doc.id === id ? { ...doc, expires_on: expiresOn } : doc,
      ),
    }));
    notify("Document expiry saved.");
  }
  async function removeDocument(id: string) {
    const doc = data.documents.find((d) => d.id === id);
    if (!doc) return;
    if (supabase) {
      const result = await supabase
        .from("documents")
        .delete()
        .eq("id", id)
        .eq("org_id", orgId);
      if (result.error) throw result.error;
      const storage = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .remove([doc.storage_path]);
      if (storage.error)
        notify(
          "Document record removed. A stored file could not be removed; ask your administrator to clean it up.",
        );
    }
    setData((d) => ({
      ...d,
      documents: d.documents.filter((x) => x.id !== id),
    }));
    notify("Document removed.");
  }
  async function openDocument(id: string) {
    const doc = data.documents.find((d) => d.id === id);
    if (!doc) return;
    if (!supabase)
      throw new Error(
        "This is an example document. Connect Supabase to upload and view real files.",
      );
    const format = resolveDocumentFormat({
      name: doc.name,
      type: doc.mime_type,
    });
    const preview = format?.kind === "pdf" || format?.kind === "image";
    const { data: link, error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(
        doc.storage_path,
        60,
        preview ? undefined : { download: doc.name },
      );
    if (error) throw error;
    window.open(link.signedUrl, "_blank", "noopener,noreferrer");
  }
  async function runAI(
    payload: Parameters<AppContextValue["runAI"]>[0],
    onProgress?: (stage: ProfileStage) => void,
  ): Promise<AIResult> {
    if (!supabase)
      throw new Error(
        "AI is not connected in the demo. Add your Supabase and Gemini settings to use this feature with your own information.",
      );
    const targetOrg = orgId;
    const targetUser = currentUserId.current;
    const original = Object.freeze({
      ...payload,
      text: payload.text ?? "",
      documentIds: Object.freeze([...(payload.documentIds ?? [])]),
      orgId: targetOrg,
    });
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value);
    const isProfile = (value: unknown): value is Profile =>
      isRecord(value) &&
      typeof value.name === "string" &&
      ["abn", "type", "state", "description", "website", "legal_name"].every(
        (key) => value[key] === undefined || typeof value[key] === "string",
      ) &&
      (value.acnc_registered === undefined ||
        typeof value.acnc_registered === "boolean") &&
      (value.focus_areas === undefined ||
        (Array.isArray(value.focus_areas) &&
          value.focus_areas.every((area) => typeof area === "string")));
    const isChecks = (value: unknown): value is ReviewCheck[] =>
      Array.isArray(value) &&
      value.every(
        (item) =>
          isRecord(item) &&
          typeof item.field === "string" &&
          typeof item.issue === "string" &&
          (item.source === undefined || typeof item.source === "string") &&
          (item.suggestion === undefined ||
            typeof item.suggestion === "string"),
      );
    const savedFiles =
      original.action === "profile"
        ? " Your uploaded documents are still saved in your library."
        : "";
    function ensureCurrent() {
      if (
        !targetOrg ||
        !targetUser ||
        activeOrg.current !== targetOrg ||
        currentUserId.current !== targetUser
      )
        throw new Error(
          "Your selected organisation or sign-in changed. Return to the original organisation and try again. Your saved documents remain in its library.",
        );
    }
    function failure(code = "SG_AI_RESPONSE", reference?: unknown) {
      const messages: Record<string, string> = {
        SG_AI_TIMEOUT:
          original.action === "discover"
            ? "The grant search took too long. Try again, or add a grant using its official guidelines."
            : "This AI step took too long. Your saved information is safe. Please try again.",
        SG_AI_QUOTA:
          "Your AI assistant has reached a service limit. Please try again later.",
        SG_AI_SETUP:
          "Your AI assistant is not fully connected yet. Please contact support.",
        SG_AI_PROVIDER:
          "Your AI assistant needs a configuration check. Please contact support.",
        SG_AI_UNAVAILABLE:
          "Your AI assistant is temporarily unavailable. Please try again.",
        SG_AI_NETWORK:
          "We couldn’t connect to your AI assistant. Check your connection and try again.",
        SG_AI_RESPONSE:
          "We couldn’t read a response from your AI assistant. Please try again.",
      };
      const safeCode = Object.hasOwn(messages, code) ? code : "SG_AI_RESPONSE";
      const safeReference =
        typeof reference === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          reference,
        )
          ? `${reference} (${safeCode})`
          : safeCode;
      return new Error(
        `${messages[safeCode]}${savedFiles} Reference: ${safeReference}.`,
      );
    }
    ensureCurrent();
    if (original.action === "profile") {
      if (original.documentIds.length > MAX_AI_DOCUMENTS)
        throw new Error(
          `Please choose up to ${MAX_AI_DOCUMENTS} documents for each profile review. Your other documents remain in the library.`,
        );
      const total = data.documents
        .filter((document) => original.documentIds.includes(document.id))
        .reduce((sum, document) => sum + document.size_bytes, 0);
      if (total > MAX_AI_DOCUMENT_BYTES)
        throw new Error(
          "Please choose documents totalling no more than 15 MB for this profile review. Your other documents remain in the library.",
        );
    }
    let session: Session | null;
    try {
      const result = await supabase.auth.getSession();
      if (result.error) throw result.error;
      session = result.data.session;
    } catch {
      throw new Error(
        `Please sign in again to use your AI assistant.${savedFiles} Reference: SG_AI_SESSION.`,
      );
    }
    ensureCurrent();
    if (!session || session.user.id !== targetUser)
      throw new Error(
        `Please sign in again to use your AI assistant.${savedFiles} Reference: SG_AI_SESSION.`,
      );
    async function requestAI(extra: Record<string, unknown> = {}) {
      ensureCurrent();
      let response: Response;
      try {
        response = await fetch("/api/ai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session!.access_token}`,
          },
          body: JSON.stringify({ ...original, ...extra }),
          signal: AbortSignal.timeout(45000),
        });
      } catch (error) {
        ensureCurrent();
        throw failure(
          error instanceof DOMException &&
            ["AbortError", "TimeoutError"].includes(error.name)
            ? "SG_AI_TIMEOUT"
            : "SG_AI_NETWORK",
        );
      }
      ensureCurrent();
      if (
        response.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== "application/json"
      )
        throw failure(
          [408, 504, 524].includes(response.status)
            ? "SG_AI_TIMEOUT"
            : "SG_AI_RESPONSE",
        );
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw failure();
      }
      ensureCurrent();
      if (!isRecord(body)) throw failure();
      if (!response.ok || typeof body.error === "string") {
        if (typeof body.code === "string" && body.code.startsWith("SG_AI_"))
          throw failure(body.code, body.reference);
        const safeText = (value: unknown): value is string =>
          typeof value === "string" &&
          value.length > 0 &&
          value.length <= 1500 &&
          !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
        if (safeText(body.error)) {
          const blockers = Array.isArray(body.blockers)
            ? body.blockers.filter(safeText).slice(0, 20)
            : [];
          const reference =
            typeof body.reference === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              body.reference,
            )
              ? `Reference: ${body.reference}.`
              : "";
          throw new Error(
            [body.error, ...blockers, savedFiles.trim(), reference]
              .filter(Boolean)
              .join(" "),
          );
        }
        throw failure();
      }
      return body;
    }
    if (original.action === "profile") {
      ensureCurrent();
      onProgress?.("extract");
      const extracted = await requestAI({ profileStage: "extract" });
      if (
        !isProfile(extracted.profileDraft) ||
        typeof extracted.sourceFingerprint !== "string" ||
        !/^[0-9a-f]{64}$/i.test(extracted.sourceFingerprint)
      )
        throw failure();
      const sourceFingerprint = extracted.sourceFingerprint;
      ensureCurrent();
      onProgress?.("verify");
      const verified = await requestAI({
        profileStage: "verify",
        profileDraft: extracted.profileDraft,
        sourceFingerprint,
      });
      if (
        !isProfile(verified.profileDraft) ||
        !isChecks(verified.profileChecks) ||
        verified.sourceFingerprint !== sourceFingerprint
      )
        throw failure();
      ensureCurrent();
      onProgress?.("correct");
      const corrected = await requestAI({
        profileStage: "correct",
        profileDraft: verified.profileDraft,
        profileChecks: verified.profileChecks,
        sourceFingerprint,
      });
      if (
        !isProfile(corrected.profile) ||
        !isChecks(corrected.checks) ||
        corrected.sourceFingerprint !== sourceFingerprint
      )
        throw failure();
      ensureCurrent();
      return corrected as AIResult;
    }
    const isReceipt = (result: Record<string, unknown>) =>
      typeof result.sourceFingerprint === "string" &&
      /^[0-9a-f]{64}$/i.test(result.sourceFingerprint) &&
      typeof result.stageIssuedAt === "number" &&
      Number.isSafeInteger(result.stageIssuedAt) &&
      result.stageIssuedAt > 0;
    const isSources = (value: unknown) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 20 &&
      value.every((source) => {
        if (
          !isRecord(source) ||
          typeof source.title !== "string" ||
          source.title.length > 1000 ||
          typeof source.uri !== "string" ||
          source.uri.length > 3000
        )
          return false;
        try {
          const url = new URL(source.uri);
          return url.protocol === "https:" && !url.username && !url.password;
        } catch {
          return false;
        }
      });
    const isSearchDraft = (value: unknown) =>
      isRecord(value) &&
      typeof value.summary === "string" &&
      value.summary.length > 0 &&
      value.summary.length <= 30000 &&
      isSources(value.sources);
    const isRequirement = (value: unknown) =>
      isRecord(value) &&
      typeof value.label === "string" &&
      value.label.length > 0 &&
      value.label.length <= 300 &&
      typeof value.source_quote === "string" &&
      value.source_quote.length >= 12 &&
      value.source_quote.length <= 2500 &&
      typeof value.mandatory === "boolean" &&
      typeof value.conditional === "boolean" &&
      (typeof value.condition_applies === "boolean" ||
        value.condition_applies === null);
    const isDraftRequirements = (value: unknown) =>
      isRecord(value) &&
      Array.isArray(value.documents) &&
      value.documents.length <= 40 &&
      Array.isArray(value.information) &&
      value.information.length <= 40 &&
      value.documents.every(
        (item) =>
          isRequirement(item) &&
          isRecord(item) &&
          [
            "financial_statement",
            "audit_report",
            "insurance",
            "registration",
            "acnc",
            "other",
          ].includes(String(item.category)),
      ) &&
      value.information.every(
        (item) =>
          isRequirement(item) &&
          isRecord(item) &&
          ["budget", "summary", "other"].includes(String(item.field)) &&
          typeof item.critical === "boolean" &&
          typeof item.missing === "boolean",
      );
    let result: Record<string, unknown>;
    if (original.action === "discover") {
      const searched = await requestAI({ discoveryStage: "search" });
      if (!isReceipt(searched) || !isSearchDraft(searched.searchDraft))
        throw failure();
      ensureCurrent();
      result = await requestAI({
        discoveryStage: "extract",
        searchDraft: searched.searchDraft,
        sourceFingerprint: searched.sourceFingerprint,
        stageIssuedAt: searched.stageIssuedAt,
      });
    } else if (original.action === "draft") {
      const checked = await requestAI({ draftStage: "preflight" });
      if (
        !isReceipt(checked) ||
        !isDraftRequirements(checked.draftRequirements)
      )
        throw failure();
      ensureCurrent();
      result = await requestAI({
        draftStage: "generate",
        draftRequirements: checked.draftRequirements,
        sourceFingerprint: checked.sourceFingerprint,
        stageIssuedAt: checked.stageIssuedAt,
      });
    } else result = await requestAI();
    const valid =
      original.action === "discover" || original.action === "import-grant"
        ? Array.isArray(result.opportunities)
        : original.action === "draft"
          ? isRecord(result.draft)
          : original.action === "report"
            ? isRecord(result.report)
            : original.action === "ask"
              ? typeof result.answer === "string"
              : false;
    if (!valid) throw failure();
    ensureCurrent();
    if (
      ["discover", "import-grant", "draft", "report"].includes(original.action)
    ) {
      try {
        await refresh();
      } catch {
        /* A saved result remains valid; the connection card retries loading separately. */
      }
      ensureCurrent();
    }
    return result as AIResult;
  }
  async function saveOpportunity(
    patch: Parameters<AppContextValue["saveOpportunity"]>[0],
  ) {
    if (supabase) {
      const { error } = await supabase
        .from("opportunities")
        .update(patch)
        .eq("id", patch.id)
        .eq("org_id", orgId);
      if (error) throw error;
    }
    setData((d) => ({
      ...d,
      opportunities: d.opportunities.map((o) =>
        o.id === patch.id ? { ...o, ...patch } : o,
      ),
    }));
  }
  async function startApplication(
    opportunity: Parameters<AppContextValue["startApplication"]>[0],
  ) {
    const found = data.applications.find(
      (a) => a.opportunity_id === opportunity.id,
    );
    if (found) return found;
    let app: Application = {
      id: crypto.randomUUID(),
      org_id: orgId,
      opportunity_id: opportunity.id,
      title: opportunity.title,
      status: "draft",
      draft: {},
      project_details: {},
      requested_amount: null,
      created_at: new Date().toISOString(),
    };
    if (supabase) {
      const { data: created, error } = await supabase
        .from("applications")
        .insert(app)
        .select()
        .single();
      if (error) throw error;
      app = created;
    }
    setData((d) => ({ ...d, applications: [...d.applications, app] }));
    notify(
      "Application started. Add the guidelines and project details to prepare your draft.",
    );
    return app;
  }
  async function updateApplication(id: string, patch: Partial<Application>) {
    if (supabase) {
      const { error } = await supabase
        .from("applications")
        .update(patch)
        .eq("id", id)
        .eq("org_id", orgId);
      if (error) throw error;
    }
    setData((d) => ({
      ...d,
      applications: d.applications.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    }));
    notify("Application saved.");
  }
  async function createFundedProject(
    applicationId: string,
    input: {
      amount: number;
      startDate: string;
      endDate: string;
      reportDue: string;
      milestone: string;
    },
  ) {
    const application = data.applications.find((a) => a.id === applicationId);
    if (!application || application.status !== "awarded")
      throw new Error("Record the application as awarded first.");
    if (data.projects.some((p) => p.application_id === applicationId))
      throw new Error("This application already has a funded project.");
    if (
      !Number.isFinite(input.amount) ||
      input.amount <= 0 ||
      input.endDate < input.startDate
    )
      throw new Error("Check the awarded amount and project dates.");
    const opportunity = data.opportunities.find(
      (o) => o.id === application.opportunity_id,
    );
    const project = {
      id: crypto.randomUUID(),
      org_id: orgId,
      application_id: applicationId,
      title: application.title,
      funder: opportunity?.funder ?? "Grant funder",
      awarded_amount: input.amount,
      start_date: input.startDate,
      end_date: input.endDate,
      next_report_due: input.reportDue || null,
      status: "active",
      proposal: application.draft,
      budget: {
        notes: String(application.project_details.budget_notes ?? ""),
        awarded_amount: input.amount,
      },
      milestones: input.milestone
        ? [
            {
              title: input.milestone,
              due_date: input.reportDue || input.endDate,
              completed: false,
            },
          ]
        : [],
    };
    if (supabase) {
      const { error } = await supabase.from("funded_projects").insert(project);
      if (error) throw error;
    }
    setData((d) => ({ ...d, projects: [...d.projects, project] }));
    notify("Award recorded. Your funded project is ready to track.");
  }
  async function updateProject(
    id: string,
    patch: Parameters<AppContextValue["updateProject"]>[1],
  ) {
    if (supabase) {
      const { error } = await supabase
        .from("funded_projects")
        .update(patch)
        .eq("id", id)
        .eq("org_id", orgId);
      if (error) throw error;
    }
    setData((d) => ({
      ...d,
      projects: d.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
    notify("Project updated.");
  }
  async function addExpense(
    projectId: string,
    description: string,
    amount: number,
    date: string,
    documentId?: string,
  ) {
    if (!description.trim() || !Number.isFinite(amount) || amount <= 0)
      throw new Error("Add a description and a positive amount.");
    if (
      documentId &&
      !data.documents.some((d) => d.id === documentId && d.org_id === orgId)
    )
      throw new Error("Choose an invoice from this organisation.");
    const expense = {
      document_id: documentId || null,
      id: crypto.randomUUID(),
      org_id: orgId,
      project_id: projectId,
      description: description.trim(),
      amount,
      incurred_on: date,
    };
    if (supabase) {
      const { error } = await supabase.from("expenses").insert(expense);
      if (error) throw error;
    }
    setData((d) => ({ ...d, expenses: [...d.expenses, expense] }));
    notify("Expense added to the project ledger.");
  }
  async function updateMessage(
    id: string,
    patch: Parameters<AppContextValue["updateMessage"]>[1],
  ) {
    if (supabase) {
      const { error } = await supabase
        .from("inbox_messages")
        .update(patch)
        .eq("id", id)
        .eq("org_id", orgId);
      if (error) throw error;
    }
    setData((d) => ({
      ...d,
      messages: d.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
    notify("Message updated.");
  }
  async function signIn(email: string, website = "") {
    if (!supabase)
      throw new Error("Sign-in is unavailable in the demo workspace.");
    const responseFailure = () =>
      new Error(
        "Sign-in is temporarily unavailable. Please try again. Reference: SG_AUTH_RESPONSE.",
      );
    let response: Response;
    try {
      response = await fetch("/api/auth-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          website,
          next: safeAuthReturnPath(
            window.location.pathname + window.location.search,
          ),
        }),
      });
    } catch {
      throw new Error(
        "We couldn’t connect to sign-in. Check your internet connection and try again. Reference: SG_AUTH_NETWORK.",
      );
    }
    if (
      response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      throw responseFailure();
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw responseFailure();
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw responseFailure();
    const body = payload as Record<string, unknown>;
    if (response.status === 503) {
      const safeCodes = new Set([
        "SG_AUTH_SCHEMA",
        "SG_AUTH_RPC",
        "SG_AUTH_ACCESS",
        "SG_AUTH_DATABASE",
        "SG_AUTH_SETUP",
      ]);
      if (
        typeof body.code === "string" &&
        safeCodes.has(body.code) &&
        typeof body.reference === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.reference,
        )
      ) {
        // Rebuild the known public message; never render upstream payloads or HTML.
        throw new Error(
          `Simple Grants sign-in is temporarily unavailable. Please try again. Reference: ${body.reference} (${body.code}).`,
        );
      }
      throw responseFailure();
    }
    // A Netlify SPA fallback can return a successful HTTP 200 with HTML. Only
    // the explicit API acknowledgement can be treated as an email request.
    if (response.status !== 202 || body.accepted !== true)
      throw responseFailure();
    notify(
      "If this address can sign in, a Simple Grants email will arrive shortly.",
    );
  }
  async function signOut() {
    if (supabase) {
      await signOutFromSimpleGrant(supabase);
      authRequest.current++;
      applyIdentity(null);
      setToast("");
    }
  }
  return (
    <Context.Provider
      value={{
        mode,
        configured,
        user,
        org,
        organisations,
        data,
        loading,
        connectionError,
        organisationsLoaded,
        retryConnection,
        toast,
        notify,
        selectOrg: (id: string) => {
          if (organisations.some((item) => item.id === id))
            chooseOrganisation(id);
        },
        signIn,
        signOut,
        createOrg,
        updateOrg,
        uploadDocuments,
        updateDocumentExpiry,
        removeDocument,
        openDocument,
        runAI,
        refresh,
        saveOpportunity,
        startApplication,
        updateApplication,
        createFundedProject,
        updateProject,
        addExpense,
        updateMessage,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("AppProvider is required.");
  return value;
}
