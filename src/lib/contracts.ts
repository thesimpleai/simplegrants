import type { User } from "@supabase/supabase-js";
import type { SetupQuestionKey, SetupSuggestion } from "./setup-questionnaire";
import type { GrantImportCandidate } from "./grant-import";
import type {
  AIResult,
  Application,
  DiscoveryStage,
  Frequency,
  FundedProject,
  InboxMessage,
  Opportunity,
  Organisation,
  OrgData,
  Profile,
  ProfileStage,
  ReviewCheck,
  SearchDraft,
  UploadBatchResult,
} from "../types";
export interface ProfileReviewCheckpoint {
  userId: string;
  orgId: string;
  text: string;
  documentIds: readonly string[];
  sourceFingerprint: string;
  profileDraft: Profile;
  profileChecks?: ReviewCheck[];
  evidence: unknown[];
}

export interface AIProgress {
  onProfileStage?: (stage: ProfileStage) => void;
  profileReview?: { current: ProfileReviewCheckpoint | null };
  onDiscoveryStage?: (stage: DiscoveryStage) => void;
  discoveryReview?: { current: DiscoveryCheckpoint | null };
}

export interface DiscoveryCheckpoint {
  userId: string;
  orgId: string;
  stage: "verify" | "extract";
  receipt: {
    searchDraft: SearchDraft;
    sourceFingerprint: string;
    stageIssuedAt: number;
  };
}

export interface AppContextValue {
  mode: "demo" | "live";
  configured: boolean;
  user: User | null;
  org: Organisation | null;
  organisations: Organisation[];
  data: OrgData;
  loading: boolean;
  connectionError: string | null;
  organisationsLoaded: boolean;
  retryConnection: () => Promise<void>;
  toast: string;
  notify: (message: string) => void;
  selectOrg: (id: string) => void;
  signIn: (email: string, website?: string) => Promise<void>;
  signOut: () => Promise<void>;
  createOrg: (name: string, frequency: Frequency) => Promise<void>;
  updateOrg: (patch: Partial<Organisation>) => Promise<void>;
  uploadDocuments: (
    files: File[],
    category: string,
    expiresOn?: string | null,
  ) => Promise<UploadBatchResult>;
  updateDocumentExpiry: (id: string, expiresOn: string | null) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  openDocument: (id: string) => Promise<void>;
  runAI: (
    payload: {
      action: string;
      text?: string;
      documentIds?: string[];
      opportunityId?: string;
      applicationId?: string;
      projectId?: string;
      message?: string;
      includeInsurance?: boolean;
      allowIncompleteDraft?: boolean;
      reviewExistingDraft?: boolean;
      importStage?: "preview" | "save";
      importCandidates?: GrantImportCandidate[];
      selectedIndexes?: number[];
      sourceFingerprint?: string;
      stageIssuedAt?: number;
      conflicts?: {
        questionKey: SetupQuestionKey;
        candidates: Omit<SetupSuggestion, "questionKey">[];
      }[];
    },
    progress?: AIProgress,
  ) => Promise<AIResult>;
  refresh: () => Promise<void>;
  repairSourceLinks: () => Promise<{
    repaired: number;
    unresolved: number;
    hasMore: boolean;
  }>;
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
