import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import type {
  AIResult,
  Application,
  Frequency,
  Organisation,
  OrgData,
} from "../types";
import type { AppContextValue } from "./contracts";
import { configured, supabase } from "./supabase";
import { DOCUMENT_BUCKET } from "./constants";
import { signOutFromSimpleGrant } from "./auth-session";
import { safeAuthReturnPath } from "./auth-links";
import { demoData, demoOrg, demoOrgTwo } from "./demo";
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
    [orgId, setOrgId] = useState(configured ? "" : demoOrg.id),
    [data, setData] = useState<OrgData>(
      configured ? empty : demoData(demoOrg.id),
    ),
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
      setOrgId((previous) =>
        rows.some((item) => item.id === previous)
          ? previous
          : (rows.find(
              (item) =>
                item.id ===
                new URLSearchParams(window.location.search).get("org"),
            )?.id ??
            rows[0]?.id ??
            ""),
      );
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
      setOrgId(o.id);
    } else {
      const id = crypto.randomUUID();
      const o: Organisation = {
        id,
        name: name.trim(),
        abn: null,
        type: "Community organisation",
        state: "VIC",
        description: "",
        focus_areas: [],
        profile: { name: name.trim() },
        notification_frequency: frequency,
        verification_status: "draft",
        inbox_alias: `demo-${id.slice(0, 8)}`,
      };
      setOrganisations((a) => [...a, o]);
      setOrgId(id);
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
  async function uploadDocuments(files: File[], category: string) {
    if (!org) throw new Error("Choose an organisation first.");
    if (!supabase)
      throw new Error(
        "File storage is available after connecting Supabase. This demo does not store your documents.",
      );
    if (files.length > 10)
      throw new Error("Please upload up to 10 files at a time.");
    for (const file of files) {
      if (
        ![
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp",
          "text/plain",
        ].includes(file.type)
      )
        throw new Error("Please use a PDF, JPG, PNG, WebP or TXT file.");
      if (file.size > 10 * 1024 * 1024)
        throw new Error(
          `${file.name} is too large. Maximum file size is 10 MB.`,
        );
      const path = `${org.id}/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .upload(path, file, { contentType: file.type });
      if (error) throw error;
      const result = await supabase.from("documents").insert({
        org_id: org.id,
        name: file.name,
        category,
        storage_path: path,
        mime_type: file.type,
        size_bytes: file.size,
        verified: false,
      });
      if (result.error) {
        await supabase.storage.from(DOCUMENT_BUCKET).remove([path]);
        throw result.error;
      }
    }
    await refresh();
    notify(
      `${files.length} document${files.length === 1 ? "" : "s"} uploaded. Ready for review.`,
    );
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
    const { data: link, error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(doc.storage_path, 60);
    if (error) throw error;
    window.open(link.signedUrl, "_blank", "noopener,noreferrer");
  }
  async function runAI(
    payload: Parameters<AppContextValue["runAI"]>[0],
  ): Promise<AIResult> {
    if (!supabase)
      throw new Error(
        "AI is not connected in the demo. Add your Supabase and Gemini settings to use this feature with your own information.",
      );
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Please sign in again.");
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ ...payload, orgId }),
    });
    const body = await response.json().catch(() => ({
      error: "The server could not respond. Please try again.",
    }));
    if (!response.ok)
      throw new Error(
        [
          body.error ?? "The AI request failed.",
          ...(Array.isArray(body.blockers) ? body.blockers : []),
        ].join(" "),
      );
    await refresh();
    return body;
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
    const response = await fetch("/api/auth-email", {
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
    const body = await response.json().catch(() => ({
      error: "Sign-in is temporarily unavailable. Please try again shortly.",
    }));
    if (!response.ok)
      throw new Error(
        typeof body.error === "string"
          ? body.error
          : "Your sign-in email could not be requested. Please try again shortly.",
      );
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
          setOrgId(id);
          const params = new URLSearchParams(window.location.search);
          params.set("org", id);
          params.delete("grant");
          window.history.replaceState({}, "", `?${params}`);
        },
        signIn,
        signOut,
        createOrg,
        updateOrg,
        uploadDocuments,
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
