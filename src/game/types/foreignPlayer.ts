import type { ForeignPlayerId, Handedness, Position, Range, RiskLevel, Year } from "./common";
import type { ScoutGrade } from "./player";

export type ForeignPlayerSlot = "standard" | "asian-quota";
export type ForeignPlayerGroup = "pitcher" | "hitter";
export type ForeignPlayerMarketStatus = "available" | "signed" | "withdrawn";

export type ForeignOriginLeague =
  | "MLB"
  | "AAA"
  | "AA"
  | "MiLB"
  | "Mexican League"
  | "Independent"
  | "NPB"
  | "NPB Futures"
  | "Japanese Industrial"
  | "CPBL"
  | "ABL";

export type ForeignPlayerPreference =
  | "money"
  | "championship"
  | "guaranteed-role"
  | "stability"
  | "large-market"
  | "overseas-return";

export type ForeignRiskTag =
  | "injury-history"
  | "command-variance"
  | "breaking-ball-adjustment"
  | "velocity-decline"
  | "strikeout-heavy"
  | "defensive-limit"
  | "limited-sample"
  | "age-decline"
  | "kbo-adjustment";

export type ForeignPitcherTools = {
  command: number;
  stuff: number;
  velocity: number;
  stamina: number;
  mentality: number;
};

export type ForeignHitterTools = {
  contact: number;
  discipline: number;
  speed: number;
  power: number;
  defense: number;
  mentality: number;
};

export type ForeignPitcherRecentStats = {
  kind: "pitcher";
  games: number;
  innings: number;
  wins: number;
  losses: number;
  saves: number;
  holds: number;
  strikeouts: number;
  walks: number;
  era: number;
  whip: number;
  strikeoutsPerNine: number;
  walksPerNine: number;
  averageVelocityKph: number;
  maxVelocityKph: number;
};

export type ForeignHitterRecentStats = {
  kind: "hitter";
  games: number;
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  runsBattedIn: number;
  average: number;
  onBasePercentage: number;
  sluggingPercentage: number;
  ops: number;
  homeRuns: number;
  strikeoutRate: number;
  walkRate: number;
  stolenBases: number;
};

export type ForeignRecentStats = ForeignPitcherRecentStats | ForeignHitterRecentStats;

export type ForeignCareerSeason = {
  seasonYear: Year;
  age: number;
  league: ForeignOriginLeague;
  stats: ForeignRecentStats;
};

export type ForeignVisibleReport = {
  scoutGrade: ScoutGrade;
  confidence: number;
  expectedOverallRange: Range;
  expectedAdaptationRange: Range;
  expectedSalaryUsd: Range;
  riskLevel: RiskLevel;
  riskTags: ForeignRiskTag[];
  strengths: string[];
  weaknesses: string[];
  summary: string;
};

export type ForeignHiddenProfile = {
  baseOverall: number;
  kboAdaptation: number;
  adjustmentSpeed: number;
  volatility: number;
  injuryRisk: number;
  declineRisk: number;
  motivation: number;
};

export type ForeignPlayerCandidate = {
  id: ForeignPlayerId;
  generationVersion?: number;
  marketYear: Year;
  slotType: ForeignPlayerSlot;
  status: ForeignPlayerMarketStatus;
  name: string;
  nationality: string;
  age: number;
  playerGroup: ForeignPlayerGroup;
  primaryPosition: Position;
  secondaryPositions: Position[];
  throws: Exclude<Handedness, "S">;
  bats: Handedness;
  formerLeague: ForeignOriginLeague;
  formerClubLevel: string;
  preferredCondition: ForeignPlayerPreference;
  recentStats: ForeignRecentStats;
  careerHistory: ForeignCareerSeason[];
  pitcherTools?: ForeignPitcherTools;
  hitterTools?: ForeignHitterTools;
  pitchMix?: string[];
  visible: ForeignVisibleReport;
  hidden: ForeignHiddenProfile;
  marketCarryover?: {
    source: "waiver" | "top" | "random";
    sinceYear: Year;
  };
  waiverMarketUntilYear?: Year;
};
