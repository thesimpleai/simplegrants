import type { Profile } from "../types";

type Field = {
  key: string;
  label: string;
  multiline?: boolean;
  date?: boolean;
  options?: string[];
};
const activityFields: Field[] = [
  { key: "name", label: "Activity or program name" },
  {
    key: "status",
    label: "Activity status",
    options: ["unspecified", "current", "historical", "planned"],
  },
  { key: "description", label: "Activity description", multiline: true },
  { key: "start_date", label: "Activity start date", date: true },
  { key: "end_date", label: "Activity end date", date: true },
  { key: "outcomes", label: "Documented outcomes", multiline: true },
  { key: "source", label: "Activity source document" },
];
const insuranceFields: Field[] = [
  { key: "insurer", label: "Insurer" },
  { key: "policy_type", label: "Policy type" },
  { key: "policy_number", label: "Policy number" },
  { key: "coverage", label: "Coverage details", multiline: true },
  { key: "coverage_amount", label: "Coverage amount" },
  { key: "starts_on", label: "Coverage start date", date: true },
  { key: "expires_on", label: "Coverage expiry date", date: true },
  { key: "issued_on", label: "Policy issue date", date: true },
  { key: "source", label: "Insurance source document" },
];
function records(value: unknown): Record<string, string>[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object")
    : [];
}
function RecordEditor({
  title,
  singular,
  value,
  fields,
  onChange,
}: {
  title: string;
  singular: string;
  value: unknown;
  fields: Field[];
  onChange: (value: Record<string, string>[]) => void;
}) {
  const items = records(value);
  return (
    <div className="profile-record-list">
      {items.map((item, index) => (
        <fieldset className="profile-record" key={index}>
          <legend>
            {singular} {index + 1}
          </legend>
          <div className="form-grid">
            {fields.map((field) => (
              <label
                className={`form-field ${field.multiline ? "profile-wide-field" : ""}`}
                key={field.key}
              >
                {field.label}
                {field.multiline ? (
                  <textarea
                    rows={3}
                    value={item[field.key] ?? ""}
                    onChange={(event) =>
                      onChange(
                        items.map((row, position) =>
                          position === index
                            ? { ...row, [field.key]: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                ) : field.options ? (
                  <select
                    value={item[field.key] ?? "unspecified"}
                    onChange={(event) =>
                      onChange(
                        items.map((row, position) =>
                          position === index
                            ? { ...row, [field.key]: event.target.value }
                            : row,
                        ),
                      )
                    }
                  >
                    {field.options.map((option) => (
                      <option value={option} key={option}>
                        {option === "unspecified"
                          ? "Not specified in sources"
                          : option[0].toUpperCase() + option.slice(1)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder={
                      field.date
                        ? "YYYY-MM-DD, month or year as documented"
                        : undefined
                    }
                    value={item[field.key] ?? ""}
                    onChange={(event) =>
                      onChange(
                        items.map((row, position) =>
                          position === index
                            ? { ...row, [field.key]: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                )}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              onChange(items.filter((_, position) => position !== index))
            }
          >
            Remove {singular.toLowerCase()} {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="button secondary"
        onClick={() => onChange([...items, {}])}
      >
        Add {title}
      </button>
    </div>
  );
}

/** Optional details stay in short, named groups so directors can review one topic at a time. */
export function ProfileDetailsForm({
  profile,
  onChange,
}: {
  profile: Profile;
  onChange: (profile: Profile) => void;
}) {
  const set = (field: string, value: unknown) =>
    onChange({ ...profile, [field]: value });
  const textField = (
    field: string,
    label: string,
    multiline = false,
    date = false,
  ) => (
    <label className="form-field" key={field}>
      {label}
      {multiline ? (
        <textarea
          rows={4}
          value={String(profile[field] ?? "")}
          onChange={(event) => set(field, event.target.value)}
        />
      ) : (
        <input
          type="text"
          placeholder={
            date ? "YYYY-MM-DD, month or year as documented" : undefined
          }
          value={String(profile[field] ?? "")}
          onChange={(event) => set(field, event.target.value)}
        />
      )}
    </label>
  );
  const listField = (field: string, label: string) => (
    <label className="form-field" key={field}>
      {label} <span className="small muted">One per line, if documented</span>
      <textarea
        rows={3}
        value={
          Array.isArray(profile[field])
            ? (profile[field] as string[]).join("\n")
            : ""
        }
        onChange={(event) => set(field, event.target.value.split("\n"))}
      />
    </label>
  );
  return (
    <div className="profile-optional-sections">
      <p className="small muted">
        Optional details help with future applications. Leave unknown
        information blank and use only facts you can support.
      </p>
      <details className="profile-detail-section">
        <summary>Purpose, people and places</summary>
        <div className="stack">
          {textField("mission", "Mission or purpose", true)}
          {listField("beneficiaries", "People and communities you support")}
          {listField("service_locations", "Service locations")}
        </div>
      </details>
      <details className="profile-detail-section">
        <summary>History and milestones</summary>
        <div className="stack">
          {textField("history", "Organisation history", true)}
          {textField("founded_on", "Founding date", false, true)}
          <p className="small muted">
            A registration or certificate date is not necessarily a founding
            date. For milestones, a documented year or month is enough.
          </p>
          <RecordEditor
            title="milestone"
            singular="Milestone"
            value={profile.milestones}
            fields={[
              { key: "title", label: "Milestone title" },
              { key: "date", label: "Milestone date or year" },
              { key: "details", label: "Milestone details", multiline: true },
              { key: "source", label: "Milestone source document" },
            ]}
            onChange={(value) => set("milestones", value)}
          />
        </div>
      </details>
      <details className="profile-detail-section">
        <summary>Activities and programs</summary>
        <div className="stack">
          <p className="small muted">
            Keep current, historical and planned work distinct. Record dates and
            outcomes only when documented.
          </p>
          <RecordEditor
            title="activity or program"
            singular="Activity"
            value={profile.activities}
            fields={activityFields}
            onChange={(value) => set("activities", value)}
          />
        </div>
      </details>
      <details className="profile-detail-section">
        <summary>Registration and charity details</summary>
        <div className="stack">
          {textField("legal_name", "Legal organisation name")}
          <label className="form-field">
            ACNC registration
            <select
              value={
                typeof profile.acnc_registered === "boolean"
                  ? String(profile.acnc_registered)
                  : ""
              }
              onChange={(event) =>
                set(
                  "acnc_registered",
                  event.target.value === ""
                    ? undefined
                    : event.target.value === "true",
                )
              }
            >
              <option value="">Not established in sources</option>
              <option value="true">Registered</option>
              <option value="false">Not registered</option>
            </select>
          </label>
          <div className="form-grid">
            {textField("registration_authority", "Registration authority")}
            {textField("registration_number", "Registration number")}
            {textField(
              "registration_date",
              "Entity registration date",
              false,
              true,
            )}
            {textField(
              "charity_registration_number",
              "Charity registration number",
            )}
            {textField(
              "charity_registration_date",
              "Charity registration date",
              false,
              true,
            )}
            {textField(
              "certificate_issue_date",
              "Certificate issue date",
              false,
              true,
            )}
          </div>
        </div>
      </details>
      <details className="profile-detail-section">
        <summary>Insurance policies</summary>
        <div className="stack">
          <p className="small muted">
            Private policy details are for authorised application work. Check
            each policy against its source; profile details alone do not replace
            a current insurance certificate.
          </p>
          <RecordEditor
            title="insurance policy"
            singular="Policy"
            value={profile.insurance_policies}
            fields={insuranceFields}
            onChange={(value) => set("insurance_policies", value)}
          />
        </div>
      </details>
      <details className="profile-detail-section">
        <summary>Other documented facts</summary>
        <RecordEditor
          title="documented fact"
          singular="Fact"
          value={profile.other_facts}
          fields={[
            { key: "label", label: "Fact topic" },
            { key: "value", label: "Documented fact", multiline: true },
            { key: "source", label: "Fact source document" },
          ]}
          onChange={(value) => set("other_facts", value)}
        />
      </details>
    </div>
  );
}

export function ProfileDetailsSummary({ profile }: { profile: Profile }) {
  const text = (label: string, value: unknown) =>
    typeof value === "string" && value.trim() ? (
      <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ) : null;
  const list = (label: string, value: unknown) =>
    Array.isArray(value) && value.length ? text(label, value.join(", ")) : null;
  const recordSummary = (
    label: string,
    value: unknown,
    labels: Record<string, string>,
  ) =>
    records(value).length ? (
      <details className="profile-detail-section">
        <summary>
          {label} ({records(value).length})
        </summary>
        {records(value).map((item, index) => (
          <dl className="profile-facts" key={index}>
            {Object.entries(labels).map(([field, title]) =>
              text(title, item[field]),
            )}
          </dl>
        ))}
      </details>
    ) : null;
  return (
    <details className="profile-detail-section">
      <summary>More organisation details</summary>
      <dl className="profile-facts">
        {text("Mission or purpose", profile.mission)}
        {list("Beneficiaries", profile.beneficiaries)}
        {list("Service locations", profile.service_locations)}
        {text("History", profile.history)}
        {text("Founding date", profile.founded_on)}
        {text("Legal name", profile.legal_name)}
        {typeof profile.acnc_registered === "boolean" &&
          text(
            "ACNC registration",
            profile.acnc_registered ? "Registered" : "Not registered",
          )}
        {text("Registration authority", profile.registration_authority)}
        {text("Registration number", profile.registration_number)}
        {text("Entity registration date", profile.registration_date)}
        {text(
          "Charity registration number",
          profile.charity_registration_number,
        )}
        {text("Charity registration date", profile.charity_registration_date)}
        {text("Certificate issue date", profile.certificate_issue_date)}
      </dl>
      {recordSummary("Milestones", profile.milestones, {
        title: "Milestone",
        date: "Date",
        details: "Details",
        source: "Source",
      })}
      {recordSummary(
        "Activities and programs",
        profile.activities,
        Object.fromEntries(
          activityFields.map((field) => [field.key, field.label]),
        ),
      )}
      {recordSummary(
        "Insurance policies",
        profile.insurance_policies,
        Object.fromEntries(
          insuranceFields.map((field) => [field.key, field.label]),
        ),
      )}
      {recordSummary("Other documented facts", profile.other_facts, {
        label: "Topic",
        value: "Fact",
        source: "Source",
      })}
    </details>
  );
}
