import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  FileText,
  FolderHeart,
  Pencil,
  Plus,
  Receipt,
  Sparkles,
} from "lucide-react";
import { useApp } from "../lib/app-context";
import type { FundedProject } from "../types";
import {
  Badge,
  Busy,
  EmptyState,
  Modal,
  Notice,
  date,
  errorMessage,
  money,
} from "../components/ui";

function label(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function ReadableContent({ value }: { value: unknown }) {
  if (value == null || value === "")
    return <p className="muted">Not recorded yet.</p>;
  if (Array.isArray(value))
    return (
      <ul className="report-list">
        {value.map((item, i) => (
          <li key={i}>
            <ReadableContent value={item} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <div className="stack">
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <section key={key}>
            <h4>{label(key)}</h4>
            <ReadableContent value={item} />
          </section>
        ))}
      </div>
    );
  return (
    <p style={{ whiteSpace: "pre-wrap" }}>
      {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
    </p>
  );
}
function reportText(value: unknown, depth = 0): string {
  if (Array.isArray(value))
    return value.map((item) => `• ${reportText(item, depth + 1)}`).join("\n");
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${label(key)}\n${reportText(item, depth + 1)}`)
      .join("\n\n");
  return value == null ? "" : String(value);
}

function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
function parseBudget(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split("|").map((part) => part.trim());
      if (
        parts.length !== 2 ||
        !parts[0] ||
        !/^\d+(\.\d{1,2})?$/.test(parts[1])
      )
        throw new Error(
          `Budget line ${index + 1}: use Item | amount, with a nonnegative amount and no more than two decimal places.`,
        );
      const amount = Number(parts[1]);
      if (!Number.isFinite(amount) || amount < 0 || amount > 999999999999)
        throw new Error(
          `Budget line ${index + 1}: enter a valid amount from zero to 999,999,999,999.`,
        );
      return { name: parts[0], amount };
    });
}
function parseMilestones(text: string, previous: FundedProject["milestones"]) {
  const titles = new Set<string>();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split("|").map((part) => part.trim());
      if (parts.length !== 2 || !parts[0] || !validDate(parts[1]))
        throw new Error(
          `Milestone line ${index + 1}: use Milestone title | YYYY-MM-DD with a valid date.`,
        );
      const key = parts[0].toLowerCase();
      if (titles.has(key))
        throw new Error(
          `Milestone line ${index + 1}: please give each milestone a different title.`,
        );
      titles.add(key);
      const existing = previous.find(
        (milestone) => milestone.title.trim().toLowerCase() === key,
      );
      return {
        title: parts[0],
        due_date: parts[1],
        completed: existing?.completed ?? false,
      };
    });
}

export default function ProjectsPage() {
  const app = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expenseProject, setExpenseProject] = useState<FundedProject | null>(
    null,
  );
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [expenseDocumentId, setExpenseDocumentId] = useState("");
  const [planProject, setPlanProject] = useState<FundedProject | null>(null);
  const [planTitle, setPlanTitle] = useState("");
  const [planStart, setPlanStart] = useState("");
  const [planEnd, setPlanEnd] = useState("");
  const [planReportDue, setPlanReportDue] = useState("");
  const [planStatus, setPlanStatus] = useState("active");
  const [planBudget, setPlanBudget] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [planMilestones, setPlanMilestones] = useState("");
  const [budgetWarningAccepted, setBudgetWarningAccepted] = useState(false);
  const [planError, setPlanError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [expenseError, setExpenseError] = useState("");
  const [report, setReport] = useState<{
    project: FundedProject;
    content: Record<string, unknown>;
  } | null>(null);
  const selected = app.data.projects.find(
    (project) => project.id === selectedId,
  );
  const activeProject = useRef("");
  activeProject.current = `${app.org?.id ?? ""}:${selectedId ?? ""}`;
  useEffect(() => {
    setReport(null);
    setExpenseProject(null);
    setPlanProject(null);
    setError("");
  }, [app.org?.id, selectedId]);
  const totalAwarded = app.data.projects.reduce(
    (sum, project) => sum + Number(project.awarded_amount),
    0,
  );
  const totalSpent = app.data.expenses.reduce(
    (sum, expense) => sum + Number(expense.amount),
    0,
  );

  let planBudgetTotal: number | null = null;
  try {
    planBudgetTotal = parseBudget(planBudget).reduce(
      (sum, category) => sum + category.amount,
      0,
    );
  } catch {
    /* Validation is shown on save. */
  }
  const overAward =
    planProject !== null &&
    planBudgetTotal !== null &&
    Math.round(planBudgetTotal * 100) >
      Math.round(Number(planProject.awarded_amount) * 100);

  function editPlan(project: FundedProject) {
    setPlanProject(project);
    setPlanTitle(project.title);
    setPlanStart(project.start_date.slice(0, 10));
    setPlanEnd(project.end_date.slice(0, 10));
    setPlanReportDue(project.next_report_due?.slice(0, 10) ?? "");
    setPlanStatus(project.status);
    const categories = Array.isArray(project.budget.categories)
      ? project.budget.categories
      : [];
    setPlanBudget(
      categories
        .filter(
          (item) =>
            item &&
            typeof item === "object" &&
            typeof item.name === "string" &&
            typeof item.amount === "number",
        )
        .map((item) => `${item.name} | ${item.amount}`)
        .join("\n"),
    );
    setPlanNotes(
      typeof project.budget.notes === "string" ? project.budget.notes : "",
    );
    setPlanMilestones(
      project.milestones
        .map(
          (milestone) =>
            `${milestone.title} | ${milestone.due_date.slice(0, 10)}`,
        )
        .join("\n"),
    );
    setBudgetWarningAccepted(false);
    setPlanError("");
  }
  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!planProject) return;
    setPlanError("");
    if (!planTitle.trim()) {
      setPlanError("Please add a project title.");
      return;
    }
    if (!validDate(planStart) || !validDate(planEnd) || planEnd < planStart) {
      setPlanError(
        "Choose valid project dates, with the end date on or after the start date.",
      );
      return;
    }
    if (planReportDue && !validDate(planReportDue)) {
      setPlanError("Choose a valid reporting date, or leave it blank.");
      return;
    }
    let categories: ReturnType<typeof parseBudget>;
    let milestones: ReturnType<typeof parseMilestones>;
    try {
      categories = parseBudget(planBudget);
      milestones = parseMilestones(planMilestones, planProject.milestones);
    } catch (e) {
      setPlanError(errorMessage(e));
      return;
    }
    const total = categories.reduce(
      (sum, category) => sum + Math.round(category.amount * 100),
      0,
    );
    if (
      total > Math.round(Number(planProject.awarded_amount) * 100) &&
      !budgetWarningAccepted
    ) {
      setPlanError(
        "The budget is greater than the grant award. Confirm the co-funding and approved budget below before saving.",
      );
      return;
    }
    setBusy("plan");
    try {
      await app.updateProject(planProject.id, {
        title: planTitle.trim(),
        start_date: planStart,
        end_date: planEnd,
        next_report_due: planReportDue || null,
        status: planStatus,
        budget: { ...planProject.budget, categories, notes: planNotes.trim() },
        milestones,
      });
      setPlanProject(null);
      app.notify("Project plan saved. Your original proposal is unchanged.");
    } catch (e) {
      setPlanError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleMilestone(project: FundedProject, index: number) {
    setError("");
    setBusy(`milestone-${index}`);
    try {
      await app.updateProject(project.id, {
        milestones: project.milestones.map((milestone, i) =>
          i === index
            ? { ...milestone, completed: !milestone.completed }
            : milestone,
        ),
      });
      app.notify(
        project.milestones[index].completed
          ? "Milestone marked as in progress."
          : "Milestone completed. A little progress, recorded.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function generateReport(project: FundedProject) {
    setError("");
    setBusy("report");
    try {
      const result = await app.runAI({
        action: "report",
        projectId: project.id,
      });
      if (!result.report)
        throw new Error("A report was not returned. Please try again.");
      if (activeProject.current === `${project.org_id}:${project.id}`)
        setReport({ project, content: result.report });
      else app.notify("Your report draft has been saved with its project.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!expenseProject) return;
    setExpenseError("");
    const amount = Number(expenseAmount);
    if (!expenseDescription.trim()) {
      setExpenseError("Please add a short description of the expense.");
      return;
    }
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !/^\d+(\.\d{1,2})?$/.test(expenseAmount)
    ) {
      setExpenseError(
        "Enter an amount greater than zero, with no more than two decimal places.",
      );
      return;
    }
    if (!validDate(expenseDate)) {
      setExpenseError("Please choose the date of the expense.");
      return;
    }
    if (
      expenseDocumentId &&
      !app.data.documents.some((document) => document.id === expenseDocumentId)
    ) {
      setExpenseError(
        "The selected document is no longer available. Please choose another document.",
      );
      return;
    }
    setBusy("expense");
    try {
      await app.addExpense(
        expenseProject.id,
        expenseDescription.trim(),
        amount,
        expenseDate,
        expenseDocumentId || undefined,
      );
      setExpenseProject(null);
      setExpenseDescription("");
      setExpenseAmount("");
      setExpenseDocumentId("");
      app.notify(
        "Expense recorded. Keep the original invoice with your evidence.",
      );
    } catch (e) {
      setExpenseError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  function downloadReport() {
    if (!report) return;
    const blob = new Blob(
      [
        `DRAFT — FOR HUMAN REVIEW\n${report.project.title}\n\n${reportText(report.content)}\n\nPrepared with AI assistance. Verify against the grant agreement and original evidence before submission.`,
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.project.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-report-draft.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function newExpense(project: FundedProject) {
    setExpenseProject(project);
    setExpenseError("");
    setExpenseDescription("");
    setExpenseAmount("");
    setExpenseDocumentId("");
  }

  return (
    <div className="stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">From funding to impact</p>
          <h1 className="page-title">Your funded projects</h1>
          <p className="page-subtitle">
            Keep the paperwork together. See the difference you’re making.
          </p>
        </div>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {!app.data.projects.length ? (
        <div className="card">
          <EmptyState
            icon={<FolderHeart size={40} />}
            title="Good things will grow here"
            description="When an application is successful, record the award from Applications. Your proposal, budget, milestones and reporting will then stay together here."
          />
        </div>
      ) : (
        <>
          {!selected && (
            <>
              <div className="grid-3">
                <div className="card stat-card">
                  <span className="muted">Projects running</span>
                  <h2>
                    {
                      app.data.projects.filter(
                        (project) =>
                          project.status !== "completed" &&
                          project.status !== "closed",
                      ).length
                    }
                  </h2>
                  <p className="muted">Community ideas in action</p>
                </div>
                <div className="card stat-card">
                  <span className="muted">Funding awarded</span>
                  <h2>{money(totalAwarded)}</h2>
                  <p className="muted">Across your funded projects</p>
                </div>
                <div className="card stat-card">
                  <span className="muted">Expenses recorded</span>
                  <h2>{money(totalSpent)}</h2>
                  <p className="muted">Based on your portal records</p>
                </div>
              </div>
              <div className="grid-2">
                {app.data.projects.map((project) => {
                  const spent = app.data.expenses
                    .filter((expense) => expense.project_id === project.id)
                    .reduce((sum, expense) => sum + Number(expense.amount), 0);
                  const completed = project.milestones.filter(
                    (milestone) => milestone.completed,
                  ).length;
                  const progress =
                    project.awarded_amount > 0
                      ? Math.min(100, (spent / project.awarded_amount) * 100)
                      : 0;
                  return (
                    <article className="card project-card" key={project.id}>
                      <div className="card-heading">
                        <span className="card-icon">
                          <FolderHeart size={23} />
                        </span>
                        <Badge
                          tone={
                            project.status === "completed" ? "neutral" : "green"
                          }
                        >
                          {label(project.status)}
                        </Badge>
                      </div>
                      <p className="eyebrow">{project.funder}</p>
                      <h2>{project.title}</h2>
                      <p className="muted">
                        {date(project.start_date)} – {date(project.end_date)}
                      </p>
                      <div className="budget-summary">
                        <strong>{money(spent)}</strong>
                        <span className="muted">
                          {" "}
                          of {money(project.awarded_amount)} recorded
                        </span>
                      </div>
                      <div
                        className="progress-track"
                        role="meter"
                        aria-label="Awarded funding spent"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progress)}
                      >
                        <div
                          className="progress-bar"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="project-meta">
                        <span>
                          <ClipboardCheck size={16} /> {completed} of{" "}
                          {project.milestones.length} milestones complete
                        </span>
                        <span>
                          <CalendarDays size={16} /> Report:{" "}
                          {date(project.next_report_due)}
                        </span>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => {
                          setSelectedId(project.id);
                          setError("");
                        }}
                      >
                        View project <ArrowUpRight size={17} />
                      </button>
                    </article>
                  );
                })}
              </div>
            </>
          )}
          {selected && (
            <>
              <button
                className="button ghost"
                style={{ alignSelf: "flex-start" }}
                onClick={() => {
                  setSelectedId(null);
                  setError("");
                }}
              >
                <ArrowLeft size={17} /> All funded projects
              </button>
              <div className="card project-detail-heading">
                <div>
                  <p className="eyebrow">{selected.funder}</p>
                  <h2>{selected.title}</h2>
                  <p className="muted">
                    {date(selected.start_date)} – {date(selected.end_date)}
                  </p>
                </div>
                <div className="stack">
                  <Badge>{label(selected.status)}</Badge>
                  <button
                    className="button secondary"
                    onClick={() => editPlan(selected)}
                  >
                    <Pencil size={17} /> Edit project plan
                  </button>
                </div>
              </div>
              <div className="grid-3">
                <div className="card stat-card">
                  <CircleDollarSign size={22} />
                  <span className="muted">Funding awarded</span>
                  <h2>{money(selected.awarded_amount)}</h2>
                </div>
                <div className="card stat-card">
                  <Receipt size={22} />
                  <span className="muted">Expenses recorded</span>
                  <h2>
                    {money(
                      app.data.expenses
                        .filter((expense) => expense.project_id === selected.id)
                        .reduce(
                          (sum, expense) => sum + Number(expense.amount),
                          0,
                        ),
                    )}
                  </h2>
                </div>
                <div className="card stat-card">
                  <CalendarDays size={22} />
                  <span className="muted">Next report due</span>
                  <h2>{date(selected.next_report_due)}</h2>
                </div>
              </div>
              <div className="grid-2">
                <section className="card">
                  <div className="card-heading">
                    <h3>
                      <FileText size={19} /> Original proposal
                    </h3>
                  </div>
                  <ReadableContent value={selected.proposal} />
                </section>
                <section className="card">
                  <div className="card-heading">
                    <h3>
                      <CircleDollarSign size={19} /> Agreed budget
                    </h3>
                  </div>
                  <Budget budget={selected.budget} />
                  <p className="muted">
                    Check the grant agreement before changing how funding is
                    used.
                  </p>
                </section>
              </div>
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h3>One step at a time</h3>
                    <p className="muted">Your project milestones</p>
                  </div>
                  <Badge>
                    {
                      selected.milestones.filter(
                        (milestone) => milestone.completed,
                      ).length
                    }{" "}
                    / {selected.milestones.length} complete
                  </Badge>
                </div>
                {selected.milestones.length ? (
                  <div className="milestone-list">
                    {selected.milestones.map((milestone, i) => (
                      <div
                        className="milestone-row"
                        key={`${i}-${milestone.title}`}
                      >
                        <button
                          className={`milestone-check ${milestone.completed ? "is-complete" : ""}`}
                          disabled={busy !== null}
                          aria-label={`${milestone.completed ? "Mark incomplete" : "Complete milestone"}: ${milestone.title}`}
                          aria-pressed={milestone.completed}
                          onClick={() => toggleMilestone(selected, i)}
                        >
                          {busy === `milestone-${i}` ? (
                            <Busy label="" />
                          ) : milestone.completed ? (
                            <Check size={18} />
                          ) : (
                            <span aria-hidden="true">○</span>
                          )}
                        </button>
                        <div>
                          <strong>{milestone.title}</strong>
                          <p className="muted">
                            Due {date(milestone.due_date)}
                          </p>
                        </div>
                        {milestone.completed && <Badge>Complete</Badge>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    No milestones have been recorded. Add the grant agreement’s
                    delivery and reporting dates when you record this award.
                  </p>
                )}
              </section>
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h3>Expenses & invoices</h3>
                    <p className="muted">
                      A clear record for your final report
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => newExpense(selected)}
                  >
                    <Plus size={17} /> Record expense
                  </button>
                </div>
                {app.data.expenses.some(
                  (expense) => expense.project_id === selected.id,
                ) ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Expense</th>
                          <th scope="col">Date</th>
                          <th scope="col">Amount</th>
                          <th scope="col">Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {app.data.expenses
                          .filter(
                            (expense) => expense.project_id === selected.id,
                          )
                          .map((expense) => (
                            <tr key={expense.id}>
                              <td>{expense.description}</td>
                              <td>{date(expense.incurred_on)}</td>
                              <td>{money(expense.amount)}</td>
                              <td>
                                {expense.document_id ? (
                                  <button
                                    className="button ghost"
                                    onClick={async () => {
                                      try {
                                        await app.openDocument(
                                          expense.document_id!,
                                        );
                                      } catch (e) {
                                        setError(errorMessage(e));
                                      }
                                    }}
                                  >
                                    Open invoice
                                  </button>
                                ) : (
                                  <span className="muted">Not attached</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Receipt size={28} />}
                    title="Your first expense goes here"
                    description="Record each grant expense and keep the original invoice. Forwarded invoices appear in your inbox for review."
                  />
                )}
                <Notice>
                  These are the records you have entered, rather than an audit
                  or a complete accounting ledger. Keep original invoices and
                  reconcile the totals with your accounts.
                </Notice>
              </section>
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h3>Evidence for your report</h3>
                    <p className="muted">
                      Documents saved to your organisation
                    </p>
                  </div>
                  <FileText size={20} />
                </div>
                <p>
                  Keep attendance records, photos with permission, invoices and
                  outcome evidence with your grant agreement. Forwarded
                  attachments need review in your inbox.
                </p>
                {app.data.documents.length ? (
                  <div className="stack">
                    {app.data.documents.slice(0, 5).map((document) => (
                      <div className="document-row" key={document.id}>
                        <FileText size={19} />
                        <span>{document.name}</span>
                        <button
                          className="button ghost"
                          onClick={async () => {
                            try {
                              await app.openDocument(document.id);
                            } catch (e) {
                              setError(errorMessage(e));
                            }
                          }}
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    Save documents from your Organisation page. Only include
                    evidence that belongs to this project when preparing the
                    final report.
                  </p>
                )}
              </section>
              <section className="card report-callout">
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">A helping hand with reporting</p>
                    <h3>Turn your progress into a report draft</h3>
                  </div>
                  <Sparkles size={25} />
                </div>
                <p>
                  Use the proposal, milestones and recorded expenses to make a
                  starting point. Review every claim, add missing evidence and
                  check the funder’s reporting template before submitting.
                </p>
                {selected.report_draft &&
                  Object.keys(selected.report_draft).length > 0 && (
                    <div className="stack">
                      <Notice>
                        A saved report draft is ready to review. Check it
                        against the latest expenses, evidence and the funder’s
                        template.
                      </Notice>
                      <button
                        className="button secondary"
                        onClick={() =>
                          setReport({
                            project: selected,
                            content: selected.report_draft!,
                          })
                        }
                      >
                        <FileText size={17} /> Review saved report draft
                      </button>
                    </div>
                  )}
                <button
                  className="button primary"
                  disabled={busy !== null}
                  onClick={() => generateReport(selected)}
                >
                  {busy === "report" ? (
                    <Busy label="Preparing report draft…" />
                  ) : (
                    <>
                      <Sparkles size={17} />{" "}
                      {selected.report_draft &&
                      Object.keys(selected.report_draft).length > 0
                        ? "Create a fresh report draft"
                        : "Help draft my report"}
                    </>
                  )}
                </button>
              </section>
            </>
          )}
        </>
      )}
      {planProject && (
        <Modal
          title="Edit project plan"
          onClose={() => {
            if (busy !== "plan") setPlanProject(null);
          }}
          wide
        >
          <form className="stack" onSubmit={savePlan}>
            <Notice>
              Record the plan agreed with your funder. Changes here do not
              request a variation or change your original proposal.
            </Notice>
            <label className="form-field">
              Project title
              <input
                value={planTitle}
                onChange={(e) => setPlanTitle(e.target.value)}
                maxLength={250}
                required
              />
            </label>
            <div className="form-grid">
              <label className="form-field">
                Start date
                <input
                  type="date"
                  value={planStart}
                  onChange={(e) => setPlanStart(e.target.value)}
                  required
                />
              </label>
              <label className="form-field">
                End date
                <input
                  type="date"
                  value={planEnd}
                  onChange={(e) => setPlanEnd(e.target.value)}
                  min={planStart || undefined}
                  required
                />
              </label>
              <label className="form-field">
                Next report due (optional)
                <input
                  type="date"
                  value={planReportDue}
                  onChange={(e) => setPlanReportDue(e.target.value)}
                />
              </label>
              <label className="form-field">
                Project status
                <select
                  value={planStatus}
                  onChange={(e) => setPlanStatus(e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="report_due">Report due</option>
                  <option value="completed">Completed</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
            </div>
            <label className="form-field">
              Agreed budget items
              <textarea
                value={planBudget}
                onChange={(e) => {
                  setPlanBudget(e.target.value);
                  setBudgetWarningAccepted(false);
                }}
                rows={5}
                placeholder={"Workshop materials | 1500\nVenue hire | 800"}
              />
              <span className="muted">
                One item per line: item name | amount in AUD. Use the GST
                treatment in your agreement. Zero amounts are allowed.
              </span>
            </label>
            <p>
              <strong>
                Budget total:{" "}
                {planBudgetTotal === null
                  ? "Check the item amounts"
                  : money(planBudgetTotal)}
              </strong>
              <span className="muted">
                {" "}
                · Grant award: {money(planProject.awarded_amount)}
              </span>
            </p>
            {overAward && (
              <div className="stack">
                <Notice>
                  The budget is greater than the grant award. Check that the
                  difference is covered by confirmed co-funding and that this is
                  the funder-approved project budget.
                </Notice>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={budgetWarningAccepted}
                    onChange={(e) => setBudgetWarningAccepted(e.target.checked)}
                  />{" "}
                  I have checked the approved budget and confirmed the
                  additional funding.
                </label>
              </div>
            )}
            <label className="form-field">
              Budget notes (optional)
              <textarea
                value={planNotes}
                onChange={(e) => setPlanNotes(e.target.value)}
                rows={3}
                placeholder="For example, confirmed co-funding or the agreed GST treatment."
              />
            </label>
            <label className="form-field">
              Milestones and reporting dates
              <textarea
                value={planMilestones}
                onChange={(e) => setPlanMilestones(e.target.value)}
                rows={5}
                placeholder={
                  "First workshop delivered | 2027-03-15\nFinal report submitted | 2027-06-30"
                }
              />
              <span className="muted">
                One milestone per line: milestone title | YYYY-MM-DD. Existing
                completion is kept when the title stays the same. New or renamed
                milestones begin as incomplete.
              </span>
            </label>
            {planError && (
              <p className="error-message" role="alert">
                {planError}
              </p>
            )}
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                disabled={busy === "plan"}
                onClick={() => setPlanProject(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={busy === "plan"}
              >
                {busy === "plan" ? (
                  <Busy label="Saving project plan…" />
                ) : (
                  <>
                    <CheckCircle2 size={17} /> Save project plan
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {expenseProject && (
        <Modal
          title="Record an expense"
          onClose={() => {
            if (busy !== "expense") setExpenseProject(null);
          }}
        >
          <form className="stack" onSubmit={saveExpense}>
            <p className="muted">For {expenseProject.title}</p>
            <label className="form-field">
              What was the expense for?
              <input
                value={expenseDescription}
                onChange={(e) => setExpenseDescription(e.target.value)}
                placeholder="For example, materials for the community workshop"
                maxLength={500}
                required
                autoFocus
              />
            </label>
            <div className="form-grid">
              <label className="form-field">
                Amount paid (AUD)
                <input
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                />
              </label>
              <label className="form-field">
                Expense date
                <input
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  type="date"
                  required
                />
              </label>
            </div>
            <label className="form-field">
              Invoice or supporting document (optional)
              <select
                value={expenseDocumentId}
                onChange={(e) => setExpenseDocumentId(e.target.value)}
              >
                <option value="">No document selected</option>
                {app.data.documents.map((document) => (
                  <option value={document.id} key={document.id}>
                    {document.name}
                  </option>
                ))}
              </select>
              <span className="muted">
                Choose a document already saved to your organisation. Upload new
                invoices from the Organisation page.
              </span>
            </label>
            <Notice>
              Use the same GST treatment as your grant’s approved budget. Keep
              the original invoice even when a copy is attached.
            </Notice>
            {expenseError && (
              <p className="error-message" role="alert">
                {expenseError}
              </p>
            )}
            <div className="modal-footer">
              <button
                className="button secondary"
                type="button"
                disabled={busy === "expense"}
                onClick={() => setExpenseProject(null)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy === "expense"}
                type="submit"
              >
                {busy === "expense" ? (
                  <Busy label="Saving…" />
                ) : (
                  <>
                    <CheckCircle2 size={17} /> Save expense
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {report &&
        selected?.id === report.project.id &&
        selected.org_id === report.project.org_id && (
          <Modal title="Your report draft" onClose={() => setReport(null)} wide>
            <div className="stack">
              <Notice>
                This is an AI-assisted draft for your review. It has not been
                submitted. Confirm all amounts, outcomes and evidence against
                the grant agreement.
              </Notice>
              <h3>{report.project.title}</h3>
              <ReadableContent value={report.content} />
              <div className="modal-footer">
                <button
                  className="button secondary"
                  onClick={() => setReport(null)}
                >
                  Close
                </button>
                <button className="button primary" onClick={downloadReport}>
                  <Download size={17} /> Download draft
                </button>
              </div>
            </div>
          </Modal>
        )}
    </div>
  );
}
function Budget({ budget }: { budget: Record<string, unknown> }) {
  if (Array.isArray(budget.categories)) {
    const categories = budget.categories.filter(
      (item): item is { name: string; amount: number } =>
        item != null &&
        typeof item === "object" &&
        typeof item.name === "string" &&
        typeof item.amount === "number",
    );
    if (categories.length)
      return (
        <div className="stack">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Budget (AUD)</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category, i) => (
                  <tr key={i}>
                    <td>{category.name}</td>
                    <td>{money(category.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td>
                    <strong>
                      {money(
                        categories.reduce(
                          (sum, category) => sum + category.amount,
                          0,
                        ),
                      )}
                    </strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {typeof budget.notes === "string" && budget.notes.trim() && (
            <p style={{ whiteSpace: "pre-wrap" }}>{budget.notes}</p>
          )}
        </div>
      );
  }
  return <ReadableContent value={budget} />;
}
