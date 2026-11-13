import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  Leaf,
  Flower2,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { useApp } from "./lib/app-context";
import { opportunityIdFromParams } from "./lib/auth-links";
import OverviewPage from "./pages/OverviewPage";
import OpportunitiesPage from "./pages/OpportunitiesPage";
import ApplicationsPage from "./pages/ApplicationsPage";
import OrganisationPage from "./pages/OrganisationPage";
import ProjectsPage from "./pages/ProjectsPage";
import InboxPage from "./pages/InboxPage";
import { Busy, Modal, Notice, errorMessage } from "./components/ui";
import type { Frequency } from "./types";
const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "organisation", label: "My organisation", icon: Building2 },
  { id: "opportunities", label: "Grant opportunities", icon: Sparkles },
  { id: "applications", label: "Applications", icon: ClipboardList },
  { id: "projects", label: "Funded & running", icon: Wallet },
  { id: "inbox", label: "Inbox", icon: Inbox },
];
function currentPage() {
  return new URLSearchParams(window.location.search).get("view") ?? "overview";
}
function WorkspaceConnectionIssue({
  message,
  loading,
  onRetry,
}: {
  message: string;
  loading: boolean;
  onRetry: () => Promise<void>;
}) {
  return (
    <section
      className="card stack"
      role="alert"
      aria-labelledby="workspace-connection-title"
    >
      <span className="icon-tile">
        <Building2 size={26} />
      </span>
      <h2 id="workspace-connection-title">We couldn’t load your workspace.</h2>
      <p>{message}</p>
      <p className="muted">
        Your saved organisations and documents have not been removed.
      </p>
      <button
        className="button primary align-start"
        disabled={loading}
        onClick={() => void onRetry()}
      >
        {loading ? <Busy label="Connecting…" /> : "Retry connection"}
      </button>
    </section>
  );
}
export default function App() {
  const app = useApp();
  const [page, setPage] = useState(currentPage),
    [mobile, setMobile] = useState(false),
    [picker, setPicker] = useState(false),
    [help, setHelp] = useState(false),
    [newOrg, setNewOrg] = useState(false),
    [name, setName] = useState(""),
    [frequency, setFrequency] = useState<Frequency>("weekly"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [email, setEmail] = useState(""),
    [emailSent, setEmailSent] = useState(false),
    [website, setWebsite] = useState(""),
    [search, setSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  function navigate(target: string) {
    const parts = target.split("&");
    setPage(parts[0]);
    const params = new URLSearchParams();
    params.set("view", parts[0]);
    const selectedOrg =
      new URLSearchParams(window.location.search).get("org") ?? app.org?.id;
    if (selectedOrg) params.set("org", selectedOrg);
    if (parts[1]) params.set("grant", parts[1].replace("grant=", ""));
    window.history.pushState({}, "", `?${params}`);
    setMobile(false);
  }
  useEffect(() => {
    const onPop = () => setPage(currentPage());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (app.configured && (!app.organisationsLoaded || app.connectionError)) {
      setNewOrg(false);
      setPicker(false);
    }
  }, [app.configured, app.organisationsLoaded, app.connectionError]);
  useEffect(() => {
    setSearch("");
    setPicker(false);
  }, [app.org?.id]);
  useEffect(() => {
    if (!picker) return;
    const onOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !pickerRef.current?.contains(event.target)
      )
        setPicker(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPicker(false);
      pickerRef.current
        ?.querySelector<HTMLButtonElement>(".org-switch")
        ?.focus();
    };
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onEscape);
    };
  }, [picker]);
  async function create() {
    setBusy(true);
    setError("");
    try {
      await app.createOrg(name, frequency);
      setNewOrg(false);
      setName("");
      navigate("organisation");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await app.signIn(email, website);
      setEmailSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setWebsite("");
    }
  }
  if (app.configured && !app.user)
    return (
      <div className="login-page">
        <div className="login-story">
          <a className="brand" href="/">
            <span className="brand-symbol">
              <Leaf size={24} />
            </span>
            simple<span>grant</span>
            <span className="brand-period">.</span>
          </a>
          <div>
            <span className="hero-eyebrow">
              GOOD WORK DESERVES GOOD SUPPORT
            </span>
            <h1>
              You bring the purpose.
              <br />
              We help with
              <br />
              the possibilities.
            </h1>
            <p>
              One simple home for your organisation,
              <br />
              your grants, and the difference you make.
            </p>
          </div>
          <small>Made for Australian community organisations.</small>
        </div>
        <main className="login-form">
          <span className="eyebrow">WELCOME TO SIMPLE GRANT</span>
          {app.connectionError ? (
            <div className="stack">
              <WorkspaceConnectionIssue
                message={app.connectionError}
                loading={app.loading}
                onRetry={app.retryConnection}
              />
              <button
                className="button secondary align-start"
                onClick={() =>
                  app
                    .signOut()
                    .catch((issue) => app.notify(errorMessage(issue)))
                }
              >
                Back to sign-in
              </button>
            </div>
          ) : app.loading ? (
            <Busy label="Checking your sign-in session…" />
          ) : (
            <>
              <h2>Let’s get you settled in.</h2>
              <p>
                Use your email to sign in securely. No password to remember.
              </p>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  login();
                }}
              >
                <label className="form-field">
                  Your email address
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@yourorganisation.org.au"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <div className="auth-honeypot" aria-hidden="true">
                  <label>
                    Leave this field empty
                    <input
                      type="text"
                      name="website"
                      autoComplete="off"
                      tabIndex={-1}
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                    />
                  </label>
                </div>
                <button className="button primary" disabled={busy}>
                  {busy ? (
                    <Busy label="Sending your link…" />
                  ) : (
                    <>
                      Email me a sign-in link <ArrowRight size={17} />
                    </>
                  )}
                </button>
                {emailSent && (
                  <Notice>
                    If this address can sign in, you’ll receive an email from
                    Simple Grants. Open the link, then choose Sign in. Your
                    grant link will be waiting when you return.
                  </Notice>
                )}
                {error && (
                  <p role="alert" className="error-box">
                    {error}
                  </p>
                )}
              </form>
              <p className="muted small">
                One login. All your organisations. A little less to remember.
              </p>
            </>
          )}
        </main>
      </div>
    );
  return (
    <div className="app-layout">
      {mobile && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <a
          className="brand"
          href="?view=overview"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-symbol">
            <Leaf size={23} />
          </span>
          simple<span>grant</span>
          <span className="brand-period">.</span>
        </a>
        <div className="organisation-switcher" ref={pickerRef}>
          <button
            className="org-switch"
            onClick={() => setPicker((p) => !p)}
            aria-expanded={picker}
            disabled={
              Boolean(app.connectionError) ||
              (app.configured && !app.organisationsLoaded)
            }
          >
            <span className="org-monogram">
              {app.org?.name
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0])
                .join("") || "+"}
            </span>
            <span>
              <strong>{app.org?.name ?? "Choose organisation"}</strong>
              <small>Your organisation</small>
            </span>
            <ChevronDown size={16} />
          </button>
          {picker && (
            <div className="org-dropdown">
              {app.organisations.map((o) => (
                <button
                  key={o.id}
                  onClick={() => {
                    app.selectOrg(o.id);
                    setPicker(false);
                  }}
                >
                  {o.name}
                  {app.org?.id === o.id && <Check size={16} />}
                </button>
              ))}
              <button
                onClick={() => {
                  setPicker(false);
                  setNewOrg(true);
                  setError("");
                }}
              >
                <Plus size={16} />
                Add an organisation
              </button>
            </div>
          )}
        </div>
        <div className="nav-section-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => navigate(n.id)}
              aria-current={page === n.id ? "page" : undefined}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "inbox" &&
                app.data.messages.filter((m) => m.status !== "reviewed")
                  .length > 0 && (
                  <span className="nav-count">
                    {
                      app.data.messages.filter((m) => m.status !== "reviewed")
                        .length
                    }
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <span className="help-sparkle">
              <Flower2 size={27} />
            </span>
            <strong>A little help goes a long way.</strong>
            <p>Everything you need to get grant-ready, one step at a time.</p>
            <button onClick={() => setHelp(true)}>
              We’re here to help <ArrowUpRightIcon />
            </button>
          </div>
          <button className="nav-item" onClick={() => navigate("organisation")}>
            <Settings size={18} />
            <span>Organisation settings</span>
          </button>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <HelpCircle size={18} />
            <span>Help & guidance</span>
          </button>
          {app.user && (
            <button
              className="nav-item"
              onClick={() =>
                app.signOut().catch((e) => app.notify(errorMessage(e)))
              }
            >
              <LogOut size={18} />
              <span>Sign out</span>
            </button>
          )}
          <div className="sidebar-footer">
            <span className="small-leaf">
              <Leaf size={14} />
            </span>
            Good things grow together.
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-location">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">Your workspace</span>
            <ChevronRight size={14} />
            <strong>
              {navigation.find((n) => n.id === page)?.label ?? "Overview"}
            </strong>
          </div>
          <div className="topbar-actions">
            <label className="topbar-search">
              <Search size={17} />
              <input
                placeholder="Find an opportunity…"
                aria-label="Find an opportunity"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (page !== "opportunities") navigate("opportunities");
                }}
              />
              <kbd>⌕</kbd>
            </label>
            <button
              className="notification-button icon-button"
              aria-label="View inbox updates"
              onClick={() => navigate("inbox")}
            >
              <Bell size={20} />
              {app.data.messages.some((m) => m.status !== "reviewed") && (
                <span />
              )}
            </button>
            <div className="avatar" title={app.user?.email ?? "Demo workspace"}>
              {app.user?.email?.slice(0, 2).toUpperCase() ?? "ME"}
            </div>
          </div>
        </header>
        {app.mode === "demo" && (
          <div className="demo-banner">
            <span>
              <span className="status-dot" />
              <strong>Demo workspace</strong>
              <span className="demo-detail">
                {" "}
                · Fictional examples. Your changes reset when you leave. AI and
                uploads need connection.
              </span>
            </span>
            <button onClick={() => setHelp(true)}>
              Set up your workspace <ArrowRight size={14} />
            </button>
          </div>
        )}
        <main className="main-content" id="main-content">
          {app.connectionError ? (
            <WorkspaceConnectionIssue
              message={app.connectionError}
              loading={app.loading}
              onRetry={app.retryConnection}
            />
          ) : (app.configured && !app.organisationsLoaded) ||
            (app.loading && !app.org) ? (
            <div className="loading-screen">
              <Busy label="Getting your workspace ready…" />
            </div>
          ) : !app.org ? (
            <div className="first-organisation">
              <span className="icon-tile">
                <Building2 size={30} />
              </span>
              <h1 className="page-title">Your community’s next chapter.</h1>
              <p>
                Start by adding your first organisation. You can add more later.
              </p>
              <button
                className="button primary"
                onClick={() => setNewOrg(true)}
              >
                <Plus size={17} />
                Add an organisation
              </button>
            </div>
          ) : (
            <div key={app.org.id}>
              {page === "overview" ? (
                <OverviewPage navigate={navigate} />
              ) : page === "organisation" ? (
                <OrganisationPage />
              ) : page === "opportunities" ? (
                <OpportunitiesPage
                  onApply={() => navigate("applications")}
                  initialId={
                    opportunityIdFromParams(
                      new URLSearchParams(window.location.search),
                    ) ?? undefined
                  }
                  search={search}
                  setSearch={setSearch}
                />
              ) : page === "applications" ? (
                <ApplicationsPage
                  onDiscover={() => navigate("opportunities")}
                />
              ) : page === "projects" ? (
                <ProjectsPage />
              ) : page === "inbox" ? (
                <InboxPage />
              ) : (
                <OverviewPage navigate={navigate} />
              )}
            </div>
          )}
          <footer className="main-footer">
            <span>
              <Leaf size={14} />A little less paperwork. A lot more possibility.
            </span>
            <span>Simple Grant · Made for community</span>
          </footer>
        </main>
      </div>
      {app.toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {app.toast}
        </div>
      )}
      {newOrg && (
        <Modal
          title="Add an organisation"
          onClose={() => !busy && setNewOrg(false)}
        >
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <p>One login can look after all the organisations you support.</p>
            <label className="form-field">
              Organisation name
              <input
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Merri Community House"
              />
            </label>
            <label className="form-field">
              How often should we look for new grants?
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
              >
                <option value="weekly">Weekly summary</option>
                <option value="monthly">Monthly summary</option>
                <option value="never">Never — I’ll search myself</option>
              </select>
            </label>
            <p className="muted small">
              You can change this any time in your organisation settings.
            </p>
            {error && (
              <p role="alert" className="error-box">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setNewOrg(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? (
                  <Busy label="Creating…" />
                ) : (
                  <>
                    Create organisation <ArrowRight size={17} />
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {help && (
        <Modal
          title="A little help to get started"
          onClose={() => setHelp(false)}
        >
          <div className="stack">
            <p>
              Start with your organisation, then find the funding that fits your
              work.
            </p>
            <ol className="help-steps">
              <li>
                <strong>Add your organisation.</strong> Upload registration
                documents and paste your history. Review and approve your
                AI-filled profile.
              </li>
              <li>
                <strong>Explore opportunities.</strong> Search with AI or add a
                grant you’ve found elsewhere. Always check the funder’s current
                guidelines.
              </li>
              <li>
                <strong>Prepare your application.</strong> Add the guidelines,
                actual questions and project details. Review your draft and
                submit through the funder’s website.
              </li>
              <li>
                <strong>Keep the good work on track.</strong> Record expenses,
                milestones and evidence, then prepare your reporting draft.
              </li>
            </ol>
            {app.mode === "demo" && (
              <Notice>
                This workspace uses fictional examples. To activate real
                sign-in, private file storage and AI, connect Supabase, Gemini
                and Resend using the deployment instructions in the GitHub
                repository.
              </Notice>
            )}
            <button
              className="button primary"
              onClick={() => {
                setHelp(false);
                navigate("organisation");
              }}
            >
              Go to my organisation <ArrowRight size={17} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ArrowUpRightIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}
