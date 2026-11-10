export type Frequency = "weekly" | "monthly" | "never";
export type Profile = {
  name: string;
  abn?: string;
  type?: string;
  state?: string;
  description?: string;
  focus_areas?: string[];
  website?: string;
  legal_name?: string;
  acnc_registered?: boolean;
  [key: string]: unknown;
};
export interface Organisation {
  id: string;
  name: string;
  abn: string | null;
  type: string;
  state: string;
  description: string;
  focus_areas: string[];
  website?: string | null;
  profile: Profile;
  notification_frequency: Frequency;
  verification_status: "draft" | "review" | "approved";
  inbox_alias: string;
  created_at?: string;
}
export interface DocumentRecord {
  id: string;
  org_id: string;
  name: string;
  category: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  extracted_text?: string | null;
  expires_on?: string | null;
  verified: boolean;
  created_at: string;
}
export interface Opportunity {
  id: string;
  org_id: string;
  title: string;
  funder: string;
  amount_min: number | null;
  amount_max: number | null;
  opens_on: string | null;
  closes_at: string | null;
  source_url: string;
  guidelines_text: string;
  summary: string;
  location: string;
  focus_areas: string[];
  match_score: number | null;
  requirements: string[];
  status: "open" | "saved" | "archived";
  provenance: Record<string, unknown>;
  created_at?: string;
}
export interface Application {
  id: string;
  org_id: string;
  opportunity_id: string;
  title: string;
  status: "draft" | "review" | "submitted" | "awarded" | "declined";
  draft: Record<string, unknown>;
  project_details: Record<string, unknown>;
  requested_amount: number | null;
  submitted_at?: string | null;
  grant_reference?: string | null;
  created_at: string;
}
export interface FundedProject {
  id: string;
  org_id: string;
  application_id: string | null;
  title: string;
  funder: string;
  awarded_amount: number;
  start_date: string;
  end_date: string;
  next_report_due: string | null;
  status: string;
  proposal: Record<string, unknown>;
  budget: Record<string, unknown>;
  report_draft?: Record<string, unknown> | null;
  milestones: { title: string; due_date: string; completed: boolean }[];
}
export interface Expense {
  id: string;
  org_id: string;
  project_id: string;
  description: string;
  amount: number;
  incurred_on: string;
  document_id?: string | null;
}
export interface InboxMessage {
  id: string;
  org_id: string;
  project_id: string | null;
  sender: string;
  subject: string;
  body: string;
  classification: string;
  status: string;
  received_at: string;
  attachments: Record<string, unknown>[];
}
export interface ReviewCheck {
  field: string;
  issue: string;
  source?: string;
  suggestion?: string;
}
export interface AIResult {
  profile?: Profile;
  checks?: ReviewCheck[];
  evidence?: unknown[];
  opportunities?: Opportunity[];
  draft?: Record<string, unknown>;
  answer?: string;
  report?: Record<string, unknown>;
  sources?: { title: string; uri: string }[];
  message?: string;
}
export interface OrgData {
  documents: DocumentRecord[];
  opportunities: Opportunity[];
  applications: Application[];
  projects: FundedProject[];
  expenses: Expense[];
  messages: InboxMessage[];
}
