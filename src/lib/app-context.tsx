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
    [toast, setToast] = useState("");
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
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) notify(error.message);
      setUser(session?.user ?? null);
      if (!session) setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) =>
      setUser(session?.user ?? null),
    );
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!supabase || !user) {
      if (configured) {
        setOrganisations([]);
        setOrgId("");
        setData(empty);
      }
      return;
    }
    let active = true;
    setLoading(true);
    supabase
      .from("organizations")
      .select("*")
      .order("created_at")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) notify(error.message);
        else {
          setOrganisations(data ?? []);
          setOrgId((current) =>
            data?.some((o) => o.id === current)
              ? current
              : (data?.find(
                  (o) =>
                    o.id ===
                    new URLSearchParams(window.location.search).get("org"),
                )?.id ??
                data?.[0]?.id ??
                ""),
          );
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);
  async function refresh() {
    if (!supabase || !orgId || activeOrg.current !== orgId) return;
    const current = ++request.current;
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
        tableNames.map((t) =>
          supabase!.from(t).select("*").eq("org_id", orgId),
        ),
      );
      if (current !== request.current) return;
      for (const r of results) if (r.error) throw r.error;
      setData({
        documents: results[0].data ?? [],
        opportunities: results[1].data ?? [],
        applications: results[2].data ?? [],
        projects: results[3].data ?? [],
        expenses: results[4].data ?? [],
        messages: results[5].data ?? [],
      });
    } finally {
      if (current === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    request.current++;
    if (!orgId) {
      setData(empty);
      return;
    }
    setData(configured ? empty : demoData(orgId));
    if (configured) refresh().catch((e) => notify(e.message));
  }, [orgId]);
  async function createOrg(name: string, frequency: Frequency) {
    if (!name.trim()) throw new Error("Please enter an organisation name.");
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
  async function signIn(email: string) {
    if (!supabase)
      throw new Error("Connect Supabase first to enable secure sign-in.");
    const next =
      window.location.origin +
      window.location.pathname +
      window.location.search;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: next },
    });
    if (error) throw error;
    notify("Check your email for your secure sign-in link.");
  }
  async function signOut() {
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
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
