import type { Grade20to80, Handedness, PlayerId, Position, ProspectId, Range, RiskLevel, TeamId, Trend } from "./common";
import type { SchoolDevelopmentBias, SchoolRegion, SchoolTier, SchoolTrait } from "./school";

export type PlayerGroup = "pitcher" | "catcher" | "infielder" | "outfielder";

export type SchoolYear = 1 | 2 | 3;

export type ProspectDataTier = "top-40" | "rank-41-100" | "rank-101-180" | "rank-181-260" | "rank-261-360";

export type LeagueLevel = "전국권" | "상위권" | "보통" | "약한 리그" | "정보 부족";

export type ScoutGrade = "S" | "A" | "B" | "C" | "D" | "E";

export type MetricQuality = "verified" | "estimated" | "missing";

export type PitchingArmSlot = "three-quarter" | "overhand" | "low-three-quarter" | "sidearm" | "submarine";

export type ProspectRiskTag =
  | "injury-history"
  | "small-sample"
  | "weak-competition"
  | "position-uncertainty"
  | "late-bloomer"
  | "signability"
  | "mechanics"
  | "plate-discipline"
  | "command"
  | "defensive-home"
  | "breaking-ball"
  | "low-record-trust"
  | "reputation-risk";

export type MetricReliability<T extends string> = Partial<Record<T, MetricQuality>>;

export type AccoladeCategory = "hitting" | "pitching" | "defense" | "reputation" | "tournament" | "physical";

export type ProspectAccolade = {
  id: string;
  label: string;
  category: AccoladeCategory;
  meaning: string;
  reputationBoost: number;
  hypeBoost: number;
};

export type PhysicalProfile = {
  heightCm: number;
  weightKg: number;
  bats: Handedness;
  throws: "L" | "R";
};

export type HitterStats = {
  games: number;
  plateAppearances: number;
  average: number | null;
  onBase: number | null;
  slugging: number | null;
  ops: number | null;
  homeRuns: number | null;
  doubles: number | null;
  stolenBases: number | null;
  strikeoutRate: number | null;
  walkRate: number | null;
  defensiveGrade: Grade20to80 | null;
  athleticismGrade: Grade20to80 | null;
  positionalValue: number | null;
  reliability: MetricReliability<
    | "average"
    | "onBase"
    | "slugging"
    | "ops"
    | "homeRuns"
    | "doubles"
    | "stolenBases"
    | "strikeoutRate"
    | "walkRate"
    | "defensiveGrade"
    | "athleticismGrade"
    | "positionalValue"
  >;
};

export type PitchType = "four-seam" | "two-seam" | "sinker" | "cutter" | "slider" | "changeup" | "splitter" | "forkball" | "curveball" | "fastball";

export type PitchArsenalEntry = {
  type: PitchType;
  grade: Grade20to80;
};

export type PitcherStats = {
  games: number;
  armSlot: PitchingArmSlot;
  innings: number | null;
  era: number | null;
  maxVelocityKph: number | null;
  averageVelocityKph: number | null;
  strikeoutsPerNine: number | null;
  walksPerNine: number | null;
  whip: number | null;
  pitchCount: number | null;
  outPitch: PitchType | null;
  pitchArsenal?: PitchArsenalEntry[];
  commandGrade: Grade20to80 | null;
  starterChance: number | null;
  reliability: MetricReliability<
    | "innings"
    | "armSlot"
    | "era"
    | "maxVelocityKph"
    | "averageVelocityKph"
    | "strikeoutsPerNine"
    | "walksPerNine"
    | "whip"
    | "pitchCount"
    | "outPitch"
    | "commandGrade"
    | "starterChance"
  >;
};

export type ToolGrades = {
  contact?: Grade20to80;
  power?: Grade20to80;
  speed?: Grade20to80;
  defense?: Grade20to80;
  arm?: Grade20to80;
  fastball?: Grade20to80;
  breakingBall?: Grade20to80;
  changeup?: Grade20to80;
  command?: Grade20to80;
};

export type ScoutingVisibility = "full" | "standard" | "limited" | "thin";

export type VisibleScoutingReport = {
  dataTier: ProspectDataTier;
  visibility: ScoutingVisibility;
  publicRank: number;
  scoutGrade: ScoutGrade;
  confidence: number;
  projectedRound: Range;
  expectedOverallRange: Range;
  trend: Trend;
  tools: ToolGrades;
  riskLevel: RiskLevel;
  riskTags: ProspectRiskTag[];
  strengths: string[];
  weaknesses: string[];
  growthProjection: string;
  teamInterest: string[];
  oneLine: string;
  summary: string;
};

export type HiddenTalentProfile = {
  currentAbility: number;
  potential: number;
  hitterTools?: HitterDevelopmentTools;
  pitcherTools?: PitcherDevelopmentTools;
  growthRate: number;
  injuryRisk: number;
  volatility: number;
  proAdaptation: number;
  workEthic: number;
  truePositionFit: Partial<Record<Position, number>>;
};

export type HitterDevelopmentTools = {
  contact: number;
  discipline: number;
  speed: number;
  power: number;
  defense: number;
  mentality: number;
};

export type PitcherDevelopmentTools = {
  command: number;
  stuff: number;
  velocity: number;
  stamina: number;
  mentality: number;
};

export type DevelopmentTools = HitterDevelopmentTools | PitcherDevelopmentTools;

export type MonthlyFormPoint = {
  month: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  value: number;
};

export type SeasonFormCycle = {
  kind: "hitter" | "pitcher";
  pattern: "steady" | "early-peak" | "summer-slump" | "late-surge" | "volatile" | "stamina-fade" | "rebound";
  points: MonthlyFormPoint[];
  reliability: number;
  staminaSignal: number;
  clutchSignal: number;
  report: string;
};

export type DraftClassQualityProfile = {
  id: "bumper" | "strong" | "normal" | "thin" | "weak";
  label: string;
  description: string;
  currentAbilityShift: number;
  potentialShift: number;
  topTalentShift: number;
  depthTalentShift: number;
  sleeperChanceBoost: number;
  overhypeChanceBoost: number;
  growthRateShift: number;
  volatilityShift: number;
};

export type HighSchoolCareerLogType =
  | "growth"
  | "stall"
  | "decline"
  | "physical"
  | "velocity"
  | "ranking"
  | "role"
  | "injury"
  | "long-rehab"
  | "repeat-year"
  | "transfer"
  | "reputation-risk"
  | "college-risk"
  | "position-change"
  | "accolade"
  | "national-team"
  | "showcase";

export type HighSchoolCareerLogEntry = {
  year: number;
  schoolYear: SchoolYear;
  stageLabel?: string;
  type: HighSchoolCareerLogType;
  headline: string;
  body: string;
  importance: 1 | 2 | 3 | 4 | 5;
};

export type HighSchoolYearSnapshot = {
  year: number;
  schoolYear: SchoolYear;
  stageLabel?: string;
  publicRank: number;
  scoutGrade: ScoutGrade;
  confidence: number;
  heightCm: number;
  weightKg: number;
  primaryStat: string;
  note: string;
  hitterStats?: HitterStats;
  pitcherStats?: PitcherStats;
};

export type ProspectSourceType = "high-school" | "college" | "overseas-returnee";

export type Prospect = {
  id: ProspectId;
  sourceType?: ProspectSourceType;
  collegeProgramType?: "two-year" | "four-year";
  collegeYear?: 2 | 4;
  collegeDraftRoute?: "regular" | "early-entry" | "junior-college" | "redraft";
  overseasPath?: "mlb-minor" | "npb-minor" | "independent" | "academy";
  overseasYears?: number;
  overseasLifestyle?: "regular-starter" | "bench-depth" | "rehab-focused" | "travel-grind" | "training-only";
  returnReason?: "방출" | "부상" | "출전 기회 부족" | "병역/국내 복귀" | "계약 만료";
  draftEligibilityNote?: string;
  draftYear: number;
  highSchoolEntryYear: number;
  draftEligibleYear: number;
  name: string;
  schoolId: string;
  school: string;
  schoolRegion: SchoolRegion;
  schoolTier: SchoolTier;
  schoolTraits: SchoolTrait[];
  schoolDevelopmentBias: SchoolDevelopmentBias;
  schoolLeagueStrength: number;
  /** Percentage points (0-100); legacy saves may contain a 0-1 ratio. */
  schoolReportReliabilityBase: number;
  schoolYear: SchoolYear;
  highSchoolStatus: "active" | "draft-eligible" | "graduated";
  playerGroup: PlayerGroup;
  primaryPosition: Position;
  secondaryPositions: Position[];
  age: number;
  archetype: string;
  leagueLevel: LeagueLevel;
  collegeCommitRisk: number;
  mlbDirectStatus?: "interest" | "signed";
  mlbInterestLevel?: number;
  physical: PhysicalProfile;
  hitterStats?: HitterStats;
  pitcherStats?: PitcherStats;
  seasonFormCycle: SeasonFormCycle;
  accolades: ProspectAccolade[];
  reputation: number;
  draftHype: number;
  visible: VisibleScoutingReport;
  trueTalent: HiddenTalentProfile;
  highSchoolSnapshots: HighSchoolYearSnapshot[];
  highSchoolCareerLog: HighSchoolCareerLogEntry[];
  isDrafted: boolean;
};

export type DraftedPlayer = {
  id: PlayerId;
  sourceProspectId: ProspectId;
  teamId: TeamId;
  name: string;
  draftYear: number;
  primaryPosition: Position;
  archetype: string;
  leagueLevel: LeagueLevel;
  collegeCommitRisk: number;
  accolades: ProspectAccolade[];
  reputation: number;
  draftHype: number;
  trueTalent: HiddenTalentProfile;
  revealed: {
    initialOverall: number;
    currentOverall: number;
    potentialBand: Range;
  };
  career: {
    status: "minors" | "first-team" | "injured" | "released" | "retired";
    yearsPro: number;
    awards: string[];
  };
};
