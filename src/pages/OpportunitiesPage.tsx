import { useEffect, useRef, useState } from "react";
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
import GrantImportDialog from "../components/GrantImportDialog";
import { opportunityIdFromParams } from "../lib/auth-links";
import type { DiscoveryCheckpoint } from "../lib/contracts";
import { profileDateOnly, profileToday } from "../lib/profile-dates";
import type { DiscoveryStage, Opportunity } from "../types";
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

const discoveryProgress: Record<
  DiscoveryStage,
  { label: string; detail: string }
> = {
  search: {
    label: "Searching grants…",
    detail: "Looking across local programs, sector grants and foundations.",
  },
  verify: {
    label: "Checking funder listings…",
    detail:
      "Checking current rounds, application dates and eligibility requirements.",
  },
  extract: {
    label: "Saving opportunities…",
    detail: "Combining duplicate listings and saving opportunities for review.",
  },
};

function closingDate(opportunity: Opportunity) {
  return profileDateOnly(opportunity.provenance.closing_date);
}

function roundLabel(opportunity: Opportunity) {
  const closing = closingDate(opportunity);
  const knownTime = Date.parse(opportunity.closes_at ?? "");
  if (
    Number.isFinite(knownTime)
      ? knownTime < Date.now()
      : closing && closing < profileToday()
  )
    return "Past round";
  if (opportunity.provenance.round_status_check_required === true)
    return "Check current status";
  switch (opportunity.provenance.round_status) {
    case "open":
      return "Open";
    case "upcoming":
      return opportunity.opens_on && opportunity.opens_on <= profileToday()
        ? "Check current status"
        : "Upcoming";
    case "rolling":
      return "Rolling";
    default:
      return null;
  }
}

function compareClosingDates(left: Opportunity, right: Opportunity) {
  function day(opportunity: Opportunity) {
    const timestamp = Date.parse(opportunity.closes_at ?? "");
    return (
      closingDate(opportunity) ??
      (Number.isFinite(timestamp)
        ? profileToday(new Date(timestamp))
        : "9999-12-31")
    );
  }
  return (
    day(left).localeCompare(day(right)) ||
    Date.parse(left.closes_at ?? "9999") - Date.parse(right.closes_at ?? "9999")
  );
}

function recommendationOrder(opportunity: Opportunity) {
  if (roundLabel(opportunity) === "Past round") return 3;
  if (opportunity.provenance.fit === "potential") return 0;
  if (opportunity.provenance.fit === "check") return 1;
  return 2;
}

function legacySource(url: string) {
  try {
    const value = new URL(url);
    return (
      value.protocol === "https:" &&
      value.hostname === "vertexaisearch.cloud.google.com" &&
      value.pathname.startsWith("/grounding-api-redirect/")
    );
  } catch {
    return false;
  }
}
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
  if (legacySource(opportunity.source_url))
    return {
      label: "Source link needs refreshing · check details",
      tone: "cream",
    };
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
    [busy, setBusy] = useState(false),
    [discoveryStage, setDiscoveryStage] = useState<DiscoveryStage | null>(null),
    [error, setError] = useState(""),
    [sort, setSort] = useState("recommended");
  const attemptedRepair = useRef(new Set<string>());
  const discoveryReview = useRef<DiscoveryCheckpoint | null>(null);
  const [repairing, setRepairing] = useState(false);
  const repairActor = useRef("");
  repairActor.current = `${app.user?.id}:${app.org?.id}`;
  useEffect(() => setRepairing(false), [app.user?.id, app.org?.id]);
  const hasLegacySources = app.data.opportunities.some((item) =>
    legacySource(item.source_url),
  );
  async function repairSources(automatic = false) {
    const actor = `${app.user?.id}:${app.org?.id}`;
    setRepairing(true);
    try {
      const result = await app.repairSourceLinks();
      if (actor !== repairActor.current) return;
      if (result.repaired)
        app.notify(
          `${result.repaired} saved source link${result.repaired === 1 ? "" : "s"} refreshed.`,
        );
      if (!automatic && result.unresolved)
        setError(
          "Some older source links could not be resolved. Check the funder’s official website before using them.",
        );
    } catch (error) {
      if (!automatic && actor === repairActor.current)
        setError(errorMessage(error));
    } finally {
      if (actor === repairActor.current) setRepairing(false);
    }
  }
  useEffect(() => {
    if (app.mode !== "live" || !app.user || !app.org || !hasLegacySources)
      return;
    const actor = `${app.user.id}:${app.org.id}`;
    if (attemptedRepair.current.has(actor)) return;
    attemptedRepair.current.add(actor);
    void repairSources(true);
  }, [app.mode, app.user?.id, app.org?.id, hasLegacySources]);
  const opportunity = app.data.opportunities.find(
    (o) => o.id === selected && o.org_id === app.org?.id,
  );
  const deadlineNote =
    typeof opportunity?.provenance.deadline_note === "string"
      ? opportunity.provenance.deadline_note.trim()
      : "";
  const progress = discoveryStage ? discoveryProgress[discoveryStage] : null;
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
        ? compareClosingDates(a, b)
        : recommendationOrder(a) - recommendationOrder(b) ||
          (b.match_score ?? 0) - (a.match_score ?? 0) ||
          compareClosingDates(a, b),
    );
  async function discover() {
    setBusy(true);
    setError("");
    try {
      const result = await app.runAI(
        { action: "discover" },
        { onDiscoveryStage: setDiscoveryStage, discoveryReview },
      );
      app.notify(
        result.message ??
          "Grant search complete. Review each opportunity against the funder’s current guidelines.",
      );
    } catch (e) {
      setError(
        errorMessage(e) +
          (discoveryReview.current
            ? " Select Find grants with AI to retry the unfinished step."
            : ""),
      );
    } finally {
      setDiscoveryStage(null);
      setBusy(false);
    }
  }
  async function apply(o: Opportunity) {
    setBusy(true);
    setError("");
    try {
      const application = await app.startApplication(o);
      try {
        sessionStorage.setItem(
          `simple-grants-open-application:${app.user?.id ?? "demo"}:${o.org_id}`,
          application.id,
        );
      } catch {
        /* Opening the application remains available from its list. */
      }
      onApply();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
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
          {hasLegacySources && app.mode === "live" && (
            <button
              className="button secondary"
              disabled={repairing}
              onClick={() => void repairSources()}
            >
              {repairing
                ? "Refreshing source links…"
                : "Refresh saved source links"}
            </button>
          )}
          <button
            className="button secondary"
            onClick={() => {
              setError("");
              setImporting(true);
            }}
          >
            <Upload size={17} />
            Import grants
          </button>
          <button className="button primary" disabled={busy} onClick={discover}>
            {busy ? (
              <Busy label={progress?.label ?? "Working…"} />
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
      <div className="insight-banner" role="status">
        <span className="sparkle-tile">
          <Sparkles size={22} />
        </span>
        <div>
          <strong>{progress?.label ?? "Search across funders"}</strong>
          <p>
            {progress?.detail ??
              "We search by location and purpose, then check the funder’s current round and requirements."}
          </p>
        </div>
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
        {opportunities.map((o) => {
          const round = roundLabel(o);
          const status = sourceStatus(o);
          return (
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
                  <Badge
                    tone={
                      round === "Open" || round === "Rolling"
                        ? "green"
                        : round
                          ? "cream"
                          : status.tone
                    }
                  >
                    {round ?? status.label}
                  </Badge>
                  {o.provenance.date_review_required === true && (
                    <Badge tone="cream">Check application dates</Badge>
                  )}
                </div>
                <button
                  className={`icon-button bookmark ${o.status === "saved" ? "is-saved" : ""}`}
                  aria-label={
                    o.status === "saved"
                      ? `Unsave ${o.title}`
                      : `Save ${o.title}`
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
                    <CalendarDays size={14} />{" "}
                    {round === "Upcoming" && o.opens_on
                      ? `Opens ${date(o.opens_on)}`
                      : closingDate(o) || o.closes_at
                        ? `Closes ${date(closingDate(o) ?? o.closes_at)}`
                        : round === "Rolling"
                          ? "Rolling applications"
                          : "Check deadline"}
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
          );
        })}
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
              : "Search with AI or import grants from your own research."
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
                {deadlineNote ||
                  "Confirm the deadline against the funder’s current listing before planning your application."}
              </Notice>
            )}
            {deadlineNote &&
              opportunity.provenance.date_review_required !== true && (
                <p className="muted">{deadlineNote}</p>
              )}
            <p>{opportunity.summary}</p>
            {typeof opportunity.provenance.fit_note === "string" &&
              opportunity.provenance.fit_note.trim() && (
                <p className="muted">{opportunity.provenance.fit_note}</p>
              )}
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
                <strong>
                  {opportunity.closes_at &&
                  opportunity.provenance.date_review_required !== true
                    ? deadline(opportunity.closes_at)
                    : closingDate(opportunity) || opportunity.closes_at
                      ? `${date(closingDate(opportunity) ?? opportunity.closes_at)} (time to confirm)`
                      : roundLabel(opportunity) === "Rolling"
                        ? "Rolling applications"
                        : deadline(null)}
                </strong>
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
                disabled={busy}
                onClick={() => apply(opportunity)}
              >
                Start application <ArrowUpRight size={17} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {importing && <GrantImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}
