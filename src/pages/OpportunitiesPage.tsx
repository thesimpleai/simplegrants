import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bookmark,
  CalendarDays,
  MapPin,
  Search,
  Sparkles,
  Upload,
  Check,
  FileText,
  ArrowUpRight,
} from "lucide-react";
import { useApp } from "../lib/app-context";
import { opportunityIdFromParams } from "../lib/auth-links";
import type { Opportunity } from "../types";
import {
  Badge,
  Busy,
  EmptyState,
  ExternalLink,
  Modal,
  Notice,
  date,
  deadline,
  money,
  errorMessage,
} from "../components/ui";
function sourceStatus(opportunity: Opportunity): {
  label: string;
  tone: string;
} {
  if (opportunity.provenance.demo)
    return { label: "Example opportunity", tone: "cream" };
  let sourceUrl: string | null = null;
  try {
    const url = new URL(opportunity.source_url);
    if (url.protocol === "https:" && !url.username && !url.password)
      sourceUrl = url.href;
  } catch {
    /* An absent or invalid link is not a found source. */
  }
  const citations = opportunity.provenance.sources;
  const grounded =
    sourceUrl &&
    opportunity.provenance.method === "google_search_grounding" &&
    Array.isArray(citations) &&
    citations.some((source) => {
      if (
        !source ||
        typeof source !== "object" ||
        typeof source.uri !== "string"
      )
        return false;
      try {
        return new URL(source.uri).href === sourceUrl;
      } catch {
        return false;
      }
    });
  if (grounded)
    return { label: "Web source found · check eligibility", tone: "green" };
  if (sourceUrl)
    return { label: "Source link added · check details", tone: "cream" };
  return {
    label:
      opportunity.provenance.method === "user_import"
        ? "Uploaded details · source unverified"
        : "Source needed · review details",
    tone: "cream",
  };
}
export default function OpportunitiesPage({
  onApply,
  initialId,
  search = "",
  setSearch,
}: {
  onApply: () => void;
  initialId?: string;
  search?: string;
  setSearch: (s: string) => void;
}) {
  const app = useApp(),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState(""),
    [importing, setImporting] = useState(false),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sort, setSort] = useState("recommended");
  const opportunity = app.data.opportunities.find(
    (o) => o.id === selected && o.org_id === app.org?.id,
  );
  useEffect(() => {
    const syncSelection = () => {
      const params = new URLSearchParams(window.location.search);
      const grantId = opportunityIdFromParams(params);
      setSelected(
        params.get("org") === app.org?.id &&
          app.data.opportunities.some(
            (item) => item.id === grantId && item.org_id === app.org?.id,
          )
          ? grantId!
          : "",
      );
      setError("");
    };
    syncSelection();
    window.addEventListener("popstate", syncSelection);
    return () => window.removeEventListener("popstate", syncSelection);
  }, [app.org?.id, app.data.opportunities, initialId]);
  function selectOpportunity(id: string) {
    if (
      !app.org ||
      !app.data.opportunities.some(
        (item) => item.id === id && item.org_id === app.org!.id,
      )
    )
      return;
    const params = new URLSearchParams({
      view: "opportunities",
      org: app.org.id,
      grant: id,
    });
    const target = `/?${params.toString()}`;
    if (`${window.location.pathname}${window.location.search}` !== target)
      window.history.pushState({}, "", target);
    setSelected(id);
    setError("");
  }
  function closeOpportunity() {
    const params = new URLSearchParams({ view: "opportunities" });
    if (app.org) params.set("org", app.org.id);
    window.history.replaceState({}, "", `/?${params.toString()}`);
    setSelected("");
    setError("");
  }
  const opportunities = app.data.opportunities
    .filter(
      (o) =>
        o.status !== "archived" &&
        (filter !== "saved" || o.status === "saved") &&
        `${o.title} ${o.summary} ${o.funder} ${o.focus_areas.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "closing"
        ? new Date(a.closes_at ?? "9999").getTime() -
          new Date(b.closes_at ?? "9999").getTime()
        : (b.match_score ?? 0) - (a.match_score ?? 0),
    );
  async function discover() {
    setBusy(true);
    setError("");
    try {
      const result = await app.runAI({ action: "discover" });
      app.notify(
        result.message ??
          "Grant search complete. Review each opportunity against the funder’s current guidelines.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function importGrant() {
    if (
      !text.trim() &&
      !app.data.documents.some((d) => d.category === "guidelines")
    ) {
      setError(
        "Paste the opportunity details or upload guidelines in My organisation first.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await app.runAI({
        action: "import-grant",
        text,
        documentIds: app.data.documents
          .filter((d) => d.category === "guidelines")
          .map((d) => d.id),
      });
      setImporting(false);
      setText("");
      app.notify("Opportunity added. Please check the source and dates.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply(o: Opportunity) {
    try {
      await app.startApplication(o);
      onApply();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function toggleSaved(o: Opportunity) {
    try {
      await app.saveOpportunity({
        id: o.id,
        status: o.status === "saved" ? "open" : "saved",
      });
      app.notify(
        o.status === "saved"
          ? "Removed from saved opportunities."
          : "Opportunity saved.",
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">FIND YOUR NEXT POSSIBILITY</div>
          <h1 className="page-title">Grant opportunities</h1>
          <p className="page-subtitle">
            Good things start with the right opportunity.
          </p>
        </div>
        <div className="button-group">
          <button
            className="button secondary"
            onClick={() => {
              setError("");
              setImporting(true);
            }}
          >
            <Upload size={17} />
            Add a grant
          </button>
          <button className="button primary" disabled={busy} onClick={discover}>
            {busy ? (
              <Busy label="Finding and checking sources…" />
            ) : (
              <>
                <Sparkles size={17} />
                Find grants with AI
              </>
            )}
          </button>
        </div>
      </div>
      {error && !importing && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      <div className="insight-banner">
        <span className="sparkle-tile">
          <Sparkles size={22} />
        </span>
        <div>
          <strong>A helping hand, tailored to your organisation</strong>
          <p>
            We look for opportunities that fit your work. You make the final
            call.
          </p>
        </div>
        <Badge tone="cream">
          {app.org?.focus_areas.length ?? 0} areas of focus
        </Badge>
      </div>
      <div className="filter-toolbar">
        <div className="segmented">
          <button
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            All opportunities{" "}
            <span>
              {
                app.data.opportunities.filter((o) => o.status !== "archived")
                  .length
              }
            </span>
          </button>
          <button
            className={filter === "saved" ? "active" : ""}
            onClick={() => setFilter("saved")}
          >
            Saved{" "}
            <span>
              {
                app.data.opportunities.filter((o) => o.status === "saved")
                  .length
              }
            </span>
          </button>
        </div>
        <label className="sort-select">
          <span>Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recommended">Recommended</option>
            <option value="closing">Closing soon</option>
          </select>
        </label>
      </div>
      <label className="grant-search">
        <Search size={19} />
        <input
          aria-label="Search grant opportunities"
          placeholder="Search by keyword, grant or funder…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="grant-grid">
        {opportunities.map((o) => (
          <article className="grant-card" key={o.id}>
            <div className="grant-card-top">
              <span
                className={`funder-icon ${o.id.endsWith("2") ? "ochre" : o.id.endsWith("3") ? "purple" : ""}`}
              >
                <span>
                  {o.funder
                    .split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("")}
                </span>
              </span>
              <div className="grant-card-meta">
                <Badge tone={sourceStatus(o).tone}>
                  {sourceStatus(o).label}
                </Badge>
                {o.provenance.date_review_required === true && (
                  <Badge tone="cream">Check application dates</Badge>
                )}
              </div>
              <button
                className={`icon-button bookmark ${o.status === "saved" ? "is-saved" : ""}`}
                aria-label={
                  o.status === "saved" ? `Unsave ${o.title}` : `Save ${o.title}`
                }
                onClick={() => toggleSaved(o)}
              >
                <Bookmark
                  size={20}
                  fill={o.status === "saved" ? "currentColor" : "none"}
                />
              </button>
            </div>
            <p className="funder-name">{o.funder}</p>
            <h2>
              <button
                onClick={() => {
                  selectOpportunity(o.id);
                }}
              >
                {o.title}
              </button>
            </h2>
            <p className="grant-description">{o.summary}</p>
            <div className="tag-list">
              {o.focus_areas.slice(0, 2).map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
            <div className="grant-facts">
              <div>
                <span className="muted">Funding available</span>
                <strong>
                  {o.amount_min && o.amount_max
                    ? `${money(o.amount_min)} – ${money(o.amount_max)}`
                    : money(o.amount_max)}
                </strong>
              </div>
              <div>
                <span>
                  <CalendarDays size={14} /> Closes {date(o.closes_at)}
                </span>
                <span>
                  <MapPin size={14} />
                  {o.location || "Location to confirm"}
                </span>
              </div>
            </div>
            <button
              className="grant-card-action"
              onClick={() => {
                selectOpportunity(o.id);
              }}
            >
              Explore this grant <ArrowRight size={18} />
            </button>
          </article>
        ))}
      </div>
      {!opportunities.length && (
        <EmptyState
          icon={<Search size={30} />}
          title={
            search
              ? "No opportunities match your search"
              : "Your next opportunity is out there"
          }
          description={
            search
              ? "Try a different keyword or clear the filters."
              : "Search with AI, or add a grant you have found elsewhere."
          }
          action={
            <button
              className="button primary"
              disabled={busy}
              onClick={discover}
            >
              Find grants with AI
            </button>
          }
        />
      )}
      <p className="footnote">
        <Check size={14} />
        Eligibility and dates must be checked against the current funder
        guidelines before applying.
      </p>
      {opportunity && (
        <Modal title={opportunity.title} onClose={closeOpportunity} wide>
          <div className="stack">
            <p className="muted">{opportunity.funder}</p>
            <Badge tone={sourceStatus(opportunity).tone}>
              {sourceStatus(opportunity).label}
            </Badge>
            <p className="muted">
              A source link does not confirm eligibility. Check the current
              funder guidelines before applying.
            </p>
            {Boolean(opportunity.provenance.demo) && (
              <Notice>
                This is an illustrative opportunity, not a live grant listing.
              </Notice>
            )}
            {opportunity.provenance.date_review_required === true && (
              <Notice>
                We couldn’t confirm this grant round’s dates. Check the funder’s
                current listing before planning your application. Previously
                saved dates are shown below where available.
              </Notice>
            )}
            <p>{opportunity.summary}</p>
            <div className="detail-facts">
              <div>
                <span>Funding</span>
                <strong>{money(opportunity.amount_max)}</strong>
              </div>
              <div>
                <span>Opens</span>
                <strong>{date(opportunity.opens_on)}</strong>
              </div>
              <div>
                <span>Closes</span>
                <strong>{deadline(opportunity.closes_at)}</strong>
              </div>
            </div>
            <h3>Before you apply</h3>
            <ul className="checklist">
              {opportunity.requirements.map((r) => (
                <li key={r}>
                  <FileText size={17} />
                  {r}
                </li>
              ))}
            </ul>
            {!opportunity.guidelines_text && (
              <Notice>
                We still need the current program guidelines and application
                questions before AI can draft your application. You can add them
                in Applications.
              </Notice>
            )}
            {opportunity.source_url && (
              <ExternalLink href={opportunity.source_url}>
                View the funder’s original listing
              </ExternalLink>
            )}
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => toggleSaved(opportunity)}
              >
                <Bookmark size={16} />
                {opportunity.status === "saved" ? "Saved" : "Save for later"}
              </button>
              <button
                className="button primary"
                onClick={() => apply(opportunity)}
              >
                Start application <ArrowUpRight size={17} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {importing && (
        <Modal
          title="Add a grant you found"
          onClose={() => !busy && setImporting(false)}
        >
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              importGrant();
            }}
          >
            <p>
              Paste the grant details, its original website link and program
              guidelines. AI will organise the information for you.
            </p>
            <label className="form-field">
              Grant information
              <textarea
                rows={9}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the funder’s listing, website address and guidelines here…"
              />
            </label>
            <Notice>
              For a document, first upload it as Grant guidelines in My
              organisation. Your uploaded guidelines will be included in this
              import.
            </Notice>
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <button
                className="button secondary"
                type="button"
                onClick={() => setImporting(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy} type="submit">
                {busy ? (
                  <Busy label="Reading details…" />
                ) : (
                  <>
                    <Sparkles size={17} />
                    Add with AI
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
