import type { DraftPickId, Position, ProspectId, TeamId } from "./common";
import type { DraftPick } from "./draft";
import type { GameState } from "./game";
import type { DevelopmentTools, Prospect } from "./player";
import type { SchoolProfile } from "./school";
import type { Team } from "./team";

export type SortDirection = "asc" | "desc";
export type PlayerTypeFilter = "all" | "hitters" | "pitchers";
export type DraftPhase = "team-selection" | "generating" | "pre-draft" | "draft" | "complete";
export type MainTab = "draft-room" | "scouting" | "team" | "review" | "tracking" | "league-history";
export type LeagueHistorySubTab = "current" | "operations" | "narrative";
export type NewsViewMode = "timeline" | "player";
export type NewsScope = "user-team" | "watched" | "league";
export type NewsGrade = "headline" | "major" | "normal" | "archive";
export type CareerYearBucket = "all" | "year-1" | "year-2-3" | "year-4-5" | "year-6-10" | "year-11-15" | "year-16-20" | "year-20-plus";
export type CareerModalTab = "tracking" | "pro";
export type TrackingSortKey = "round" | "overallPick" | "name" | "position" | "initialOverall" | "currentOverall" | "overallChange" | "status" | "trackingStatus" | "recommended";

export type FilterPreset =
  | "top-available"
  | "team-needs"
  | "pitchers"
  | "hitters"
  | "premium-defense"
  | "low-risk"
  | "upside"
  | "safe"
  | "awarded"
  | "college-risk"
  | "late-sleepers"
  | "high-confidence"
  | "league-adjusted"
  | "pitcher-lottery"
  | "high-risk-upside";

export type SortKey =
  | "rank"
  | "projectedRound"
  | "position"
  | "positionalValue"
  | "ops"
  | "homeRuns"
  | "strikeoutRate"
  | "maxVelocityKph"
  | "strikeoutsPerNine"
  | "walksPerNine"
  | "defensiveGrade"
  | "scoutGrade"
  | "reputation"
  | "draftHype"
  | "risk"
  | "confidence";

export type DraftSelectionView = {
  pick: DraftPick;
  team: Team;
  prospect: Prospect;
  isPanicPick?: boolean;
};

export type DraftIntelEvent = {
  id: string;
  year: number;
  stage: "D-30" | "D-14" | "D-7" | "D-1" | "당일" | "타임";
  type: "언론 동향" | "구단 관심" | "연막" | "비공개 테스트" | "리스크 점검" | "MLB 변수" | "팬 여론" | "타임 회의";
  tone: "positive" | "neutral" | "negative" | "smoke";
  headline: string;
  body: string;
  impact: string;
  prospectId?: ProspectId;
  prospectName?: string;
  teamId?: TeamId;
  teamName?: string;
};

export type PreDraftAction = "quiet-follow" | "public-interest" | "smoke-screen";

export type DraftTimeoutReport = {
  id: string;
  year: number;
  pickRound: number;
  pickOverall: number;
  headline: string;
  lines: string[];
  focusProspectId?: ProspectId;
};

export type AppSaveState = {
  scoutName: string;
  game?: GameState;
  dynamicTeams: Team[];
  phase: DraftPhase;
  activeTab: MainTab;
  userTeamId?: TeamId;
  selections: DraftSelectionView[];
  notifications: string[];
  predraftIntelEvents: DraftIntelEvent[];
  predraftUserAction?: PreDraftAction;
  predraftStageIndex: number;
  draftTimeoutsUsed: number;
  draftTimeoutReports: DraftTimeoutReport[];
  careerYear: number;
  careerPlayers: CareerPlayerState[];
  existingPlayers: ExistingLeaguePlayer[];
  careerNews: CareerNewsItem[];
  selectedCareerId: ProspectId | "";
  seasonResults: TeamSeasonResult[];
  nextDraftPicks: DraftPick[];
  pickTradeEvents: PickTradeEvent[];
  teamTradeStrengthAdjustments: Record<string, number>;
  needHistory: TeamNeedSnapshot[];
  legacyEndingSeen: boolean;
};

export type TrackingStatus = "auto" | "follow" | "summary" | "archived";

export type CareerLogEntry = {
  year: number;
  week: number;
  grade: NewsGrade;
  type: string;
  headline: string;
  importance: CareerNewsItem["importance"];
  overallChange?: number;
  overallAfter?: number;
  compacted?: boolean;
};

export type SeasonCycleResult = {
  earlyDelta: number;
  midDelta: number;
  lateDelta: number;
  totalDelta: number;
  nextOverall: number;
  injuryRoll: boolean;
  longRehab: boolean;
  pattern: "steady-growth" | "slump" | "rebound" | "plateau" | "regression";
  developmentOutcome: DevelopmentOutcome;
};

export type DevelopmentOutcome =
  | "overall-growth"
  | "strength-focus"
  | "weakness-fix"
  | "maintain"
  | "strength-fade"
  | "weakness-worsen"
  | "overall-decline"
  | "major-injury";

export type SeasonDevelopmentClimate = {
  id: "excellent" | "good" | "normal" | "poor" | "rough";
  label: string;
  description: string;
  growthShift: number;
  adaptationShift: number;
  volatilityShift: number;
  injuryShift: number;
};

export type CareerPlayerState = {
  playerId: ProspectId;
  prospect: Prospect;
  team: Team;
  pick: DraftPick;
  draftYear: number;
  initialOverall: number;
  currentOverall: number;
  overall: number;
  currentTools: DevelopmentTools;
  yearsPro: number;
  yearsSinceDraft: number;
  releaseProtectionUntilYear: number;
  trackingStatus: TrackingStatus;
  trackingArchivedAtYear?: number;
  status: "2군" | "1군" | "부상" | "방출" | "은퇴" | "해외진출";
  currentPosition?: Position;
  bullpenRole?: "마무리" | "셋업맨" | "필승조" | "롱맨" | "추격조" | "패전조";
  fieldingRole?: "지명타자";
  debuted: boolean;
  firstHit: boolean;
  firstHomeRun: boolean;
  firstStart: boolean;
  eventKeys: string[];
  careerLog: CareerLogEntry[];
  failureReason?: string;
  originalTeamId: TeamId;
  transactionLog: string[];
  customNickname?: string;
  militaryStatus?: "none" | "serving" | "completed" | "exempt";
  militaryType?: "상무" | "일반 병역";
  militaryServiceUntilYear?: number;
};

export type CareerNewsItem = {
  id: string;
  year: number;
  week: number;
  grade: NewsGrade;
  importance: 1 | 2 | 3 | 4 | 5;
  type: string;
  headline: string;
  body: string;
  teamName?: string;
  playerId?: ProspectId;
  emphasis?: "user" | "watched" | "missed";
};

export type TeamLegacyRow = {
  teamId: TeamId;
  teamName: string;
  franchiseStars: LegacyPlayerItem[];
  hallOfFame: Array<LegacyPlayerItem & { confirmed: boolean }>;
  retiredNumbers: Array<LegacyPlayerItem & { confirmed: boolean; number: number }>;
};

export type LegacyPlayerItem = {
  player: CareerPlayerState;
  nickname: string;
};

export type DraftRegretRecord = {
  id: string;
  year: number;
  label: string;
  teamName: string;
  pickedName: string;
  missedName: string;
  body: string;
  missedPlayerId: ProspectId;
};

export type RecordBreakerRow = {
  id: string;
  year: number;
  teamName: string;
  player: CareerPlayerState;
  record: string;
  rarity: string;
  ordinalKey?: string;
  ordinalStart?: number;
};

export type YearlyAwardRow = {
  id: string;
  seasonYear: number;
  category: string;
  teamName: string;
  playerName: string;
  note: string;
  playerId?: ProspectId;
};

export type SelectionHistoryRow = {
  id: string;
  seasonYear: number;
  group: string;
  category?: string;
  teamName: string;
  playerName: string;
  note: string;
  playerId?: ProspectId;
};

export type ScoutLegacySummary = {
  scoutName: string;
  teamName: string;
  years: number;
  draftedCount: number;
  starCount: number;
  hallCandidates: number;
  goldGloves: number;
  titles: number;
  mvps: number;
  records: number;
  championships: number;
  bestPlayers: CareerPlayerState[];
  signatureLines: string[];
  closingLine: string;
};

export type ExistingLeaguePlayer = {
  id: string;
  teamId: TeamId;
  age: number;
  overall: number;
  peakOverall: number;
  playerGroup: "pitcher" | "hitter";
  status: "active" | "released" | "retired";
  yearsTracked: number;
  lastEvent?: string;
};

export type ExistingTeamSummary = {
  teamId: TeamId;
  teamName: string;
  positionDepth: Partial<Record<Position, { total: number; existing: number }>>;
  activeTotal: number;
  existingActive: number;
  retired: number;
  released: number;
};

export type TeamSeasonResult = {
  seasonYear: number;
  yearIndex: number;
  teamId: TeamId;
  rank: number;
  previousRank?: number;
  strengthScore: number;
  seasonPerformanceScore: number;
  wins: number;
  draws: number;
  losses: number;
  winningPct: number;
  baseStrength: number;
  draftImpact: number;
  prospectContribution: number;
  regularContribution: number;
  injuryPenalty: number;
  pickTradeImpact: number;
  randomSwing: number;
  nextFirstRoundPick: number;
};

export type PickTradeEvent = {
  id: string;
  seasonYear: number;
  yearIndex: number;
  type: "user-pick-gain" | "user-pick-loss" | "other-teams";
  pickId: DraftPickId;
  round: number;
  overall: number;
  originalTeamId: TeamId;
  fromTeamId: TeamId;
  toTeamId: TeamId;
  userStrengthImpact: number;
  headline: string;
  body: string;
};

export type FanMockCandidate = {
  prospect: Prospect;
  supportRate: number;
  reasons: string[];
  concern: string;
  score: number;
};

export type FanReactionGrade = "A" | "B" | "C" | "D" | "F";

export type FanPickReaction = {
  selection: DraftSelectionView;
  grade: FanReactionGrade;
  score: number;
  reasons: string[];
  concern: string;
  comments: { tone: "긍정" | "부정" | "회의" | "기대" | "분노" | "재평가"; text: string }[];
  mockRank?: number;
};

export type FieldPickReaction = {
  selection: DraftSelectionView;
  grade: FanReactionGrade;
  score: number;
  verdict: string;
  reasons: string[];
  concerns: string[];
  scoutQuote: string;
};

export type FanRetrospective = {
  id: string;
  year: number;
  type: "오버픽 재평가" | "컨센서스 실패" | "팬 1순위 비교";
  title: string;
  body: string;
};

export type DraftSummary = {
  pitcherCount: number;
  hitterCount: number;
  positionCounts: Partial<Record<Position, number>>;
  top100Count: number;
  lotteryCount: number;
  overpickCount: number;
  slidePickCount: number;
  injuryRiskCount: number;
  collegeRiskCount: number;
  awardedCount: number;
  needGrade: string;
  fanGrade: string;
  fanAverage: number;
  internalGrade: string;
  notes: string[];
};

export type RemainingPoolSummary = {
  byPosition: Record<Position, number>;
  byRound: Record<string, number>;
  awarded: number;
  highConfidence: number;
  collegeRisk: number;
};

export type TeamNeedSnapshot = {
  year: number;
  teamId: TeamId;
  needs: Partial<Record<Position, number>>;
};

export type SchoolSummaryRow = {
  school: SchoolProfile;
  prospectCount: number;
  topCandidateCount: number;
  draftedCount: number;
  positionSummary: string;
};
