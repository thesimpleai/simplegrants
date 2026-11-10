import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Heart,
  Leaf,
  Flower2,
  Mail,
  Plus,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useApp } from "../lib/app-context";
import { Badge, EmptyState, date, money } from "../components/ui";
export default function OverviewPage({
  navigate,
}: {
  navigate: (page: string) => void;
}) {
  const { org, data, mode } = useApp();
  const next = data.projects
    .filter((p) => p.next_report_due)
    .sort((a, b) =>
      String(a.next_report_due).localeCompare(String(b.next_report_due)),
    )[0];
  const docsNeeded = [
    "registration",
    "acnc",
    "financial_statement",
    "insurance",
  ].filter((c) => !data.documents.some((d) => d.category === c)).length;
  const days = (v: string | null) =>
    v
      ? Math.max(0, Math.ceil((new Date(v).getTime() - Date.now()) / 86400000))
      : null;
  return (
    <>
      <div className="page-heading overview-heading">
        <div>
          <div className="eyebrow">SMALL TEAMS. BIG POSSIBILITIES.</div>
          <h1 className="page-title">
            A little clarity. A lot of possibility.
          </h1>
          <p className="page-subtitle">
            Here’s what’s happening at {org?.name ?? "your organisation"}.
          </p>
        </div>
        <span className="today-label">
          <CalendarDays size={16} />
          {new Date().toLocaleDateString("en-AU", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "Australia/Melbourne",
          })}
        </span>
      </div>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <span className="hero-eyebrow">
            <span className="status-dot" />
            YOUR NEXT CHAPTER STARTS HERE
          </span>
          <h2>
            More time for your community.
            <br />
            Less time on paperwork.
          </h2>
          <p>
            Find the right funding, put your best application forward,
            <br className="desktop-only" /> and keep every little detail in one
            place.
          </p>
          <button
            className="button warm"
            onClick={() => navigate("opportunities")}
          >
            Explore your opportunities <ArrowUpRight size={18} />
          </button>
        </div>
        <div className="hero-illustration" aria-hidden="true">
          <svg viewBox="0 0 320 260">
            <circle cx="175" cy="127" r="105" fill="#3c6252" />
            <circle cx="256" cy="53" r="14" fill="#ddc385" />
            <path
              d="M182 226C175 170 184 109 230 58"
              fill="none"
              stroke="#dce4c8"
              strokeWidth="4"
            />
            <path
              d="M190 179C218 179 259 148 250 119C218 114 189 142 190 179Z"
              fill="#afc2a3"
            />
            <path
              d="M183 149C148 149 120 114 132 88C168 90 186 116 183 149Z"
              fill="#d0d7ad"
            />
            <path
              d="M204 109C234 103 256 69 242 49C216 58 198 80 204 109Z"
              fill="#e1d9b0"
            />
            <path
              d="M183 218C146 204 124 170 136 145C166 153 187 181 183 218Z"
              fill="#9fb999"
            />
            <path d="M195 227H165L155 210H204Z" fill="#ddc385" />
            <g transform="translate(53 130) rotate(-9)">
              <rect width="94" height="100" rx="10" fill="#f6f1e5" />
              <rect x="15" y="18" width="29" height="7" rx="3" fill="#c6ccb9" />
              <rect x="15" y="35" width="64" height="4" rx="2" fill="#d7d9ca" />
              <rect x="15" y="46" width="55" height="4" rx="2" fill="#d7d9ca" />
              <circle cx="27" cy="73" r="11" fill="#dce5cb" />
              <path
                d="m22 73 4 4 7-8"
                fill="none"
                stroke="#507956"
                strokeWidth="2"
              />
              <rect x="46" y="68" width="32" height="4" rx="2" fill="#c6ccb9" />
              <rect x="46" y="77" width="23" height="4" rx="2" fill="#d7d9ca" />
            </g>
            <path
              d="M77 55v18m-9-9h18M278 174v14m-7-7h14"
              stroke="#b7c69d"
              strokeWidth="2"
            />
          </svg>
        </div>
      </section>
      <div className="metric-grid">
        <button
          className="metric-card"
          onClick={() => navigate("opportunities")}
        >
          <div className="metric-icon sage">
            <Sparkles size={21} />
          </div>
          <span className="metric-label">Grant opportunities</span>
          <strong>
            {data.opportunities.filter((o) => o.status !== "archived").length}
            <ArrowUpRight size={20} />
          </strong>
          <span className="metric-caption">Possibilities worth exploring</span>
        </button>
        <button
          className="metric-card"
          onClick={() => navigate("applications")}
        >
          <div className="metric-icon sand">
            <FileText size={21} />
          </div>
          <span className="metric-label">Applications in progress</span>
          <strong>
            {
              data.applications.filter((a) =>
                ["draft", "review"].includes(a.status),
              ).length
            }
            <ArrowUpRight size={20} />
          </strong>
          <span className="metric-caption">
            One step closer to making it happen
          </span>
        </button>
        <button className="metric-card" onClick={() => navigate("projects")}>
          <div className="metric-icon lavender">
            <Heart size={21} />
          </div>
          <span className="metric-label">Funded & running</span>
          <strong>
            {data.projects.filter((p) => p.status === "active").length}
            <ArrowUpRight size={20} />
          </strong>
          <span className="metric-caption">Good work, already in motion</span>
        </button>
        <button className="metric-card" onClick={() => navigate("projects")}>
          <div className="metric-icon peach">
            <TrendingUp size={21} />
          </div>
          <span className="metric-label">Funding at work</span>
          <strong className="funding-total">
            {money(data.projects.reduce((n, p) => n + p.awarded_amount, 0))}
            <ArrowUpRight size={20} />
          </strong>
          <span className="metric-caption">Supporting your community</span>
        </button>
      </div>
      <div className="dashboard-columns">
        <section className="card next-steps">
          <div className="card-heading">
            <div>
              <span className="eyebrow">A LITTLE FOCUS GOES A LONG WAY</span>
              <h2>Your next steps</h2>
            </div>
            <span className="count-label">
              {next ? 3 : 2} things to keep moving
            </span>
          </div>
          {next && (
            <button className="next-step" onClick={() => navigate("projects")}>
              <span className="step-icon amber">
                <Clock3 size={20} />
              </span>
              <span>
                <span className="next-step-title">
                  A progress report is coming up
                </span>
                <span className="muted">
                  {next.title} · Due {date(next.next_report_due)}
                </span>
              </span>
              <Badge tone="cream">{days(next.next_report_due)} days</Badge>
              <ChevronRight size={17} />
            </button>
          )}
          <button
            className="next-step"
            onClick={() => navigate("organisation")}
          >
            <span className="step-icon sage">
              <CheckCircle2 size={20} />
            </span>
            <span>
              <span className="next-step-title">
                {org?.verification_status === "approved"
                  ? "Keep your organisation grant-ready"
                  : "Let’s get to know your organisation"}
              </span>
              <span className="muted">
                {docsNeeded
                  ? "Add your documents once. Reuse them with confidence."
                  : "Review your documents and check what is up to date."}
              </span>
            </span>
            <ChevronRight size={17} />
          </button>
          <button
            className="next-step"
            onClick={() =>
              navigate(
                data.messages.some((m) => m.status !== "reviewed")
                  ? "inbox"
                  : "applications",
              )
            }
          >
            <span className="step-icon lavender">
              <Mail size={20} />
            </span>
            <span>
              <span className="next-step-title">
                {data.messages.some((m) => m.status !== "reviewed")
                  ? "A couple of updates need a look"
                  : "Move your next application forward"}
              </span>
              <span className="muted">
                {data.messages.some((m) => m.status !== "reviewed")
                  ? `${data.messages.filter((m) => m.status !== "reviewed").length} inbox updates ready for your review`
                  : "Small steps make a big difference."}
              </span>
            </span>
            <ChevronRight size={17} />
          </button>
        </section>
        <section className="community-note">
          <Leaf size={26} />
          <span className="eyebrow">MADE FOR THE WORK YOU DO</span>
          <h2>
            You bring the purpose.
            <br />
            We’ll help with the process.
          </h2>
          <p>
            No grant-writing experience needed. Just your ideas, your documents,
            and a little help along the way.
          </p>
          <button
            className="text-link"
            onClick={() => navigate("organisation")}
          >
            Build your organisation profile <ArrowRight size={17} />
          </button>
          <div className="note-decoration" aria-hidden="true">
            <Flower2 size={108} strokeWidth={1} />
          </div>
        </section>
      </div>
      <section className="opportunities-preview">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">THE NEXT GOOD THING</span>
            <h2>Opportunities to explore</h2>
          </div>
          <button
            className="text-link"
            onClick={() => navigate("opportunities")}
          >
            View all opportunities <ArrowRight size={17} />
          </button>
        </div>
        <div className="mini-grant-grid">
          {data.opportunities.slice(0, 3).map((o, i) => (
            <button
              className="mini-grant"
              key={o.id}
              onClick={() => navigate(`opportunities&grant=${o.id}`)}
            >
              <div className="row-between">
                <span className={`mini-grant-symbol symbol-${i}`}>
                  <Flower2 size={26} strokeWidth={1.5} />
                </span>
                <Badge tone="cream">
                  {mode === "demo"
                    ? "Example"
                    : o.location || "Check eligibility"}
                </Badge>
              </div>
              <span className="funder-name">{o.funder}</span>
              <h3>{o.title}</h3>
              <div className="mini-grant-bottom">
                <strong>Up to {money(o.amount_max)}</strong>
                <ArrowUpRight size={18} />
              </div>
            </button>
          ))}
        </div>
        {!data.opportunities.length && (
          <EmptyState
            title="A fresh start for your next great idea"
            description="Find funding that fits your community and your organisation."
            action={
              <button
                className="button secondary"
                onClick={() => navigate("opportunities")}
              >
                <Plus size={17} />
                Find an opportunity
              </button>
            }
          />
        )}
      </section>
    </>
  );
}
