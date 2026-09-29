import type { ForeignContractId, ForeignOfferId, ForeignPlayerId, TeamId, Year } from "./common";
import type { ForeignPlayerCandidate, ForeignPlayerGroup, ForeignPlayerPreference, ForeignPlayerSlot, ForeignRecentStats } from "./foreignPlayer";
import type { SeasonFormCycle } from "./player";

export type ForeignContractStatus = "active" | "expired" | "released" | "voided" | "overseas-departed";
export type ForeignOverseasDestination = "MLB" | "AAA" | "NPB";

export type ForeignGuaranteedRole =
  | "starting-pitcher"
  | "closer"
  | "bullpen"
  | "flexible-pitcher"
  | "everyday-player"
  | "platoon-player"
  | "bench-player";

export type ForeignContractExitReason =
  | "contract-complete"
  | "performance"
  | "injury"
  | "adaptation"
  | "discipline"
  | "mutual-agreement"
  | "overseas-return";

export type ForeignContractTerms = {
  years: number;
  annualSalaryUsd: number;
  guaranteedRole: ForeignGuaranteedRole;
  signingBonusUsd?: number;
  incentivesUsd?: number;
};

export type ForeignRetentionRecommendation = "priority-renewal" | "renewal" | "review" | "release-candidate";
export type ForeignRolePromiseStatus = "protected" | "fulfilled" | "downgraded" | "violated";
export type ForeignRosterDecisionType = "renewed" | "retained" | "role-downgrade" | "non-renewal" | "waived" | "overseas-departure";

export type ForeignKboSeason = {
  seasonYear: Year;
  age: number;
  actualAdaptation: number;
  effectiveOverall: number;
  injuryDays: number;
  formCycle?: SeasonFormCycle;
  stats: ForeignRecentStats;
};

export type ForeignRetentionEvaluation = {
  seasonYear: Year;
  score: number;
  performanceScore: number;
  recommendation: ForeignRetentionRecommendation;
  reasons: string[];
  overseasReturnProbability?: number;
};

export type ForeignRosterDecision = {
  seasonYear: Year;
  teamId: TeamId;
  playerId: ForeignPlayerId;
  playerName: string;
  decision: ForeignRosterDecisionType;
  score: number;
  summary: string;
  nextContractId?: ForeignContractId;
  destination?: ForeignOverseasDestination;
};

export type ForeignContract = {
  id: ForeignContractId;
  playerId: ForeignPlayerId;
  teamId: TeamId;
  slotType: ForeignPlayerSlot;
  playerGroup: ForeignPlayerGroup;
  signedYear: Year;
  startYear: Year;
  endYear: Year;
  annualSalaryUsd: number;
  signingBonusUsd: number;
  incentivesUsd: number;
  totalValueUsd: number;
  guaranteedRole: ForeignGuaranteedRole;
  currentRole?: ForeignGuaranteedRole;
  rolePromiseStatus?: ForeignRolePromiseStatus;
  rolePromiseGraceUntilYear?: Year;
  rolePromiseNote?: string;
  dissatisfaction?: number;
  status: ForeignContractStatus;
  renewalCount: number;
  previousContractId?: ForeignContractId;
  endedYear?: Year;
  exitReason?: ForeignContractExitReason;
  playerSnapshot?: ForeignPlayerCandidate;
  seasonHistory?: ForeignKboSeason[];
  latestRetentionEvaluation?: ForeignRetentionEvaluation;
  overseasDestination?: ForeignOverseasDestination;
};

export type ForeignRosterUsage = {
  total: number;
  standard: number;
  asianQuota: number;
  standardPitchers: number;
  standardHitters: number;
};

export type ForeignRosterViolation =
  | "player-already-contracted"
  | "total-limit"
  | "standard-limit"
  | "asian-quota-limit"
  | "standard-pitcher-limit"
  | "standard-hitter-limit";

export type ForeignRosterValidation = {
  allowed: boolean;
  violations: ForeignRosterViolation[];
  usage: ForeignRosterUsage;
};

export type ForeignOfferStatus = "submitted" | "accepted" | "rejected" | "withdrawn";

export type ForeignOfferRejectionReason =
  | "duplicate-team-offer"
  | "player-unavailable"
  | "role-mismatch"
  | "roster-limit"
  | "lost-player-choice";

export type ForeignContractOffer = {
  id: ForeignOfferId;
  recruitmentYear: Year;
  round: number;
  teamId: TeamId;
  playerId: ForeignPlayerId;
  terms: ForeignContractTerms;
  status: ForeignOfferStatus;
  rejectionReason?: ForeignOfferRejectionReason;
};

export type ForeignRecruitmentDecision = {
  year: Year;
  round: number;
  playerId: ForeignPlayerId;
  winnerTeamId: TeamId;
  winningOfferId: ForeignOfferId;
  competingTeamIds: TeamId[];
  winningFactor: ForeignPlayerPreference | "opportunity";
  winningScore: number;
};

export type ForeignRecruitmentStatus = "not-started" | "open" | "complete";

export type ForeignRecruitmentState = {
  year: Year;
  status: ForeignRecruitmentStatus;
  currentRound: number;
  maxRounds: number;
  pendingTeamIds: TeamId[];
  completedTeamIds: TeamId[];
};
