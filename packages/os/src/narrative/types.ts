export interface NarrativeChange {
  title: string;
  prose: string;
  files: string[];
  primaryFile: string | null;
}

export interface NarrativeDecision {
  what: string;
  why: string | null;
  tradeoff: string | null;
}

export interface NarrativeVerification {
  cmd: string;
  passed: boolean | null;
}

export interface NarrativePrGroup {
  label: string;
  files: string[];
  lookFirst: boolean;
}

export interface NarrativePrReview {
  groups: NarrativePrGroup[];
  risk: string | null;
}

export interface SessionNarrative {
  tldr: string;
  why: string;
  changes: NarrativeChange[];
  decisions: NarrativeDecision[];
  verifications: NarrativeVerification[];
  prReview: NarrativePrReview;
}
