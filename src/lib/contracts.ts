import type { User } from "@supabase/supabase-js";
import type {
  AIResult,
  Application,
  Frequency,
  FundedProject,
  InboxMessage,
  Opportunity,
  Organisation,
  OrgData,
} from "../types";
export interface AppContextValue {
  mode: "demo" | "live";
  configured: boolean;
  user: User | null;
  org: Organisation | null;
  organisations: Organisation[];
  data: OrgData;
  loading: boolean;
  toast: string;
  notify: (message: string) => void;
  selectOrg: (id: string) => void;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  createOrg: (name: string, frequency: Frequency) => Promise<void>;
  updateOrg: (patch: Partial<Organisation>) => Promise<void>;
  uploadDocuments: (files: File[], category: string) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  openDocument: (id: string) => Promise<void>;
  runAI: (payload: {
    action: string;
    text?: string;
    documentIds?: string[];
    opportunityId?: string;
    applicationId?: string;
    projectId?: string;
    message?: string;
  }) => Promise<AIResult>;
  refresh: () => Promise<void>;
  saveOpportunity: (
    patch: Partial<Opportunity> & { id: string },
  ) => Promise<void>;
  startApplication: (opportunity: Opportunity) => Promise<Application>;
  updateApplication: (id: string, patch: Partial<Application>) => Promise<void>;
  createFundedProject: (
    applicationId: string,
    input: {
      amount: number;
      startDate: string;
      endDate: string;
      reportDue: string;
      milestone: string;
    },
  ) => Promise<void>;
  updateProject: (id: string, patch: Partial<FundedProject>) => Promise<void>;
  addExpense: (
    projectId: string,
    description: string,
    amount: number,
    date: string,
    documentId?: string,
  ) => Promise<void>;
  updateMessage: (id: string, patch: Partial<InboxMessage>) => Promise<void>;
}
