import { Fragment, useEffect, useMemo, useState } from "react";
import { chooseCpuPickWithContext } from "./game/draft/autoDraft";
import {
  FILTER_PRESETS,
  GRADE_LABELS,
  GRADE_WEIGHT,
  MAIN_TABS,
  MIN_POSITION_DEPTH_FOR_CUTS,
  NEWS_GRADE_LABELS,
  NEWS_SCOPE_LABELS,
  PLAYER_TYPE_LABELS,
  POSITION_LABELS,
  POSITIONS,
  RISK_LABELS,
  RISK_TAGS,
  ROOKIE_ROSTER_EXEMPT_YEARS,
  ROUNDS,
  ROUND_LABELS,
  SCHOOL_BIAS_LABELS,
  SCHOOL_TIER_LABELS,
  SCHOOL_TRAIT_LABELS,
  TEAM_ROSTER_LIMIT,
  TENDENCY_LABELS,
  TRACKING_STATUS_LABELS,
  YEAR_BUCKET_LABELS,
} from "./game/constants/appUi";
import { createVariedInitialTeams } from "./game/constants/league";
import { createNewGame } from "./game/simulation/gameLoop";
import { advanceHighSchoolPlayerPool } from "./game/generation/prospects";
import { createSeededRng } from "./game/generation/random";
import { clearSaveState, compactSaveState, JSON_SAVE_FILENAME, readSaveState, writeSaveState } from "./game/storage/saveState";
import { roundGrade, roundTo } from "./game/utils/math";
import type { DraftPickId, Position, ProspectId, TeamId } from "./game/types/common";
import type { DraftPick } from "./game/types/draft";
import type { GameState } from "./game/types/game";
import type { DevelopmentTools, HighSchoolYearSnapshot, HitterDevelopmentTools, HitterStats, LeagueLevel, PitcherDevelopmentTools, PitcherStats, Prospect, ProspectRiskTag, ProspectSourceType, SchoolYear, ScoutGrade, SeasonFormCycle } from "./game/types/player";
import type { SchoolDevelopmentBias, SchoolProfile, SchoolRegion, SchoolTier, SchoolTrait } from "./game/types/school";
import type { PositionDepth, Team } from "./game/types/team";
import type {
  AppSaveState,
  CareerLogEntry,
  CareerModalTab,
  CareerNewsItem,
  CareerPlayerState,
  CareerYearBucket,
  DevelopmentOutcome,
  DraftIntelEvent,
  DraftPhase,
  DraftRegretRecord,
  DraftSelectionView,
  DraftTimeoutReport,
  DraftSummary,
  ExistingLeaguePlayer,
  ExistingTeamSummary,
  FanMockCandidate,
  FanPickReaction,
  FanReactionGrade,
  FanRetrospective,
  FieldPickReaction,
  FilterPreset,
  LeagueHistorySubTab,
  LegacyPlayerItem,
  MainTab,
  NewsGrade,
  NewsScope,
  NewsViewMode,
  PickTradeEvent,
  PreDraftAction,
  PlayerTypeFilter,
  RecordBreakerRow,
  RemainingPoolSummary,
  ScoutLegacySummary,
  SeasonCycleResult,
  SeasonDevelopmentClimate,
  SelectionHistoryRow,
  SchoolSummaryRow,
  SortDirection,
  SortKey,
  TeamLegacyRow,
  TeamNeedSnapshot,
  TeamSeasonResult,
  TrackingSortKey,
  TrackingStatus,
  YearlyAwardRow,
} from "./game/types/app";

type SaveFileHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<SaveFileHandle>;
  }
}

const SOURCE_TYPE_LABELS: Record<ProspectSourceType | "all", string> = {
  all: "전체",
  "high-school": "고교",
  college: "대학",
  "overseas-returnee": "해외 복귀",
};

const STAT_CAREER_LOG_TYPES = new Set([
  "육성 결과",
  "시즌 하락",
  "후반기 반등",
  "시즌 부침",
  "기량 상승",
  "베테랑 반등",
  "기량 저하",
  "입지 흔들림",
  "퓨처스 적응",
  "성장 정체",
  "에이징커브",
  "상무 복무",
]);
const PREDRAFT_STAGES: DraftIntelEvent["stage"][] = ["D-30", "D-14", "D-7", "D-1", "당일"];
let activeJsonSaveHandle: SaveFileHandle | undefined;

function readStoredSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeStoredSet(key: string, value: Set<string>) {
  localStorage.setItem(key, JSON.stringify(Array.from(value)));
}

function readStoredRecord(key: string): Record<number, string> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<number, string>;
  } catch {
    return {};
  }
}

function writeStoredRecord(key: string, value: Record<number, string>) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function writeJsonSaveFile(value: AppSaveState): Promise<"file-system" | "download" | "cancelled" | "failed"> {
  const compacted = compactSaveState(value);
  const json = JSON.stringify(compacted, null, 2);
  const blob = new Blob([json], { type: "application/json" });

  if (window.showSaveFilePicker) {
    try {
      activeJsonSaveHandle ??= await window.showSaveFilePicker({
        suggestedName: JSON_SAVE_FILENAME,
        types: [{ description: "Draft SM save file", accept: { "application/json": [".json"] } }],
      });
      const writable = await activeJsonSaveHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "file-system";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      activeJsonSaveHandle = undefined;
      return "failed";
    }
  }

  downloadJsonSave(blob);
  return "download";
}

function downloadJsonSave(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = JSON_SAVE_FILENAME;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function createRandomSeed(): string {
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return `${Date.now()}-${Array.from(values).join("-")}`;
}

function App() {
  const savedAtBoot = useMemo(() => readSaveState(), []);
  const [hasSavedCareer, setHasSavedCareer] = useState(Boolean(savedAtBoot));
  const [showStartScreen, setShowStartScreen] = useState(true);
  const [scoutName, setScoutName] = useState(savedAtBoot?.scoutName ?? "");
  const [legacyEndingSeen, setLegacyEndingSeen] = useState(savedAtBoot?.legacyEndingSeen ?? false);
  const [showLegacyModal, setShowLegacyModal] = useState(false);
  const [pregameSeed, setPregameSeed] = useState(() => createRandomSeed());
  const [game, setGame] = useState<GameState | undefined>();
  const [dynamicTeams, setDynamicTeams] = useState<Team[]>([]);
  const pregameTeams = useMemo(() => createVariedInitialTeams(createSeededRng(pregameSeed)), [pregameSeed]);
  const teams = dynamicTeams.length > 0 ? dynamicTeams : game?.teams ?? pregameTeams;
  const prospects = useMemo(() => (game ? Object.values(game.prospectsById) : []), [game]);
  const schoolProfiles = useMemo(() => (game ? Object.values(game.schoolsById) : []), [game]);
  const draftPicks = useMemo(() => (game ? game.draftPicksByYear[game.currentYear] : []), [game]);
  const displayDraftYear = draftPicks[0]?.year ?? game?.currentYear ?? 2026;
  const totalProspects = game?.settings.prospectsPerYear ?? 360;
  const totalObservedProspects = prospects.length || totalProspects;
  const totalPicks = draftPicks.length || 100;
  const schools = useMemo(() => Array.from(new Set(prospects.map((prospect) => prospect.school))).sort(), [prospects]);
  const regions = useMemo(() => Array.from(new Set(schoolProfiles.map((school) => school.region))).sort(), [schoolProfiles]);

  const [phase, setPhase] = useState<DraftPhase>("team-selection");
  const [activeTab, setActiveTab] = useState<MainTab>("draft-room");
  const [userTeamId, setUserTeamId] = useState<TeamId | undefined>();
  const [initialRank, setInitialRank] = useState<number | "random">("random");
  const [selections, setSelections] = useState<DraftSelectionView[]>([]);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedId, setSelectedId] = useState("");
  const [positionFilter, setPositionFilter] = useState<Position | "all">("all");
  const [roundFilter, setRoundFilter] = useState<number | "all">("all");
  const [schoolYearFilter, setSchoolYearFilter] = useState<SchoolYear | "all" | "eligible">("eligible");
  const [sourceTypeFilter, setSourceTypeFilter] = useState<ProspectSourceType | "all">("all");
  const [playerTypeFilter, setPlayerTypeFilter] = useState<PlayerTypeFilter>("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [riskFilter, setRiskFilter] = useState<ProspectRiskTag | "all">("all");
  const [schoolFilter, setSchoolFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<SchoolRegion | "all">("all");
  const [schoolTierFilter, setSchoolTierFilter] = useState<SchoolTier | "all">("all");
  const [leagueFilter, setLeagueFilter] = useState<LeagueLevel | "all">("all");
  const [accoladeFilter, setAccoladeFilter] = useState<string>("all");
  const [activePreset, setActivePreset] = useState<FilterPreset | "none">("none");
  const [favorites, setFavorites] = useState(() => readStoredSet("draft-sm:favorites"));
  const [compareIds, setCompareIds] = useState<Set<string>>(() => readStoredSet("draft-sm:compare"));
  const [bigBoardIds, setBigBoardIds] = useState<string[]>(() => Array.from(readStoredSet("draft-sm:bigboard")));
  const [roundNotes, setRoundNotes] = useState<Record<number, string>>(() => readStoredRecord("draft-sm:round-notes"));
  const [predraftIntelEvents, setPredraftIntelEvents] = useState<DraftIntelEvent[]>([]);
  const [predraftUserAction, setPredraftUserAction] = useState<PreDraftAction | undefined>();
  const [predraftStageIndex, setPredraftStageIndex] = useState(0);
  const [draftTimeoutsUsed, setDraftTimeoutsUsed] = useState(0);
  const [draftTimeoutReports, setDraftTimeoutReports] = useState<DraftTimeoutReport[]>([]);
  const [careerYear, setCareerYear] = useState(0);
  const [careerPlayers, setCareerPlayers] = useState<CareerPlayerState[]>([]);
  const [existingPlayers, setExistingPlayers] = useState<ExistingLeaguePlayer[]>([]);
  const [careerNews, setCareerNews] = useState<CareerNewsItem[]>([]);
  const [selectedCareerId, setSelectedCareerId] = useState<ProspectId | "">("");
  const [seasonResults, setSeasonResults] = useState<TeamSeasonResult[]>([]);
  const [nextDraftPicks, setNextDraftPicks] = useState<DraftPick[]>([]);
  const [pickTradeEvents, setPickTradeEvents] = useState<PickTradeEvent[]>([]);
  const [teamTradeStrengthAdjustments, setTeamTradeStrengthAdjustments] = useState<Record<string, number>>({});
  const [needHistory, setNeedHistory] = useState<TeamNeedSnapshot[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [trackingFilter, setTrackingFilter] = useState<TrackingStatus | "all" | "needs-review" | "released">("all");
  const [trackingSortKey, setTrackingSortKey] = useState<TrackingSortKey>("round");
  const [trackingSortDirection, setTrackingSortDirection] = useState<SortDirection>("asc");
  const [trackingSubTab, setTrackingSubTab] = useState<"news" | "manage" | "add">("news");
  const [teamSubTab, setTeamSubTab] = useState<"draft" | "status" | "fans">("draft");
  const [leagueHistorySubTab, setLeagueHistorySubTab] = useState<LeagueHistorySubTab>("current");
  const [selectedAwardSeason, setSelectedAwardSeason] = useState<number | undefined>();
  const [selectedAllStarSeason, setSelectedAllStarSeason] = useState<number | undefined>();
  const [selectedNationalTeamSeason, setSelectedNationalTeamSeason] = useState<number | undefined>();
  const [newsViewMode, setNewsViewMode] = useState<NewsViewMode>("timeline");
  const [newsScope, setNewsScope] = useState<NewsScope>("user-team");
  const [newsGradeFilter, setNewsGradeFilter] = useState<NewsGrade | "all">("all");
  const [careerYearBucket, setCareerYearBucket] = useState<CareerYearBucket>("all");
  const [detailPlayerId, setDetailPlayerId] = useState<ProspectId | "">("");
  const [prospectDetailId, setProspectDetailId] = useState<ProspectId | "">("");
  const [draftPickToast, setDraftPickToast] = useState<DraftSelectionView | undefined>();
  const [isPickSequenceRunning, setIsPickSequenceRunning] = useState(false);

  const selectedTeam = teams.find((team) => team.id === userTeamId);
  const currentPick = phase === "draft" ? draftPicks[selections.length] : undefined;
  const currentTeam = currentPick ? teams.find((team) => team.id === currentPick.ownerTeamId) : undefined;
  const draftEligibleProspects = useMemo(() => prospects.filter((prospect) => isDraftEligibleProspect(prospect, displayDraftYear)), [displayDraftYear, prospects]);
  const selected = prospects.find((prospect) => prospect.id === selectedId) ?? draftEligibleProspects[0] ?? prospects[0];
  const prospectDetail = prospectDetailId ? prospects.find((prospect) => prospect.id === prospectDetailId) : undefined;
  const selectedDrafted = selected ? selections.some((selection) => selection.prospect.id === selected.id) : false;
  const draftedIds = useMemo(() => new Set(selections.map((selection) => selection.prospect.id)), [selections]);
  const availableProspects = useMemo(() => prospects.filter((prospect) => !draftedIds.has(prospect.id)), [draftedIds, prospects]);
  const tableProspects = activeTab === "draft-room" ? prospects : availableProspects;
  const availableDraftProspects = useMemo(() => draftEligibleProspects.filter((prospect) => !draftedIds.has(prospect.id)), [draftEligibleProspects, draftedIds]);
  const accoladeOptions = useMemo(() => Array.from(new Set(prospects.flatMap((prospect) => prospect.accolades.map((accolade) => accolade.label)))).sort(), [prospects]);
  const comparedProspects = Array.from(compareIds)
    .map((id) => prospects.find((prospect) => prospect.id === id))
    .filter((prospect): prospect is Prospect => Boolean(prospect));

  const visibleProspects = useMemo(() => {
    return tableProspects
      .filter((prospect) => {
        if (positionFilter !== "all" && prospect.primaryPosition !== positionFilter) return false;
        if (schoolYearFilter === "eligible" && !isDraftEligibleProspect(prospect, displayDraftYear)) return false;
        if (schoolYearFilter !== "all" && schoolYearFilter !== "eligible" && prospect.schoolYear !== schoolYearFilter) return false;
        if (sourceTypeFilter !== "all" && prospectSourceType(prospect) !== sourceTypeFilter) return false;
        if (roundFilter !== "all" && !rangeContains(prospect.visible.projectedRound, roundFilter)) return false;
        if (playerTypeFilter === "hitters" && prospect.playerGroup === "pitcher") return false;
        if (playerTypeFilter === "pitchers" && prospect.playerGroup !== "pitcher") return false;
        if (favoriteOnly && !favorites.has(prospect.id)) return false;
        if (riskFilter !== "all" && !prospect.visible.riskTags.includes(riskFilter)) return false;
        if (schoolFilter !== "all" && prospect.school !== schoolFilter) return false;
        if (regionFilter !== "all" && prospect.schoolRegion !== regionFilter) return false;
        if (schoolTierFilter !== "all" && prospect.schoolTier !== schoolTierFilter) return false;
        if (leagueFilter !== "all" && prospect.leagueLevel !== leagueFilter) return false;
        if (accoladeFilter !== "all" && !prospect.accolades.some((accolade) => accolade.label === accoladeFilter)) return false;
        if (!matchesPreset(prospect, activePreset, selectedTeam)) return false;
        return true;
      })
      .sort((a, b) => compareBySortKey(a, b, sortKey, sortDirection));
  }, [accoladeFilter, activePreset, displayDraftYear, favoriteOnly, favorites, leagueFilter, playerTypeFilter, positionFilter, regionFilter, riskFilter, roundFilter, schoolFilter, schoolTierFilter, schoolYearFilter, selectedTeam, sortDirection, sortKey, sourceTypeFilter, tableProspects]);

  const userSelections = selections.filter((selection) => selection.team.id === userTeamId);
  const canUserPick = Boolean(phase === "draft" && currentTeam?.id === userTeamId && selected && isDraftEligibleProspect(selected, displayDraftYear) && !selectedDrafted);
  const fanMockCandidates = useMemo(() => (selectedTeam ? createFanMockDraft(selectedTeam, draftEligibleProspects) : []), [draftEligibleProspects, selectedTeam]);
  const fanPickReactions = useMemo(() => userSelections.map((selection) => createFanPickReaction(selection, selectedTeam, fanMockCandidates)), [fanMockCandidates, selectedTeam, userSelections]);
  const fieldPickReactions = useMemo(() => userSelections.map((selection) => createFieldPickReaction(selection, selectedTeam)), [selectedTeam, userSelections]);
  const nextUserPickIndex = phase === "draft" && userTeamId ? draftPicks.findIndex((pick, index) => index >= selections.length && pick.ownerTeamId === userTeamId) : -1;
  const picksUntilUserPick = nextUserPickIndex >= 0 ? nextUserPickIndex - selections.length : undefined;
  const nextUserPick = nextUserPickIndex >= 0 ? draftPicks[nextUserPickIndex] : undefined;
  const bigBoardProspects = bigBoardIds.map((id) => prospects.find((prospect) => prospect.id === id)).filter((prospect): prospect is Prospect => Boolean(prospect));
  const bigBoardAvailable = bigBoardProspects.filter((prospect) => !draftedIds.has(prospect.id));
  const bigBoardDraftAvailable = bigBoardAvailable.filter((prospect) => isDraftEligibleProspect(prospect, displayDraftYear));
  const bigBoardTopDraftRecommendation = bigBoardDraftAvailable[0];
  const favoriteProspects = Array.from(favorites)
    .map((id) => prospects.find((prospect) => prospect.id === id))
    .filter((prospect): prospect is Prospect => Boolean(prospect))
    .filter((prospect) => !draftedIds.has(prospect.id));
  const positionCounts = useMemo(() => createPositionCounts(availableDraftProspects), [availableDraftProspects]);
  const remainingSummary = useMemo(() => createRemainingPoolSummary(availableDraftProspects), [availableDraftProspects]);
  const valueCandidates = useMemo(() => [...availableDraftProspects].sort((left, right) => left.visible.publicRank - right.visible.publicRank).slice(0, 8), [availableDraftProspects]);
  const roundRecommendations = useMemo(() => createRecommendations(availableDraftProspects, selectedTeam, currentPick?.round ?? 1, "round"), [availableDraftProspects, currentPick?.round, selectedTeam]);
  const needRecommendations = useMemo(() => createRecommendations(availableDraftProspects, selectedTeam, currentPick?.round ?? 1, "needs"), [availableDraftProspects, currentPick?.round, selectedTeam]);
  const userTurnRecommendations = useMemo(() => createUserTurnRecommendations(availableDraftProspects, selectedTeam, currentPick?.round ?? 1, bigBoardTopDraftRecommendation), [availableDraftProspects, bigBoardTopDraftRecommendation, currentPick?.round, selectedTeam]);
  const draftSummary = useMemo(() => createDraftSummary(userSelections, selectedTeam, fanPickReactions), [fanPickReactions, selectedTeam, userSelections]);
  const selectedCareerPlayer = careerPlayers.find((player) => player.playerId === selectedCareerId);
  const detailCareerPlayer = useMemo(() => {
    if (!detailPlayerId) return undefined;
    return careerPlayers.find((player) => player.playerId === detailPlayerId) ?? createInitialCareerPlayers(selections).find((player) => player.playerId === detailPlayerId);
  }, [careerPlayers, detailPlayerId, selections]);
  const selectedUndraftedProspect = prospects.find((prospect) => prospect.id === selectedCareerId);
  const filteredCareerNews = useMemo(() => filterCareerNews(careerNews, careerPlayers, newsGradeFilter, careerYearBucket, newsScope, userTeamId, favorites, compareIds), [careerNews, careerPlayers, careerYearBucket, compareIds, favorites, newsGradeFilter, newsScope, userTeamId]);
  const selectedCareerLog = filteredCareerNews.filter((news) => news.playerId === selectedCareerId);
  const accoladeReview = useMemo(() => createAccoladeReview(careerPlayers), [careerPlayers]);
  const fanRetrospectives = useMemo(() => createFanRetrospectives(fanPickReactions, careerPlayers, fanMockCandidates, careerYear), [careerPlayers, careerYear, fanMockCandidates, fanPickReactions]);
  const teamLegacyRows = useMemo(() => createTeamLegacyRows(teams, careerPlayers), [careerPlayers, teams]);
  const draftRegretRecords = useMemo(() => createDraftRegretRecords(selections, careerPlayers, teams), [careerPlayers, selections, teams]);
  const recordBreakerRows = useMemo(() => createRecordBreakerRows(careerPlayers, teams), [careerPlayers, teams]);
  const allRecordBreakerRows = useMemo(() => createRecordBreakerRows(careerPlayers, teams, 999), [careerPlayers, teams]);
  const yearlyAwardRows = useMemo(() => createYearlyAwardRows(seasonResults, careerPlayers, teams, existingPlayers), [careerPlayers, existingPlayers, seasonResults, teams]);
  const allStarRows = useMemo(() => createAllStarHistoryRows(seasonResults, careerPlayers, teams, existingPlayers), [careerPlayers, existingPlayers, seasonResults, teams]);
  const nationalTeamRows = useMemo(() => createNationalTeamHistoryRows(seasonResults, careerPlayers, teams, existingPlayers), [careerPlayers, existingPlayers, seasonResults, teams]);
  const awardSeasons = useMemo(() => Array.from(new Set(yearlyAwardRows.map((row) => row.seasonYear))).sort((left, right) => right - left), [yearlyAwardRows]);
  const allStarSeasons = useMemo(() => Array.from(new Set(allStarRows.map((row) => row.seasonYear))).sort((left, right) => right - left), [allStarRows]);
  const nationalTeamSeasons = useMemo(() => Array.from(new Set(nationalTeamRows.map((row) => row.seasonYear))).sort((left, right) => right - left), [nationalTeamRows]);
  const activeAwardSeason = selectedAwardSeason && awardSeasons.includes(selectedAwardSeason) ? selectedAwardSeason : awardSeasons[0];
  const activeAllStarSeason = selectedAllStarSeason && allStarSeasons.includes(selectedAllStarSeason) ? selectedAllStarSeason : allStarSeasons[0];
  const activeNationalTeamSeason = selectedNationalTeamSeason && nationalTeamSeasons.includes(selectedNationalTeamSeason) ? selectedNationalTeamSeason : nationalTeamSeasons[0];
  const activeAwardRows = activeAwardSeason ? yearlyAwardRows.filter((row) => row.seasonYear === activeAwardSeason) : [];
  const activeAwardGoldGloveRows = activeAwardRows.filter((row) => row.category.startsWith("골든글러브"));
  const activeAwardTitleRows = activeAwardRows.filter((row) => !row.category.startsWith("골든글러브"));
  const activeAllStarRows = activeAllStarSeason ? allStarRows.filter((row) => row.seasonYear === activeAllStarSeason) : [];
  const activeNationalTeamRows = activeNationalTeamSeason ? nationalTeamRows.filter((row) => row.seasonYear === activeNationalTeamSeason) : [];
  const existingTeamSummaries = useMemo(() => createExistingTeamSummaries(teams, existingPlayers, careerPlayers), [careerPlayers, existingPlayers, teams]);
  const currentRosterRows = useMemo(() => createCurrentRosterRows(selectedTeam, existingPlayers, careerPlayers), [careerPlayers, existingPlayers, selectedTeam]);
  const teamCycleSummary = useMemo(() => createTeamCycleSummary(selectedTeam, existingPlayers, careerPlayers), [careerPlayers, existingPlayers, selectedTeam]);
  const latestSeasonYear = Math.max(0, ...seasonResults.map((result) => result.yearIndex));
  const latestSeasonResults = seasonResults.filter((result) => result.yearIndex === latestSeasonYear);
  const latestPostseasonRows = useMemo(() => createPostseasonRows(latestSeasonResults, teams), [latestSeasonResults, teams]);
  const latestKoreanSeries = latestPostseasonRows[latestPostseasonRows.length - 1];
  const userSeasonHistory = userTeamId ? seasonResults.filter((result) => result.teamId === userTeamId) : [];
  const userNextDraftPicks = userTeamId ? nextDraftPicks.filter((pick) => pick.ownerTeamId === userTeamId) : [];
  const latestPickTradeEvents = pickTradeEvents.filter((event) => event.yearIndex === latestSeasonYear);
  const userNeedRows = selectedTeam ? createNeedRows(selectedTeam, needHistory, existingPlayers, careerPlayers) : [];
  const topNeeds = userNeedRows.slice(0, 3);
  const risingNeeds = userNeedRows.filter((row) => row.change > 0).slice(0, 3);
  const fallingNeeds = userNeedRows.filter((row) => row.change < 0).slice(0, 3);
  const teamFanOpinion = useMemo(() => createTeamFanOpinion(selectedTeam, userTeamId, latestSeasonResults, userSeasonHistory, userNeedRows, careerPlayers, pickTradeEvents, nextDraftPicks, teamTradeStrengthAdjustments), [careerPlayers, latestSeasonResults, nextDraftPicks, pickTradeEvents, selectedTeam, teamTradeStrengthAdjustments, userNeedRows, userSeasonHistory, userTeamId]);
  const teamFanMetrics = useMemo(() => createTeamFanMetrics(selectedTeam, userTeamId, careerPlayers, seasonResults, teamFanOpinion, yearlyAwardRows, allStarRows, nationalTeamRows, allRecordBreakerRows), [allRecordBreakerRows, allStarRows, careerPlayers, nationalTeamRows, seasonResults, selectedTeam, teamFanOpinion, userTeamId, yearlyAwardRows]);
  const trackingRows = useMemo(() => createTrackingRows(careerPlayers, trackingFilter, trackingSortKey, trackingSortDirection, careerYearBucket, careerYear), [careerPlayers, careerYear, careerYearBucket, trackingFilter, trackingSortDirection, trackingSortKey]);
  const trackingAddRows = useMemo(() => createTrackingAddRows(careerPlayers, careerYearBucket), [careerPlayers, careerYearBucket]);
  const trackingSummary = useMemo(() => createTrackingSummary(careerPlayers, careerNews, userTeamId), [careerNews, careerPlayers, userTeamId]);
  const releaseRows = useMemo(() => careerPlayers.filter((player) => player.status === "방출" || player.status === "은퇴" || player.status === "해외진출").sort((left, right) => right.yearsSinceDraft - left.yearsSinceDraft || left.pick.overall - right.pick.overall), [careerPlayers]);
  const hasTrackingHistory = careerPlayers.length > 0 || careerNews.length > 0;
  const hasLeagueHistory = seasonResults.length > 0 || pickTradeEvents.length > 0 || careerPlayers.length > 0;
  const legacySummary = useMemo(() => createScoutLegacySummary(scoutName || "스카우터", selectedTeam, careerPlayers, seasonResults, yearlyAwardRows, allRecordBreakerRows, careerYear), [allRecordBreakerRows, careerPlayers, careerYear, scoutName, seasonResults, selectedTeam, yearlyAwardRows]);
  const revealedPredraftStages = predraftUserAction ? PREDRAFT_STAGES.slice(0, predraftStageIndex) : [];
  const visiblePredraftIntelEvents = predraftIntelEvents.filter((event) => event.type === "타임 회의" || revealedPredraftStages.includes(event.stage));
  const nextPredraftStage = predraftUserAction ? PREDRAFT_STAGES[predraftStageIndex] : undefined;
  const currentDraftHasSeasonResult = phase === "complete" && currentDraftAlreadySimulated(selections);
  const primaryProgressLabel =
    phase === "pre-draft"
      ? !predraftUserAction
        ? "드래프트 전 행동 결정"
        : nextPredraftStage
          ? `${nextPredraftStage} 동향 확인`
          : "드래프트 시작"
      : phase === "draft"
      ? "드래프트 전체 자동 진행"
      : currentDraftHasSeasonResult
        ? "다음 드래프티 생성"
        : "1년 진행";
  const primaryProgressDisabled =
    phase === "team-selection" ||
    phase === "generating" ||
    (currentDraftHasSeasonResult && nextDraftPicks.length === 0);
  const fullAutoDisabled = phase === "team-selection" || phase === "generating" || (currentDraftHasSeasonResult && nextDraftPicks.length === 0);
  const currentSaveState = useMemo<AppSaveState>(
    () => ({
      scoutName,
      game,
      dynamicTeams,
      phase,
      activeTab,
      userTeamId,
      selections,
      notifications,
      predraftIntelEvents,
      predraftUserAction,
      predraftStageIndex,
      draftTimeoutsUsed,
      draftTimeoutReports,
      careerYear,
      careerPlayers,
      existingPlayers,
      careerNews,
      selectedCareerId,
      seasonResults,
      nextDraftPicks,
      pickTradeEvents,
      teamTradeStrengthAdjustments,
      needHistory,
      legacyEndingSeen,
    }),
    [activeTab, careerNews, careerPlayers, careerYear, draftTimeoutReports, draftTimeoutsUsed, dynamicTeams, existingPlayers, game, legacyEndingSeen, needHistory, nextDraftPicks, notifications, phase, pickTradeEvents, predraftIntelEvents, predraftStageIndex, predraftUserAction, scoutName, seasonResults, selectedCareerId, selections, teamTradeStrengthAdjustments, userTeamId],
  );

  useEffect(() => {
    if (showStartScreen || phase === "generating" || !scoutName.trim()) return;
    const saved = writeSaveState(currentSaveState);
    setHasSavedCareer(saved);
  }, [currentSaveState, phase, scoutName, showStartScreen]);

  useEffect(() => {
    if (!draftPickToast) return undefined;
    const timeout = window.setTimeout(() => setDraftPickToast(undefined), 1150);
    return () => window.clearTimeout(timeout);
  }, [draftPickToast]);

  useEffect(() => {
    function handleSaveShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (showStartScreen || phase === "generating" || !scoutName.trim()) return;
      event.preventDefault();
      saveCurrentJsonFile();
    }

    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [currentSaveState, phase, scoutName, showStartScreen]);

  useEffect(() => {
    if (careerYear >= 50 && !legacyEndingSeen && !showStartScreen) {
      setShowLegacyModal(true);
      setLegacyEndingSeen(true);
    }
  }, [careerYear, legacyEndingSeen, showStartScreen]);

  function isCollapsed(key: string): boolean {
    return Boolean(collapsedSections[key]);
  }

  function toggleCollapsed(key: string) {
    setCollapsedSections((current) => ({ ...current, [key]: !current[key] }));
  }

  async function saveCurrentJsonFile() {
    const result = await writeJsonSaveFile(currentSaveState);
    if (result === "cancelled") return;
    const message =
      result === "file-system"
        ? `${JSON_SAVE_FILENAME}에 세이브를 덮어썼습니다.`
        : result === "download"
          ? `${JSON_SAVE_FILENAME} 세이브 파일을 다운로드했습니다.`
          : "JSON 세이브 저장에 실패했습니다. 브라우저 권한 또는 저장 위치를 확인해 주세요.";
    setNotifications((items) => [message, ...items.slice(0, 4)]);
  }

  function startNewCareer(name: string) {
    clearSaveState();
    setHasSavedCareer(false);
    setScoutName(name.trim() || "무명 스카우터");
    setPregameSeed(createRandomSeed());
    setLegacyEndingSeen(false);
    setShowLegacyModal(false);
    setShowStartScreen(false);
    setPhase("team-selection");
  }

  async function loadCareerFromJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as AppSaveState;
      applyLoadedSaveState(parsed, `${file.name} 세이브를 불러왔습니다.`);
    } catch {
      setNotifications((items) => ["세이브 파일을 읽지 못했습니다. JSON 파일 형식을 확인해 주세요.", ...items.slice(0, 4)]);
    }
  }

  function applyLoadedSaveState(saved: AppSaveState, message?: string) {
    setScoutName(saved.scoutName || "무명 스카우터");
    setGame(saved.game);
    setDynamicTeams(saved.dynamicTeams ?? []);
    setPhase(saved.phase ?? "team-selection");
    setActiveTab(saved.activeTab === ("schools" as MainTab) || saved.activeTab === ("board" as MainTab) ? "draft-room" : saved.activeTab ?? "draft-room");
    setUserTeamId(saved.userTeamId);
    setSelections(saved.selections ?? []);
    setNotifications(message ? [message, ...(saved.notifications ?? []).slice(0, 4)] : saved.notifications ?? []);
    setPredraftIntelEvents(saved.predraftIntelEvents ?? []);
    setPredraftUserAction(saved.predraftUserAction);
    setPredraftStageIndex(saved.predraftStageIndex ?? (saved.predraftUserAction ? PREDRAFT_STAGES.length : 0));
    setDraftTimeoutsUsed(saved.draftTimeoutsUsed ?? 0);
    setDraftTimeoutReports(saved.draftTimeoutReports ?? []);
    setCareerYear(saved.careerYear ?? 0);
    setCareerPlayers(saved.careerPlayers ?? []);
    setExistingPlayers(saved.existingPlayers ?? []);
    setCareerNews(saved.careerNews ?? []);
    setSelectedCareerId(saved.selectedCareerId ?? "");
    setSeasonResults(saved.seasonResults ?? []);
    setNextDraftPicks(saved.nextDraftPicks ?? []);
    setPickTradeEvents(saved.pickTradeEvents ?? []);
    setTeamTradeStrengthAdjustments(saved.teamTradeStrengthAdjustments ?? {});
    setNeedHistory(saved.needHistory ?? []);
    setLegacyEndingSeen(Boolean(saved.legacyEndingSeen));
    setShowLegacyModal(false);
    setSelectedId(Object.keys(saved.game?.prospectsById ?? {})[0] ?? "");
    setHasSavedCareer(true);
    setShowStartScreen(false);
  }

  function reincarnateCareer() {
    clearSaveState();
    setHasSavedCareer(false);
    setPregameSeed(createRandomSeed());
    setShowLegacyModal(false);
    setShowStartScreen(true);
    setPhase("team-selection");
    setGame(undefined);
    setDynamicTeams([]);
    setUserTeamId(undefined);
    setSelections([]);
    setNotifications([]);
    setPredraftIntelEvents([]);
    setPredraftUserAction(undefined);
    setPredraftStageIndex(0);
    setDraftTimeoutsUsed(0);
    setDraftTimeoutReports([]);
    setCareerYear(0);
    setCareerPlayers([]);
    setExistingPlayers([]);
    setCareerNews([]);
    setSeasonResults([]);
    setNextDraftPicks([]);
    setPickTradeEvents([]);
    setNeedHistory([]);
    setLegacyEndingSeen(false);
  }

  function chooseImmortality() {
    setShowLegacyModal(false);
    setNotifications((items) => [`${scoutName || "스카우터"}는 50년의 회고를 뒤로하고 다음 드래프트를 계속 지켜보기로 했습니다.`, ...items.slice(0, 4)]);
  }

  function startDraft(teamId: TeamId, rank: number | "random" = initialRank) {
    setUserTeamId(teamId);
    setActiveTab("draft-room");
    setPhase("generating");
    setGame(undefined);
    setSelections([]);
    setNotifications([]);
    setPredraftIntelEvents([]);
    setPredraftUserAction(undefined);
    setPredraftStageIndex(0);
    setDraftTimeoutsUsed(0);
    setDraftTimeoutReports([]);
    setCareerYear(0);
    setCareerPlayers([]);
    setExistingPlayers([]);
    setCareerNews([]);
    setSelectedCareerId("");
    setSeasonResults([]);
    setNextDraftPicks([]);
    setPickTradeEvents([]);
    setTeamTradeStrengthAdjustments({});
    setNeedHistory([]);
    setTrackingFilter("all");
    setTrackingSortKey("round");
    setTrackingSortDirection("asc");
    setLeagueHistorySubTab("current");
    setSelectedAwardSeason(undefined);
    setSelectedAllStarSeason(undefined);
    setSelectedNationalTeamSeason(undefined);
    setNewsViewMode("timeline");
    setNewsGradeFilter("all");
    setCareerYearBucket("all");
    setDetailPlayerId("");
    setDynamicTeams([]);
    setSelectedId("");
    const emptySet = new Set<string>();
    setFavorites(emptySet);
    setCompareIds(emptySet);
    setBigBoardIds([]);
    setRoundNotes({});
    writeStoredSet("draft-sm:favorites", emptySet);
    writeStoredSet("draft-sm:compare", emptySet);
    writeStoredSet("draft-sm:bigboard", emptySet);
    writeStoredRecord("draft-sm:round-notes", {});

    window.setTimeout(() => {
      const nextGame = createNewGame(pregameSeed, {
        userTeamId: teamId,
        userInitialRank: rank === "random" ? undefined : rank,
      });
      const nextProspects = Object.values(nextGame.prospectsById);
      setGame(nextGame);
      setDynamicTeams(nextGame.teams);
      setExistingPlayers(createInitialExistingPlayers(nextGame.teams));
      setNeedHistory(createNeedSnapshots(nextGame.currentYear - 1, nextGame.teams));
      setSelectedId(nextProspects[0]?.id ?? "");
      setPredraftIntelEvents(createPreDraftIntelEvents(nextGame.currentYear, nextGame.teams, nextProspects, teamId));
      setPredraftUserAction(undefined);
      setPredraftStageIndex(0);
      setDraftTimeoutsUsed(0);
      setDraftTimeoutReports([]);
      setPhase("pre-draft");
    }, 650);
  }

  function changeSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(defaultDirection(nextKey));
  }

  function toggleFavorite(id: string) {
    setFavorites((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      writeStoredSet("draft-sm:favorites", next);
      return next;
    });
  }

  function toggleCompare(id: string) {
    setCompareIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 4) {
        next.add(id);
      }
      writeStoredSet("draft-sm:compare", next);
      return next;
    });
  }

  function toggleBigBoard(id: string) {
    setBigBoardIds((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      writeStoredSet("draft-sm:bigboard", new Set(next));
      return next;
    });
  }

  function moveBigBoard(id: string, direction: -1 | 1) {
    setBigBoardIds((current) => {
      const index = current.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      writeStoredSet("draft-sm:bigboard", new Set(next));
      return next;
    });
  }

  function updateRoundNote(round: number, value: string) {
    setRoundNotes((current) => {
      const next = { ...current, [round]: value };
      writeStoredRecord("draft-sm:round-notes", next);
      return next;
    });
  }

  function beginDraftFromPreDraft() {
    if (phase !== "pre-draft") return;
    if (!predraftUserAction || predraftStageIndex < PREDRAFT_STAGES.length) return;
    setPhase("draft");
    setNotifications((items) => [`${displayDraftYear}년 드래프트가 시작됐습니다. 첫 내 지명까지 보드와 동향을 함께 확인하세요.`, ...items.slice(0, 4)]);
  }

  function advancePreDraftStage() {
    if (phase !== "pre-draft" || !predraftUserAction) return;
    const stage = PREDRAFT_STAGES[predraftStageIndex];
    if (!stage) {
      beginDraftFromPreDraft();
      return;
    }
    const stageEvents = predraftIntelEvents.filter((event) => event.stage === stage);
    setPredraftStageIndex((index) => Math.min(index + 1, PREDRAFT_STAGES.length));
    setNotifications((items) => [
      `${displayDraftYear}년 드래프트 ${stage} 동향 ${stageEvents.length}건을 확인했습니다.`,
      ...items.slice(0, 4),
    ]);
  }

  function updateProspectInGame(prospectId: ProspectId, updater: (prospect: Prospect) => Prospect) {
    setGame((current) => {
      if (!current || !current.prospectsById[prospectId]) return current;
      return {
        ...current,
        prospectsById: {
          ...current.prospectsById,
          [prospectId]: updater(current.prospectsById[prospectId]),
        },
      };
    });
  }

  function runPreDraftAction(action: PreDraftAction) {
    if (phase !== "pre-draft" || predraftUserAction) return;
    const target = selected && isDraftEligibleProspect(selected, displayDraftYear) ? selected : draftEligibleProspects[0];
    const topNeed = topNeeds[0]?.position;
    const userTeamName = selectedTeam?.shortName ?? "우리 팀";
    let event: DraftIntelEvent;

    if (action === "quiet-follow" && target) {
      updateProspectInGame(target.id, (prospect) => ({
        ...prospect,
        visible: {
          ...prospect.visible,
          confidence: clampNumber(prospect.visible.confidence + 0.06, 0.15, 0.98),
          summary: `${prospect.visible.summary} 비공개 추가 관찰에서 기존 리포트와 크게 어긋나지 않는다는 평가가 붙었다.`,
        },
      }));
      setFavorites((current) => {
        const next = new Set(current);
        next.add(target.id);
        writeStoredSet("draft-sm:favorites", next);
        return next;
      });
      event = {
        id: `intel-${displayDraftYear}-user-${Date.now()}`,
        year: displayDraftYear,
        stage: "D-7",
        type: "비공개 테스트",
        tone: "positive",
        headline: `${userTeamName}, ${target.name} 비공개 추가 관찰`,
        body: "구단 내부에서는 공개 순위보다 특정 지표와 현장 반응을 다시 확인하는 쪽을 택했다. 외부에는 큰 움직임이 드러나지 않았다.",
        impact: "선택 선수의 리포트 신뢰도가 소폭 상승하고 관심 목록에 추가됩니다.",
        prospectId: target.id,
        prospectName: target.name,
        teamId: selectedTeam?.id,
        teamName: selectedTeam?.name,
      };
    } else if (action === "public-interest" && target) {
      updateProspectInGame(target.id, (prospect) => ({
        ...prospect,
        reputation: Math.round(clampNumber(prospect.reputation + 3, 0, 100)),
        draftHype: Math.round(clampNumber(prospect.draftHype + 6, 0, 100)),
      }));
      event = {
        id: `intel-${displayDraftYear}-user-${Date.now()}`,
        year: displayDraftYear,
        stage: "D-14",
        type: "구단 관심",
        tone: "smoke",
        headline: `${userTeamName}, ${target.name} 공개 관심설`,
        body: "지역 매체를 통해 구단의 관심이 알려졌다. 팬 여론은 반응하기 시작했지만, 다른 구단도 이 이름을 다시 체크할 명분이 생겼다.",
        impact: "선택 선수의 인지도와 하이프가 오릅니다. 팬 모의지명에는 도움, 스텔스 운영에는 부담입니다.",
        prospectId: target.id,
        prospectName: target.name,
        teamId: selectedTeam?.id,
        teamName: selectedTeam?.name,
      };
    } else {
      event = {
        id: `intel-${displayDraftYear}-user-${Date.now()}`,
        year: displayDraftYear,
        stage: "D-1",
        type: "연막",
        tone: "smoke",
        headline: `${userTeamName}, ${topNeed ? positionLabel(topNeed) : "상위 지명"} 쪽으로 시선 분산`,
        body: "구단은 특정 선수 이름 대신 포지션 니즈와 복수 후보 검토만 강조했다. 외부에서는 실제 보드 상단을 읽기 어려운 분위기다.",
        impact: "직접 능력치는 변하지 않습니다. 드래프트 당일 정보전 로그로 남습니다.",
        teamId: selectedTeam?.id,
        teamName: selectedTeam?.name,
      };
    }

    setPredraftUserAction(action);
    setPredraftStageIndex(0);
    setPredraftIntelEvents((current) => [event, ...current]);
    setNotifications((items) => [`사전 전략 실행: ${event.headline}`, ...items.slice(0, 4)]);
  }

  function runAutoPreDraftAction() {
    if (phase !== "pre-draft" || predraftUserAction) return;
    const target = selected && isDraftEligibleProspect(selected, displayDraftYear) ? selected : draftEligibleProspects[0];
    const topNeed = topNeeds[0]?.position;
    const topNeedTarget = target && topNeed ? target.primaryPosition === topNeed || target.secondaryPositions.includes(topNeed) : false;
    const action: PreDraftAction =
      !target
        ? "smoke-screen"
        : favorites.has(target.id) || compareIds.has(target.id) || target.visible.confidence < 0.55 || target.visible.riskLevel === "high" || target.visible.riskLevel === "extreme"
          ? "quiet-follow"
          : target.visible.publicRank <= 30 && topNeedTarget && target.draftHype >= 50
            ? "public-interest"
            : target.visible.publicRank <= 12 && target.reputation >= 65
              ? "public-interest"
              : "smoke-screen";
    runPreDraftAction(action);
    setNotifications((items) => [`운영팀 자동 판단으로 ${preDraftActionLabel(action)} 전략을 선택했습니다.`, ...items.slice(0, 4)]);
  }

  function requestDraftTimeout() {
    if (!canUserPick || !currentPick || !selectedTeam || draftTimeoutsUsed >= 3) return;
    const report = createDraftTimeoutReport(displayDraftYear, currentPick, selectedTeam, selected, availableDraftProspects, topNeeds, draftTimeoutsUsed + 1);
    setDraftTimeoutsUsed((count) => count + 1);
    setDraftTimeoutReports((current) => [report, ...current].slice(0, 8));
    setNotifications((items) => [`타임 요청: ${report.headline}`, ...items.slice(0, 4)]);
  }

  function applyFilterPreset(preset: FilterPreset) {
    setActivePreset(preset);
    setFavoriteOnly(false);
    setSchoolFilter("all");
    setRegionFilter("all");
    setSchoolTierFilter("all");
    setLeagueFilter("all");
    setAccoladeFilter("all");
    setRiskFilter("all");
    setPositionFilter("all");
    setPlayerTypeFilter("all");
    setRoundFilter("all");

    if (preset === "top-available") {
      setSortKey("rank");
      setSortDirection("asc");
    }
    if (preset === "team-needs") {
      const topNeed = userNeedRows[0]?.position;
      if (topNeed) setPositionFilter(topNeed);
      setSortKey("positionalValue");
      setSortDirection("desc");
    }
    if (preset === "pitchers") setPlayerTypeFilter("pitchers");
    if (preset === "hitters") setPlayerTypeFilter("hitters");
    if (preset === "premium-defense") {
      setSortKey("defensiveGrade");
      setSortDirection("desc");
    }
    if (preset === "low-risk") {
      setRiskFilter("all");
      setSortKey("risk");
      setSortDirection("asc");
    }
    if (preset === "upside") {
      setSortKey("confidence");
      setSortDirection("asc");
    }
    if (preset === "safe" || preset === "high-confidence") {
      setSortKey("confidence");
      setSortDirection("desc");
    }
    if (preset === "awarded") {
      setSortKey("rank");
      setSortDirection("asc");
    }
    if (preset === "college-risk") {
      setRiskFilter("signability");
      setSortKey("rank");
      setSortDirection("asc");
    }
    if (preset === "late-sleepers") {
      setRoundFilter(11);
      setSortKey("confidence");
      setSortDirection("asc");
    }
    if (preset === "league-adjusted") {
      setRiskFilter("weak-competition");
      setSortKey("ops");
      setSortDirection("desc");
    }
    if (preset === "pitcher-lottery") {
      setPlayerTypeFilter("pitchers");
      setSortKey("maxVelocityKph");
      setSortDirection("desc");
    }
    if (preset === "high-risk-upside") {
      setSortKey("confidence");
      setSortDirection("asc");
    }
  }


  function applySelection(prospect: Prospect, pick: DraftPick, team: Team, meta: Pick<DraftSelectionView, "isPanicPick"> = {}) {
    const nextSelection = { pick, team, prospect, ...meta };
    setDraftPickToast(nextSelection);
    setSelections((current) => {
      if (current.some((selection) => selection.prospect.id === prospect.id) || current.length >= draftPicks.length) {
        return current;
      }

      if (favorites.has(prospect.id) && team.id !== userTeamId) {
        setNotifications((items) => [
          `${pick.round}R ${pick.overall}번: 관심 선수 ${prospect.name}(${prospect.primaryPosition})가 ${team.shortName}에 지명되었습니다.`,
          ...items.slice(0, 4),
        ]);
      }
      if (bigBoardIds.slice(0, 12).includes(prospect.id) && team.id !== userTeamId) {
        setNotifications((items) => [
          `${pick.round}R ${pick.overall}번: 내 빅보드 상위 후보 ${prospect.name}(${prospect.primaryPosition})가 ${team.shortName}에 지명되었습니다.`,
          ...items.slice(0, 4),
        ]);
      }

      const next = [...current, nextSelection];
      if (next.length >= draftPicks.length) {
        setPhase("complete");
      }

      const nextAvailable = draftEligibleProspects.find((candidate) => candidate.id !== prospect.id && !next.some((selection) => selection.prospect.id === candidate.id));
      if (nextAvailable && selectedId === prospect.id) {
        setSelectedId(nextAvailable.id);
      }

      return next;
    });
  }

  function runCpuPick() {
    if (!currentPick || !currentTeam || currentTeam.id === userTeamId) return;
    const cpuAvailable = availableDraftProspects;
    const teamDrafted = selections.filter((selection) => selection.team.id === currentTeam.id).map((selection) => selection.prospect);
    const previousSelection = selections[selections.length - 1];
    const pickResult = chooseCpuPickWithContext(currentTeam, cpuAvailable, currentPick.overall, teamDrafted, { previousPick: previousSelection?.prospect });
    applySelection(pickResult.prospect, currentPick, currentTeam, { isPanicPick: pickResult.isPanicPick });
  }

  async function runUntilUserPick() {
    await runSequentialCpuPicksUntilUserPick();
  }

  function userPick(prospect: Prospect | undefined) {
    if (!currentPick || !currentTeam || currentTeam.id !== userTeamId || selectedDrafted) return;
    if (!prospect) return;
    if (draftedIds.has(prospect.id)) return;
    if (isMlbDirectSigned(prospect)) return;
    if (!isDraftEligibleProspect(prospect, displayDraftYear)) return;
    applySelection(prospect, currentPick, currentTeam);
    window.setTimeout(() => {
      void runSequentialCpuPicksUntilUserPick();
    }, 520);
  }

  async function runSequentialCpuPicksUntilUserPick() {
    if (phase !== "draft" || !userTeamId || isPickSequenceRunning) return;
    setIsPickSequenceRunning(true);
    try {
      await sleep(260);
      let safety = 0;
      while (safety < draftPicks.length) {
        safety += 1;
        const madePick = await runNextCpuPickInSequence();
        if (!madePick) break;
        await sleep(720);
      }
    } finally {
      setIsPickSequenceRunning(false);
    }
  }

  function runNextCpuPickInSequence(): Promise<boolean> {
    return new Promise((resolve) => {
      setSelections((current) => {
        const pick = draftPicks[current.length];
        const team = pick ? teams.find((candidate) => candidate.id === pick.ownerTeamId) : undefined;
        if (!pick || !team || team.id === userTeamId) {
          resolve(false);
          return current;
        }

        const cpuAvailable = draftEligibleProspects.filter((candidate) => !current.some((selection) => selection.prospect.id === candidate.id));
        if (cpuAvailable.length === 0) {
          resolve(false);
          return current;
        }

        const teamDrafted = current.filter((selection) => selection.team.id === team.id).map((selection) => selection.prospect);
        const previousSelection = current[current.length - 1];
        const pickResult = chooseCpuPickWithContext(team, cpuAvailable, pick.overall, teamDrafted, { previousPick: previousSelection?.prospect });
        const selection: DraftSelectionView = { pick, team, prospect: pickResult.prospect, isPanicPick: pickResult.isPanicPick };
        announceWatchedPick(selection);
        setDraftPickToast(selection);
        const next = [...current, selection];
        if (next.length >= draftPicks.length) {
          setPhase("complete");
        }
        const nextAvailable = draftEligibleProspects.find((candidate) => !next.some((item) => item.prospect.id === candidate.id));
        if (nextAvailable) {
          setSelectedId((currentId) => next.some((item) => item.prospect.id === currentId) ? nextAvailable.id : currentId);
        }
        resolve(true);
        return next;
      });
    });
  }

  function announceWatchedPick(selection: DraftSelectionView) {
    if (selection.team.id === userTeamId) return;
    if (favorites.has(selection.prospect.id)) {
      setNotifications((items) => [
        `${selection.pick.round}R ${selection.pick.overall}번: 관심 선수 ${selection.prospect.name}(${selection.prospect.primaryPosition})가 ${selection.team.shortName}에 지명되었습니다.`,
        ...items.slice(0, 4),
      ]);
    }
    if (bigBoardIds.slice(0, 12).includes(selection.prospect.id)) {
      setNotifications((items) => [
        `${selection.pick.round}R ${selection.pick.overall}번: 내 빅보드 상위 후보 ${selection.prospect.name}(${selection.prospect.primaryPosition})가 ${selection.team.shortName}에 지명되었습니다.`,
        ...items.slice(0, 4),
      ]);
    }
  }

  function appendCpuSelectionsUntilUserPick(currentSelections: DraftSelectionView[]): DraftSelectionView[] {
    if (!userTeamId) return currentSelections;
    let next = [...currentSelections];
    let guard = 0;

    while (next.length < draftPicks.length && guard < draftPicks.length) {
      guard += 1;
      const pick = draftPicks[next.length];
      const team = teams.find((candidate) => candidate.id === pick.ownerTeamId);
      if (!team || team.id === userTeamId) break;

      const cpuAvailable = draftEligibleProspects.filter((candidate) => !next.some((selection) => selection.prospect.id === candidate.id));
      if (cpuAvailable.length === 0) break;
      const teamDrafted = next.filter((selection) => selection.team.id === team.id).map((selection) => selection.prospect);
      const previousSelection = next[next.length - 1];
      const pickResult = chooseCpuPickWithContext(team, cpuAvailable, pick.overall, teamDrafted, { previousPick: previousSelection?.prospect });
      const cpuProspect = pickResult.prospect;
      if (favorites.has(cpuProspect.id)) {
        setNotifications((items) => [
          `${pick.round}R ${pick.overall}번: 관심 선수 ${cpuProspect.name}(${cpuProspect.primaryPosition})가 ${team.shortName}에 지명되었습니다.`,
          ...items.slice(0, 4),
        ]);
      }
      if (bigBoardIds.slice(0, 12).includes(cpuProspect.id)) {
        setNotifications((items) => [
          `${pick.round}R ${pick.overall}번: 내 빅보드 상위 후보 ${cpuProspect.name}(${cpuProspect.primaryPosition})가 ${team.shortName}에 지명되었습니다.`,
          ...items.slice(0, 4),
        ]);
      }
      next = [...next, { pick, team, prospect: cpuProspect, isPanicPick: pickResult.isPanicPick }];
    }

    return next;
  }

  function simulateNextCareerYear() {
    if (phase !== "complete" || !userTeamId) return;
    if (currentDraftAlreadySimulated(selections)) {
      openNextDraftYear();
      return;
    }
    autoAdvanceOneYear();
  }

  function openNextDraftYear() {
    if (!userTeamId || nextDraftPicks.length === 0) return;
    const draftYear = nextDraftPicks[0].year;
    const nextDraft = createDraftStateForYear(draftYear, nextDraftPicks, teams);
    setGame(nextDraft.game);
    setDynamicTeams(nextDraft.teams);
    setSelections([]);
    setPredraftIntelEvents(createPreDraftIntelEvents(draftYear, nextDraft.teams, nextDraft.prospects, userTeamId));
    setPredraftUserAction(undefined);
    setPredraftStageIndex(0);
    setDraftTimeoutsUsed(0);
    setDraftTimeoutReports([]);
    setPhase("pre-draft");
    setSelectedId(nextDraft.prospects[0]?.id ?? "");
    setActiveTab("draft-room");
    pruneDraftListsForNewPool(Object.keys(nextDraft.game.prospectsById));
    setNotifications((items) => [`${draftYear}년 드래프트 클래스로 이동했습니다. 드래프트 전 동향을 확인한 뒤 시작할 수 있습니다.`, ...items.slice(0, 4)]);
  }

  function autoAdvanceOneYear() {
    if (!userTeamId || phase === "team-selection" || phase === "generating") return;
    if (phase === "complete" && currentDraftAlreadySimulated(selections)) {
      openNextDraftYear();
      return;
    }

    let completedSelections = selections;
    let prospectPool = prospects;
    const nextCareerYear = careerYear + 1;

    completedSelections = phase === "complete" ? selections : completeDraftAutomatically(selections);
    if (phase !== "complete") {
      setSelections(completedSelections);
      setNotifications((items) => [`남은 지명을 자동 완료하고 ${completedSelections.length}명 드래프트 결과로 1년을 진행했습니다.`, ...items.slice(0, 4)]);
    }

    setPhase("complete");
    simulateCareerYear(completedSelections, careerPlayers, prospectPool, nextCareerYear);
    if (nextCareerYear >= 50 && !legacyEndingSeen) {
      setShowLegacyModal(true);
      setLegacyEndingSeen(true);
    }
    setActiveTab("tracking");
  }

  function handlePrimaryProgressAction() {
    if (primaryProgressDisabled) return;
    if (phase === "pre-draft") {
      if (!predraftUserAction) {
        setNotifications((items) => ["먼저 드래프트 전 행동을 하나 선택하세요. 이후 날짜별 동향이 열립니다.", ...items.slice(0, 4)]);
        return;
      }
      if (predraftStageIndex < PREDRAFT_STAGES.length) {
        advancePreDraftStage();
        return;
      }
      beginDraftFromPreDraft();
      return;
    }
    if (phase === "draft") {
      const completedSelections = completeDraftAutomatically(selections);
      setSelections(completedSelections);
      setPhase("complete");
      const nextAvailable = draftEligibleProspects.find((prospect) => !completedSelections.some((selection) => selection.prospect.id === prospect.id));
      if (nextAvailable) {
        setSelectedId(nextAvailable.id);
      }
      setNotifications((items) => [`남은 ${draftPicks.length - selections.length}개 지명을 자동으로 완료했습니다. 시즌 진행 전 결과를 확인할 수 있습니다.`, ...items.slice(0, 4)]);
      return;
    }
    if (currentDraftHasSeasonResult) {
      openNextDraftYear();
      return;
    }
    simulateNextCareerYear();
  }

  function completeDraftAutomatically(currentSelections: DraftSelectionView[], pickPool = draftPicks, prospectPool = draftEligibleProspects, teamPool = teams): DraftSelectionView[] {
    let next = [...currentSelections];

    while (next.length < pickPool.length) {
      const pick = pickPool[next.length];
      const team = teamPool.find((candidate) => candidate.id === pick.ownerTeamId);
      if (!pick || !team) break;
      const cpuAvailable = prospectPool.filter((prospect) => !next.some((selection) => selection.prospect.id === prospect.id));
      if (cpuAvailable.length === 0) break;
      const teamDrafted = next.filter((selection) => selection.team.id === team.id).map((selection) => selection.prospect);
      const previousSelection = next[next.length - 1];
      const pickResult = chooseCpuPickWithContext(team, cpuAvailable, pick.overall, teamDrafted, { previousPick: previousSelection?.prospect });
      next = [...next, { pick, team, prospect: pickResult.prospect, isPanicPick: pickResult.isPanicPick }];
    }

    return next;
  }

  function currentDraftAlreadySimulated(selectionSource: DraftSelectionView[]): boolean {
    const draftYear = selectionSource[0]?.pick.year;
    if (!draftYear) return false;
    return seasonResults.some((result) => result.seasonYear === draftYear);
  }

  function createDraftStateForYear(draftYear: number, picks: DraftPick[], teamPool: Team[]) {
    const seed = createRandomSeed();
    const rng = createSeededRng(seed);
    const baseGame = game ?? createNewGame(seed);
    const schools = Object.values(baseGame.schoolsById);
    const { prospects: nextProspects, classQuality } = advanceHighSchoolPlayerPool(rng, draftYear, game?.settings.prospectsPerYear ?? 360, Object.values(baseGame.prospectsById), schools);
    const nextDraftProspects = nextProspects.filter((prospect) => isDraftEligibleProspect(prospect, draftYear));
    const nextGame: GameState = {
      ...baseGame,
      turn: baseGame.turn + 1,
      currentYear: draftYear,
      teams: teamPool,
      prospectsById: Object.fromEntries(nextProspects.map((prospect) => [prospect.id, prospect])),
      draftClassProfilesByYear: {
        ...(baseGame.draftClassProfilesByYear ?? {}),
        [draftYear]: classQuality,
      },
      draftClassesByYear: {
        ...baseGame.draftClassesByYear,
        [draftYear]: nextDraftProspects.map((prospect) => prospect.id),
      },
      draftPicksByYear: {
        ...baseGame.draftPicksByYear,
        [draftYear]: picks,
      },
    };

    return { game: nextGame, prospects: nextDraftProspects, picks, teams: teamPool };
  }

  function clearDraftListsForNewClass() {
    const emptySet = new Set<string>();
    setFavorites(emptySet);
    setCompareIds(emptySet);
    setBigBoardIds([]);
    setRoundNotes({});
    writeStoredSet("draft-sm:favorites", emptySet);
    writeStoredSet("draft-sm:compare", emptySet);
    writeStoredSet("draft-sm:bigboard", emptySet);
    writeStoredRecord("draft-sm:round-notes", {});
  }

  function pruneDraftListsForNewPool(nextProspectIds: string[]) {
    const validIds = new Set(nextProspectIds);
    setFavorites((current) => {
      const next = new Set(Array.from(current).filter((id) => validIds.has(id)));
      writeStoredSet("draft-sm:favorites", next);
      return next;
    });
    setCompareIds((current) => {
      const next = new Set(Array.from(current).filter((id) => validIds.has(id)));
      writeStoredSet("draft-sm:compare", next);
      return next;
    });
    setBigBoardIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      writeStoredSet("draft-sm:bigboard", new Set(next));
      return next;
    });
    setRoundNotes({});
    writeStoredRecord("draft-sm:round-notes", {});
  }

  function simulateCareerYear(selectionSource: DraftSelectionView[], careerPlayerSource: CareerPlayerState[], prospectPool = prospects, nextYearOverride?: number) {
    if (!userTeamId) return;

    const existingCareerIds = new Set(careerPlayerSource.map((player) => player.playerId));
    const newCareerSelections = selectionSource.filter((selection) => !existingCareerIds.has(selection.prospect.id));
    const basePlayers = careerPlayerSource.length > 0 ? [...careerPlayerSource, ...createInitialCareerPlayers(newCareerSelections)] : createInitialCareerPlayers(selectionSource);
    const nextYear = nextYearOverride ?? careerYear + 1;
    const watchedIds = new Set<ProspectId>([...Array.from(favorites), ...Array.from(compareIds)] as ProspectId[]);
    const sourceUserSelections = selectionSource.filter((selection) => selection.team.id === userTeamId);
    const nextAfterUserPickIds = new Set<ProspectId>(
      sourceUserSelections
        .map((selection) => selectionSource.find((candidate) => candidate.pick.overall === selection.pick.overall + 1)?.prospect.id)
        .filter((id): id is ProspectId => Boolean(id)),
    );
    const news: CareerNewsItem[] = [];
    const seasonYear = selectionSource[0]?.pick.year ?? ((game?.currentYear ?? 2026) + nextYear - 1);
    const developmentClimate = createSeasonDevelopmentClimate();
    news.push(createDevelopmentClimateNews(nextYear, developmentClimate));
    const militaryManagedPlayers = applyMilitaryServiceTransitions(basePlayers, nextYear, seasonYear, userTeamId, watchedIds, nextAfterUserPickIds, news);
    const advancedPlayers = militaryManagedPlayers.map((player) => advanceCareerPlayer(player, nextYear, userTeamId, watchedIds, nextAfterUserPickIds, teams, news, developmentClimate));
    applyUserInboundTransactions(advancedPlayers, nextYear, userTeamId, teams, watchedIds, nextAfterUserPickIds, news);
    const roleAdjustedPlayers = applyTeamRoleAdjustments(applyRosterLimitCuts(advancedPlayers, nextYear, userTeamId, watchedIds, nextAfterUserPickIds, teams, news), teams, nextYear, userTeamId, watchedIds, nextAfterUserPickIds, news);
    const rosterLimitedPlayers = assignBullpenRoles(roleAdjustedPlayers, teams);
    const nextExistingPlayers = advanceExistingPlayers(existingPlayers.length > 0 ? existingPlayers : createInitialExistingPlayers(teams), nextYear);
    awardSingleRookieOfYear(rosterLimitedPlayers, nextYear, userTeamId, watchedIds, nextAfterUserPickIds, news);
    addSeasonSelectionHonors(rosterLimitedPlayers, nextExistingPlayers, teams, nextYear, seasonYear, userTeamId, watchedIds, nextAfterUserPickIds, news);
    const nextPlayers = applyDefaultTrackingAfterSeason(rosterLimitedPlayers, userTeamId, nextYear);
    const previousResults = seasonResults.filter((result) => result.yearIndex === careerYear);
    const nextSeasonResults = simulateTeamSeason(teams, selectionSource, nextPlayers, nextExistingPlayers, seasonYear, nextYear, previousResults, teamTradeStrengthAdjustments);
    applyOverseasShowcaseEvents(nextPlayers, nextSeasonResults, seasonResults, seasonYear, nextYear, userTeamId, watchedIds, nextAfterUserPickIds, news);
    const nextYearPicks = createNextDraftPicksFromSeason(nextSeasonResults, seasonYear + 1, game?.settings.rounds ?? 10);
    const tradeResult = applyPickTradeEvents(nextYearPicks, teams, userTeamId, seasonYear, nextYear);
    const needsUpdate = updateTeamNeedsAfterSeason(teams, nextPlayers, seasonYear);
    const draftedInSource = new Set(selectionSource.map((selection) => selection.prospect.id));
    const sourceUndrafted = prospectPool.filter((prospect) => !draftedInSource.has(prospect.id));

    news.push(...createUndraftedNews(nextYear, sourceUndrafted, watchedIds));
    news.push(...tradeResult.news);
    news.push(...needsUpdate.news);
    const curatedNews = curateYearlyNews(news);

    setCareerYear(nextYear);
    setCareerPlayers(nextPlayers);
    setExistingPlayers(nextExistingPlayers);
    setCareerNews((items) => [...curatedNews, ...items].slice(0, 120));
    setSeasonResults((items) => [...items.filter((result) => result.yearIndex !== nextYear), ...nextSeasonResults]);
    setNextDraftPicks(tradeResult.picks);
    setPickTradeEvents((items) => [...tradeResult.events, ...items].slice(0, 40));
    setTeamTradeStrengthAdjustments((current) => mergeStrengthAdjustments(current, tradeResult.strengthAdjustments));
    setDynamicTeams(needsUpdate.teams);
    setNeedHistory((items) => [...items, ...createNeedSnapshots(seasonYear, needsUpdate.teams)].slice(-120));
    if (!selectedCareerId && nextPlayers[0]) {
      setSelectedCareerId(nextPlayers[0].playerId);
    }
  }

  function updateTrackingStatus(playerId: ProspectId, status: TrackingStatus) {
    setCareerPlayers((players) =>
      players.map((player) =>
        player.playerId === playerId
          ? { ...player, trackingStatus: status, trackingArchivedAtYear: status === "archived" ? careerYear : undefined }
          : player,
      ),
    );
  }

  function updatePlayerNickname(playerId: ProspectId, nickname: string) {
    const trimmed = nickname.trim();
    setCareerPlayers((players) =>
      players.map((player) =>
        player.playerId === playerId
          ? { ...player, customNickname: trimmed || undefined }
          : player,
      ),
    );
  }

  function applyTrackingRecommendation() {
    setCareerPlayers((players) =>
      players.map((player) => {
        const status = player.status === "방출" || player.status === "은퇴" ? "archived" : recommendTrackingStatus(player);
        return { ...player, trackingStatus: status, trackingArchivedAtYear: status === "archived" ? careerYear : undefined };
      }),
    );
  }

  function applyTrackingRule(rule: "early-follow" | "late-summary" | "low-growth-archive") {
    setCareerPlayers((players) =>
      players.map((player) => {
        if (player.status === "방출" || player.status === "은퇴") return { ...player, trackingStatus: "archived", trackingArchivedAtYear: careerYear };
        if (rule === "early-follow" && player.pick.round <= 3) return { ...player, trackingStatus: "follow", trackingArchivedAtYear: undefined };
        if (rule === "late-summary" && player.pick.round >= 8) return { ...player, trackingStatus: "summary", trackingArchivedAtYear: undefined };
        if (rule === "low-growth-archive" && player.yearsSinceDraft >= 2 && player.currentOverall - player.initialOverall <= 1 && player.currentOverall < 50) {
          return { ...player, trackingStatus: "archived", trackingArchivedAtYear: careerYear };
        }
        return player;
      }),
    );
  }

  function changeTrackingSort(key: TrackingSortKey) {
    if (trackingSortKey === key) {
      setTrackingSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setTrackingSortKey(key);
    setTrackingSortDirection(["round", "overallPick", "name", "position", "trackingStatus"].includes(key) ? "asc" : "desc");
  }

  function isUserLegacyPlayer(playerId: ProspectId | undefined): boolean {
    if (!playerId) return false;
    const player = careerPlayers.find((candidate) => candidate.playerId === playerId);
    return Boolean(player && isUserManagedPlayer(player, userTeamId));
  }

  function userPlayerRowClass(player: CareerPlayerState | undefined): string {
    if (!player || !userTeamId) return "";
    if (player.originalTeamId === userTeamId && player.team.id !== userTeamId) return "departed-user-row";
    if (player.team.id === userTeamId || player.originalTeamId === userTeamId) return "user-team-row";
    return "";
  }

  function userLegacyRowClass(playerId: ProspectId | undefined): string {
    if (!playerId) return "";
    return userPlayerRowClass(careerPlayers.find((candidate) => candidate.playerId === playerId));
  }

  function openProspectDetail(id: string) {
    setSelectedId(id);
    setProspectDetailId(id as ProspectId);
  }

  return (
    <main className="app-shell">
      {showStartScreen && <StartScreen scoutName={scoutName} onNameChange={setScoutName} onStart={startNewCareer} onLoad={loadCareerFromJson} />}
      <header className="topbar">
        <div>
          <h1>고교야구 드래프트 보드</h1>
          <p>{displayDraftYear} 드래프트 클래스 · 10라운드 {totalPicks}명 지명 · 올해 후보 {totalProspects}명 · 관찰 풀 {totalObservedProspects}명 · {scoutName || "스카우터"}</p>
        </div>
        <div className="topbar-actions">
          {activeTab !== "draft-room" && (
            <>
              <button className="primary-progress-button" disabled={primaryProgressDisabled || isPickSequenceRunning} onClick={handlePrimaryProgressAction}>
                {primaryProgressLabel}
              </button>
              <button className="quick-year-button" disabled={fullAutoDisabled || isPickSequenceRunning} onClick={autoAdvanceOneYear}>
                한해 완전 자동
              </button>
            </>
          )}
          <div className="summary-grid" aria-label="요약">
            <Summary label="남은 후보" value={`${availableDraftProspects.length}/${totalProspects}`} />
            <Summary label="지명" value={`${selections.length}/${totalPicks}`} />
            <Summary label="관심" value={favorites.size} />
            <Summary label="비교" value={`${compareIds.size}/4`} />
          </div>
        </div>
      </header>

      {!showStartScreen && phase === "team-selection" && <TeamSelectionModal teams={teams} initialRank={initialRank} onRankChange={setInitialRank} onSelect={startDraft} />}

      {!showStartScreen && phase === "generating" && <GeneratingModal count={totalProspects} />}

      {showLegacyModal && <LegacyEndingModal summary={legacySummary} onImmortal={chooseImmortality} onReincarnate={reincarnateCareer} />}

      {phase !== "team-selection" && phase !== "generating" && selected && (
        <>
          <nav className="main-tabs" aria-label="화면 그룹">
            {MAIN_TABS.map((tab) => (
              <button key={tab.id} data-active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
                <strong>{tab.label}</strong>
                <span>{tab.description}</span>
              </button>
            ))}
          </nav>

          {activeTab === "draft-room" && <section className="draft-command-center collapsible-section">
            <CollapseButton collapsed={isCollapsed("draft-dashboard")} onClick={() => toggleCollapsed("draft-dashboard")} />
            {!isCollapsed("draft-dashboard") && <>
              <div className="draft-command-main">
                <div>
                  <span className="section-kicker">{phase === "pre-draft" ? "드래프트 전 동향" : phase === "complete" ? "드래프트 종료" : canUserPick ? "내 지명 차례" : "드래프트 진행 중"}</span>
                  <h2>{phase === "pre-draft" ? `${displayDraftYear} 드래프트 D-30 ~ 당일` : phase === "complete" ? `${totalPicks}명 지명 완료` : `${currentPick?.round ?? "-"}라운드 ${currentPick?.overall ?? "-"}번`}</h2>
                  <p>
                    {phase === "pre-draft"
                      ? "언론 동향, 구단 관심설, 비공개 테스트와 연막을 확인한 뒤 드래프트를 시작합니다."
                      : phase === "complete"
                      ? `지명되지 않은 올해 후보 ${availableDraftProspects.length}명이 남아 있습니다.`
                      : `${currentTeam?.name ?? "-"} · ${currentTeam?.id === userTeamId ? "직접 지명" : "CPU 지명 대기"}`}
                  </p>
                  {phase === "draft" && (
                    <p>
                      다음 내 지명까지 {picksUntilUserPick === undefined ? "-" : picksUntilUserPick === 0 ? "현재 픽" : `${picksUntilUserPick}픽`} ·
                      {nextUserPick ? ` ${nextUserPick.round}라운드 ${nextUserPick.overall}번` : " 남은 지명 없음"}
                    </p>
                  )}
                </div>
                <div className="draft-command-actions">
                  <button className="primary-button large-action" disabled={!canUserPick || isPickSequenceRunning} onClick={() => userPick(selected)}>
                    선택 선수 지명
                  </button>
                  <button className="text-button" disabled={!canUserPick || isPickSequenceRunning || draftTimeoutsUsed >= 3} onClick={requestDraftTimeout}>
                    타임 요청 {draftTimeoutsUsed}/3
                  </button>
                  <button className="text-button" disabled={phase !== "draft" || isPickSequenceRunning} onClick={runUntilUserPick}>
                    {isPickSequenceRunning ? "픽 진행 중" : "내 차례까지 진행"}
                  </button>
                  <button className="text-button" disabled={isPickSequenceRunning || (phase !== "pre-draft" && phase !== "draft")} onClick={handlePrimaryProgressAction}>
                    {phase === "pre-draft" ? primaryProgressLabel : "드래프트 전체 자동"}
                  </button>
                  <button className="text-button" disabled={fullAutoDisabled} onClick={autoAdvanceOneYear}>
                    한 해 완전 자동
                  </button>
                  {phase === "complete" && (
                    <button className="primary-button" disabled={primaryProgressDisabled} onClick={handlePrimaryProgressAction}>
                      {primaryProgressLabel}
                    </button>
                  )}
                </div>
              </div>

              {phase === "pre-draft" && (
                <section className="predraft-panel">
                  <div className="predraft-head">
                    <div>
                      <h3>드래프트 전 동향</h3>
                      <p>{predraftUserAction ? "날짜별로 동향을 열어보며 보드가 흔들리는 과정을 확인합니다." : "먼저 올해 드래프트 전 행동을 하나 정합니다. 정보전은 판단을 흔들 뿐 정답을 보장하지 않습니다."}</p>
                    </div>
                  </div>
                  <div className="predraft-action-board" data-locked={Boolean(predraftUserAction)}>
                    <button className="predraft-action-card" data-selected={predraftUserAction === "quiet-follow"} disabled={Boolean(predraftUserAction) || !selected} onClick={() => runPreDraftAction("quiet-follow")}>
                      <strong>비공개 집중 관찰</strong>
                      <span>선택 선수 추가 관찰</span>
                      <small>리포트 신뢰도 소폭 상승 · 외부 노출 최소화</small>
                      <em>{predraftUserAction === "quiet-follow" ? "선택됨" : "선택"}</em>
                    </button>
                    <button className="predraft-action-card" data-selected={predraftUserAction === "public-interest"} disabled={Boolean(predraftUserAction) || !selected} onClick={() => runPreDraftAction("public-interest")}>
                      <strong>관심 공개</strong>
                      <span>선택 선수 관심설 유도</span>
                      <small>팬 여론 가산 · 하이프 상승 · 타 구단 견제 위험</small>
                      <em>{predraftUserAction === "public-interest" ? "선택됨" : "선택"}</em>
                    </button>
                    <button className="predraft-action-card" data-selected={predraftUserAction === "smoke-screen"} disabled={Boolean(predraftUserAction)} onClick={() => runPreDraftAction("smoke-screen")}>
                      <strong>연막 유지</strong>
                      <span>실제 보드 숨기기</span>
                      <small>직접 능력 변화 없음 · 정보전 로그 생성</small>
                      <em>{predraftUserAction === "smoke-screen" ? "선택됨" : "선택"}</em>
                    </button>
                    <button className="predraft-action-card auto-action-card" disabled={Boolean(predraftUserAction)} onClick={runAutoPreDraftAction}>
                      <strong>자동 결정</strong>
                      <span>운영팀 추천으로 선택</span>
                      <small>선택 선수, 팀 니즈, 리포트 신뢰도, 하이프를 보고 자동 실행</small>
                      <em>자동</em>
                    </button>
                  </div>
                  <div className="predraft-stage-row" aria-label="드래프트 전 일정">
                    {PREDRAFT_STAGES.map((stage, index) => (
                      <button
                        className="stage-pill"
                        data-active={index < predraftStageIndex}
                        data-current={predraftUserAction && index === predraftStageIndex}
                        disabled={!predraftUserAction || index > predraftStageIndex}
                        key={stage}
                        onClick={() => {
                          if (index === predraftStageIndex) advancePreDraftStage();
                        }}
                      >
                        {stage}
                      </button>
                    ))}
                    <button className="stage-pill" data-active={predraftUserAction && predraftStageIndex >= PREDRAFT_STAGES.length} disabled={!predraftUserAction || predraftStageIndex < PREDRAFT_STAGES.length} onClick={beginDraftFromPreDraft}>
                      지명 시작
                    </button>
                  </div>
                  <div className="intel-feed">
                    {!predraftUserAction ? <p className="empty">행동을 선택하면 D-30부터 동향이 열립니다.</p> : visiblePredraftIntelEvents.length === 0 ? <p className="empty">아직 열린 동향이 없습니다. 다음 날짜를 확인하세요.</p> : visiblePredraftIntelEvents.map((event) => (
                      <button className="intel-item" data-tone={event.tone} key={event.id} onClick={() => event.prospectId && openProspectDetail(event.prospectId)}>
                        <span>{event.stage} · {event.type}{event.teamName ? ` · ${event.teamName}` : ""}</span>
                        <strong>{event.headline}</strong>
                        <p>{event.body}</p>
                        <small>{event.impact}</small>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <div className="final-meeting-grid">
                <section className="meeting-panel">
                  <h3>최종 회의 · 팀 니즈</h3>
                  <div className="meeting-list">
                    {topNeeds.map((row) => (
                      <button key={row.position} onClick={() => setPositionFilter(row.position)}>
                        <span className={`pos pos-${row.position}`}>{positionLabel(row.position)}</span>
                        <strong>{needLevelLabel(row.need)} {row.need}</strong>
                        <small>{row.depth.changeReason ?? "올해 보강 우선순위"}</small>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="meeting-panel">
                  <h3>팬 모의지명 TOP 5</h3>
                  <div className="meeting-list">
                    {fanMockCandidates.slice(0, 5).map((candidate, index) => {
                      const drafted = draftedIds.has(candidate.prospect.id);
                      return (
                        <button data-drafted={drafted} key={candidate.prospect.id} onClick={() => openProspectDetail(candidate.prospect.id)}>
                          <span className="num">{index + 1}</span>
                          <strong>{candidate.prospect.name}</strong>
                          <small>{candidate.supportRate}% · {candidate.reasons.slice(0, 2).join(" · ")}</small>
                        </button>
                      );
                    })}
                  </div>
                </section>
                <section className="meeting-panel">
                  <h3>내 보드 / 추천</h3>
                  <div className="meeting-list">
                    {bigBoardTopDraftRecommendation && (
                      <button onClick={() => openProspectDetail(bigBoardTopDraftRecommendation.id)}>
                        <span>보드 1순위</span>
                        <strong>{bigBoardTopDraftRecommendation.name}</strong>
                        <small>{positionLabel(bigBoardTopDraftRecommendation.primaryPosition)} · {formatRange(bigBoardTopDraftRecommendation.visible.projectedRound)}R</small>
                      </button>
                    )}
                    {userTurnRecommendations.slice(0, 4).map((prospect, index) => (
                      <button key={prospect.id} onClick={() => openProspectDetail(prospect.id)}>
                        <span>추천 {index + 1}</span>
                        <strong>{prospect.name}</strong>
                        <small>{draftReason(prospect)}</small>
                      </button>
                    ))}
                    {!bigBoardTopDraftRecommendation && userTurnRecommendations.length === 0 && <p className="empty">추천 후보 없음</p>}
                  </div>
                </section>
                <section className="meeting-panel">
                  <h3>{draftTimeoutReports.length > 0 ? "타임 회의" : "진행 알림"}</h3>
                  <div className="meeting-notifications">
                    {draftTimeoutReports.length > 0 ? draftTimeoutReports.slice(0, 2).map((report) => (
                      <div className="timeout-report" key={report.id}>
                        <strong>{report.pickRound}R {report.pickOverall}번 · {report.headline}</strong>
                        {report.lines.map((line) => <p key={line}>{line}</p>)}
                      </div>
                    )) : notifications.length === 0 ? <p className="empty">관심 선수 지명 알림 없음</p> : notifications.slice(0, 5).map((item) => <p key={item}>{item}</p>)}
                  </div>
                </section>
              </div>
            </>}
          </section>}

          {activeTab === "team" && (
            <div className="sub-tabs team-sub-tabs" aria-label="구단 상황 하위 탭">
              <button data-active={teamSubTab === "draft"} onClick={() => setTeamSubTab("draft")}>드래프트 관련</button>
              <button data-active={teamSubTab === "status"} onClick={() => setTeamSubTab("status")}>구단 현황</button>
              <button data-active={teamSubTab === "fans"} onClick={() => setTeamSubTab("fans")}>팬</button>
            </div>
          )}

          {draftPickToast && (
            <div className="draft-pick-toast" data-user-pick={draftPickToast.team.id === userTeamId} data-panic={Boolean(draftPickToast.isPanicPick)}>
              <span>{draftPickToast.pick.round}라운드 {draftPickToast.pick.overall}순위</span>
              <strong>{draftPickToast.team.shortName}, {draftPickToast.prospect.name} 지명!</strong>
              <small>{draftPickToast.prospect.school} · {positionLabel(draftPickToast.prospect.primaryPosition)}{draftPickToast.isPanicPick ? " · 패닉픽" : ""}</small>
            </div>
          )}

          {activeTab === "team" && teamSubTab === "draft" && <section className="needs-section">
            <div className="career-head">
              <div>
                <h2>우리 팀 드래프트 요구사항</h2>
                <p>포지션별 1군 전력, 유망주층, 리스크와 최근 드래프트 결과를 반영합니다.</p>
              </div>
              <CollapseButton collapsed={isCollapsed("needs")} onClick={() => toggleCollapsed("needs")} />
            </div>
            {!isCollapsed("needs") && <>
              <div className="asset-summary">
                {topNeeds.map((row) => <span key={row.position}>TOP 보강 {positionLabel(row.position)} {row.need}</span>)}
                {risingNeeds.map((row) => <span key={`up-${row.position}`}>{positionLabel(row.position)} +{row.change}</span>)}
                {fallingNeeds.map((row) => <span key={`down-${row.position}`}>{positionLabel(row.position)} {row.change}</span>)}
              </div>
              <div className="standings-wrap needs-wrap">
                <table className="needs-table">
                <thead>
                  <tr>
                    <th>포지션</th>
                    <th>1군 전력점수</th>
                    <th>유망주층점수</th>
                    <th>노쇠화 위험도</th>
                    <th>부상 위험도</th>
                    <th>계약 이탈 위험도</th>
                    <th>보강 필요도</th>
                    <th>전년 대비</th>
                    <th>변화 이유</th>
                  </tr>
                </thead>
                <tbody>
                  {userNeedRows.map((row) => (
                    <tr key={row.position}>
                      <td><span className={`pos pos-${row.position}`}>{positionLabel(row.position)}</span></td>
                      <td className="num">{formatIndex(row.depth.majorLeagueStrength)}</td>
                      <td className="num">{formatIndex(row.depth.prospectDepth)}</td>
                      <td className="num">{formatRiskIndex(row.depth.agingRisk)}</td>
                      <td className="num">{formatRiskIndex(row.depth.injuryRisk)}</td>
                      <td className="num">{formatRiskIndex(row.depth.contractRisk)}</td>
                      <td><span className={`need-badge need-${needLevel(row.need)}`}>{needLevelLabel(row.need)} {row.need}</span></td>
                      <td className="num">{formatSigned(row.change)}</td>
                      <td>{row.depth.changeReason ?? "큰 변화 없음"}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </>}
          </section>}

          {activeTab === "team" && teamSubTab === "status" && <section className="needs-section">
            <div className="career-head">
              <div>
                <h2>현 로스터 구성</h2>
                <p>드래프트 출신 선수와 기존 선수층을 현재 OVR 기준으로 주전, 플래툰, 2군 역할로 나눕니다.</p>
              </div>
              <CollapseButton collapsed={isCollapsed("current-roster")} onClick={() => toggleCollapsed("current-roster")} />
            </div>
            {!isCollapsed("current-roster") && (
              <div className="standings-wrap roster-wrap">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th>포지션</th>
                      <th>주전</th>
                      <th>플래툰/백업</th>
                      <th>2군/육성</th>
                      <th>부상/군복무</th>
                      <th>드래프트 출신</th>
                      <th>기존 선수층</th>
                      <th>보강 필요도</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRosterRows.map((row) => (
                      <tr key={row.position}>
                        <td><span className={`pos pos-${row.position}`}>{positionLabel(row.position)}</span></td>
                        <td>{row.starters.length ? row.starters.map((member) => <RosterMemberButton member={member} key={member.id} onSelect={setDetailPlayerId} />) : <span className="muted">공백</span>}</td>
                        <td>{row.platoon.length ? row.platoon.map((member) => <RosterMemberButton member={member} key={member.id} onSelect={setDetailPlayerId} />) : <span className="muted">부족</span>}</td>
                        <td>{row.secondTeam.length ? row.secondTeam.map((member) => <RosterMemberButton member={member} key={member.id} onSelect={setDetailPlayerId} />) : <span className="muted">얇음</span>}</td>
                        <td>{row.inactive.length ? row.inactive.map((member) => <RosterMemberButton member={member} key={member.id} onSelect={setDetailPlayerId} />) : <span className="muted">없음</span>}</td>
                        <td className="num">{row.draftedCount}</td>
                        <td className="num">{row.existingCount}</td>
                        <td><span className={`need-badge need-${needLevel(row.need)}`}>{needLevelLabel(row.need)} {row.need}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>}

          {activeTab === "team" && teamSubTab === "status" && <section className="needs-section">
            <div className="career-head">
              <div>
                <h2>팀 평균 사이클</h2>
                <p>3월부터 10월까지 선수단의 월별 폼 흐름을 평균낸 관찰 지표입니다. 기존 선수층은 OVR과 나이 기반 추정치로 반영합니다.</p>
              </div>
              <CollapseButton collapsed={isCollapsed("team-cycle")} onClick={() => toggleCollapsed("team-cycle")} />
            </div>
            {!isCollapsed("team-cycle") && (
              teamCycleSummary ? (
                <>
                  <div className="asset-summary">
                    <span>후반 유지력 {teamCycleSummary.lateSeasonGrade}</span>
                    <span>포스트시즌 적합도 {teamCycleSummary.postseasonFitGrade}</span>
                    <span>강세월 {teamCycleSummary.strongMonths || "뚜렷하지 않음"}</span>
                    <span>약세월 {teamCycleSummary.weakMonths || "뚜렷하지 않음"}</span>
                  </div>
                  <div className="team-cycle-grid">
                    <section className="team-cycle-card">
                      <h3>전체 평균</h3>
                      <SeasonCycleChart cycle={teamCycleSummary.total} />
                    </section>
                    <section className="team-cycle-card">
                      <h3>타자 평균</h3>
                      <SeasonCycleChart cycle={teamCycleSummary.hitters} />
                    </section>
                    <section className="team-cycle-card">
                      <h3>투수 평균</h3>
                      <SeasonCycleChart cycle={teamCycleSummary.pitchers} />
                    </section>
                  </div>
                </>
              ) : (
                <p className="empty">활동 중인 선수단 사이클 표본이 부족합니다.</p>
              )
            )}
          </section>}

          {activeTab === "team" && teamSubTab === "fans" && <section className="fan-section">
            <div className="career-head">
              <div>
                <h2>팬덤 지표</h2>
                <p>성적, 스타 선수, 드래프트 서사, 팬 여론을 합성한 게임 내 팬덤 추정치입니다.</p>
              </div>
              <CollapseButton collapsed={isCollapsed("team-fan-metrics")} onClick={() => toggleCollapsed("team-fan-metrics")} />
            </div>
            {!isCollapsed("team-fan-metrics") && (
              <div className="fan-metrics-grid">
                <div className="opinion-score-card" data-mood={teamFanOpinion.mood}>
                  <span>구단 인기도</span>
                  <strong>{teamFanMetrics.popularity}</strong>
                  <em>{teamFanMetrics.popularityLabel}</em>
                </div>
                <div className="fan-metric-card">
                  <span>관중 동원 지수</span>
                  <strong>{teamFanMetrics.attendanceIndex}</strong>
                  <small>{teamFanMetrics.momentum}</small>
                </div>
                <div className="fan-metric-card">
                  <span>굿즈 구매력</span>
                  <strong>{teamFanMetrics.merchandiseIndex}</strong>
                  <small>유니폼 판매 랭킹에 반영</small>
                </div>
                <div className="fan-metric-card">
                  <span>온라인 화제성</span>
                  <strong>{teamFanMetrics.onlineBuzz}</strong>
                  <small>스타·논쟁·대표팀 이슈 반영</small>
                </div>
                <div className="fan-metric-card">
                  <span>충성 팬 지수</span>
                  <strong>{teamFanMetrics.loyaltyIndex}</strong>
                  <small>프랜차이즈 서사와 장기 성적 반영</small>
                </div>
              </div>
            )}
          </section>}

          {activeTab === "team" && teamSubTab === "fans" && <section className="needs-section">
            <div className="career-head">
              <div>
                <h2>팀내 유니폼 판매량 랭킹</h2>
                <p>현재 소속 선수 기준 추정 판매 비중입니다. 활약, 스타성, 원클럽 서사, 대표팀·수상 이력이 영향을 줍니다.</p>
              </div>
              <CollapseButton collapsed={isCollapsed("jersey-ranking")} onClick={() => toggleCollapsed("jersey-ranking")} />
            </div>
            {!isCollapsed("jersey-ranking") && (
              teamFanMetrics.jerseyRows.length === 0 ? (
                <p className="empty">아직 유니폼 판매 랭킹에 잡힐 소속 선수가 없습니다.</p>
              ) : (
                <div className="standings-wrap jersey-wrap">
                  <table className="compact-table">
                    <thead>
                      <tr>
                        <th>순위</th>
                        <th>선수</th>
                        <th>포지션</th>
                        <th>연차</th>
                        <th>현재 OVR</th>
                        <th>판매 비중</th>
                        <th>주요 요인</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamFanMetrics.jerseyRows.map((row) => (
                        <tr key={row.player.playerId} className={userPlayerRowClass(row.player)}>
                          <td className="num">{row.rank}</td>
                          <td><button className="link-button" onClick={() => setDetailPlayerId(row.player.playerId)}>{row.player.prospect.name}</button></td>
                          <td><PositionCell player={row.player} /></td>
                          <td className="num">{row.player.yearsSinceDraft}년차</td>
                          <td className="num">{row.player.currentOverall}</td>
                          <td className="num">{row.salesShare}%</td>
                          <td>{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </section>}

          {activeTab === "team" && teamSubTab === "fans" && <section className="fan-section">
            <div className="career-head">
              <div>
                <h2>시즌 후 팬 여론</h2>
                <p>팬 여론은 팀 방향성에 대한 압박과 기대치를 보여주며, 실제 성공을 보장하지 않습니다.</p>
              </div>
              <CollapseButton collapsed={isCollapsed("team-fan-opinion")} onClick={() => toggleCollapsed("team-fan-opinion")} />
            </div>
            {!isCollapsed("team-fan-opinion") && (
              <div className="team-opinion-grid">
                <div className="opinion-score-card" data-mood={teamFanOpinion.mood}>
                  <span>팬 여론 지수</span>
                  <strong>{teamFanOpinion.score}</strong>
                  <em>{teamFanOpinion.label}</em>
                </div>
                <div className="opinion-panel">
                  <h3>긍정 요인</h3>
                  <ul>
                    {teamFanOpinion.positives.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div className="opinion-panel">
                  <h3>불만 요인</h3>
                  <ul>
                    {teamFanOpinion.negatives.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div className="opinion-panel comment-panel">
                  <h3>팬 댓글 로그</h3>
                  <ul>
                    {teamFanOpinion.comments.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </div>
            )}
          </section>}

          {activeTab === "team" && teamSubTab === "draft" && <section className="fan-section">
            <div className="career-head">
              <div>
                <h2>팬 모의지명 TOP 5</h2>
                <p>팬 여론은 기대와 압박을 보여줄 뿐, 성공을 보장하지 않습니다.</p>
              </div>
              <CollapseButton collapsed={isCollapsed("fan-mock")} onClick={() => toggleCollapsed("fan-mock")} />
            </div>
            {!isCollapsed("fan-mock") && <div className="fan-mock-grid">
              {fanMockCandidates.map((candidate, index) => {
                const drafted = selections.some((selection) => selection.prospect.id === candidate.prospect.id);
                return (
                  <button className="fan-mock-row" data-drafted={drafted} key={candidate.prospect.id} onClick={() => openProspectDetail(candidate.prospect.id)}>
                    <span className="num">{index + 1}</span>
                    <strong>{candidate.prospect.name}</strong>
                    <span className={`pos pos-${candidate.prospect.primaryPosition}`}>{positionLabel(candidate.prospect.primaryPosition)}</span>
                    <span>{candidate.supportRate}%</span>
                    <span>{drafted ? "지명 완료" : "남아 있음"}</span>
                    <small>{candidate.reasons.join(" · ")}</small>
                    <small>{candidate.concern}</small>
                  </button>
                );
              })}
            </div>}
          </section>}

          {activeTab === "draft-room" && <section className="draft-aid-section collapsible-section">
            <div className="career-head">
              <div>
                <h2>드래프트 운영 보드</h2>
                <p>최종 회의에서 좁힌 후보를 실제 10라운드 진행용 목록으로 관리합니다.</p>
              </div>
              <CollapseButton collapsed={isCollapsed("draft-aid")} onClick={() => toggleCollapsed("draft-aid")} />
            </div>
            {!isCollapsed("draft-aid") && (
              <div className="draft-aid-grid">
                <BigBoardPanel prospects={bigBoardProspects.slice(0, 12)} draftedIds={draftedIds} onSelect={openProspectDetail} onMove={moveBigBoard} onRemove={toggleBigBoard} />
                <AidPanel title="관심 선수" prospects={favoriteProspects.slice(0, 8)} onSelect={openProspectDetail} />
                <div className="aid-panel">
                  <h3>포지션별 남은 선수</h3>
                  <div className="position-count-grid">
                    {POSITIONS.map((position) => (
                      <button className="count-chip" key={position} onClick={() => setPositionFilter(position)}>
                        <span className={`pos pos-${position}`}>{positionLabel(position)}</span>
                        <strong>{positionCounts[position] ?? 0}</strong>
                      </button>
                    ))}
                  </div>
                </div>
                <RemainingSummaryPanel summary={remainingSummary} />
                <RoundNotePanel currentRound={currentPick?.round ?? 1} notes={roundNotes} onChange={updateRoundNote} />
              </div>
            )}
          </section>}

          {(activeTab === "draft-room" || activeTab === "review") && <section className="draft-board-section collapsible-section">
            <CollapseButton collapsed={isCollapsed("draft-board")} onClick={() => toggleCollapsed("draft-board")} />
            {!isCollapsed("draft-board") && <>
              <div className="draft-board-head">
                <div>
                  <h2>드래프트 보드</h2>
                  <p>
                    {phase === "complete"
                      ? `${selections.length}/${totalPicks}명 지명 완료 · 미지명 후보 ${availableDraftProspects.length}명`
                      : `${selections.length}/${totalPicks}명 지명 · 현재 ${currentPick?.round ?? "-"}R ${currentPick?.overall ?? "-"}번`}
                  </p>
                </div>
                <div className="board-summary-strip">
                  <span>내 픽 {userSelections.length}명</span>
                  <span>관심 {favorites.size}명</span>
                  <span>빅보드 잔여 {bigBoardDraftAvailable.length}명</span>
                  <span>비교 {compareIds.size}/4</span>
                </div>
              </div>
              <div className="board-zone">
              <table className="draft-board">
                <thead>
                  <tr>
                    <th>라운드</th>
                    <th>전체</th>
                    <th>원소속</th>
                    <th>현재 보유</th>
                    <th>선수</th>
                    <th>포지션</th>
                    <th>학교</th>
                    <th>픽감</th>
                  </tr>
                </thead>
                <tbody>
                  {draftPicks.map((pick, index) => {
                    const selection = selections[index];
                    const originalTeam = teams.find((candidate) => candidate.id === pick.originalTeamId);
                    const ownerTeam = teams.find((candidate) => candidate.id === pick.ownerTeamId);
                    const rowClass = [
                      index === selections.length && phase === "draft" ? "current-pick-row" : "",
                      selection?.team.id === userTeamId ? "user-team-row" : "",
                      selection?.isPanicPick ? "panic-pick-row" : "",
                    ].filter(Boolean).join(" ");
                    return (
                      <tr key={pick.id} className={rowClass}>
                        <td className="num">{pick.round}</td>
                        <td className="num">{pick.overall}</td>
                        <td>{originalTeam?.shortName}</td>
                        <td>{ownerTeam?.shortName}</td>
                        <td>{selection ? <button className="link-button" onClick={() => setDetailPlayerId(selection.prospect.id)}>{selection.prospect.name}</button> : "-"}</td>
                        <td>{selection ? <span className={`pos pos-${selection.prospect.primaryPosition}`}>{positionLabel(selection.prospect.primaryPosition)}</span> : "-"}</td>
                        <td>{selection?.prospect.school ?? "-"}</td>
                        <td>{selection ? (
                          <span className={`pick-value pick-${selection.isPanicPick ? "panic" : pickValueType(pick, selection.prospect)}`}>
                            {selection.isPanicPick ? `패닉픽 · ${pickValueLabel(pick, selection.prospect)}` : pickValueLabel(pick, selection.prospect)}
                          </span>
                        ) : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>

              {phase === "complete" && (
              <div className="reveal-panel">
                <div className="review-report-head">
                  <div>
                    <h2>드래프트 결과보고</h2>
                    <p>{selectedTeam?.shortName ?? "우리 팀"} 지명 {userSelections.length}명 · 초기 종합만 공개 · 최종 평가는 커리어 진행 후 확인</p>
                  </div>
                  <div className="report-grade-stack">
                    <span>내부 평가</span>
                    <strong>{draftSummary.internalGrade}</strong>
                  </div>
                </div>
                <div className="draft-summary-grid enhanced">
                  <span><strong>{draftSummary.pitcherCount}:{draftSummary.hitterCount}</strong><small>투수/야수</small></span>
                  <span><strong>{formatPositionCounts(draftSummary.positionCounts)}</strong><small>포지션 분포</small></span>
                  <span><strong>{draftSummary.top100Count}명</strong><small>상위 100위권</small></span>
                  <span><strong>{draftSummary.lotteryCount}명</strong><small>200위 이하 관찰픽</small></span>
                  <span><strong>{draftSummary.overpickCount} / {draftSummary.slidePickCount}</strong><small>오버픽 / 슬라이드</small></span>
                  <span><strong>{draftSummary.injuryRiskCount} / {draftSummary.collegeRiskCount}</strong><small>부상 / 대학 리스크</small></span>
                  <span><strong>{draftSummary.awardedCount}명</strong><small>수상 경력 보유</small></span>
                  <span><strong>{draftSummary.needGrade}</strong><small>팀 니즈 충족도</small></span>
                  <span><strong>{draftSummary.fanAverage}점 · {draftSummary.fanGrade}</strong><small>팬 반응 평균</small></span>
                  <span><strong>{fieldReactionAverage(fieldPickReactions)}점 · {plusGrade(fieldReactionAverage(fieldPickReactions))}</strong><small>현장 반응 평균</small></span>
                </div>
                <div className="draft-evaluation-notes">
                  {draftSummary.notes.map((note) => <p key={note}>{note}</p>)}
                </div>
                {userSelections.length === 0 ? (
                  <p className="empty">내 지명 선수가 없습니다.</p>
                ) : (
                  <div className="draft-result-table-wrap">
                  <table className="draft-result-table">
                    <thead>
                      <tr>
                        <th>라운드</th>
                        <th>전체</th>
                        <th>이름</th>
                        <th>포지션</th>
                        <th>학교</th>
                        <th>예상 순위</th>
                        <th>실제 순위</th>
                        <th>픽감</th>
                        <th>초기 종합</th>
                        <th>수상 경력</th>
                        <th>리스크 태그</th>
                        <th>팬 반응</th>
                        <th>현장 반응</th>
                        <th>팀 니즈</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userSelections.map((selection) => {
                        const reaction = fanPickReactions.find((item) => item.selection.prospect.id === selection.prospect.id);
                        const fieldReaction = fieldPickReactions.find((item) => item.selection.prospect.id === selection.prospect.id);
                        const need = selectedTeam ? teamNeedScore(selectedTeam, selection.prospect.primaryPosition) : 0;
                        return (
                          <tr className="user-team-row" key={selection.prospect.id}>
                            <td className="num">{selection.pick.round}</td>
                            <td className="num">{selection.pick.overall}</td>
                            <td className="name-cell">
                              <button className="link-button" onClick={() => setDetailPlayerId(selection.prospect.id)}>{selection.prospect.name}</button>
                            </td>
                            <td><span className={`pos pos-${selection.prospect.primaryPosition}`}>{positionLabel(selection.prospect.primaryPosition)}</span></td>
                            <td>{selection.prospect.school}</td>
                            <td>{formatExpectedPickRange(selection.prospect)}</td>
                            <td className="num">{selection.pick.overall}</td>
                            <td><span className={`pick-value pick-${pickValueType(selection.pick, selection.prospect)}`}>{pickValueLabel(selection.pick, selection.prospect)}</span></td>
                            <td className="num">{selection.prospect.trueTalent.currentAbility}</td>
                            <td>{shortAccolades(selection.prospect)}</td>
                            <td>{shortRiskTags(selection.prospect)}</td>
                            <td>{reaction ? `${reaction.grade} (${Math.round(reaction.score)})` : "-"}</td>
                            <td>{fieldReaction ? `${fieldReaction.grade} (${Math.round(fieldReaction.score)})` : "-"}</td>
                            <td>{needLevelLabel(need)} {need}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
                <p className="reveal-note">잠재력, 성장률, 적응력 등 숨은 능력치는 아직 공개되지 않습니다.</p>
              </div>
              )}
            </>}
          </section>}

          {activeTab === "review" && phase === "complete" && (
            <section className="fan-section">
              <div className="career-head">
                <div>
                  <h2>드래프트 직후 반응</h2>
                  <p>팬 반응은 여론과 기대치, 현장 반응은 보드 가치와 육성 난이도를 따로 봅니다. 둘 다 선수 성장에는 직접 영향을 주지 않습니다.</p>
                </div>
                <CollapseButton collapsed={isCollapsed("fan-reaction")} onClick={() => toggleCollapsed("fan-reaction")} />
              </div>
              {!isCollapsed("fan-reaction") && <div className="reaction-two-column">
                <div className="reaction-column">
                  <h3>팬 반응</h3>
                  <div className="fan-reaction-grid compact">
                    {fanPickReactions.map((reaction) => (
                      <article className="fan-reaction-card" key={reaction.selection.prospect.id}>
                        <div className="reaction-head">
                          <strong>
                            {reaction.selection.pick.round}R <button className="link-button" onClick={() => setDetailPlayerId(reaction.selection.prospect.id)}>{reaction.selection.prospect.name}</button>
                          </strong>
                          <span className={`reaction-grade grade-${reaction.grade}`}>{reaction.grade}</span>
                        </div>
                        <p>{reaction.reasons.join(" · ")}</p>
                        <p className="muted">{reaction.concern}</p>
                        <ul className="comment-log">
                          {reaction.comments.slice(0, 4).map((comment) => (
                            <li key={comment.text}><strong>{comment.tone}</strong> {comment.text}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>
                </div>
                <div className="reaction-column">
                  <h3>현장 반응</h3>
                  <div className="field-reaction-list">
                    {fieldPickReactions.map((reaction) => (
                      <article className="field-reaction-card" key={`field-${reaction.selection.prospect.id}`}>
                        <div className="reaction-head">
                          <strong>
                            {reaction.selection.pick.round}R <button className="link-button" onClick={() => setDetailPlayerId(reaction.selection.prospect.id)}>{reaction.selection.prospect.name}</button>
                          </strong>
                          <span className={`reaction-grade grade-${reaction.grade}`}>{reaction.grade}</span>
                        </div>
                        <p className="field-verdict">{reaction.verdict}</p>
                        <div className="field-reaction-body">
                          <span>{reaction.reasons.join(" · ")}</span>
                          <span>{reaction.concerns.length ? reaction.concerns.join(" · ") : "큰 즉시 리스크 없음"}</span>
                        </div>
                        <p className="scout-quote">“{reaction.scoutQuote}”</p>
                      </article>
                    ))}
                  </div>
                </div>
              </div>}
            </section>
          )}

          {activeTab === "tracking" && (phase === "complete" || hasTrackingHistory) && (
            <>
            <section className="tracking-overview">
              <div>
                <h2>선수 추적 대시보드</h2>
                <p>{careerYear === 0 ? "시즌 진행 전입니다. 첫 1년을 넘기면 자동 추적 대상이 생성됩니다." : `${careerYear}년차 종료 기준 · 뉴스와 추적 상태를 함께 관리합니다.`}</p>
              </div>
              <div className="tracking-overview-grid">
                <button className="summary-tile" onClick={() => {
                  setTrackingSubTab("news");
                  setNewsScope("user-team");
                }}>
                  <strong>{trackingSummary.currentUserTeam}</strong>
                  <span>현재 자팀 선수</span>
                </button>
                <button className="summary-tile" onClick={() => {
                  setTrackingSubTab("manage");
                  setTrackingFilter("needs-review");
                }}>
                  <strong>{trackingSummary.needsReview}</strong>
                  <span>분류 필요</span>
                </button>
                <button className="summary-tile" onClick={() => {
                  setTrackingSubTab("manage");
                  setTrackingFilter("follow");
                }}>
                  <strong>{trackingSummary.follow}</strong>
                  <span>상세 추적</span>
                </button>
                <button className="summary-tile" onClick={() => {
                  setTrackingSubTab("manage");
                  setTrackingFilter("summary");
                }}>
                  <strong>{trackingSummary.summary}</strong>
                  <span>요약 추적</span>
                </button>
                <button className="summary-tile" onClick={() => {
                  setTrackingSubTab("news");
                  setNewsGradeFilter("major");
                }}>
                  <strong>{trackingSummary.majorNews}</strong>
                  <span>주요 뉴스</span>
                </button>
                <button className="summary-tile alert" onClick={() => {
                  setTrackingSubTab("manage");
                  setTrackingFilter("released");
                }}>
                  <strong>{trackingSummary.released}</strong>
                  <span>방출/은퇴/해외진출</span>
                </button>
              </div>
            </section>
            <div className="sub-tabs tracking-sub-tabs" aria-label="선수 추적 하위 탭">
              <button data-active={trackingSubTab === "news"} onClick={() => setTrackingSubTab("news")}>뉴스피드</button>
              <button data-active={trackingSubTab === "manage"} onClick={() => setTrackingSubTab("manage")}>추적중 선수 관리</button>
              <button data-active={trackingSubTab === "add"} onClick={() => setTrackingSubTab("add")}>새 추적 추가</button>
            </div>
            {trackingSubTab === "news" && (
            <section className="career-section">
              <div className="career-head">
                <div>
                  <h2>드래프트 이후 뉴스피드</h2>
                  <p>{careerYear === 0 ? "아직 시뮬레이션 전입니다." : `드래프트 후 ${careerYear}년차까지 진행`}</p>
                </div>
                <div className="head-actions">
                  <CollapseButton collapsed={isCollapsed("career")} onClick={() => toggleCollapsed("career")} />
                </div>
              </div>
              {!isCollapsed("career") && <div className="career-grid">
                <div className="news-feed">
                  <div className="news-view-toggle">
                    <button className="small-button" data-active={newsViewMode === "timeline"} onClick={() => setNewsViewMode("timeline")}>시간순</button>
                    <button className="small-button" data-active={newsViewMode === "player"} onClick={() => setNewsViewMode("player")}>선수별</button>
                    <Select label="뉴스 범위" value={newsScope} onChange={(value) => setNewsScope(value as NewsScope)} options={["user-team", "watched", "league"]} labelMap={NEWS_SCOPE_LABELS} />
                    <Select label="뉴스 등급" value={newsGradeFilter} onChange={(value) => setNewsGradeFilter(value as NewsGrade | "all")} options={["all", "headline", "major", "normal", "archive"]} labelMap={NEWS_GRADE_LABELS} />
                    <Select label="연차" value={careerYearBucket} onChange={(value) => setCareerYearBucket(value as CareerYearBucket)} options={["all", "year-1", "year-2-3", "year-4-5", "year-6-10", "year-11-15", "year-16-20", "year-20-plus"]} labelMap={YEAR_BUCKET_LABELS} />
                  </div>
                  {filteredCareerNews.length === 0 ? (
                    <p className="empty">드래프트 이후 소식이 여기에 기사 목록처럼 쌓입니다.</p>
                  ) : newsViewMode === "timeline" ? (
                    orderedNews(filteredCareerNews).map((news) => (
                      <NewsButton news={news} key={news.id} onSelect={(id) => {
                        setSelectedCareerId(id);
                        if (careerPlayers.some((player) => player.playerId === id)) setDetailPlayerId(id);
                      }} />
                    ))
                  ) : (
                    <PlayerNewsTimeline news={filteredCareerNews} prospects={prospects} players={careerPlayers} onSelect={(id) => {
                      setSelectedCareerId(id);
                      if (careerPlayers.some((player) => player.playerId === id)) setDetailPlayerId(id);
                    }} />
                  )}
                </div>
                <aside className="career-log">
                  <h2>선수 커리어 로그</h2>
                  {selectedCareerPlayer ? (
                    <>
                      <div className="detail-line">
                        <span className={`pos pos-${currentPlayerPosition(selectedCareerPlayer)}`}>{positionLabel(currentPlayerPosition(selectedCareerPlayer))}</span>
                        <span>{selectedCareerPlayer.team.name}</span>
                        <span>{selectedCareerPlayer.pick.round}라운드 {selectedCareerPlayer.pick.overall}번</span>
                        <span>{selectedCareerPlayer.status}</span>
                      </div>
                      <h3><button className="link-button" onClick={() => setDetailPlayerId(selectedCareerPlayer.playerId)}>{selectedCareerPlayer.prospect.name}</button></h3>
                      <div className="career-player-strip">
                        <span><strong>{selectedCareerPlayer.currentOverall}</strong><small>현재 OVR</small></span>
                        <span><strong>{formatSigned(selectedCareerPlayer.currentOverall - selectedCareerPlayer.initialOverall)}</strong><small>초기 대비</small></span>
                        <span><strong>{selectedCareerPlayer.yearsSinceDraft}년차</strong><small>드래프트 후</small></span>
                        <span><strong>{trackingStatusLabel(selectedCareerPlayer.trackingStatus)}</strong><small>추적 상태</small></span>
                      </div>
                      <ul className="career-log-list">
                        {selectedCareerLog.length === 0 ? <li>아직 공개된 커리어 뉴스가 없습니다.</li> : selectedCareerLog.map((news) => (
                          <li key={news.id}><strong>{news.year}년차 {formatSeasonWeek(news.week)}</strong> {news.headline}</li>
                        ))}
                      </ul>
                    </>
                  ) : selectedUndraftedProspect ? (
                    <>
                      <div className="detail-line">
                        <span className={`pos pos-${selectedUndraftedProspect.primaryPosition}`}>{positionLabel(selectedUndraftedProspect.primaryPosition)}</span>
                        <span>{selectedUndraftedProspect.school}</span>
                        <span>미지명</span>
                      </div>
                      <h3>{selectedUndraftedProspect.name}</h3>
                      <ul className="career-log-list">
                        {selectedCareerLog.map((news) => (
                          <li key={news.id}><strong>{news.year}년차 {formatSeasonWeek(news.week)}</strong> {news.headline}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="empty">뉴스를 클릭하면 해당 선수의 커리어 로그가 표시됩니다.</p>
                  )}
                </aside>
              </div>}
            </section>
            )}
            {trackingSubTab === "manage" && (
            <section className="tracking-section">
              <div className="career-head">
                <div>
                  <h2>드래프트 선수 추적 관리</h2>
                  <p>{careerYear === 0 ? "다음 해 진행 후 1년차 자동 추적 결과를 기준으로 분류할 수 있습니다." : `${careerYear}년차 종료 기준 · 자동/상세/요약/종료 상태 관리`}</p>
                </div>
                <CollapseButton collapsed={isCollapsed("tracking")} onClick={() => toggleCollapsed("tracking")} />
              </div>
              {!isCollapsed("tracking") && (
                <>
                  <div className="tracking-toolbar">
                    <Select
                      label="추적 상태"
                      value={trackingFilter}
                      onChange={(value) => setTrackingFilter(value as TrackingStatus | "all" | "needs-review" | "released")}
                      options={["all", "needs-review", "auto", "follow", "summary", "released"]}
                      labelMap={{ ...TRACKING_STATUS_LABELS, "needs-review": "분류 필요", released: "방출/은퇴" }}
                    />
                    <Select
                      label="연차"
                      value={careerYearBucket}
                      onChange={(value) => setCareerYearBucket(value as CareerYearBucket)}
                      options={["all", "year-1", "year-2-3", "year-4-5", "year-6-10", "year-11-15", "year-16-20", "year-20-plus"]}
                      labelMap={YEAR_BUCKET_LABELS}
                    />
                    <button className="text-button" disabled={careerPlayers.length === 0} onClick={applyTrackingRecommendation}>추천대로 적용</button>
                    <button className="text-button" disabled={careerPlayers.length === 0} onClick={() => applyTrackingRule("early-follow")}>1~3라운드 상세</button>
                    <button className="text-button" disabled={careerPlayers.length === 0} onClick={() => applyTrackingRule("late-summary")}>8~10라운드 요약</button>
                    <button className="text-button" disabled={careerPlayers.length === 0} onClick={() => applyTrackingRule("low-growth-archive")}>저성장 추적 종료</button>
                  </div>
                  {careerPlayers.length === 0 ? (
                    <p className="empty">아직 커리어 추적 대상이 없습니다. 드래프트 종료 후 다음 해를 진행하면 100명의 지명 선수가 자동 추적됩니다.</p>
                  ) : trackingRows.length === 0 ? (
                    <p className="empty">현재 표시할 추적중 선수가 없습니다. 추적 종료한 선수를 다시 보려면 새 추적 추가 탭을 사용하세요.</p>
                  ) : (
                    <div className="standings-wrap tracking-wrap">
                      <table className="tracking-table">
                        <thead>
                          <tr>
                            <TrackingTh label="추적 상태" column="trackingStatus" sortKey={trackingSortKey} direction={trackingSortDirection} onSort={changeTrackingSort} />
                            <TrackingTh label="선수명" column="name" sortKey={trackingSortKey} direction={trackingSortDirection} onSort={changeTrackingSort} />
                            <th>지명연도</th>
                            <TrackingTh label="라운드" column="round" sortKey={trackingSortKey} direction={trackingSortDirection} onSort={changeTrackingSort} />
                            <TrackingTh label="전체" column="overallPick" sortKey={trackingSortKey} direction={trackingSortDirection} onSort={changeTrackingSort} />
                            <TrackingTh label="포지션" column="position" sortKey={trackingSortKey} direction={trackingSortDirection} onSort={changeTrackingSort} />
                            <th>학교</th>
                            <TrackingTh label="초기 OVR" column="initialOverall" sortKey={trackingSortKey} direction={trackingSortDirection} onSort={changeTrackingSort} />
                            <TrackingTh label="현재 OVR" column="currentOverall" sortKey={trackingSortKey} direction={trackingSortDirection} onSort={changeTrackingSort} />
                            <TrackingTh label="변화" column="overallChange" sortKey={trackingSortKey} direction={trackingSortDirection} onSort={changeTrackingSort} />
                            <TrackingTh label="현재 상태" column="status" sortKey={trackingSortKey} direction={trackingSortDirection} onSort={changeTrackingSort} />
                            <th>주요 이벤트</th>
                            <TrackingTh label="추천" column="recommended" sortKey={trackingSortKey} direction={trackingSortDirection} onSort={changeTrackingSort} />
                          </tr>
                        </thead>
                        <tbody>
                          {trackingRows.map((player) => {
                            const recommendation = recommendTrackingStatus(player);
                            const currentUserPlayer = Boolean(userTeamId && player.team.id === userTeamId);
                            const departedUserPlayer = Boolean(userTeamId && player.originalTeamId === userTeamId && player.team.id !== userTeamId);
                            return (
                              <tr key={player.playerId} data-tracking={player.trackingStatus} data-user-player={currentUserPlayer} data-departed-user-player={departedUserPlayer}>
                                <td>
                                  <select className="tracking-select" data-status={player.trackingStatus} value={player.trackingStatus} onChange={(event) => updateTrackingStatus(player.playerId, event.target.value as TrackingStatus)} disabled={player.status === "방출" || player.status === "은퇴" || player.status === "해외진출"}>
                                    <option value="auto">자동 추적</option>
                                    <option value="follow">상세 추적</option>
                                    <option value="summary">요약 추적</option>
                                    <option value="archived">추적 종료</option>
                                  </select>
                                </td>
                                <td className="name-cell">
                                  <button className="link-button" onClick={() => {
                                    setSelectedCareerId(player.playerId);
                                    setDetailPlayerId(player.playerId);
                                  }}>{player.prospect.name}</button>
                                </td>
                                <td className="num">{player.draftYear}</td>
                                <td className="num">{player.pick.round}</td>
                                <td className="num">{player.pick.overall}</td>
                                <td><PositionCell player={player} /></td>
                                <td>{player.prospect.school}</td>
                                <td className="num">{player.initialOverall}</td>
                                <td className="num">{player.currentOverall}</td>
                                <td className="num">{formatSigned(player.currentOverall - player.initialOverall)}</td>
                                <td>{player.status}</td>
                                <td>{shortCareerEvents(player)}</td>
                                <td>{trackingStatusLabel(recommendation)} · {trackingRecommendationReason(player)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="history-panel">
                    <h3>방출/은퇴/해외진출 명단</h3>
                    {releaseRows.length === 0 ? (
                      <p className="empty">아직 방출, 은퇴, 해외진출 처리된 선수가 없습니다. 첫 1년은 모든 지명 선수가 보호됩니다.</p>
                    ) : (
                      <table className="history-table release-table">
                        <thead>
                          <tr>
                            <th>선수명</th>
                            <th>지명연도</th>
                            <th>라운드</th>
                            <th>포지션</th>
                            <th>현재 상태</th>
                            <th>실패 사유</th>
                            <th>마지막 OVR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {releaseRows.map((player) => (
                            <tr key={`release-${player.playerId}`}>
                              <td><button className="link-button" onClick={() => setDetailPlayerId(player.playerId)}>{player.prospect.name}</button></td>
                              <td className="num">{player.draftYear}</td>
                              <td className="num">{player.pick.round}</td>
                              <td><PositionCell player={player} /></td>
                              <td>{player.status}</td>
                              <td>{player.failureReason ?? releaseFailureReason(player)}</td>
                              <td className="num">{player.currentOverall}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </section>
            )}
            {trackingSubTab === "add" && (
            <section className="tracking-section">
              <div className="career-head">
                <div>
                  <h2>새롭게 추적할 선수 추가</h2>
                  <p>추적 종료한 선수 중 다시 볼 만한 선수를 상세 또는 요약 추적으로 되돌립니다.</p>
                </div>
              </div>
              <div className="tracking-toolbar add-toolbar">
                <Select
                  label="연차"
                  value={careerYearBucket}
                  onChange={(value) => setCareerYearBucket(value as CareerYearBucket)}
                  options={["all", "year-1", "year-2-3", "year-4-5", "year-6-10", "year-11-15", "year-16-20", "year-20-plus"]}
                  labelMap={YEAR_BUCKET_LABELS}
                />
                <button className="text-button" onClick={() => setCareerYearBucket("all")}>연차 전체</button>
              </div>
              {trackingAddRows.length === 0 ? (
                <p className="empty">다시 추가할 후보가 없습니다. 추적 종료 상태의 선수가 생기면 여기에 표시됩니다.</p>
              ) : (
                <div className="standings-wrap tracking-wrap">
                  <table className="tracking-table tracking-add-table">
                    <thead>
                      <tr>
                        <th>추적 추가</th>
                        <th>선수명</th>
                        <th>상태</th>
                        <th>소속</th>
                        <th>라운드</th>
                        <th>포지션</th>
                        <th>현재 OVR</th>
                        <th>변화</th>
                        <th>최근 이벤트</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trackingAddRows.map((player) => {
                        const currentUserPlayer = Boolean(userTeamId && player.team.id === userTeamId);
                        const departedUserPlayer = Boolean(userTeamId && player.originalTeamId === userTeamId && player.team.id !== userTeamId);
                        const disabled = player.status === "방출" || player.status === "은퇴" || player.status === "해외진출";
                        return (
                          <tr key={`add-${player.playerId}`} data-tracking={player.trackingStatus} data-user-player={currentUserPlayer} data-departed-user-player={departedUserPlayer}>
                            <td>
                              <div className="inline-actions">
                                <button className="small-button" disabled={disabled} onClick={() => updateTrackingStatus(player.playerId, "follow")}>상세</button>
                                <button className="small-button" disabled={disabled} onClick={() => updateTrackingStatus(player.playerId, "summary")}>요약</button>
                              </div>
                            </td>
                            <td className="name-cell"><button className="link-button" onClick={() => setDetailPlayerId(player.playerId)}>{player.prospect.name}</button></td>
                            <td>{trackingStatusLabel(player.trackingStatus)} · {player.status}</td>
                            <td>{player.team.shortName}</td>
                            <td className="num">{player.pick.round}R</td>
                            <td><PositionCell player={player} /></td>
                            <td className="num">{player.currentOverall}</td>
                            <td className="num">{formatSigned(player.currentOverall - player.initialOverall)}</td>
                            <td>{shortCareerEvents(player)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            )}
            </>
          )}

          {activeTab === "league-history" && (phase === "complete" || hasLeagueHistory) && (
            <section className="season-section">
              <div className="career-head">
                <div>
                  <h2>리그 히스토리</h2>
                  <p>{latestSeasonResults.length === 0 ? "다음 해 진행을 누르면 시즌 순위가 계산됩니다." : `${latestSeasonResults[0]?.seasonYear}시즌 종료 기준`}</p>
                </div>
                <CollapseButton collapsed={isCollapsed("season")} onClick={() => toggleCollapsed("season")} />
              </div>
              {!isCollapsed("season") && (
                <div className="sub-tabs" aria-label="리그 히스토리 하위 탭">
                  <button data-active={leagueHistorySubTab === "current"} onClick={() => setLeagueHistorySubTab("current")}>올해 결과</button>
                  <button data-active={leagueHistorySubTab === "operations"} onClick={() => setLeagueHistorySubTab("operations")}>운영 기록</button>
                  <button data-active={leagueHistorySubTab === "narrative"} onClick={() => setLeagueHistorySubTab("narrative")}>리그 서사</button>
                </div>
              )}
              {!isCollapsed("season") && leagueHistorySubTab === "current" && (
                <div className="narrative-grid">
                  <div className="history-panel">
                    <h3>{latestSeasonResults[0]?.seasonYear ?? displayDraftYear}시즌 최종 순위</h3>
                    {latestSeasonResults.length === 0 ? (
                      <p className="empty">아직 시즌 결과가 없습니다.</p>
                    ) : (
                      <div className="standings-wrap">
                        <table className="standings-table">
                          <thead>
                            <tr>
                              <th>순위</th>
                              <th>구단</th>
                              <th>승-무-패</th>
                              <th>승률</th>
                              <th>전력 점수</th>
                              <th>시즌 성과</th>
                              <th>전년 대비</th>
                              <th>기본</th>
                              <th>드래프트</th>
                              <th>유망주 기여</th>
                              <th>주전 배출</th>
                              <th>부상</th>
                              <th>지명권</th>
                              <th>변동</th>
                              <th>다음 1R</th>
                            </tr>
                          </thead>
                          <tbody>
                            {latestSeasonResults.map((result) => {
                              const team = teams.find((candidate) => candidate.id === result.teamId);
                              const rankChange = result.previousRank ? result.previousRank - result.rank : 0;
                              return (
                                <tr key={`current-${result.seasonYear}-${result.teamId}`} className={result.teamId === userTeamId ? "user-team-row" : ""}>
                                  <td className="num">{result.rank}</td>
                                  <td className="name-cell">{team?.name}</td>
                                  <td className="num">{formatSeasonRecord(result)}</td>
                                  <td className="num">{formatWinningPct(result)}</td>
                                  <td className="num">{formatScore(result.strengthScore)}</td>
                                  <td className="num">{formatScore(result.seasonPerformanceScore)}</td>
                                  <td>{result.previousRank ? formatRankChange(rankChange) : "첫 시즌"}</td>
                                  <td className="num">{formatScore(result.baseStrength)}</td>
                                  <td className="num">{formatSigned(result.draftImpact)}</td>
                                  <td className="num">{formatSigned(result.prospectContribution)}</td>
                                  <td className="num">{formatSigned(result.regularContribution)}</td>
                                  <td className="num">{formatSigned(-result.injuryPenalty)}</td>
                                  <td className="num">{formatSigned(result.pickTradeImpact)}</td>
                                  <td className="num">{formatSigned(result.randomSwing)}</td>
                                  <td className="num">{result.nextFirstRoundPick}순위</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  <div className="history-panel">
                    <h3>포스트시즌 결과</h3>
                    {latestPostseasonRows.length === 0 ? (
                      <p className="empty">시즌 결과가 생기면 와일드카드부터 한국시리즈까지 표시됩니다.</p>
                    ) : (
                      <>
                        <div className="asset-summary">
                          <span>우승 {latestKoreanSeries?.winnerName ?? "-"}</span>
                          <span>준우승 {latestKoreanSeries?.loserName ?? "-"}</span>
                          <span>한국시리즈 {latestKoreanSeries?.scoreText ?? "-"}</span>
                        </div>
                        <table className="history-table postseason-table">
                          <thead>
                            <tr>
                              <th>라운드</th>
                              <th>시리즈</th>
                              <th>승자</th>
                              <th>패자</th>
                              <th>스코어</th>
                              <th>요약</th>
                            </tr>
                          </thead>
                          <tbody>
                            {latestPostseasonRows.map((row) => (
                              <tr key={row.id} className={row.winnerId === userTeamId ? "user-team-row" : row.loserId === userTeamId ? "departed-user-row" : ""}>
                                <td>{row.round}</td>
                                <td>{row.matchup}</td>
                                <td>{row.winnerName}</td>
                                <td>{row.loserName}</td>
                                <td>{row.scoreText}</td>
                                <td>{row.summary}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                </div>
              )}
              {!isCollapsed("season") && leagueHistorySubTab === "operations" && <>
              <div className="history-panel">
                <h3>우리 팀 연도별 변화</h3>
                {userSeasonHistory.length === 0 ? (
                  <p className="empty">우리 팀 시즌 기록이 아직 없습니다.</p>
                ) : (
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>시즌</th>
                        <th>최종 순위</th>
                        <th>승-무-패</th>
                        <th>승률</th>
                        <th>전력 점수</th>
                        <th>시즌 성과</th>
                        <th>다음 1R 순번</th>
                        <th>전년 대비</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userSeasonHistory.map((result) => {
                        const rankChange = result.previousRank ? result.previousRank - result.rank : 0;
                        return (
                          <tr key={`history-${result.seasonYear}`}>
                            <td>{result.seasonYear}</td>
                            <td className="num">{result.rank}</td>
                            <td className="num">{formatSeasonRecord(result)}</td>
                            <td className="num">{formatWinningPct(result)}</td>
                            <td className="num">{formatScore(result.strengthScore)}</td>
                            <td className="num">{formatScore(result.seasonPerformanceScore)}</td>
                            <td className="num">{result.nextFirstRoundPick}순위</td>
                            <td>{result.previousRank ? formatRankChange(rankChange) : "첫 시즌"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="history-panel">
                <h3>다음 드래프트 지명권 관리</h3>
                {nextDraftPicks.length === 0 ? (
                  <p className="empty">시즌 종료 후 다음 드래프트 지명권 현황이 표시됩니다.</p>
                ) : (
                  <>
                    <div className="asset-summary">
                      <span>내 지명권 {userNextDraftPicks.length}장</span>
                      <span>최근 지명권 이동 {latestPickTradeEvents.length}건</span>
                      <span>우리 팀 전력 보정 {formatSigned(teamTradeStrengthAdjustments[String(userTeamId)] ?? 0)}</span>
                    </div>
                    <div className="standings-wrap pick-assets-wrap">
                      <table className="pick-assets-table">
                        <thead>
                          <tr>
                            <th>라운드</th>
                            <th>순번</th>
                            <th>원소속</th>
                            <th>현재 보유</th>
                            <th>상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {nextDraftPicks.map((pick) => {
                            const originalTeam = teams.find((team) => team.id === pick.originalTeamId);
                            const ownerTeam = teams.find((team) => team.id === pick.ownerTeamId);
                            const moved = pick.originalTeamId !== pick.ownerTeamId;
                            return (
                              <tr key={pick.id} className={pick.ownerTeamId === userTeamId ? "user-team-row" : moved ? "traded-pick-row" : ""}>
                                <td className="num">{pick.round}</td>
                                <td className="num">{pick.overall}</td>
                                <td>{originalTeam?.name}</td>
                                <td>{ownerTeam?.name}</td>
                                <td>{moved ? "이동" : "원보유"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
              <div className="history-panel">
                <h3>지명권 트레이드 내역</h3>
                {pickTradeEvents.length === 0 ? (
                  <p className="empty">아직 지명권 트레이드가 없습니다.</p>
                ) : (
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>시즌</th>
                        <th>유형</th>
                        <th>지명권</th>
                        <th>원소속</th>
                        <th>보낸 팀</th>
                        <th>받은 팀</th>
                        <th>우리 팀 전력</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pickTradeEvents.map((event) => {
                        const originalTeam = teams.find((team) => team.id === event.originalTeamId);
                        const fromTeam = teams.find((team) => team.id === event.fromTeamId);
                        const toTeam = teams.find((team) => team.id === event.toTeamId);
                        return (
                          <tr key={event.id}>
                            <td>{event.seasonYear}</td>
                            <td>{pickTradeTypeLabel(event.type)}</td>
                            <td>{event.round}라운드 {event.overall}순위</td>
                            <td>{originalTeam?.shortName}</td>
                            <td>{fromTeam?.shortName}</td>
                            <td>{toTeam?.shortName}</td>
                            <td className="num">{formatSigned(event.userStrengthImpact)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="history-panel">
                <h3>수상 경력 선수 회고</h3>
                {accoladeReview.total === 0 ? (
                  <p className="empty">수상 경력 있는 지명 선수의 커리어 표본이 아직 없습니다.</p>
                ) : (
                  <>
                    <div className="asset-summary">
                      <span>수상 경력 지명 {accoladeReview.total}명</span>
                      <span>성공 {accoladeReview.successes}명</span>
                      <span>실패/정체 {accoladeReview.failures}명</span>
                      <span>성공률 {Math.round((accoladeReview.successes / accoladeReview.total) * 100)}%</span>
                    </div>
                    <table className="history-table">
                      <thead>
                        <tr>
                          <th>사례</th>
                          <th>선수</th>
                          <th>수상/이력</th>
                          <th>현재 상태</th>
                          <th>현재 종합</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accoladeReview.examples.map((player) => (
                          <tr key={`award-review-${player.playerId}`}>
                            <td>{player.overall >= 68 ? "성공 신호" : "오버픽 위험"}</td>
                            <td><button className="link-button" onClick={() => setDetailPlayerId(player.playerId)}>{player.prospect.name}</button></td>
                            <td>{shortAccolades(player.prospect)}</td>
                            <td>{player.status}</td>
                            <td className="num">{player.overall}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
              <div className="history-panel">
                <h3>팬 반응 회고</h3>
                {fanRetrospectives.length === 0 ? (
                  <p className="empty">3년차 이후부터 팬 반응과 실제 커리어를 비교합니다.</p>
                ) : (
                  <div className="retrospective-list">
                    {fanRetrospectives.map((item) => (
                      <article className="retrospective-item" key={item.id}>
                        <span>{item.year}년차 · {item.type}</span>
                        <strong>{item.title}</strong>
                        <p>{item.body}</p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
              </>}
              {!isCollapsed("season") && leagueHistorySubTab === "narrative" && (
                <div className="narrative-grid">
                  <div className="history-panel">
                    <h3>구단별 프랜차이즈 / 명예의전당 / 영구결번</h3>
                    {teamLegacyRows.length === 0 ? (
                      <p className="empty">장기 커리어 표본이 쌓이면 구단별 상징 선수 후보가 표시됩니다.</p>
                    ) : (
                      <table className="history-table legacy-table">
                        <thead>
                          <tr>
                            <th>구단</th>
                            <th>프랜차이즈 스타</th>
                            <th>명예의전당</th>
                            <th>영구결번</th>
                          </tr>
                        </thead>
                        <tbody>
                          {teamLegacyRows.map((row) => (
                            <tr key={`legacy-${row.teamId}`} className={row.teamId === userTeamId ? "user-team-row" : ""}>
                              <td>{row.teamName}</td>
                              <td>{row.franchiseStars.length === 0 ? "-" : row.franchiseStars.map((item) => <LegacyNameButton item={item} key={item.player.playerId} onSelect={setDetailPlayerId} />)}</td>
                              <td>{row.hallOfFame.length === 0 ? "-" : row.hallOfFame.map((item) => <LegacyNameButton item={item} key={`hof-${item.player.playerId}`} suffix={item.confirmed ? "" : " (후보)"} onSelect={setDetailPlayerId} />)}</td>
                              <td>{row.retiredNumbers.length === 0 ? "-" : row.retiredNumbers.map((item) => <LegacyNameButton item={item} key={`num-${item.player.playerId}`} prefix={`#${item.number} `} suffix={item.confirmed ? "" : " (후보)"} onSelect={setDetailPlayerId} />)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="history-panel">
                    <h3>드래프트 회고 뉴스</h3>
                    {draftRegretRecords.length === 0 ? (
                      <p className="empty">올해는 1~2라운드 기준으로 김거김급 회고 사례가 딱히 없습니다.</p>
                    ) : (
                      <div className="retrospective-list">
                        {draftRegretRecords.map((record) => (
                          <article className="retrospective-item" key={record.id}>
                            <span>{record.year}년차 · {record.teamName}</span>
                            <strong>{record.label}</strong>
                            <p>{record.body}</p>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="history-panel">
                    <h3>레코드브레이커</h3>
                    {recordBreakerRows.length === 0 ? (
                      <p className="empty">기존 리그 대기록을 위협할 정도의 압도적인 커리어가 나오면 여기에 남습니다.</p>
                    ) : (
                      <table className="history-table">
                        <thead>
                          <tr>
                            <th>연차</th>
                            <th>구단</th>
                            <th>선수</th>
                            <th>기록</th>
                            <th>희소성</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recordBreakerRows.map((row) => (
                            <tr key={row.id} className={userPlayerRowClass(row.player)}>
                              <td className="num">{row.year}</td>
                              <td>{row.teamName}</td>
                              <td><button className="link-button" onClick={() => setDetailPlayerId(row.player.playerId)}>{row.player.prospect.name}</button></td>
                              <td>{row.record}</td>
                              <td>{row.rarity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="history-panel">
                    <h3>선수 뎁스</h3>
                    {existingTeamSummaries.length === 0 ? (
                      <p className="empty">시즌이 진행되면 구단별 포지션 뎁스가 표시됩니다.</p>
                    ) : (
                      <table className="history-table">
                        <thead>
                          <tr>
                            <th>구단</th>
                            {POSITIONS.map((position) => <th key={`depth-${position}`}>{positionLabel(position)}</th>)}
                            <th>활동 합계</th>
                            <th>기존 활동</th>
                            <th>은퇴</th>
                            <th>방출</th>
                          </tr>
                        </thead>
                        <tbody>
                          {existingTeamSummaries.map((row) => (
                            <tr key={`existing-${row.teamId}`} className={row.teamId === userTeamId ? "user-team-row" : ""}>
                              <td>{row.teamName}</td>
                              {POSITIONS.map((position) => {
                                const depth = row.positionDepth[position] ?? { total: 0, existing: 0 };
                                return <td className="num" key={`${row.teamId}-${position}`}>{depth.total}({depth.existing})</td>;
                              })}
                              <td className="num">{row.activeTotal}</td>
                              <td className="num">{row.existingActive}</td>
                              <td className="num">{row.retired}</td>
                              <td className="num">{row.released}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="history-panel">
                    <h3>연도별 골든글러브 / 타이틀홀더</h3>
                    {yearlyAwardRows.length === 0 ? (
                      <p className="empty">시즌이 진행되면 기존 선수층 또는 드래프트 출신 선수의 주요 수상과 타이틀이 기록됩니다. 실제 후보가 없는 부문은 표시하지 않습니다.</p>
                    ) : (
                      <>
                        <div className="year-button-row">
                          {awardSeasons.map((season) => (
                            <button className="small-button" data-active={activeAwardSeason === season} key={season} onClick={() => setSelectedAwardSeason(season)}>
                              {season}
                            </button>
                          ))}
                        </div>
                        <table className="history-table award-history-table">
                          <thead>
                            <tr>
                              <th>부문</th>
                              <th>구단</th>
                              <th>선수</th>
                              <th>비고</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeAwardGoldGloveRows.map((row) => (
                              <tr key={row.id} className={userLegacyRowClass(row.playerId)}>
                                <td>{row.category}</td>
                                <td>{row.teamName}</td>
                                <td>{row.playerId ? <button className="link-button" onClick={() => row.playerId && setDetailPlayerId(row.playerId)}>{row.playerName}</button> : row.playerName}</td>
                                <td>{row.note}</td>
                              </tr>
                            ))}
                            {activeAwardGoldGloveRows.length > 0 && activeAwardTitleRows.length > 0 && (
                              <tr className="award-section-divider">
                                <td colSpan={4}>타이틀홀더</td>
                              </tr>
                            )}
                            {activeAwardTitleRows.map((row) => (
                              <tr key={row.id} className={userLegacyRowClass(row.playerId)}>
                                <td>{row.category}</td>
                                <td>{row.teamName}</td>
                                <td>{row.playerId ? <button className="link-button" onClick={() => row.playerId && setDetailPlayerId(row.playerId)}>{row.playerName}</button> : row.playerName}</td>
                                <td>{row.note}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>

                  <div className="history-panel">
                    <h3>연도별 올스타</h3>
                    {allStarRows.length === 0 ? (
                      <p className="empty">시즌이 진행되면 드림/나눔 올스타 선발 기록이 쌓입니다.</p>
                    ) : activeAllStarRows.length === 0 ? (
                      <p className="empty">선택한 연도에는 드래프트 출신 올스타 선발자가 없습니다.</p>
                    ) : (
                      <>
                        <div className="year-button-row">
                          {allStarSeasons.map((season) => (
                            <button className="small-button" data-active={activeAllStarSeason === season} key={season} onClick={() => setSelectedAllStarSeason(season)}>
                              {season}
                            </button>
                          ))}
                        </div>
                        <table className="history-table">
                          <thead>
                            <tr>
                              <th>연도</th>
                              <th>구분</th>
                              <th>슬롯</th>
                              <th>구단</th>
                              <th>선수</th>
                              <th>기록</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeAllStarRows.map((row, index) => (
                              <Fragment key={row.id}>
                                {index > 0 && activeAllStarRows[index - 1]?.group !== row.group && (
                                  <tr className="award-section-divider">
                                    <td colSpan={6}>{row.group}</td>
                                  </tr>
                                )}
                                <tr className={userLegacyRowClass(row.playerId)}>
                                  <td className="num">{row.seasonYear}</td>
                                  <td>{row.group}</td>
                                  <td>{row.category ?? "-"}</td>
                                  <td>{row.teamName}</td>
                                  <td>{row.playerId ? <button className="link-button" onClick={() => row.playerId && setDetailPlayerId(row.playerId)}>{row.playerName}</button> : row.playerName}</td>
                                  <td>{row.note}</td>
                                </tr>
                              </Fragment>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>

                  <div className="history-panel">
                    <h3>연도별 국가대표</h3>
                    {nationalTeamRows.length === 0 ? (
                      <p className="empty">2026년부터 아시안게임, WBC, 올림픽 순서로 대표팀 선발 기록이 쌓입니다. 4년 주기 중 한 해는 국제대회가 없습니다.</p>
                    ) : activeNationalTeamRows.length === 0 ? (
                      <p className="empty">선택한 연도에는 국가대표 선발 기록이 없습니다.</p>
                    ) : (
                      <>
                        <div className="year-button-row">
                          {nationalTeamSeasons.map((season) => (
                            <button className="small-button" data-active={activeNationalTeamSeason === season} key={season} onClick={() => setSelectedNationalTeamSeason(season)}>
                              {season}
                            </button>
                          ))}
                        </div>
                        <table className="history-table">
                          <thead>
                            <tr>
                              <th>연도</th>
                              <th>대회/성적</th>
                              <th>구분</th>
                              <th>구단</th>
                              <th>선수</th>
                              <th>기록</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeNationalTeamRows.map((row) => (
                              <tr key={row.id} className={userLegacyRowClass(row.playerId)}>
                                <td className="num">{row.seasonYear}</td>
                                <td>{row.group}</td>
                                <td>{row.category ?? "-"}</td>
                                <td>{row.teamName}</td>
                                <td>{row.playerId ? <button className="link-button" onClick={() => row.playerId && setDetailPlayerId(row.playerId)}>{row.playerName}</button> : row.playerName}</td>
                                <td>{row.note}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {activeTab === "league-history" && phase !== "complete" && !hasLeagueHistory && (
            <section className="fan-section">
              <h2>리그 히스토리</h2>
              <p className="empty">드래프트가 끝나고 시즌을 진행하면 순위, 다음 해 지명권, 트레이드, 리그 회고가 여기에 쌓입니다.</p>
            </section>
          )}

          {activeTab === "review" && phase !== "complete" && (
            <section className="fan-section">
              <h2>결과/회고</h2>
              <p className="empty">드래프트가 끝나면 지명 결과와 직후 반응을 여기서 확인합니다.</p>
            </section>
          )}

          {activeTab === "tracking" && phase !== "complete" && !hasTrackingHistory && (
            <section className="fan-section">
              <h2>선수 추적</h2>
              <p className="empty">드래프트가 끝나고 시즌을 진행하면 뉴스피드, 선수별 커리어 로그, 추적 관리가 여기에 쌓입니다.</p>
            </section>
          )}

          {(activeTab === "draft-room" || activeTab === "scouting") && <section className="controls collapsible-section" aria-label="필터">
            <CollapseButton collapsed={isCollapsed("filters")} onClick={() => toggleCollapsed("filters")} />
            {!isCollapsed("filters") && <>
              <div className="filter-head">
                <div>
                  <h2>선수 탐색 조건</h2>
                  <p>드래프트 룸에서는 기본적으로 올해 지명 대상 후보를 빠르게 좁혀 봅니다.</p>
                </div>
                <span>{visibleProspects.length}명 표시</span>
              </div>
              <Select label="포지션" value={positionFilter} onChange={(value) => setPositionFilter(value as Position | "all")} options={["all", ...POSITIONS]} labelMap={POSITION_LABELS} />
              <Select label="큰 분류" value={playerTypeFilter} onChange={(value) => setPlayerTypeFilter(value as PlayerTypeFilter)} options={["all", "pitchers", "hitters"]} labelMap={PLAYER_TYPE_LABELS} />
              <Select label="출신 구분" value={sourceTypeFilter} onChange={(value) => setSourceTypeFilter(value as ProspectSourceType | "all")} options={["all", "high-school", "college", "overseas-returnee"]} labelMap={SOURCE_TYPE_LABELS} />
              <Select label="학년" value={String(schoolYearFilter)} onChange={(value) => setSchoolYearFilter(value === "all" || value === "eligible" ? value : Number(value) as SchoolYear)} options={["eligible", "all", "3", "2", "1"]} labelMap={{ eligible: "올해 지명 대상", "3": "3학년", "2": "2학년", "1": "1학년" }} />
              <Select label="예상 라운드" value={String(roundFilter)} onChange={(value) => setRoundFilter(value === "all" ? "all" : Number(value))} options={["all", ...ROUNDS.map(String)]} labelMap={ROUND_LABELS} />
              <Select label="리스크 태그" value={riskFilter} onChange={(value) => setRiskFilter(value as ProspectRiskTag | "all")} options={["all", ...RISK_TAGS]} labelMap={RISK_LABELS} />
              <Select label="학교" value={schoolFilter} onChange={setSchoolFilter} options={["all", ...schools]} />
              <Select label="지역" value={regionFilter} onChange={(value) => setRegionFilter(value as SchoolRegion | "all")} options={["all", ...regions]} />
              <Select label="학교 등급" value={schoolTierFilter} onChange={(value) => setSchoolTierFilter(value as SchoolTier | "all")} options={["all", "elite", "strong", "normal", "small"]} labelMap={SCHOOL_TIER_LABELS} />
              <Select label="리그 수준" value={leagueFilter} onChange={(value) => setLeagueFilter(value as LeagueLevel | "all")} options={["all", "전국권", "상위권", "보통", "약한 리그", "정보 부족"]} />
              <Select label="수상/이력" value={accoladeFilter} onChange={setAccoladeFilter} options={["all", ...accoladeOptions]} />
              <button className="text-button" data-active={favoriteOnly} onClick={() => setFavoriteOnly((value) => !value)}>관심 선수만</button>
              <button className="text-button" data-active={activePreset === "none"} onClick={() => setActivePreset("none")}>프리셋 해제</button>
              <div className="preset-row">
                {FILTER_PRESETS.map((preset) => (
                  <button className="small-button" data-active={activePreset === preset.id} key={preset.id} onClick={() => applyFilterPreset(preset.id)}>
                    {preset.label}
                  </button>
                ))}
              </div>
            </>}
          </section>}

          {(activeTab === "draft-room" || activeTab === "scouting") && <section className="workspace collapsible-section">
            <CollapseButton collapsed={isCollapsed("prospects")} onClick={() => toggleCollapsed("prospects")} />
            {!isCollapsed("prospects") && <>
              <div className="prospect-workspace-head">
                <div>
                  <h2>{activeTab === "draft-room" ? "남은 선수 테이블" : "전체 선수 명단"}</h2>
                  <p>{visibleProspects.length}명 표시 · 남은 올해 후보 {availableDraftProspects.length}명 · 정렬 기준 {sortKey}</p>
                </div>
                <div className="prospect-workspace-actions">
                  {selected && (
                    <button className="text-button" onClick={() => openProspectDetail(selected.id)}>
                      선택 선수 상세: {selected.name}
                    </button>
                  )}
                  <button className="text-button" data-active={favoriteOnly} onClick={() => setFavoriteOnly((value) => !value)}>관심만</button>
                  <button className="text-button" onClick={() => applyFilterPreset("top-available")}>남은 최고 랭커</button>
                </div>
              </div>
              <div className="table-zone">
              <table className="prospect-table">
            <thead>
              <tr>
                <th>관심</th>
                <th>보드</th>
                <SortableTh label="순위" column="rank" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <th>이름</th>
                <th>출신</th>
                <th>학년/경력</th>
                <th>예정연도</th>
                <SortableTh label="포지션" column="position" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <th>유형</th>
                <th>학교</th>
                <th>지역</th>
                <th>학교등급</th>
                <th>키</th>
                <th>몸무게</th>
                <th>리그</th>
                <th>대학위험</th>
                <th>투/타</th>
                <SortableTh label="예상R" column="projectedRound" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableTh label="등급" column="scoutGrade" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableTh label="평판" column="reputation" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableTh label="하이프" column="draftHype" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <th>수상/이력</th>
                <SortableTh label="출루장타" column="ops" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableTh label="홈런" column="homeRuns" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableTh label="삼진%" column="strikeoutRate" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableTh label="최고구속" column="maxVelocityKph" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <th>투구폼</th>
                <SortableTh label="탈삼/9" column="strikeoutsPerNine" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableTh label="볼넷/9" column="walksPerNine" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableTh label="수비" column="defensiveGrade" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableTh label="포지션가치" column="positionalValue" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableTh label="위험" column="risk" sortKey={sortKey} direction={sortDirection} onSort={changeSort} />
                <th>비교</th>
              </tr>
            </thead>
            <tbody>
              {visibleProspects.map((prospect) => {
                const isDrafted = draftedIds.has(prospect.id);
                const selection = selections.find((item) => item.prospect.id === prospect.id);
                return (
                <tr key={prospect.id} className={prospect.id === selected?.id ? "selected-row" : ""} data-drafted={isDrafted} onClick={() => openProspectDetail(prospect.id)}>
                  <td>
                    <button className="icon-button" data-active={favorites.has(prospect.id)} disabled={isDrafted} onClick={(event) => { event.stopPropagation(); toggleFavorite(prospect.id); }}>★</button>
                  </td>
                  <td>
                    <button className="icon-button" data-active={bigBoardIds.includes(prospect.id)} disabled={isDrafted} onClick={(event) => { event.stopPropagation(); toggleBigBoard(prospect.id); }}>▲</button>
                  </td>
                  <td className="num">{prospect.visible.publicRank}</td>
                  <td className="name-cell">
                    {prospect.name}
                    {selection && <span className="drafted-inline-badge">{selection.pick.round}R {selection.team.shortName}</span>}
                  </td>
                  <td>{sourceTypeLabel(prospect)}</td>
                  <td>{prospectPathLabel(prospect)}</td>
                  <td className="num">{prospect.draftEligibleYear}</td>
                  <td><span className={`pos pos-${prospect.primaryPosition}`}>{positionLabel(prospect.primaryPosition)}</span></td>
                  <td>{prospect.archetype}</td>
                  <td>{prospect.school}</td>
                  <td>{prospect.schoolRegion}</td>
                  <td>{schoolTierLabel(prospect.schoolTier)}</td>
                  <td className="num">{prospect.physical.heightCm}</td>
                  <td className="num">{prospect.physical.weightKg}</td>
                  <td>{prospect.leagueLevel}</td>
                  <td className="num">{formatPercentFromWhole(prospect.collegeCommitRisk)}</td>
                  <td>{throwsBatsText(prospect)}</td>
                  <td className="num">{formatRange(prospect.visible.projectedRound)}</td>
                  <td><span className={`grade grade-${prospect.visible.scoutGrade}`}>{gradeLabel(prospect.visible.scoutGrade)}</span></td>
                  <td className="num">{prospect.reputation}</td>
                  <td className="num">{prospect.draftHype}</td>
                  <td>{shortAccolades(prospect)}</td>
                  <td className="num">{formatDecimal(prospect.hitterStats?.ops, 3)}</td>
                  <td className="num">{formatNumber(prospect.hitterStats?.homeRuns)}</td>
                  <td className="num">{formatPercent(prospect.hitterStats?.strikeoutRate)}</td>
                  <td className="num">{formatKph(prospect.pitcherStats?.maxVelocityKph)}</td>
                  <td>{armSlotLabel(prospect.pitcherStats?.armSlot)}</td>
                  <td className="num">{formatDecimal(prospect.pitcherStats?.strikeoutsPerNine, 1)}</td>
                  <td className="num">{formatDecimal(prospect.pitcherStats?.walksPerNine, 1)}</td>
                  <td className="num">{formatNumber(prospect.hitterStats?.defensiveGrade)}</td>
                  <td className="num">{formatNumber(positionValue(prospect))}</td>
                  <td><span className={`risk risk-${prospect.visible.riskLevel}`}>{riskText(prospect.visible.riskLevel)}</span></td>
                  <td>
                    <button className="small-button" data-active={compareIds.has(prospect.id)} disabled={isDrafted || (!compareIds.has(prospect.id) && compareIds.size >= 4)} onClick={(event) => { event.stopPropagation(); toggleCompare(prospect.id); }}>
                      {isDrafted ? "지명완료" : "비교"}
                    </button>
                  </td>
                </tr>
              );})}
            </tbody>
              </table>
              </div>

            </>}
          </section>}

          {(activeTab === "draft-room" || activeTab === "scouting") && <section className="comparison">
            <div className="comparison-head">
              <h2>비교 목록</h2>
              <div className="head-actions">
                <button className="text-button" onClick={() => { const next = new Set<string>(); setCompareIds(next); writeStoredSet("draft-sm:compare", next); }}>비우기</button>
                <CollapseButton collapsed={isCollapsed("comparison")} onClick={() => toggleCollapsed("comparison")} />
              </div>
            </div>
            {!isCollapsed("comparison") && (comparedProspects.length === 0 ? (
              <p className="empty">드래프트 중에도 최대 4명까지 비교 목록에 추가할 수 있습니다.</p>
            ) : (
              <ComparisonTable prospects={comparedProspects} onRemove={toggleCompare} />
            ))}
          </section>}

          {prospectDetail && (
            <ProspectDetailModal
              prospect={prospectDetail}
              canDraft={phase === "draft" && !isPickSequenceRunning && currentTeam?.id === userTeamId && isDraftEligibleProspect(prospectDetail, displayDraftYear) && !draftedIds.has(prospectDetail.id)}
              phase={phase}
              onDraft={() => userPick(prospectDetail)}
              onClose={() => setProspectDetailId("")}
            />
          )}

          {detailCareerPlayer && (
            <CareerPlayerModal
              player={detailCareerPlayer}
              news={careerNews.filter((item) => item.playerId === detailCareerPlayer.playerId)}
              awards={yearlyAwardRows.filter((row) => row.playerId === detailCareerPlayer.playerId)}
              records={allRecordBreakerRows.filter((row) => row.player.playerId === detailCareerPlayer.playerId)}
              selectionHonors={[...allStarRows, ...nationalTeamRows].filter((row) => row.playerId === detailCareerPlayer.playerId)}
              onTrackingChange={updateTrackingStatus}
              onNicknameChange={updatePlayerNickname}
              onClose={() => setDetailPlayerId("")}
            />
          )}
        </>
      )}
      {!showStartScreen && phase !== "generating" && (
        <button className="floating-save-button" onClick={saveCurrentJsonFile} title="JSON 세이브 저장 (Ctrl/Cmd+S)">
          저장
        </button>
      )}
    </main>
  );
}

function createPreDraftIntelEvents(year: number, teams: Team[], prospects: Prospect[], userTeamId?: TeamId): DraftIntelEvent[] {
  const eligible = prospects
    .filter((prospect) => isDraftEligibleProspect(prospect, year))
    .sort((left, right) => left.visible.publicRank - right.visible.publicRank);
  const top = eligible.slice(0, 32);
  const userTeam = teams.find((team) => team.id === userTeamId) ?? teams[stableIndex(`${year}-user-team`, teams.length)];
  const outsideTeam = teams.filter((team) => team.id !== userTeam?.id)[stableIndex(`${year}-outside-team`, Math.max(1, teams.length - 1))] ?? teams[0];
  const hypeProspect = top[stableIndex(`${year}-hype`, Math.max(1, top.length))] ?? eligible[0];
  const riskProspect = eligible.find((prospect) => prospect.visible.riskTags.length > 0 && prospect.visible.publicRank <= 90) ?? top[2] ?? eligible[0];
  const mlbProspect = eligible.find((prospect) => prospect.mlbDirectStatus && prospect.visible.publicRank <= 40) ?? top.find((prospect) => prospect.reputation + prospect.draftHype >= 140) ?? top[0];
  const userNeedPosition = topNeedPosition(userTeam);
  const needProspect = eligible.find((prospect) => userNeedPosition && prospect.primaryPosition === userNeedPosition) ?? top[1] ?? eligible[0];
  const outsideNeedPosition = topNeedPosition(outsideTeam);
  const outsideProspect = eligible.find((prospect) => outsideNeedPosition && prospect.primaryPosition === outsideNeedPosition && prospect.visible.publicRank <= 80) ?? top[3] ?? eligible[0];

  const events: DraftIntelEvent[] = [
    {
      id: `intel-${year}-d30-fan`,
      year,
      stage: "D-30",
      type: "팬 여론",
      tone: "neutral",
      headline: `${hypeProspect?.name ?? "상위 후보"} 중심으로 팬 모의지명 과열`,
      body: `${hypeProspect ? prospectShortLine(hypeProspect) : "상위권 후보"}를 두고 팬 커뮤니티와 지역 매체의 언급량이 늘었다. 실제 보드와 여론 보드는 아직 같은 방향이라고 보기 어렵다.`,
      impact: "팬 반응과 드래프트 하이프를 읽는 참고 자료입니다.",
      prospectId: hypeProspect?.id,
      prospectName: hypeProspect?.name,
    },
    {
      id: `intel-${year}-d14-team`,
      year,
      stage: "D-14",
      type: "구단 관심",
      tone: "positive",
      headline: `${userTeam?.shortName ?? "우리 팀"}, ${needProspect?.name ?? "니즈 포지션 후보"} 집중 체크`,
      body: `${userNeedPosition ? positionLabel(userNeedPosition) : "상위 보드"} 보강 필요성이 언급되는 가운데, 현장 스카우트가 ${needProspect?.school ?? "주요 학교"} 경기장을 다시 찾았다는 말이 돈다.`,
      impact: "팀 니즈와 선수 가치가 동시에 언급된 동향입니다. 성공을 보장하지는 않습니다.",
      prospectId: needProspect?.id,
      prospectName: needProspect?.name,
      teamId: userTeam?.id,
      teamName: userTeam?.name,
    },
    {
      id: `intel-${year}-d7-risk`,
      year,
      stage: "D-7",
      type: "리스크 점검",
      tone: riskProspect?.visible.riskLevel === "high" || riskProspect?.visible.riskLevel === "extreme" ? "negative" : "neutral",
      headline: `${riskProspect?.name ?? "상위 후보"} 리스크 재점검`,
      body: `${riskProspect ? prospectShortLine(riskProspect) : "상위 후보"}에 대해 ${riskProspect?.visible.riskTags.length ? shortRiskTags(riskProspect) : "리포트 신뢰도와 실제 툴 검증"} 문제가 다시 거론됐다. 몇몇 구단은 순위보다 특정 지표나 팀 니즈 관점에서 검토할 가능성이 있다.`,
      impact: "리스크 태그와 공개 평판이 충돌하는 후보를 다시 보게 만드는 정보입니다.",
      prospectId: riskProspect?.id,
      prospectName: riskProspect?.name,
    },
    {
      id: `intel-${year}-d1-smoke`,
      year,
      stage: "D-1",
      type: "연막",
      tone: "smoke",
      headline: `${outsideTeam?.shortName ?? "타 구단"}, ${outsideNeedPosition ? positionLabel(outsideNeedPosition) : "상위 후보"} 관심설`,
      body: `${outsideTeam?.shortName ?? "타 구단"}이 ${outsideProspect?.name ?? "복수 후보"} 쪽으로 움직인다는 이야기가 나왔지만, 실제 보드인지 앞 순번 견제인지는 확인되지 않는다.`,
      impact: "CPU 구단 움직임을 해석하는 재료입니다. 연막일 수 있습니다.",
      prospectId: outsideProspect?.id,
      prospectName: outsideProspect?.name,
      teamId: outsideTeam?.id,
      teamName: outsideTeam?.name,
    },
    {
      id: `intel-${year}-day-mlb`,
      year,
      stage: "당일",
      type: "MLB 변수",
      tone: mlbProspect?.mlbDirectStatus ? "negative" : "neutral",
      headline: `${mlbProspect?.name ?? "고교 특급"} 해외 관심 변수`,
      body: `${mlbProspect ? prospectShortLine(mlbProspect) : "상위권 선수"}를 두고 해외 스카우트 체크가 있었다는 말이 남아 있다. 실제 직행 여부와 국내 지명 가치는 끝까지 분리해서 봐야 한다.`,
      impact: "대학/MLB/계약 리스크가 있는 후보를 다시 확인하게 합니다.",
      prospectId: mlbProspect?.id,
      prospectName: mlbProspect?.name,
    },
  ];
  return events.filter((event) => event.headline.trim().length > 0);
}

type PostseasonRow = {
  id: string;
  round: string;
  matchup: string;
  winnerId: TeamId;
  winnerName: string;
  loserId: TeamId;
  loserName: string;
  scoreText: string;
  summary: string;
};

function createPostseasonRows(results: TeamSeasonResult[], teams: Team[]): PostseasonRow[] {
  if (results.length < 5) return [];
  const byRank = [...results].sort((left, right) => left.rank - right.rank);
  const teamName = (teamId: TeamId) => teams.find((team) => team.id === teamId)?.shortName ?? "미정";
  const play = (round: string, higher: TeamSeasonResult, lower: TeamSeasonResult, bestOf: 3 | 5 | 7): PostseasonRow => {
    const higherScore = postseasonPower(higher, round);
    const lowerScore = postseasonPower(lower, round);
    const upset = lowerScore > higherScore;
    const winner = upset ? lower : higher;
    const loser = upset ? higher : lower;
    const maxWin = Math.ceil(bestOf / 2);
    const loserWins = Math.min(maxWin - 1, Math.floor(deterministicNoise(`${round}-${higher.teamId}-${lower.teamId}-score`) * maxWin));
    const scoreText = `${maxWin}-${loserWins}`;
    return {
      id: `postseason-${higher.seasonYear}-${round}-${higher.teamId}-${lower.teamId}`,
      round,
      matchup: `${teamName(higher.teamId)} vs ${teamName(lower.teamId)}`,
      winnerId: winner.teamId,
      winnerName: teamName(winner.teamId),
      loserId: loser.teamId,
      loserName: teamName(loser.teamId),
      scoreText,
      summary: postseasonSummary(round, winner, loser, upset),
    };
  };
  const wildcard = play("와일드카드", byRank[3], byRank[4], 3);
  const wildcardWinner = results.find((result) => result.teamId === wildcard.winnerId) ?? byRank[3];
  const semi = play("준플레이오프", byRank[2], wildcardWinner, 5);
  const semiWinner = results.find((result) => result.teamId === semi.winnerId) ?? byRank[2];
  const playoff = play("플레이오프", byRank[1], semiWinner, 5);
  const playoffWinner = results.find((result) => result.teamId === playoff.winnerId) ?? byRank[1];
  const koreanSeries = play("한국시리즈", byRank[0], playoffWinner, 7);
  return [wildcard, semi, playoff, koreanSeries];
}

function postseasonPower(result: TeamSeasonResult, round: string): number {
  const seedBonus = Math.max(0, 6 - result.rank) * 1.8;
  const lateSeason = result.seasonPerformanceScore * 0.55 + result.strengthScore * 0.45;
  const draftFatigue = Math.max(0, result.prospectContribution) * 0.08 - result.injuryPenalty * 0.25;
  const roundNoise = (deterministicNoise(`${result.seasonYear}-${round}-${result.teamId}`) - 0.5) * 8;
  return lateSeason + seedBonus + draftFatigue + roundNoise;
}

function postseasonSummary(round: string, winner: TeamSeasonResult, loser: TeamSeasonResult, upset: boolean): string {
  if (round === "한국시리즈") {
    return upset
      ? "정규시즌 흐름을 뒤집고 단기전 집중력으로 우승을 가져갔습니다."
      : "정규시즌 1위의 전력 우위를 한국시리즈까지 이어갔습니다.";
  }
  if (upset) return "하위 시드가 전력 격차를 뒤집은 업셋 시리즈입니다.";
  if (winner.seasonPerformanceScore - loser.seasonPerformanceScore >= 7) return "시즌 후반 흐름 차이가 시리즈 결과로 이어졌습니다.";
  return "전력 차이는 크지 않았지만 상위 시드가 시리즈를 관리했습니다.";
}

function preDraftActionLabel(action: PreDraftAction): string {
  const labels: Record<PreDraftAction, string> = {
    "quiet-follow": "비공개 집중 관찰",
    "public-interest": "관심 공개",
    "smoke-screen": "연막 유지",
  };
  return labels[action];
}

function createDraftTimeoutReport(
  year: number,
  pick: DraftPick,
  team: Team,
  selected: Prospect | undefined,
  available: Prospect[],
  topNeeds: Array<{ position: Position; need: number; depth?: { changeReason?: string } }>,
  timeoutNumber: number,
): DraftTimeoutReport {
  const topNeed = topNeeds[0];
  const bestAvailable = [...available].sort((left, right) => left.visible.publicRank - right.visible.publicRank)[0];
  const selectedPositionCount = selected ? available.filter((prospect) => prospect.primaryPosition === selected.primaryPosition).length : 0;
  const needCount = topNeed ? available.filter((prospect) => prospect.primaryPosition === topNeed.position).length : 0;
  const selectedLine = selected
    ? `${selected.name}: ${positionLabel(selected.primaryPosition)} · 전체 ${selected.visible.publicRank}위 · ${formatRange(selected.visible.projectedRound)}R · ${riskText(selected.visible.riskLevel)} 리스크`
    : "선택 후보가 없습니다. 보드 상단과 팀 니즈를 먼저 좁혀야 합니다.";
  const boardLine = bestAvailable
    ? `남은 최고 랭커는 ${bestAvailable.name}(${positionLabel(bestAvailable.primaryPosition)}, 전체 ${bestAvailable.visible.publicRank}위)입니다.`
    : "남은 후보 풀이 비었습니다.";
  const needLine = topNeed
    ? `${team.shortName} 최우선 니즈는 ${positionLabel(topNeed.position)}(${needLevelLabel(topNeed.need)} ${topNeed.need})이고, 해당 포지션 남은 후보는 ${needCount}명입니다.`
    : "뚜렷한 최우선 니즈가 보이지 않아 보드 가치 위주 판단이 필요합니다.";
  const scarcityLine = selected
    ? `${positionLabel(selected.primaryPosition)} 남은 후보는 ${selectedPositionCount}명입니다. 지금 뽑지 않아도 다음 라운드까지 남을지는 포지션 희소성과 앞 팀 니즈에 달려 있습니다.`
    : "후보를 선택하면 포지션 희소성 코멘트를 확인할 수 있습니다.";
  const riskLine = selected
    ? `${selected.name}의 판단 포인트: ${draftReason(selected)} / 수상·이력 ${shortAccolades(selected)}.`
    : "타임은 정답 추천이 아니라 스카우트 회의용 체크리스트입니다.";

  return {
    id: `timeout-${year}-${pick.overall}-${timeoutNumber}`,
    year,
    pickRound: pick.round,
    pickOverall: pick.overall,
    headline: `${timeoutNumber}번째 타임 · ${team.shortName} 회의`,
    focusProspectId: selected?.id,
    lines: [selectedLine, boardLine, needLine, scarcityLine, riskLine],
  };
}

function topNeedPosition(team: Team | undefined): Position | undefined {
  if (!team) return undefined;
  return [...team.needs].sort((left, right) => right.urgency - left.urgency)[0]?.position;
}

function prospectShortLine(prospect: Prospect): string {
  return `${prospect.name}(${positionLabel(prospect.primaryPosition)} · ${prospect.school} · 전체 ${prospect.visible.publicRank}위)`;
}

function stableIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 1000003;
  }
  return Math.abs(hash) % length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function StartScreen({
  scoutName,
  onNameChange,
  onStart,
  onLoad,
}: {
  scoutName: string;
  onNameChange: (value: string) => void;
  onStart: (name: string) => void;
  onLoad: (file: File) => void;
}) {
  const name = scoutName.trim();
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="team-select-modal" role="dialog" aria-modal="true" aria-labelledby="start-title">
        <div className="panel-head">
          <div>
            <h2 id="start-title">스카우터 등록</h2>
            <p>50년 뒤 리그가 당신의 이름과 함께 기억할 드래프트 연대기를 시작합니다.</p>
          </div>
        </div>
        <div className="tracking-toolbar">
          <label className="select-control">
            <span>내 이름</span>
            <input value={scoutName} onChange={(event) => onNameChange(event.target.value)} placeholder="예: 김수호" />
          </label>
          <button className="primary-button" onClick={() => onStart(name || "무명 스카우터")}>처음부터</button>
          <label className="text-button file-load-button">
            불러오기
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onLoad(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        <p className="empty">이름은 50년차 회고 서사와 스카우터 업적 기록에 표시됩니다.</p>
      </section>
    </div>
  );
}

function LegacyEndingModal({ summary, onImmortal, onReincarnate }: { summary: ScoutLegacySummary; onImmortal: () => void; onReincarnate: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="player-detail-modal" role="dialog" aria-modal="true" aria-labelledby="legacy-ending-title">
        <div className="panel-head">
          <div>
            <h2 id="legacy-ending-title">{summary.scoutName}, 50년의 드래프트 연대기</h2>
            <p>{summary.teamName}와 함께 쌓은 시간 · {summary.years}년차 회고</p>
          </div>
        </div>
        <dl className="metric-grid">
          <Metric label="지명 선수" value={`${summary.draftedCount}명`} />
          <Metric label="스타 발굴" value={`${summary.starCount}명`} />
          <Metric label="명전급 후보" value={`${summary.hallCandidates}명`} />
          <Metric label="골든글러브" value={`${summary.goldGloves}회`} />
          <Metric label="타이틀/MVP" value={`${summary.titles + summary.mvps}회`} />
          <Metric label="대기록" value={`${summary.records}개`} />
          <Metric label="우승" value={`${summary.championships}회`} />
        </dl>
        <div className="modal-detail-grid">
          <section className="detail-block">
            <h3>당신이 발굴한 이름들</h3>
            <List values={summary.bestPlayers.map((player) => `${player.prospect.name} · ${player.pick.round}R ${player.pick.overall}번 · 현재 OVR ${player.currentOverall}`)} fallback="아직 리그가 기억할 스타는 많지 않습니다." />
          </section>
          <section className="detail-block">
            <h3>스카우터 연대기</h3>
            <List values={summary.signatureLines} fallback="기록이 더 쌓이면 여기에 업적이 남습니다." />
          </section>
          <section className="detail-block">
            <h3>마지막 문장</h3>
            <p>{summary.closingLine}</p>
          </section>
        </div>
        <div className="tracking-toolbar">
          <button className="primary-button" onClick={onImmortal}>영생을 살며 계속하기</button>
          <button className="text-button" onClick={onReincarnate}>새로운 삶으로 환생</button>
        </div>
      </section>
    </div>
  );
}

function TeamSelectionModal({
  teams,
  initialRank,
  onRankChange,
  onSelect,
}: {
  teams: Team[];
  initialRank: number | "random";
  onRankChange: (rank: number | "random") => void;
  onSelect: (teamId: TeamId, rank: number | "random") => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="team-select-modal" role="dialog" aria-modal="true" aria-labelledby="team-select-title">
        <div className="panel-head">
          <div>
            <h2 id="team-select-title">구단 선택</h2>
            <p>10개 가상 구단 중 하나를 선택하면 팀 니즈, 성향, 전력과 첫 드래프트 순번이 새 커리어마다 조금씩 달라집니다.</p>
          </div>
        </div>
        <div className="start-option-row">
          <label className="filter-control">
            <span>지난 시즌 순위</span>
            <select value={String(initialRank)} onChange={(event) => onRankChange(event.target.value === "random" ? "random" : Number(event.target.value))}>
              <option value="random">자동 배정</option>
              {Array.from({ length: 10 }, (_, index) => index + 1).map((rank) => (
                <option key={rank} value={rank}>{rank}위 시작 · 첫 드래프트 {11 - rank}순위</option>
              ))}
            </select>
          </label>
          <p>10위로 시작하면 첫 드래프트 1순위, 1위로 시작하면 10순위입니다.</p>
        </div>
        <div className="team-grid">
          {teams.map((team) => (
            <button className="team-option" key={team.id} onClick={() => onSelect(team.id, initialRank)}>
              <strong>{team.name}</strong>
              <span>{team.market} · {team.shortName}</span>
              <span>니즈: {team.needs.map((need) => `${positionLabel(need.position)} ${Math.round(need.urgency)}`).join(", ")}</span>
              <span>{team.tendencies.map((tendency) => TENDENCY_LABELS[tendency]).join(" / ")}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function GeneratingModal({ count }: { count: number }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="generating-modal" role="status" aria-live="polite">
        <h2>선수 명단 생성 중</h2>
        <p>올해 드래프트 풀 {count}명을 새로 만들고 있습니다.</p>
        <div className="loading-bar" aria-hidden="true">
          <span />
        </div>
      </section>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return <div className="summary-item"><span>{label}</span><strong>{value}</strong></div>;
}

function CollapseButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <button className="collapse-button" type="button" onClick={onClick} aria-label={collapsed ? "펼치기" : "접기"}>
      {collapsed ? "펼치기" : "접기"}
    </button>
  );
}

function Select({ label, value, onChange, options, labelMap }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labelMap?: Partial<Record<string, string>> }) {
  return (
    <label className="filter-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option === "all" ? "전체" : labelMap?.[option] ?? option}</option>)}
      </select>
    </label>
  );
}

function SortableTh({ label, column, sortKey, direction, onSort }: { label: string; column: SortKey; sortKey: SortKey; direction: SortDirection; onSort: (key: SortKey) => void }) {
  return (
    <th>
      <button className="sort-button" onClick={() => onSort(column)}>
        {label} {sortKey === column ? (direction === "asc" ? "▲" : "▼") : ""}
      </button>
    </th>
  );
}

type RosterMember = {
  id: string;
  name: string;
  overall: number;
  age?: number;
  primaryPosition: Position;
  source: "drafted" | "existing";
  playerId?: ProspectId;
  note: string;
  bullpenRole?: NonNullable<CareerPlayerState["bullpenRole"]>;
  fieldingRole?: NonNullable<CareerPlayerState["fieldingRole"]>;
};

function RosterMemberButton({ member, onSelect }: { member: RosterMember; onSelect: (id: ProspectId) => void }) {
  const note = member.fieldingRole ? `${member.fieldingRole} · ${member.note}` : member.bullpenRole ? `${member.bullpenRole} · ${member.note}` : member.note;
  const content = (
    <>
      <strong>{member.name}</strong>
      <small>OVR {member.overall}{member.age ? ` · ${member.age}세` : ""} · {note}</small>
    </>
  );
  if (member.playerId) {
    return <button className="roster-member" data-source={member.source} onClick={() => onSelect(member.playerId!)}>{content}</button>;
  }
  return <span className="roster-member" data-source={member.source}>{content}</span>;
}

function PositionCell({ player }: { player: CareerPlayerState }) {
  const current = currentPlayerPosition(player);
  return (
    <>
      <span className={`pos pos-${current}`}>{positionLabel(current)}</span>
      {current !== player.prospect.primaryPosition && <small className="position-origin"> {positionLabel(player.prospect.primaryPosition)} 출신</small>}
    </>
  );
}

type WeightedCycle = {
  cycle: SeasonFormCycle;
  weight: number;
};

type TeamCycleSummary = {
  total: SeasonFormCycle;
  hitters: SeasonFormCycle;
  pitchers: SeasonFormCycle;
  lateSeasonGrade: string;
  postseasonFitGrade: string;
  strongMonths: string;
  weakMonths: string;
};

type TeamFanMetrics = {
  popularity: number;
  popularityLabel: string;
  attendanceIndex: number;
  merchandiseIndex: number;
  onlineBuzz: number;
  loyaltyIndex: number;
  momentum: string;
  jerseyRows: JerseySalesRow[];
};

type JerseySalesRow = {
  rank: number;
  player: CareerPlayerState;
  score: number;
  salesShare: number;
  reason: string;
};

type NationalTeamSelectionContext = {
  isAsianGames: boolean;
  wildcardsUsed: number;
  wildcardLimit: number;
};

function TrackingTh({ label, column, sortKey, direction, onSort }: { label: string; column: TrackingSortKey; sortKey: TrackingSortKey; direction: SortDirection; onSort: (key: TrackingSortKey) => void }) {
  return (
    <th>
      <button className="sort-button" onClick={() => onSort(column)}>
        {label} {sortKey === column ? (direction === "asc" ? "▲" : "▼") : ""}
      </button>
    </th>
  );
}

function Metric({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return <><dt>{label}</dt><dd className={className}>{value}</dd></>;
}

function List({ values, fallback }: { values: string[]; fallback: string }) {
  const uniqueValues = uniqueStrings(values);
  return <ul>{uniqueValues.length ? uniqueValues.map((value) => <li key={value}>{value}</li>) : <li>{fallback}</li>}</ul>;
}

function TagList({ values, fallback, variant }: { values: string[]; fallback: string; variant?: "risk" }) {
  const uniqueValues = uniqueStrings(values);
  if (uniqueValues.length === 0) return <p className="empty">{fallback}</p>;
  return (
    <div className="tag-row">
      {uniqueValues.map((value) => <span className={`tag ${variant === "risk" ? "risk-tag" : ""}`} key={value}>{value}</span>)}
    </div>
  );
}

function ProspectHighSchoolTracking({ prospect }: { prospect: Prospect }) {
  const snapshots = [...prospect.highSchoolSnapshots].sort((left, right) => left.schoolYear - right.schoolYear || left.year - right.year);
  const cumulative = createHighSchoolCumulativeStats(snapshots);
  if (snapshots.length === 0) return <p className="empty">아직 고교 추적 기록이 없습니다.</p>;

  return (
    <div className="school-tracking-list">
      <details className="tracking-detail" open>
        <summary>
          <strong>누적</strong>
          <span>{snapshots.length}개 학년 관찰 · {cumulative.primaryLine}</span>
        </summary>
        <div className="tracking-detail-body">
          {cumulative.hitterStats && <HitterLine stats={cumulative.hitterStats} />}
          {cumulative.pitcherStats && <PitcherLine stats={cumulative.pitcherStats} />}
          <List values={prospect.highSchoolCareerLog.map((entry) => `${entry.year}년 ${entry.schoolYear}학년 · ${highSchoolLogTypeLabel(entry.type)} · ${entry.headline}`)} fallback="누적 커리어 로그 없음" />
        </div>
      </details>
      {snapshots.map((snapshot) => {
        const logs = prospect.highSchoolCareerLog.filter((entry) => entry.year === snapshot.year && entry.schoolYear === snapshot.schoolYear);
        return (
          <details className="tracking-detail" key={`${snapshot.year}-${snapshot.schoolYear}`}>
            <summary>
              <strong>{snapshot.schoolYear}학년</strong>
              <span>{snapshot.year}년 · {snapshot.primaryStat} · {snapshot.note}</span>
            </summary>
            <div className="tracking-detail-body">
              <dl className="metric-grid compact-metrics">
                <Metric label="공개순위" value={snapshot.publicRank} />
                <Metric label="등급" value={gradeLabel(snapshot.scoutGrade)} />
                <Metric label="신뢰도" value={formatPercent(snapshot.confidence)} />
                <Metric label="신체" value={`${snapshot.heightCm}cm/${snapshot.weightKg}kg`} />
              </dl>
              {snapshot.hitterStats && <HitterLine stats={snapshot.hitterStats} />}
              {snapshot.pitcherStats && <PitcherLine stats={snapshot.pitcherStats} />}
              <List values={logs.map((entry) => `${highSchoolLogTypeLabel(entry.type)} · ${entry.headline} - ${entry.body}`)} fallback="해당 학년 세부 로그 없음" />
            </div>
          </details>
        );
      })}
    </div>
  );
}

function createHighSchoolCumulativeStats(snapshots: HighSchoolYearSnapshot[]): { primaryLine: string; hitterStats?: HitterStats; pitcherStats?: PitcherStats } {
  const hitterSnapshots = snapshots.map((snapshot) => snapshot.hitterStats).filter((stats): stats is HitterStats => Boolean(stats));
  const pitcherSnapshots = snapshots.map((snapshot) => snapshot.pitcherStats).filter((stats): stats is PitcherStats => Boolean(stats));
  if (pitcherSnapshots.length > 0) {
    const innings = pitcherSnapshots.reduce((total, stats) => total + (stats.innings ?? 0), 0);
    const games = pitcherSnapshots.reduce((total, stats) => total + stats.games, 0);
    const weighted = (value: (stats: PitcherStats) => number | null) => {
      if (innings <= 0) return null;
      return pitcherSnapshots.reduce((total, stats) => total + (value(stats) ?? 0) * (stats.innings ?? 0), 0) / innings;
    };
    const pitcherStats: PitcherStats = {
      ...pitcherSnapshots[pitcherSnapshots.length - 1],
      games,
      innings: roundTo(innings, 1),
      era: roundTo(weighted((stats) => stats.era) ?? 0, 2),
      maxVelocityKph: Math.max(...pitcherSnapshots.map((stats) => stats.maxVelocityKph ?? 0)) || null,
      averageVelocityKph: Math.round(weighted((stats) => stats.averageVelocityKph) ?? 0) || null,
      strikeoutsPerNine: roundTo(weighted((stats) => stats.strikeoutsPerNine) ?? 0, 1),
      walksPerNine: roundTo(weighted((stats) => stats.walksPerNine) ?? 0, 1),
      whip: roundTo(weighted((stats) => stats.whip) ?? 0, 2),
      pitchCount: Math.max(...pitcherSnapshots.map((stats) => stats.pitchCount ?? 0)) || null,
      pitchArsenal: mergePitchArsenal(pitcherSnapshots),
      commandGrade: roundGrade(weighted((stats) => stats.commandGrade) ?? 20),
      starterChance: Math.round(Math.max(...pitcherSnapshots.map((stats) => stats.starterChance ?? 0))) || null,
    };
    pitcherStats.outPitch = strongestVisiblePitch(pitcherStats);
    return { primaryLine: highSchoolPrimarySummary({ pitcherStats }), pitcherStats };
  }
  if (hitterSnapshots.length > 0) {
    const plateAppearances = hitterSnapshots.reduce((total, stats) => total + stats.plateAppearances, 0);
    const games = hitterSnapshots.reduce((total, stats) => total + stats.games, 0);
    const weighted = (value: (stats: HitterStats) => number | null) => {
      if (plateAppearances <= 0) return null;
      return hitterSnapshots.reduce((total, stats) => total + (value(stats) ?? 0) * stats.plateAppearances, 0) / plateAppearances;
    };
    const hitterStats: HitterStats = {
      ...hitterSnapshots[hitterSnapshots.length - 1],
      games,
      plateAppearances,
      average: roundTo(weighted((stats) => stats.average) ?? 0, 3),
      onBase: roundTo(weighted((stats) => stats.onBase) ?? 0, 3),
      slugging: roundTo(weighted((stats) => stats.slugging) ?? 0, 3),
      ops: 0,
      homeRuns: hitterSnapshots.reduce((total, stats) => total + (stats.homeRuns ?? 0), 0),
      doubles: hitterSnapshots.reduce((total, stats) => total + (stats.doubles ?? 0), 0),
      stolenBases: hitterSnapshots.reduce((total, stats) => total + (stats.stolenBases ?? 0), 0),
      strikeoutRate: roundTo(weighted((stats) => stats.strikeoutRate) ?? 0, 3),
      walkRate: roundTo(weighted((stats) => stats.walkRate) ?? 0, 3),
      defensiveGrade: roundGrade(weighted((stats) => stats.defensiveGrade) ?? 20),
      athleticismGrade: roundGrade(weighted((stats) => stats.athleticismGrade) ?? 20),
    };
    hitterStats.ops = roundTo((hitterStats.onBase ?? 0) + (hitterStats.slugging ?? 0), 3);
    return { primaryLine: highSchoolPrimarySummary({ hitterStats }), hitterStats };
  }
  return { primaryLine: "누적 세부 기록 없음" };
}

function highSchoolPrimarySummary(prospect: Pick<Prospect, "hitterStats" | "pitcherStats">): string {
  if (prospect.pitcherStats) return `ERA ${formatDecimal(prospect.pitcherStats.era, 2)} · ${formatDecimal(prospect.pitcherStats.innings, 1)}이닝`;
  if (prospect.hitterStats) return `OPS ${formatDecimal(prospect.hitterStats.ops, 3)} · ${formatNumber(prospect.hitterStats.homeRuns)}홈런`;
  return "기록 없음";
}

function visibleWeaknessesWithoutRiskDuplicates(prospect: Prospect): string[] {
  const riskLabels = prospect.visible.riskTags.map((tag) => RISK_LABELS[tag]);
  return prospect.visible.weaknesses.filter((weakness) => !riskLabels.some((label) => weakness === label || weakness.includes(label) || label.includes(weakness)));
}

function LegacyNameButton({ item, prefix = "", suffix = "", onSelect }: { item: LegacyPlayerItem; prefix?: string; suffix?: string; onSelect: (id: ProspectId) => void }) {
  return (
    <button className="link-button inline-name legacy-name-button" onClick={() => onSelect(item.player.playerId)}>
      {prefix}{item.player.prospect.name}<span className="legacy-nickname"> {item.nickname}</span>{suffix}
    </button>
  );
}

function AidPanel({ title, prospects, onSelect, showReason = false }: { title: string; prospects: Prospect[]; onSelect: (id: string) => void; showReason?: boolean }) {
  return (
    <div className="aid-panel">
      <h3>{title}</h3>
      {prospects.length === 0 ? (
        <p className="empty">해당 후보 없음</p>
      ) : (
        <div className="aid-list">
          {prospects.map((prospect) => (
            <button key={prospect.id} onClick={() => onSelect(prospect.id)}>
              <span className="num">{prospect.visible.publicRank}</span>
              <strong>{prospect.name}</strong>
              <span className={`pos pos-${prospect.primaryPosition}`}>{positionLabel(prospect.primaryPosition)}</span>
              <small>{formatRange(prospect.visible.projectedRound)}R · {gradeLabel(prospect.visible.scoutGrade)} · {prospect.archetype}</small>
              {showReason && <small className="aid-reason">{draftReason(prospect)}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BigBoardPanel({
  prospects,
  draftedIds,
  onSelect,
  onMove,
  onRemove,
}: {
  prospects: Prospect[];
  draftedIds: Set<string>;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="aid-panel bigboard-panel">
      <h3>내 빅보드</h3>
      {prospects.length === 0 ? (
        <p className="empty">테이블의 ▲ 버튼으로 후보를 추가합니다.</p>
      ) : (
        <div className="bigboard-list">
          {prospects.map((prospect, index) => {
            const drafted = draftedIds.has(prospect.id);
            return (
              <div className="bigboard-row" data-drafted={drafted} key={prospect.id}>
                <span className="num">{index + 1}</span>
                <button className="link-button" onClick={() => onSelect(prospect.id)}>{prospect.name}</button>
                <span className={`pos pos-${prospect.primaryPosition}`}>{positionLabel(prospect.primaryPosition)}</span>
                <span>{drafted ? "지명 완료" : "남아 있음"}</span>
                <button className="mini-button" disabled={index === 0} onClick={() => onMove(prospect.id, -1)}>↑</button>
                <button className="mini-button" disabled={index === prospects.length - 1} onClick={() => onMove(prospect.id, 1)}>↓</button>
                <button className="mini-button" onClick={() => onRemove(prospect.id)}>삭제</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RemainingSummaryPanel({ summary }: { summary: RemainingPoolSummary }) {
  return (
    <div className="aid-panel">
      <h3>남은 선수 요약</h3>
      <div className="summary-matrix">
        <span>수상 경력</span><strong>{summary.awarded}</strong>
        <span>신뢰도 A/B</span><strong>{summary.highConfidence}</strong>
        <span>대학 리스크</span><strong>{summary.collegeRisk}</strong>
        {Object.entries(summary.byRound).map(([round, count]) => (
          <Fragment key={round}>
            <span>{round}</span>
            <strong>{count}</strong>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function RoundNotePanel({ currentRound, notes, onChange }: { currentRound: number; notes: Record<number, string>; onChange: (round: number, value: string) => void }) {
  return (
    <div className="aid-panel round-note-panel">
      <h3>라운드별 메모</h3>
      <label>
        <span>{currentRound}라운드 전략</span>
        <textarea value={notes[currentRound] ?? ""} onChange={(event) => onChange(currentRound, event.target.value)} placeholder="예: 6라운드 이후 좌완 성장형 투수 찾기" />
      </label>
      <div className="note-list">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((round) => (
          <span key={round} data-active={round === currentRound}>
            {round}R {notes[round] ? notes[round] : "-"}
          </span>
        ))}
      </div>
    </div>
  );
}

function NewsButton({ news, onSelect }: { news: CareerNewsItem; onSelect: (id: ProspectId) => void }) {
  return (
    <button className="news-item" data-emphasis={news.emphasis ?? "normal"} data-grade={news.grade} data-sentiment={newsSentiment(news)} onClick={() => news.playerId && onSelect(news.playerId)}>
      <span>{news.year}년차 {formatSeasonWeek(news.week)} · {NEWS_GRADE_LABELS[news.grade]} · {news.type} · 중요도 {news.importance}</span>
      <strong>{news.headline}</strong>
      <p>{news.body}</p>
      {news.teamName && <small>{news.teamName}</small>}
    </button>
  );
}

function PlayerNewsTimeline({ news, prospects, players, onSelect }: { news: CareerNewsItem[]; prospects: Prospect[]; players: CareerPlayerState[]; onSelect: (id: ProspectId) => void }) {
  const groups = groupNewsByPlayer(news, prospects, players);
  if (groups.length === 0) return <p className="empty">선수와 연결된 뉴스가 아직 없습니다.</p>;

  return (
    <div className="player-news-list">
      {groups.map((group) => (
        <section className="player-news-group" key={group.playerId}>
          <button className="player-news-head" onClick={() => onSelect(group.playerId)}>
            <strong>{group.name}</strong>
            <span>{group.meta}</span>
          </button>
          <div className="player-news-events">
            {group.items.map((item) => (
              <button className="player-news-event" data-emphasis={item.emphasis ?? "normal"} data-grade={item.grade} data-sentiment={newsSentiment(item)} key={item.id} onClick={() => onSelect(group.playerId)}>
                <span>{item.year}년차 {formatSeasonWeek(item.week)} · {NEWS_GRADE_LABELS[item.grade]} · {item.type}</span>
                <strong>{item.headline}</strong>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProspectDetailModal({
  prospect,
  canDraft,
  phase,
  onDraft,
  onClose,
}: {
  prospect: Prospect;
  canDraft: boolean;
  phase: DraftPhase;
  onDraft: () => void;
  onClose: () => void;
}) {
  const [activeProspectTab, setActiveProspectTab] = useState<"overview" | "report" | "tracking" | "risk">("overview");
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="player-detail-modal" role="dialog" aria-modal="true" aria-labelledby="prospect-detail-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <div>
            <h2 id="prospect-detail-title">{prospect.name}</h2>
            <p>{positionLabel(prospect.primaryPosition)} · {prospect.school} · {prospectDraftPathSummary(prospect)} · {prospect.physical.heightCm}cm/{prospect.physical.weightKg}kg</p>
          </div>
          <button className="text-button" onClick={onClose}>닫기</button>
        </div>
        <div className="detail-line">
          <span className={`pos pos-${prospect.primaryPosition}`}>{positionLabel(prospect.primaryPosition)}</span>
          <span>{throwsBatsText(prospect)}</span>
          <span>{prospect.schoolRegion}</span>
          <span>{schoolTierLabel(prospect.schoolTier)}</span>
          <span>{prospect.leagueLevel}</span>
          <span>{sourceTypeLabel(prospect)}</span>
          <span>{prospect.draftEligibleYear}년 드래프트 예정</span>
          {prospect.mlbDirectStatus && <span>{mlbDirectLabel(prospect)}</span>}
        </div>
        <button className="primary-button full-width" disabled={!canDraft} onClick={onDraft}>
          {canDraft ? "이 선수 지명" : phase === "complete" ? "드래프트 종료" : "내 차례가 아닙니다"}
        </button>
        <div className="modal-tabs" aria-label="유망주 상세 탭">
          <button data-active={activeProspectTab === "overview"} onClick={() => setActiveProspectTab("overview")}>개요</button>
          <button data-active={activeProspectTab === "report"} onClick={() => setActiveProspectTab("report")}>기록/리포트</button>
          <button data-active={activeProspectTab === "tracking"} onClick={() => setActiveProspectTab("tracking")}>고교추적</button>
          <button data-active={activeProspectTab === "risk"} onClick={() => setActiveProspectTab("risk")}>리스크/관심</button>
        </div>
        {activeProspectTab === "overview" && (
          <div className="modal-detail-grid">
            <section className="detail-block">
              <h3>핵심 지표</h3>
              <dl className="metric-grid">
                <Metric label="예상 라운드" value={formatRange(prospect.visible.projectedRound)} />
                <Metric label="출신 구분" value={sourceTypeLabel(prospect)} />
                <Metric label="학년/경력" value={prospectPathLabel(prospect)} />
                <Metric label="드래프트 예정연도" value={prospect.draftEligibleYear} />
                <Metric label="스카우트 등급" value={gradeLabel(prospect.visible.scoutGrade)} />
                <Metric label="평판" value={prospect.reputation} />
                <Metric label="드래프트 하이프" value={prospect.draftHype} />
                <Metric label="MLB 변수" value={mlbDirectLabel(prospect)} />
                <Metric label="유형" value={prospect.archetype} />
                <Metric label="리포트 신뢰도" value={`${Math.round(prospect.visible.confidence * 100)}%`} />
              </dl>
            </section>
            <section className="detail-block">
              <h3>학교 정보</h3>
              <p>{schoolProfileText(prospect)}</p>
              {prospect.sourceType !== "high-school" && <p>{prospectDraftPathSummary(prospect)}</p>}
              <p>특성: {prospect.schoolTraits.map(schoolTraitLabel).join(", ") || "-"}</p>
              <dl className="metric-grid compact-metrics">
                <Metric label="리그 수준" value={prospect.leagueLevel} />
                <Metric label="학교 지역" value={prospect.schoolRegion} />
                <Metric label="학교 등급" value={schoolTierLabel(prospect.schoolTier)} />
                <Metric label="학교 리그지수" value={prospect.schoolLeagueStrength} />
              </dl>
            </section>
            <section className="detail-block">
              <h3>수상 / 이력</h3>
              {prospect.accolades.length === 0 ? <p className="empty">수상 이력 없음</p> : (
                <ul className="award-list">
                  {prospect.accolades.map((award) => (
                    <li className="award-item" key={award.id}>
                      <strong>{award.label}</strong>
                      <span>{award.meaning}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
        {activeProspectTab === "report" && (
          <div className="modal-detail-grid">
            <section className="detail-block">
              <h3>주요 기록</h3>
              {prospect.pitcherStats ? <PitcherLine stats={prospect.pitcherStats} /> : <HitterLine stats={prospect.hitterStats} />}
            </section>
            <section className="detail-block">
              <h3>{prospect.pitcherStats ? "투구 사이클" : "타격 사이클"}</h3>
              <SeasonCycleChart cycle={prospect.seasonFormCycle ?? fallbackSeasonFormCycle(prospect)} />
            </section>
            <section className="detail-block">
              <h3>스카우트 리포트</h3>
              <p>{prospect.visible.summary}</p>
              <p>{prospect.visible.growthProjection}</p>
              <p>{prospect.visible.oneLine}</p>
            </section>
          </div>
        )}
        {activeProspectTab === "tracking" && (
          <div className="modal-detail-grid">
            <section className="detail-block wide-detail-block">
              <h3>고교 추적</h3>
              <ProspectHighSchoolTracking prospect={prospect} />
            </section>
          </div>
        )}
        {activeProspectTab === "risk" && (
          <div className="modal-detail-grid">
            <section className="detail-block">
              <h3>리스크</h3>
              <dl className="metric-grid">
                <Metric label="위험도" value={riskText(prospect.visible.riskLevel)} />
                <Metric label="대학 진학 위험" value={formatPercentFromWhole(prospect.collegeCommitRisk)} />
              </dl>
              <h3 className="detail-subhead">리스크 태그</h3>
              <TagList values={prospect.visible.riskTags.map((tag) => RISK_LABELS[tag])} fallback="주요 리스크 태그 없음" variant="risk" />
            </section>
            <section className="detail-block">
              <h3>구단 관심도</h3>
              <List values={prospect.visible.teamInterest} fallback="뚜렷한 관심 구단 정보 없음" />
            </section>
            <section className="detail-block">
              <h3>강점</h3>
              <List values={prospect.visible.strengths} fallback="공개된 강점 정보 없음" />
            </section>
            <section className="detail-block">
              <h3>약점</h3>
              <List values={visibleWeaknessesWithoutRiskDuplicates(prospect)} fallback="공개된 약점 정보 없음" />
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function CareerPlayerModal({
  player,
  news,
  awards,
  records,
  selectionHonors,
  onTrackingChange,
  onNicknameChange,
  onClose,
}: {
  player: CareerPlayerState;
  news: CareerNewsItem[];
  awards: YearlyAwardRow[];
  records: RecordBreakerRow[];
  selectionHonors: SelectionHistoryRow[];
  onTrackingChange: (playerId: ProspectId, status: TrackingStatus) => void;
  onNicknameChange: (playerId: ProspectId, nickname: string) => void;
  onClose: () => void;
}) {
  const [activeModalTab, setActiveModalTab] = useState<CareerModalTab>("tracking");
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState(player.customNickname ?? "");
  const ordered = orderedNews(news);
  const ovrChange = player.currentOverall - player.initialOverall;
  const achievement = createPlayerAchievementSummary(player, awards, records, news, selectionHonors);
  const modalNickname = createPlayerNickname(player, player.team);
  useEffect(() => {
    setNicknameDraft(player.customNickname ?? "");
    setEditingNickname(false);
  }, [player.playerId, player.customNickname]);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="player-detail-modal" role="dialog" aria-modal="true" aria-labelledby="player-detail-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <div>
            <h2 id="player-detail-title">{player.prospect.name}</h2>
            <p>{player.team.name} · {positionLabel(currentPlayerPosition(player))}{currentPlayerPosition(player) !== player.prospect.primaryPosition ? `(${positionLabel(player.prospect.primaryPosition)} 출신)` : ""} · {player.prospect.school} · {careerAge(player)}세 · {player.draftYear}년 {player.pick.round}라운드 {player.pick.overall}순위 지명</p>
          </div>
          <button className="text-button" onClick={onClose}>닫기</button>
        </div>
        <div className="detail-line">
          <span className={`pos pos-${currentPlayerPosition(player)}`}>{positionLabel(currentPlayerPosition(player))}</span>
          <span>{throwsBatsText(player.prospect)}</span>
          <span>{player.team.name}</span>
          <span>{player.status}</span>
          {currentPlayerPosition(player) !== player.prospect.primaryPosition && <span>{positionLabel(player.prospect.primaryPosition)} 출신</span>}
          {player.bullpenRole && <span>{player.bullpenRole}</span>}
          {player.fieldingRole && <span>{player.fieldingRole}</span>}
          <span>{player.yearsSinceDraft}년차</span>
          <span>{player.pick.round}라운드 {player.pick.overall}순위</span>
          <span>초기 OVR {player.initialOverall}</span>
          <span>현재 OVR {player.currentOverall}</span>
          <span>변화 {formatSigned(ovrChange)}</span>
          <span>{trackingStatusLabel(player.trackingStatus)}</span>
        </div>
        <div className="career-modal-actions">
          <div className="career-modal-control">
            <span>별명</span>
            <div className="nickname-editor">
              {editingNickname ? (
                <>
                  <input value={nicknameDraft} onChange={(event) => setNicknameDraft(event.target.value)} placeholder={modalNickname} />
                  <button className="small-button" onClick={() => {
                    onNicknameChange(player.playerId, nicknameDraft);
                    setEditingNickname(false);
                  }}>저장</button>
                  <button className="small-button" onClick={() => {
                    setNicknameDraft(player.customNickname ?? "");
                    setEditingNickname(false);
                  }}>취소</button>
                </>
              ) : (
                <>
                  <strong>{modalNickname}</strong>
                  <button className="small-button" onClick={() => setEditingNickname(true)}>편집</button>
                </>
              )}
            </div>
          </div>
          <label className="career-modal-control">
            <span>추적 상태</span>
            <select
              className="tracking-select"
              data-status={player.trackingStatus}
              value={player.trackingStatus}
              onChange={(event) => onTrackingChange(player.playerId, event.target.value as TrackingStatus)}
              disabled={player.status === "방출" || player.status === "은퇴" || player.status === "해외진출"}
            >
              <option value="auto">자동 추적</option>
              <option value="follow">상세 추적</option>
              <option value="summary">요약 추적</option>
              <option value="archived">추적 종료</option>
            </select>
          </label>
        </div>
        <div className="modal-tabs" aria-label="선수 상세 탭">
          <button data-active={activeModalTab === "tracking"} onClick={() => setActiveModalTab("tracking")}>추적 관찰</button>
          <button data-active={activeModalTab === "pro"} onClick={() => setActiveModalTab("pro")}>프로 성적</button>
        </div>
        {activeModalTab === "tracking" ? (
          <div className="modal-detail-grid">
            <section className="detail-block">
              <h3>현재 평가</h3>
              <p>{careerEvaluationText(player)}</p>
              <dl className="metric-grid compact-metrics">
                <Metric label="초기 OVR" value={player.initialOverall} />
                <Metric label="현재 OVR" value={player.currentOverall} />
                <Metric label="OVR 변화" value={formatSigned(ovrChange)} />
                <Metric label="프로 연차" value={`${player.yearsSinceDraft}년차`} />
                <Metric label="현재 상태" value={player.status} />
                <Metric label="병역" value={militaryStatusText(player)} />
              </dl>
            </section>
            <section className="detail-block">
              <h3>현재 세부 능력</h3>
              <ToolLine player={player} />
            </section>
            <section className="detail-block">
              <h3>고교 시점 공개 데이터</h3>
              {player.prospect.pitcherStats ? <PitcherLine stats={player.prospect.pitcherStats} /> : <HitterLine stats={player.prospect.hitterStats} />}
              <dl className="metric-grid compact-metrics">
                <Metric label="스카우트 등급" value={gradeLabel(player.prospect.visible.scoutGrade)} />
                <Metric label="예상 라운드" value={formatRange(player.prospect.visible.projectedRound)} />
                <Metric label="리포트 신뢰도" value={`${Math.round(player.prospect.visible.confidence * 100)}%`} />
                <Metric label="위험도" value={riskText(player.prospect.visible.riskLevel)} />
              </dl>
            </section>
            <section className="detail-block">
              <h3>리스크 / 이력</h3>
              <p>리스크: {shortRiskTags(player.prospect)}</p>
              <p>수상/이력: {shortAccolades(player.prospect)}</p>
              {player.failureReason && <p>실패 사유: {player.failureReason}</p>}
            </section>
            <section className="detail-block">
              <h3>소속 변화</h3>
              <List values={player.transactionLog} fallback="소속 변화 없음" />
            </section>
            <section className="detail-block">
              <h3>커리어 로그</h3>
              {ordered.length === 0 ? (
                <p className="empty">아직 공개된 커리어 뉴스가 없습니다.</p>
              ) : (
                <ul className="career-log-list modal-log-list">
                  {ordered.map((item) => (
                    <li key={item.id}><strong>{item.year}년차 {formatSeasonWeek(item.week)}</strong> {item.headline}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : (
          <div className="modal-detail-grid">
            <section className="detail-block">
              <h3>프로 성과 요약</h3>
              <dl className="metric-grid compact-metrics">
                <Metric label="골든글러브" value={`${achievement.goldGloves}개`} />
                <Metric label="타이틀홀더" value={`${achievement.titles}개`} />
                <Metric label="MVP" value={`${achievement.mvps}개`} />
                <Metric label="신인왕" value={achievement.rookieAwards > 0 ? "수상" : "-"} />
                <Metric label="대기록" value={`${achievement.records}개`} />
                <Metric label="올스타" value={`${achievement.allStars}회`} />
                <Metric label="국가대표" value={`${achievement.nationalTeams}회`} />
                <Metric label="대표 성과" value={achievement.topLine} />
              </dl>
            </section>
            <section className="detail-block">
              <h3>수상 / 타이틀</h3>
              <List values={achievement.awardLines} fallback="아직 주요 수상 또는 타이틀 없음" />
            </section>
            <section className="detail-block">
              <h3>대기록</h3>
              <List values={achievement.recordLines} fallback="아직 레코드브레이커 기록 없음" />
            </section>
            <section className="detail-block">
              <h3>프로 주요 뉴스</h3>
              <List values={achievement.newsLines} fallback="아직 프로 성과 관련 뉴스 없음" />
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function HitterLine({ stats }: { stats?: HitterStats }) {
  if (!stats) return <p>타자 기록 없음</p>;
  return <p>타율 {formatDecimal(stats.average, 3)} · 출루율 {formatDecimal(stats.onBase, 3)} · 장타율 {formatDecimal(stats.slugging, 3)} · 출루장타 {formatDecimal(stats.ops, 3)} · 홈런 {formatNumber(stats.homeRuns)} · 2루타 {formatNumber(stats.doubles)} · 삼진율 {formatPercent(stats.strikeoutRate)} · 볼넷율 {formatPercent(stats.walkRate)} · 수비 {formatNumber(stats.defensiveGrade)}</p>;
}

function SeasonCycleChart({ cycle }: { cycle: SeasonFormCycle }) {
  const width = 360;
  const height = 118;
  const left = 28;
  const right = 12;
  const top = 12;
  const bottom = 24;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const xStep = innerWidth / Math.max(1, cycle.points.length - 1);
  const yFor = (value: number) => top + (1 - (value - 25) / 60) * innerHeight;
  const points = cycle.points.map((point, index) => ({
    ...point,
    x: left + index * xStep,
    y: yFor(point.value),
  }));
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const strongMonths = points.filter((point) => point.value >= 60).map((point) => `${point.month}월`);
  const weakMonths = points.filter((point) => point.value <= 45).map((point) => `${point.month}월`);
  return (
    <div className="season-cycle">
      <div className="season-cycle-head">
        <strong>{seasonCyclePatternLabel(cycle.pattern)}</strong>
        <span>신뢰도 {Math.round(cycle.reliability * 100)}% · 유지력 {cycle.staminaSignal} · 후반 집중도 {cycle.clutchSignal}</span>
      </div>
      <svg className="season-cycle-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${cycle.kind === "pitcher" ? "투구" : "타격"} 월별 사이클`}>
        {[35, 50, 65].map((line) => (
          <g key={line}>
            <line x1={left} x2={width - right} y1={yFor(line)} y2={yFor(line)} />
            <text x={4} y={yFor(line) + 4}>{line === 65 ? "강" : line === 50 ? "보" : "약"}</text>
          </g>
        ))}
        <polyline points={polyline} />
        {points.map((point) => (
          <g key={point.month}>
            <circle cx={point.x} cy={point.y} r={3.4} />
            <text className="month-label" x={point.x} y={height - 5}>{point.month}</text>
          </g>
        ))}
      </svg>
      <div className="season-cycle-summary">
        <span>강세: {strongMonths.length ? strongMonths.join(", ") : "뚜렷하지 않음"}</span>
        <span>약세: {weakMonths.length ? weakMonths.join(", ") : "뚜렷하지 않음"}</span>
      </div>
      <p>{cycle.report}</p>
    </div>
  );
}

function seasonCyclePatternLabel(pattern: SeasonFormCycle["pattern"]): string {
  const labels: Record<SeasonFormCycle["pattern"], string> = {
    steady: "안정형",
    "early-peak": "초반 강세형",
    "summer-slump": "여름 하락형",
    "late-surge": "후반 상승형",
    volatile: "기복형",
    "stamina-fade": "체력 저하형",
    rebound: "반등형",
  };
  return labels[pattern];
}

function fallbackSeasonFormCycle(prospect: Prospect): SeasonFormCycle {
  const kind = prospect.pitcherStats ? "pitcher" : "hitter";
  const base = prospect.visible.publicRank <= 60 ? 56 : prospect.visible.publicRank <= 180 ? 50 : 46;
  const points = ([3, 4, 5, 6, 7, 8, 9, 10] as const).map((month, index) => ({
    month,
    value: Math.round(clampNumber(base + (index >= 6 ? 2 : 0) - (index === 5 ? 3 : 0), 25, 85)),
  }));
  return {
    kind,
    pattern: "steady",
    points,
    reliability: Math.max(0.28, Math.min(0.72, prospect.visible.confidence)),
    staminaSignal: 50,
    clutchSignal: 50,
    report: "이전 저장 데이터에는 월별 사이클이 없어 현재 공개 순위와 리포트 신뢰도를 바탕으로 보수적인 안정형 추정치를 표시합니다.",
  };
}

function createPlayerAchievementSummary(player: CareerPlayerState, awards: YearlyAwardRow[], records: RecordBreakerRow[], news: CareerNewsItem[], selectionHonors: SelectionHistoryRow[] = []) {
  const goldGloveRows = awards.filter((row) => row.category.startsWith("골든글러브"));
  const mvpRows = awards.filter((row) => row.category === "MVP");
  const titleRows = awards.filter((row) => !row.category.startsWith("골든글러브") && row.category !== "MVP");
  const rookieAwards = player.eventKeys.includes("rookie-award") || news.some((item) => item.type === "신인왕 수상") ? 1 : 0;
  const allStarStoredLines = uniqueStrings([
    ...player.transactionLog.filter((line) => line.includes("올스타")),
    ...selectionHonors.filter((row) => row.id.startsWith("allstar-")).map((row) => row.note),
  ]);
  const nationalTeamStoredLines = uniqueStrings([
    ...player.transactionLog.filter((line) => line.includes("국가대표") || line.includes("대표팀")),
    ...selectionHonors.filter((row) => row.id.startsWith("national-")).map((row) => row.note),
  ]);
  const allStarLines = allStarStoredLines.length > 0
    ? allStarStoredLines
    : uniqueStrings(player.careerLog.filter((entry) => entry.type === "올스타 선발").map((entry) => `${entry.year}년차 올스타 선발`));
  const nationalTeamLines = nationalTeamStoredLines.length > 0
    ? nationalTeamStoredLines
    : uniqueStrings(player.careerLog.filter((entry) => entry.type === "국가대표 선발").map((entry) => `${entry.year}년차 국가대표 선발`));
  const awardLines = [
    ...mvpRows.map((row) => `${row.seasonYear} ${row.category}`),
    ...goldGloveRows.map((row) => `${row.seasonYear} ${row.category}`),
    ...titleRows.map((row) => `${row.seasonYear} ${row.category}`),
    ...allStarLines,
    ...nationalTeamLines,
    ...(rookieAwards ? [`신인왕 수상`] : []),
  ];
  const recordLines = records
    .sort((left, right) => left.year - right.year || left.record.localeCompare(right.record, "ko"))
    .map((row) => `${row.year}년차 · ${row.record}`);
  const newsLines = orderedNews(news)
    .filter((item) => ["신인왕 수상", "골든글러브", "MVP급 시즌", "메이저 진출", "해외 평가전 활약", "해외 관심", "하위 라운드 성공", "우리 팀이 거른 선수의 성공"].includes(item.type))
    .map((item) => `${item.year}년차 ${formatSeasonWeek(item.week)} · ${item.headline}`);
  const topLine =
    mvpRows.length > 0
      ? "MVP 수상급"
      : nationalTeamLines.some((line) => line.includes("금메달"))
        ? "국가대표 금메달"
        : goldGloveRows.length > 0
        ? "골든글러브 수상자"
        : titleRows.length > 0
          ? "타이틀홀더"
          : records.length > 0
            ? "대기록 보유"
            : rookieAwards
              ? "신인왕"
              : player.debuted
                ? "1군 기록 보유"
                : "1군 기록 없음";

  return {
    goldGloves: goldGloveRows.length,
    titles: titleRows.length,
    mvps: mvpRows.length,
    rookieAwards,
    records: records.length,
    allStars: allStarLines.length,
    nationalTeams: nationalTeamLines.length,
    topLine,
    awardLines,
    recordLines,
    newsLines,
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function createScoutLegacySummary(
  scoutName: string,
  team: Team | undefined,
  players: CareerPlayerState[],
  seasonResults: TeamSeasonResult[],
  awards: YearlyAwardRow[],
  records: RecordBreakerRow[],
  years: number,
): ScoutLegacySummary {
  const teamPlayers = team ? players.filter((player) => player.originalTeamId === team.id) : players;
  const starPlayers = teamPlayers.filter((player) => player.currentOverall >= 74 || player.eventKeys.includes("gold-glove") || player.eventKeys.includes("mvp") || player.eventKeys.includes("major-posting"));
  const bestPlayers = [...starPlayers]
    .sort((left, right) => legacyScore(right) - legacyScore(left))
    .slice(0, 6);
  const playerIds = new Set(teamPlayers.map((player) => player.playerId));
  const teamAwards = awards.filter((row) => row.playerId && playerIds.has(row.playerId));
  const teamRecords = records.filter((row) => playerIds.has(row.player.playerId));
  const championships = team ? seasonResults.filter((result) => result.teamId === team.id && result.rank === 1).length : 0;
  const hallCandidates = teamPlayers.filter((player) => legacyScore(player) >= 106 && yearsWithTeam(player, team ?? player.team) >= 10).length;
  const goldGloves = teamAwards.filter((row) => row.category.startsWith("골든글러브")).length;
  const mvps = teamAwards.filter((row) => row.category === "MVP").length;
  const titles = teamAwards.filter((row) => !row.category.startsWith("골든글러브") && row.category !== "MVP").length;
  const signatureLines = [
    `${scoutName}의 이름으로 기록된 지명 선수는 ${teamPlayers.length}명입니다.`,
    championships > 0 ? `${team?.shortName ?? "구단"}는 당신의 재임 중 ${championships}번 정상에 올랐습니다.` : `${team?.shortName ?? "구단"}는 아직 왕조라 불릴 만큼의 우승 기록은 남기지 못했습니다.`,
    starPlayers.length > 0 ? `리그가 기억하는 스타 ${starPlayers.length}명이 당신의 드래프트 보드에서 출발했습니다.` : "수많은 선택이 있었지만 아직 시대를 상징하는 이름은 기다리는 중입니다.",
    teamRecords.length > 0 ? `대기록 ${teamRecords.length}개가 당신이 지켜본 선수들의 이름 옆에 새겨졌습니다.` : "대기록의 벽은 높았지만, 몇몇 선수는 그 문턱까지 다가갔습니다.",
  ];
  const closingLine =
    bestPlayers.length > 0
      ? `${bestPlayers[0].prospect.name}의 이름이 가장 굵게 남았지만, ${scoutName}의 진짜 유산은 매년 360명의 이름 속에서 다음 가능성을 포기하지 않은 시간입니다.`
      : `${scoutName}의 50년은 화려한 전설보다 오래 버틴 관찰의 기록에 가깝습니다. 다음 삶에서는 또 다른 첫 번째 픽이 기다립니다.`;

  return {
    scoutName,
    teamName: team?.name ?? "미선택 구단",
    years,
    draftedCount: teamPlayers.length,
    starCount: starPlayers.length,
    hallCandidates,
    goldGloves,
    titles,
    mvps,
    records: teamRecords.length,
    championships,
    bestPlayers,
    signatureLines,
    closingLine,
  };
}

function PitcherLine({ stats }: { stats: PitcherStats }) {
  return <p>평균자책 {formatDecimal(stats.era, 2)} · 이닝 {formatDecimal(stats.innings, 1)} · 투구폼 {armSlotLabel(stats.armSlot)} · 최고구속 {formatKph(stats.maxVelocityKph)} · 탈삼/9 {formatDecimal(stats.strikeoutsPerNine, 1)} · 볼넷/9 {formatDecimal(stats.walksPerNine, 1)} · 이닝당출루허용 {formatDecimal(stats.whip, 2)} · 구종 수 {formatNumber(stats.pitchCount)} · 결정구 {pitchLabel(stats.outPitch)} · 구종 {pitchArsenalLine(stats)}</p>;
}

function ToolLine({ player }: { player: CareerPlayerState }) {
  const tools = getCareerTools(player);
  const rows = isPitcherTools(tools)
    ? [
        ["제구", tools.command],
        ["구위", tools.stuff],
        ["구속", tools.velocity],
        ["체력", tools.stamina],
        ["멘탈", tools.mentality],
      ]
    : [
        ["컨택", tools.contact],
        ["선구안", tools.discipline],
        ["주루", tools.speed],
        ["파워", tools.power],
        ["수비", tools.defense],
        ["멘탈", tools.mentality],
      ];
  return (
    <div className="tool-grid">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </Fragment>
      ))}
    </div>
  );
}

function ComparisonTable({ prospects, onRemove }: { prospects: Prospect[]; onRemove: (id: string) => void }) {
  const mode = prospects.every((prospect) => prospect.playerGroup !== "pitcher")
    ? "hitter"
    : prospects.every((prospect) => prospect.playerGroup === "pitcher")
      ? "pitcher"
      : "mixed";
  const rows = comparisonRows(mode);

  return (
    <table className="compare-table">
      <thead>
        <tr>
          <th>지표</th>
          {prospects.map((prospect) => (
            <th key={prospect.id}>
              <button className="remove-button" onClick={() => onRemove(prospect.id)}>×</button>
              {prospect.name} <span className={`pos pos-${prospect.primaryPosition}`}>{positionLabel(prospect.primaryPosition)}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            {prospects.map((prospect) => <td key={prospect.id}>{row.value(prospect)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function comparisonRows(mode: "hitter" | "pitcher" | "mixed") {
  const common = [
    { label: "공개 순위", value: (p: Prospect) => p.visible.publicRank },
    { label: "예상 라운드", value: (p: Prospect) => formatRange(p.visible.projectedRound) },
    { label: "스카우트 등급", value: (p: Prospect) => gradeLabel(p.visible.scoutGrade) },
    { label: "선수 유형", value: (p: Prospect) => p.archetype },
    { label: "출신 구분", value: (p: Prospect) => sourceTypeLabel(p) },
    { label: "학년/경력", value: (p: Prospect) => prospectPathLabel(p) },
    { label: "신체조건", value: (p: Prospect) => `${p.physical.heightCm}cm/${p.physical.weightKg}kg` },
    { label: "학교", value: (p: Prospect) => p.school },
    { label: "지역", value: (p: Prospect) => p.schoolRegion },
    { label: "학교 등급", value: (p: Prospect) => schoolTierLabel(p.schoolTier) },
    { label: "리그 수준", value: (p: Prospect) => p.leagueLevel },
    { label: "대학 진학 가능성", value: (p: Prospect) => formatPercentFromWhole(p.collegeCommitRisk) },
    { label: "수상/이력", value: (p: Prospect) => shortAccolades(p) },
    { label: "평판", value: (p: Prospect) => p.reputation },
    { label: "하이프", value: (p: Prospect) => p.draftHype },
    { label: "포지션 가치", value: (p: Prospect) => formatNumber(positionValue(p)) },
    { label: "신뢰도", value: (p: Prospect) => `${Math.round(p.visible.confidence * 100)}%` },
    { label: "위험도", value: (p: Prospect) => riskText(p.visible.riskLevel) },
  ];
  const hitter = [
    { label: "출루장타", value: (p: Prospect) => formatDecimal(p.hitterStats?.ops, 3) },
    { label: "홈런", value: (p: Prospect) => formatNumber(p.hitterStats?.homeRuns) },
    { label: "2루타", value: (p: Prospect) => formatNumber(p.hitterStats?.doubles) },
    { label: "삼진율", value: (p: Prospect) => formatPercent(p.hitterStats?.strikeoutRate) },
    { label: "볼넷율", value: (p: Prospect) => formatPercent(p.hitterStats?.walkRate) },
    { label: "수비 등급", value: (p: Prospect) => formatNumber(p.hitterStats?.defensiveGrade) },
    { label: "운동능력", value: (p: Prospect) => formatNumber(p.hitterStats?.athleticismGrade) },
  ];
  const pitcher = [
    { label: "평균자책", value: (p: Prospect) => formatDecimal(p.pitcherStats?.era, 2) },
    { label: "이닝", value: (p: Prospect) => formatDecimal(p.pitcherStats?.innings, 1) },
    { label: "투구폼", value: (p: Prospect) => armSlotLabel(p.pitcherStats?.armSlot) },
    { label: "최고 구속", value: (p: Prospect) => formatKph(p.pitcherStats?.maxVelocityKph) },
    { label: "평균 구속", value: (p: Prospect) => formatKph(p.pitcherStats?.averageVelocityKph) },
    { label: "탈삼/9", value: (p: Prospect) => formatDecimal(p.pitcherStats?.strikeoutsPerNine, 1) },
    { label: "볼넷/9", value: (p: Prospect) => formatDecimal(p.pitcherStats?.walksPerNine, 1) },
    { label: "결정구", value: (p: Prospect) => pitchLabel(p.pitcherStats?.outPitch) },
    { label: "구종 구성", value: (p: Prospect) => p.pitcherStats ? pitchArsenalLine(p.pitcherStats) : "-" },
    { label: "제구 등급", value: (p: Prospect) => formatNumber(p.pitcherStats?.commandGrade) },
    { label: "선발 가능성", value: (p: Prospect) => formatPercentFromWhole(p.pitcherStats?.starterChance) },
  ];
  if (mode === "hitter") return [...common, ...hitter];
  if (mode === "pitcher") return [...common, ...pitcher];
  return common;
}

function compareBySortKey(a: Prospect, b: Prospect, key: SortKey, direction: SortDirection) {
  const multiplier = direction === "asc" ? 1 : -1;
  return (sortValue(a, key) - sortValue(b, key)) * multiplier;
}

function sortValue(prospect: Prospect, key: SortKey): number {
  if (key === "rank") return prospect.visible.publicRank;
  if (key === "projectedRound") return prospect.visible.projectedRound.min;
  if (key === "position") return POSITIONS.indexOf(prospect.primaryPosition);
  if (key === "positionalValue") return positionValue(prospect) ?? -1;
  if (key === "ops") return prospect.hitterStats?.ops ?? -1;
  if (key === "homeRuns") return prospect.hitterStats?.homeRuns ?? -1;
  if (key === "strikeoutRate") return prospect.hitterStats?.strikeoutRate ?? 9;
  if (key === "maxVelocityKph") return prospect.pitcherStats?.maxVelocityKph ?? -1;
  if (key === "strikeoutsPerNine") return prospect.pitcherStats?.strikeoutsPerNine ?? -1;
  if (key === "walksPerNine") return prospect.pitcherStats?.walksPerNine ?? 99;
  if (key === "defensiveGrade") return prospect.hitterStats?.defensiveGrade ?? -1;
  if (key === "scoutGrade") return GRADE_WEIGHT[prospect.visible.scoutGrade];
  if (key === "reputation") return prospect.reputation;
  if (key === "draftHype") return prospect.draftHype;
  if (key === "risk") return { low: 1, medium: 2, high: 3, extreme: 4 }[prospect.visible.riskLevel] ?? 0;
  return prospect.visible.confidence;
}

function defaultDirection(key: SortKey): SortDirection {
  return ["rank", "projectedRound", "strikeoutRate", "walksPerNine", "risk"].includes(key) ? "asc" : "desc";
}

function matchesPreset(prospect: Prospect, preset: FilterPreset | "none", team: Team | undefined): boolean {
  if (preset === "none") return true;
  if (preset === "top-available") return prospect.visible.publicRank <= 120;
  if (preset === "team-needs") return team ? teamNeedScore(team, prospect.primaryPosition) >= 55 : true;
  if (preset === "pitchers") return prospect.playerGroup === "pitcher";
  if (preset === "hitters") return prospect.playerGroup !== "pitcher";
  if (preset === "premium-defense") return ["C", "SS", "CF"].includes(prospect.primaryPosition);
  if (preset === "low-risk") return prospect.visible.riskLevel === "low" && !prospect.visible.riskTags.includes("injury-history");
  if (preset === "upside") return prospect.visible.expectedOverallRange.max >= 65;
  if (preset === "safe") return prospect.visible.confidence >= 0.68 && prospect.visible.riskLevel !== "high";
  if (preset === "awarded") return prospect.accolades.length > 0;
  if (preset === "college-risk") return prospect.collegeCommitRisk >= 60;
  if (preset === "late-sleepers") return prospect.visible.projectedRound.min >= 8 && prospect.visible.expectedOverallRange.max >= 58;
  if (preset === "high-confidence") return prospect.visible.confidence >= 0.72;
  if (preset === "league-adjusted") return (prospect.visible.riskTags.includes("weak-competition") && ((prospect.hitterStats?.ops ?? 0) >= 0.9 || (prospect.pitcherStats?.strikeoutsPerNine ?? 0) >= 9.5));
  if (preset === "pitcher-lottery") return prospect.playerGroup === "pitcher" && (prospect.visible.expectedOverallRange.max >= 62 || (prospect.pitcherStats?.maxVelocityKph ?? 0) >= 148);
  if (preset === "high-risk-upside") return prospect.visible.expectedOverallRange.max >= 65 && prospect.visible.riskLevel === "high";
  return true;
}

function lateRoundRoleChance(player: CareerPlayerState): number {
  const roundPenalty = player.pick.round >= 10 ? -0.04 : player.pick.round >= 8 ? -0.02 : 0;
  const growthSignal = player.currentOverall >= 68 ? 0.08 : player.currentOverall >= 64 ? 0.04 : 0;
  const roleProfile = ["C", "SS", "CF", "RP"].includes(player.prospect.primaryPosition) ? 0.035 : 0;
  const riskPenalty = player.prospect.trueTalent.volatility >= 0.78 || player.prospect.trueTalent.proAdaptation <= 0.36 ? -0.04 : 0;
  return clampNumber(0.08 + roundPenalty + growthSignal + roleProfile + riskPenalty, 0.015, 0.18);
}

function lateRoundBreakoutChance(player: CareerPlayerState): number {
  const roundPenalty = player.pick.round >= 10 ? -0.015 : 0;
  const eliteSignal = player.currentOverall >= 82 ? 0.035 : player.currentOverall >= 78 ? 0.018 : 0;
  const makeup = player.prospect.trueTalent.workEthic >= 0.72 && player.prospect.trueTalent.proAdaptation >= 0.62 ? 0.018 : 0;
  return clampNumber(0.012 + eliteSignal + makeup + roundPenalty, 0.002, 0.07);
}

function rangeContains(range: { min: number; max: number }, value: number) {
  return value >= range.min && value <= range.max;
}

function formatRange(range: { min: number; max: number }) {
  if (range.min > 10) return "미지명권";
  if (range.max > 10) return `${range.min}-미지명권`;
  return range.min === range.max ? String(range.min) : `${range.min}-${range.max}`;
}

function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : String(value);
}

function formatIndex(value: number): string {
  return `${value}점`;
}

function formatRiskIndex(value: number): string {
  return `${value}%`;
}

function formatDecimal(value: number | null | undefined, digits: number) {
  return value === null || value === undefined ? "-" : value.toFixed(digits);
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`;
}

function formatPercentFromWhole(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${value}%`;
}

function formatKph(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${value}㎞/시`;
}

function highSchoolLogTypeLabel(type: string): string {
  if (type === "growth") return "성장";
  if (type === "stall") return "정체";
  if (type === "decline") return "하락";
  if (type === "physical") return "신체";
  if (type === "velocity") return "구속";
  if (type === "ranking") return "랭킹";
  if (type === "role") return "역할";
  if (type === "injury") return "부상";
  if (type === "long-rehab") return "장기 재활";
  if (type === "repeat-year") return "유급 가능성";
  if (type === "transfer") return "전학 가능성";
  if (type === "reputation-risk") return "평판 리스크";
  if (type === "college-risk") return "진학 변수";
  if (type === "position-change") return "포지션 전환";
  if (type === "accolade") return "수상";
  if (type === "national-team") return "대표팀";
  if (type === "showcase") return "올스타/쇼케이스";
  return type;
}

function positionValue(prospect: Prospect) {
  if (prospect.hitterStats?.positionalValue !== undefined) return prospect.hitterStats.positionalValue;
  if (prospect.primaryPosition === "SP") return 9;
  if (prospect.primaryPosition === "RP") return 4;
  return null;
}

function createPositionCounts(prospects: Prospect[]): Record<Position, number> {
  return POSITIONS.reduce(
    (counts, position) => ({
      ...counts,
      [position]: prospects.filter((prospect) => prospect.primaryPosition === position).length,
    }),
    {} as Record<Position, number>,
  );
}

function createSchoolSummaryRows(schools: SchoolProfile[], prospects: Prospect[], selections: DraftSelectionView[]): SchoolSummaryRow[] {
  const draftedIds = new Set(selections.map((selection) => selection.prospect.id));
  return schools
    .map((school) => {
      const schoolProspects = prospects.filter((prospect) => prospect.schoolId === school.id);
      const positionCounts = createPositionCounts(schoolProspects);
      return {
        school,
        prospectCount: schoolProspects.length,
        topCandidateCount: schoolProspects.filter((prospect) => prospect.visible.publicRank <= 100).length,
        draftedCount: schoolProspects.filter((prospect) => draftedIds.has(prospect.id)).length,
        positionSummary: formatPositionCounts(positionCounts),
      };
    })
    .sort((left, right) => right.prospectCount - left.prospectCount || right.school.leagueStrength - left.school.leagueStrength);
}

function createTrackingRows(players: CareerPlayerState[], filter: TrackingStatus | "all" | "needs-review" | "released", sortKey: TrackingSortKey, direction: SortDirection, yearBucket: CareerYearBucket, currentCareerYear: number): CareerPlayerState[] {
  const filtered = players.filter((player) => {
    if (!isActiveTrackingTarget(player, currentCareerYear, filter)) return false;
    if (!matchesCareerYearBucket(player.yearsSinceDraft, yearBucket)) return false;
    if (filter === "all") return player.trackingStatus !== "archived" && player.status !== "방출" && player.status !== "은퇴" && player.status !== "해외진출";
    if (filter === "needs-review") return player.trackingStatus === "auto" && player.yearsSinceDraft >= 1;
    if (filter === "released") return player.status === "방출" || player.status === "은퇴" || player.status === "해외진출";
    return player.trackingStatus === filter;
  });
  const multiplier = direction === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => compareTrackingValue(left, right, sortKey) * multiplier);
}

function createTrackingAddRows(players: CareerPlayerState[], yearBucket: CareerYearBucket): CareerPlayerState[] {
  return players
    .filter((player) => {
      if (!matchesCareerYearBucket(player.yearsSinceDraft, yearBucket)) return false;
      if (player.status === "은퇴" || player.status === "해외진출") return false;
      return player.trackingStatus === "archived";
    })
    .sort((left, right) => {
      const leftArchived = left.trackingStatus === "archived" ? 1 : 0;
      const rightArchived = right.trackingStatus === "archived" ? 1 : 0;
      return rightArchived - leftArchived || right.currentOverall - left.currentOverall || left.pick.overall - right.pick.overall;
    });
}

function createTrackingSummary(players: CareerPlayerState[], news: CareerNewsItem[], userTeamId: TeamId | undefined) {
  const activePlayers = players.filter((player) => player.status !== "방출" && player.status !== "은퇴" && player.status !== "해외진출");
  return {
    total: players.length,
    active: activePlayers.length,
    currentUserTeam: userTeamId ? activePlayers.filter((player) => player.team.id === userTeamId).length : 0,
    departedUserTeam: userTeamId ? activePlayers.filter((player) => player.originalTeamId === userTeamId && player.team.id !== userTeamId).length : 0,
    needsReview: players.filter((player) => player.trackingStatus === "auto" && player.yearsSinceDraft >= 1).length,
    follow: players.filter((player) => player.trackingStatus === "follow").length,
    summary: players.filter((player) => player.trackingStatus === "summary").length,
    archived: players.filter((player) => player.trackingStatus === "archived").length,
    released: players.filter((player) => player.status === "방출" || player.status === "은퇴" || player.status === "해외진출").length,
    majorNews: news.filter((item) => item.grade === "headline" || item.grade === "major").length,
  };
}

function isActiveTrackingTarget(player: CareerPlayerState, currentCareerYear: number, filter: TrackingStatus | "all" | "needs-review" | "released"): boolean {
  if (filter === "released") return true;
  if (filter === "archived") return player.trackingStatus === "archived";
  if (player.trackingStatus !== "archived") return true;
  return currentCareerYear <= (player.trackingArchivedAtYear ?? player.yearsSinceDraft);
}

function filterCareerNews(
  news: CareerNewsItem[],
  players: CareerPlayerState[],
  gradeFilter: NewsGrade | "all",
  yearBucket: CareerYearBucket,
  scope: NewsScope,
  userTeamId: TeamId | undefined,
  favorites: Set<string>,
  compareIds: Set<string>,
): CareerNewsItem[] {
  return news.filter((item) => {
    if (gradeFilter !== "all" && item.grade !== gradeFilter) return false;
    const player = item.playerId ? players.find((candidate) => candidate.playerId === item.playerId) : undefined;
    if (scope === "user-team" && !player?.playerId) return false;
    if (scope === "user-team" && (!player || !isUserManagedPlayer(player, userTeamId))) return false;
    if (scope === "watched") {
      const watched = Boolean(item.playerId && (favorites.has(item.playerId) || compareIds.has(item.playerId)));
      if (!watched && (!player || !isUserManagedPlayer(player, userTeamId))) return false;
    }
    if (yearBucket === "all") return true;
    return matchesCareerYearBucket(player?.yearsSinceDraft ?? item.year, yearBucket);
  });
}

function matchesCareerYearBucket(years: number, bucket: CareerYearBucket): boolean {
  if (bucket === "all") return true;
  if (bucket === "year-1") return years === 1;
  if (bucket === "year-2-3") return years >= 2 && years <= 3;
  if (bucket === "year-4-5") return years >= 4 && years <= 5;
  if (bucket === "year-6-10") return years >= 6 && years <= 10;
  if (bucket === "year-11-15") return years >= 11 && years <= 15;
  if (bucket === "year-16-20") return years >= 16 && years <= 20;
  return years > 20;
}

function compareTrackingValue(left: CareerPlayerState, right: CareerPlayerState, key: TrackingSortKey): number {
  if (key === "round") return left.pick.round - right.pick.round || left.pick.overall - right.pick.overall;
  if (key === "overallPick") return left.pick.overall - right.pick.overall;
  if (key === "name") return left.prospect.name.localeCompare(right.prospect.name, "ko");
  if (key === "position") return POSITIONS.indexOf(left.prospect.primaryPosition) - POSITIONS.indexOf(right.prospect.primaryPosition);
  if (key === "initialOverall") return left.initialOverall - right.initialOverall;
  if (key === "currentOverall") return left.currentOverall - right.currentOverall;
  if (key === "overallChange") return left.currentOverall - left.initialOverall - (right.currentOverall - right.initialOverall);
  if (key === "status") return left.status.localeCompare(right.status, "ko");
  if (key === "trackingStatus") return trackingStatusRank(left.trackingStatus) - trackingStatusRank(right.trackingStatus);
  return trackingStatusRank(recommendTrackingStatus(left)) - trackingStatusRank(recommendTrackingStatus(right));
}

function trackingStatusRank(status: TrackingStatus): number {
  return { auto: 0, follow: 1, summary: 2, archived: 3 }[status];
}

function trackingStatusLabel(status: TrackingStatus): string {
  return TRACKING_STATUS_LABELS[status];
}

function militaryStatusText(player: CareerPlayerState): string {
  if (player.militaryStatus === "exempt") return "면제/병역특례";
  if (player.militaryStatus === "completed") return "필";
  if (player.militaryStatus === "serving") return `${player.militaryType ?? "복무"} 중`;
  return "미필";
}

function isFirstTeamAwardEligible(player: CareerPlayerState): boolean {
  return player.status === "1군" && player.militaryStatus !== "serving";
}

function isUserManagedPlayer(player: CareerPlayerState, userTeamId: TeamId | undefined): boolean {
  if (!userTeamId) return false;
  return player.originalTeamId === userTeamId || player.team.id === userTeamId;
}

function applyDefaultTrackingAfterSeason(players: CareerPlayerState[], userTeamId: TeamId, year: number): CareerPlayerState[] {
  if (year < 1) return players;
  return players.map((player) => {
    if (isUserManagedPlayer(player, userTeamId)) return player;
    if (player.trackingStatus !== "auto") return player;
    return { ...player, trackingStatus: "archived", trackingArchivedAtYear: year };
  });
}

function recommendTrackingStatus(player: CareerPlayerState): TrackingStatus {
  if (player.status === "방출" || player.status === "은퇴") return "archived";
  if (player.status === "해외진출") return "follow";
  const ovrChange = player.currentOverall - player.initialOverall;
  const premiumPosition = ["SP", "C", "SS"].includes(player.prospect.primaryPosition);
  if (player.pick.round <= 3) return "follow";
  if (ovrChange >= 5 || player.currentOverall >= 54 || player.debuted) return "follow";
  if (player.pick.round >= 6 && player.prospect.trueTalent.growthRate >= 0.72 && player.prospect.trueTalent.potential >= 64) return "follow";
  if (player.yearsSinceDraft >= 2 && ovrChange <= 1 && player.currentOverall < 50) return "archived";
  if (player.eventKeys.includes("position-change") || player.status === "부상" || player.prospect.trueTalent.injuryRisk >= 0.72) return "summary";
  if (premiumPosition) return "summary";
  if (player.currentOverall < 45 && positionValue(player.prospect) !== null && (positionValue(player.prospect) ?? 0) <= 4) return "archived";
  return "summary";
}

function trackingRecommendationReason(player: CareerPlayerState): string {
  const ovrChange = player.currentOverall - player.initialOverall;
  if (player.status === "방출" || player.status === "은퇴") return "보관 대상";
  if (player.status === "해외진출") return "메이저 진출";
  if (player.pick.round <= 3) return "상위 라운드";
  if (ovrChange >= 5) return `OVR ${formatSigned(ovrChange)} 성장`;
  if (player.currentOverall >= 54 || player.debuted) return "1군 접근";
  if (player.pick.round >= 6 && player.prospect.trueTalent.growthRate >= 0.72) return "하위 라운드 성장 여지";
  if (player.yearsSinceDraft >= 2 && ovrChange <= 1 && player.currentOverall < 50) return "2년 이상 성장 정체";
  if (player.status === "부상" || player.prospect.trueTalent.injuryRisk >= 0.72) return "부상 변수";
  if (["SP", "C", "SS"].includes(player.prospect.primaryPosition)) return "핵심 포지션";
  return "요약 추적 적합";
}

function shortCareerEvents(player: CareerPlayerState): string {
  if (player.careerLog.length === 0) return "-";
  return player.careerLog.slice(-3).map((entry) => entry.type).join(", ");
}

function releaseFailureReason(player: CareerPlayerState): string {
  if (player.prospect.visible.riskTags.includes("command")) return "제구 개선 실패";
  if (player.prospect.visible.riskTags.includes("breaking-ball")) return player.prospect.playerGroup === "pitcher" ? "변화구 완성 실패" : "변화구 대처 실패";
  if (player.prospect.visible.riskTags.includes("position-uncertainty")) return "포지션 전환 실패";
  if (player.prospect.visible.riskTags.includes("defensive-home")) return "수비 포지션 상실";
  if (player.prospect.visible.riskTags.includes("injury-history") || player.prospect.trueTalent.injuryRisk > 0.72) return "반복 부상";
  if (player.prospect.playerGroup === "pitcher" && (player.prospect.pitcherStats?.maxVelocityKph ?? 150) < 140) return "구속 하락";
  if (player.prospect.playerGroup !== "pitcher" && (player.prospect.hitterStats?.homeRuns ?? 0) <= 2 && player.prospect.primaryPosition === "1B") return "장타력 부족";
  if (player.prospect.trueTalent.proAdaptation < 0.35) return "프로 적응 실패";
  return "성장 정체";
}

function firstTeamDebutChance(overall: number, player: CareerPlayerState): number {
  const base = overall >= 76 ? 0.54 : overall >= 72 ? 0.36 : overall >= 68 ? 0.22 : overall >= 64 ? 0.12 : overall >= 60 ? 0.055 : 0.018;
  const draftContext = player.pick.round <= 1 ? 0.07 : player.pick.round <= 2 ? 0.04 : player.pick.round >= 8 ? -0.035 : 0;
  const adaptation = player.prospect.trueTalent.proAdaptation >= 0.72 ? 0.055 : player.prospect.trueTalent.proAdaptation <= 0.36 ? -0.055 : 0;
  const positionBoost = ["C", "SS", "SP"].includes(player.prospect.primaryPosition) && overall >= 68 ? 0.025 : 0;
  const firstYearMultiplier = player.yearsSinceDraft === 0 ? 0.38 : player.yearsSinceDraft === 1 ? 0.72 : 1;
  return clampNumber((base + draftContext + adaptation + positionBoost) * firstYearMultiplier, 0.006, 0.66);
}

function firstTeamRegularChance(player: CareerPlayerState): number {
  const base = player.currentOverall >= 76 ? 0.42 : player.currentOverall >= 72 ? 0.28 : player.currentOverall >= 68 ? 0.16 : player.currentOverall >= 64 ? 0.075 : 0.025;
  const firstTeamContext = player.status === "1군" ? 0.055 : -0.05;
  const workEthic = player.prospect.trueTalent.workEthic >= 0.72 ? 0.045 : player.prospect.trueTalent.workEthic <= 0.34 ? -0.04 : 0;
  const volatility = player.prospect.trueTalent.volatility >= 0.76 ? -0.045 : 0;
  return clampNumber(base + firstTeamContext + workEthic + volatility, 0.01, 0.52);
}

function rookieStandoutChance(player: CareerPlayerState): number {
  const base = player.currentOverall >= 78 ? 0.34 : player.currentOverall >= 74 ? 0.22 : player.currentOverall >= 70 ? 0.12 : player.currentOverall >= 66 ? 0.045 : 0.015;
  const settled = player.eventKeys.includes("first-team-regular") ? 0.08 : 0;
  const reputation = player.prospect.reputation >= 78 ? 0.035 : 0;
  const risk = player.prospect.trueTalent.volatility >= 0.8 || player.prospect.trueTalent.proAdaptation <= 0.35 ? -0.055 : 0;
  return clampNumber(base + settled + reputation + risk, 0.006, 0.44);
}

function rookieAwardChance(player: CareerPlayerState): number {
  const base = player.overall >= 75 ? 0.42 : player.overall >= 72 ? 0.3 : 0.18;
  const roleBonus = player.status === "1군" ? 0.12 : 0;
  const draftBonus = player.pick.round <= 3 ? 0.06 : player.pick.round >= 8 ? -0.04 : 0;
  return clampNumber(base + roleBonus + draftBonus, 0.08, 0.58);
}

function rookieCandidateChance(player: CareerPlayerState): number {
  const base = player.currentOverall >= 78 ? 0.28 : player.currentOverall >= 75 ? 0.18 : player.currentOverall >= 72 ? 0.095 : 0.035;
  const roleBonus = player.eventKeys.includes("rookie-standout") ? 0.08 : player.eventKeys.includes("first-team-regular") ? 0.035 : 0;
  const noise = deterministicNoise(`rookie-candidate-${player.playerId}-${player.yearsSinceDraft}`) * 0.06;
  return clampNumber(base + roleBonus + noise, 0.004, 0.38);
}

function tradeChance(player: CareerPlayerState): number {
  const base = player.originalTeamId !== player.team.id ? 0.018 : 0.032;
  const blocked = player.pick.round <= 1 && player.currentOverall >= 70 ? -0.012 : 0;
  const rolePressure = player.status === "1군" && player.currentOverall < 58 ? 0.018 : 0;
  const stuckProspect = player.yearsSinceDraft >= 3 && player.currentOverall < 54 ? 0.02 : 0;
  return clampNumber(base + blocked + rolePressure + stuckProspect, 0.006, 0.075);
}

function freeAgencyExitChance(player: CareerPlayerState): number {
  const star = player.currentOverall >= 74 ? 0.09 : player.currentOverall >= 66 ? 0.055 : 0.025;
  const draftedByUser = player.originalTeamId === player.team.id ? 0 : -0.015;
  const loyalty = player.pick.round <= 2 ? -0.015 : 0;
  return clampNumber(star + draftedByUser + loyalty, 0.01, 0.12);
}

function majorPostingChance(player: CareerPlayerState): number {
  const yearFactor = recordYearFactor(player.yearsSinceDraft, 8, 4);
  const overseasBoost = player.eventKeys.includes("overseas-showcase-standout")
    ? 1.65
    : player.eventKeys.includes("overseas-scouted")
      ? 1.28
      : 1;
  if (player.currentOverall >= 94 && (player.eventKeys.includes("mvp") || player.eventKeys.includes("major-posting"))) return 0.014 * yearFactor * overseasBoost;
  if (player.currentOverall >= 91 && player.eventKeys.some((key) => ["mvp", "gold-glove"].includes(key))) return 0.007 * yearFactor * overseasBoost;
  if (player.currentOverall >= 88 && player.eventKeys.includes("mvp")) return 0.003 * yearFactor * overseasBoost;
  return 0;
}

function applyOverseasShowcaseEvents(
  players: CareerPlayerState[],
  currentResults: TeamSeasonResult[],
  previousResults: TeamSeasonResult[],
  seasonYear: number,
  year: number,
  userTeamId: TeamId,
  watchedIds: Set<ProspectId>,
  nextAfterUserPickIds: Set<ProspectId>,
  news: CareerNewsItem[],
): void {
  const userResult = currentResults.find((result) => result.teamId === userTeamId);
  if (!userResult) return;
  const recentResults = [...previousResults.filter((result) => result.teamId === userTeamId), userResult]
    .sort((left, right) => right.yearIndex - left.yearIndex)
    .slice(0, 5);
  const topTwoSeasons = recentResults.filter((result) => result.rank <= 2).length;
  const playoffSeasons = recentResults.filter((result) => result.rank <= 5).length;
  const dynastyScore = topTwoSeasons * 18 + playoffSeasons * 5 + Math.max(0, 11 - userResult.rank) * 3 + Math.max(0, userResult.wins - 80) * 0.8;
  const activeStars = players.filter((player) =>
    player.team.id === userTeamId &&
    player.status !== "방출" &&
    player.status !== "은퇴" &&
    player.status !== "해외진출" &&
    player.militaryStatus !== "serving" &&
    (player.currentOverall >= 72 || player.eventKeys.some((key) => ["mvp", "gold-glove", "rookie-award", "allstar", "national-team"].includes(key))),
  );
  const starScore = activeStars.reduce((total, player) => total + Math.max(0, player.currentOverall - 68) * 0.45 + overseasResumeBonus(player), 0);
  const popularityProxy = clampNumber(38 + dynastyScore * 0.55 + starScore * 0.8, 0, 100);
  if (recentResults.length < 3 || topTwoSeasons < 2 || popularityProxy < 68) return;

  const invitationChance = clampNumber(0.08 + (topTwoSeasons - 1) * 0.055 + Math.max(0, popularityProxy - 72) * 0.004, 0.08, 0.38);
  if (Math.random() > invitationChance) return;

  const showcase = chooseOverseasShowcase(seasonYear, popularityProxy, userResult.rank);
  const candidates = activeStars
    .filter((player) => player.currentOverall >= 67 && !player.eventKeys.includes(`overseas-showcase-${seasonYear}`))
    .map((player) => ({
      player,
      score: player.currentOverall + overseasResumeBonus(player) + deterministicNoise(`showcase-${seasonYear}-${player.playerId}`) * 12,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  if (candidates.length === 0) return;

  const teamName = candidates[0]?.player.team.name ?? "우리 팀";
  const resultText = overseasShowcaseResult(showcase, userResult, seasonYear);
  news.push({
    id: `overseas-showcase-team-${seasonYear}-${userTeamId}`,
    year,
    week: 28,
    grade: "headline",
    importance: 5,
    type: "해외 평가전",
    headline: `${teamName}, ${showcase.label} 제안 수락`,
    body: `${seasonYear}시즌 종료 후 ${showcase.partner} 측이 왕조급 성적과 흥행력을 확인하고 이벤트 매치를 제안했다. ${resultText} 좋은 장면을 만든 선수들은 해외 스카우트 체크리스트에 이름을 올렸다.`,
    teamName,
    emphasis: "user",
  });

  const standoutCount = Math.min(candidates.length, 1 + Math.floor(deterministicNoise(`showcase-count-${seasonYear}-${userTeamId}`) * 3));
  candidates.slice(0, standoutCount).forEach(({ player }, index) => {
    const standout = index === 0 || deterministicNoise(`showcase-standout-${seasonYear}-${player.playerId}`) > 0.42;
    player.eventKeys = uniqueStrings([
      ...player.eventKeys,
      `overseas-showcase-${seasonYear}`,
      "overseas-scouted",
      ...(standout ? ["overseas-showcase-standout"] : []),
    ]);
    player.transactionLog = uniqueStrings([
      ...player.transactionLog,
      `${seasonYear}년 ${showcase.label} ${standout ? "주요 활약" : "해외 스카우트 체크"}`,
    ]);
    addCareerNews(
      news,
      player,
      year,
      standout ? 5 : 4,
      standout ? "해외 평가전 활약" : "해외 관심",
      standout ? `${player.prospect.name}, ${showcase.label}에서 해외 관심 상승` : `${player.prospect.name}, 해외 스카우트 관찰 대상`,
      standout
        ? `${showcase.partner} 관계자 앞에서 자신의 강점을 확실히 보여줬다. 실제 이적과는 별개지만 해외진출 가능성 평가가 한 단계 올라갔다.`
        : `${showcase.partner} 스카우트가 장기 관찰 대상으로 분류했다. 당장 이적을 의미하지는 않지만 향후 포스팅 변수로 남았다.`,
      careerContext(player, userTeamId, watchedIds, nextAfterUserPickIds),
    );
  });
}

function overseasResumeBonus(player: CareerPlayerState): number {
  return (
    (player.eventKeys.includes("mvp") ? 10 : 0) +
    (player.eventKeys.includes("gold-glove") ? 6 : 0) +
    (player.eventKeys.includes("rookie-award") ? 3 : 0) +
    player.careerLog.filter((entry) => ["올스타 선발", "국가대표 선발", "MVP급 시즌", "골든글러브"].includes(entry.type)).length * 1.8
  );
}

function chooseOverseasShowcase(seasonYear: number, popularity: number, rank: number): { label: string; partner: string } {
  const roll = deterministicNoise(`overseas-showcase-type-${seasonYear}-${Math.round(popularity)}-${rank}`);
  if (popularity >= 84 && rank <= 2 && roll > 0.56) return { label: "MLB 초청 평가전", partner: "MLB 구단" };
  if (roll > 0.28) return { label: "NPB 교류전", partner: "NPB 구단" };
  return { label: "아시아 챔피언십 친선전", partner: "해외 스카우트 그룹" };
}

function overseasShowcaseResult(showcase: { label: string }, result: TeamSeasonResult, seasonYear: number): string {
  const roll = deterministicNoise(`overseas-showcase-result-${showcase.label}-${seasonYear}-${result.teamId}`);
  if (roll > 0.78 || result.rank === 1) return `${showcase.label}에서 경쟁력 있는 경기력으로 시리즈를 가져갔다.`;
  if (roll > 0.36) return `${showcase.label}에서는 승패보다 선수 개별 툴 검증에 가까운 흐름이 나왔다.`;
  return `${showcase.label}에서 낯선 구위와 운영 방식에 고전했지만 몇몇 선수는 존재감을 남겼다.`;
}

function awardSingleRookieOfYear(
  players: CareerPlayerState[],
  year: number,
  userTeamId: TeamId,
  watchedIds: Set<ProspectId>,
  nextAfterUserPickIds: Set<ProspectId>,
  news: CareerNewsItem[],
) {
  const candidates = players
    .filter((player) => isRookieAwardEligible(player, year))
    .map((player) => ({
      player,
      score:
        player.currentOverall * 1.2 +
        (player.debuted ? 10 : 0) +
        (firstDebutYear(player) === year ? 8 : 0) +
        (player.eventKeys.includes("rookie-candidate") ? 8 : 0) +
        (player.pick.round <= 3 ? 4 : 0) +
        deterministicNoise(`rookie-award-${year}-${player.playerId}`) * 10,
    }))
    .sort((left, right) => right.score - left.score);
  const winner = candidates[0]?.player;
  if (!winner) return;

  winner.eventKeys = [...winner.eventKeys, "rookie-award"];
  if (!winner.debuted) {
    winner.debuted = true;
    winner.status = "1군";
  }
  const context = careerContext(winner, userTeamId, watchedIds, nextAfterUserPickIds);
  addCareerNews(news, winner, year, 5, "신인왕 수상", `${winner.prospect.name}, 신인왕 수상`, "시즌 내내 안정적인 1군 기여를 이어가며 신인왕 투표에서 가장 앞선 평가를 받았다. 올해 신인왕 수상자는 단 한 명으로 기록된다.", context);
}

function isRookieAwardEligible(player: CareerPlayerState, year: number): boolean {
  if (player.eventKeys.includes("rookie-award")) return false;
  if (player.status === "방출" || player.status === "은퇴" || player.status === "해외진출") return false;
  if (player.militaryStatus === "serving") return false;
  const debutYear = firstDebutYear(player);
  const noPreviousDebut = debutYear === undefined || debutYear === year;
  return player.yearsPro <= 3 || noPreviousDebut;
}

function firstDebutYear(player: CareerPlayerState): number | undefined {
  return player.careerLog
    .filter((entry) => entry.type === "1군 데뷔")
    .sort((left, right) => left.year - right.year)[0]?.year;
}

function applyUserInboundTransactions(
  players: CareerPlayerState[],
  year: number,
  userTeamId: TeamId,
  teams: Team[],
  watchedIds: Set<ProspectId>,
  nextAfterUserPickIds: Set<ProspectId>,
  news: CareerNewsItem[],
) {
  if (Math.random() > 0.34) return;
  const userTeam = teams.find((team) => team.id === userTeamId);
  if (!userTeam) return;
  const candidates = players.filter((player) =>
    player.team.id !== userTeamId &&
    player.status !== "방출" &&
    player.status !== "은퇴" &&
    player.status !== "해외진출" &&
    player.yearsSinceDraft >= 2 &&
    player.currentOverall >= 50 &&
    player.currentOverall <= 74,
  );
  const target = pickRandom(candidates);
  if (!target) return;
  const previousTeam = target.team;
  const isFreeAgent = target.yearsSinceDraft >= 7 && Math.random() < 0.48;
  target.team = userTeam;
  target.trackingStatus = target.currentOverall >= 62 ? "follow" : target.trackingStatus === "archived" ? "summary" : target.trackingStatus;
  target.transactionLog = [
    ...target.transactionLog,
    isFreeAgent ? `${year}년차 FA 영입: ${previousTeam.shortName} → ${userTeam.shortName}` : `${year}년차 트레이드 영입: ${previousTeam.shortName} → ${userTeam.shortName}`,
  ];
  const context = careerContext(target, userTeamId, watchedIds, nextAfterUserPickIds);
  addCareerNews(
    news,
    target,
    year,
    target.currentOverall >= 65 ? 5 : 4,
    isFreeAgent ? "FA 영입" : "트레이드 영입",
    `${userTeam.shortName}, ${target.prospect.name} 영입`,
    isFreeAgent
      ? `${previousTeam.shortName}에서 시장에 나온 선수를 영입하며 뎁스를 보강했다. 지명 당시와 다른 팀에서 커리어의 다음 장을 시작한다.`
      : `${previousTeam.shortName}와의 거래를 통해 성장 여지가 남은 선수를 데려왔다. 단기 전력과 장기 자산을 동시에 고려한 움직임이다.`,
    context,
  );
}

function addSeasonSelectionHonors(
  players: CareerPlayerState[],
  existingPlayers: ExistingLeaguePlayer[],
  teams: Team[],
  year: number,
  seasonYear: number,
  userTeamId: TeamId,
  watchedIds: Set<ProspectId>,
  nextAfterUserPickIds: Set<ProspectId>,
  news: CareerNewsItem[],
) {
  const allStars = createAllStarRowsForSeason(seasonYear, year, players, teams, existingPlayers);
  allStars.forEach((row) => {
    if (!row.playerId) return;
    const player = players.find((candidate) => candidate.playerId === row.playerId);
    if (!player || player.transactionLog.some((item) => item === row.note)) return;
    player.transactionLog = [...player.transactionLog, row.note];
    addCareerNews(news, player, year, player.team.id === userTeamId ? 4 : 3, "올스타 선발", `${player.prospect.name}, 올스타 ${row.group} 선발`, `${player.team.shortName} 소속으로 ${seasonYear} 올스타 ${row.group} ${row.category ?? "로스터"}에 이름을 올렸다.`, careerContext(player, userTeamId, watchedIds, nextAfterUserPickIds));
  });

  const tournament = nationalTeamTournamentInfo(seasonYear);
  if (!tournament) return;
  const nationalTeam = createNationalTeamRowsForSeason(seasonYear, year, players, teams, existingPlayers);
  nationalTeam.forEach((row) => {
    if (!row.playerId) return;
    const player = players.find((candidate) => candidate.playerId === row.playerId);
    if (!player || player.transactionLog.some((item) => item === row.note)) return;
    const result = nationalTeamResultFromNote(row.note);
    player.transactionLog = [...player.transactionLog, row.note];
    const grantsExemption = nationalTeamResultGrantsMilitaryExemption(tournament.name, result);
    const wasServingInSangmu = player.militaryStatus === "serving" && player.militaryType === "상무";
    if (grantsExemption) {
      player.militaryStatus = "exempt";
      player.militaryType = undefined;
      player.militaryServiceUntilYear = undefined;
      player.transactionLog = [...player.transactionLog, `${seasonYear}년 ${tournament.name} ${result} 병역특례`];
      if (wasServingInSangmu) {
        player.transactionLog = [...player.transactionLog, `${seasonYear}년 ${tournament.name} ${result}로 상무 즉시 전역`];
        addCareerNews(
          news,
          player,
          year,
          player.team.id === userTeamId || player.originalTeamId === userTeamId ? 5 : 4,
          "병역 복귀",
          `${player.prospect.name}, 대표팀 성과로 상무 즉시 전역`,
          `${tournament.name} ${result}로 병역특례 조건을 충족하며 남은 상무 복무 일정을 마치지 않고 팀에 복귀하게 됐다.`,
          careerContext(player, userTeamId, watchedIds, nextAfterUserPickIds),
        );
      }
    }
    addCareerNews(
      news,
      player,
      year,
      player.team.id === userTeamId || grantsExemption ? 5 : 4,
      "국가대표 선발",
      `${player.prospect.name}, ${seasonYear} ${tournament.name} 선발`,
      `${player.team.shortName}에서 리그 상위권 활약을 인정받아 ${tournament.name}에 합류했다. 대회 결과는 ${result}${grantsExemption ? wasServingInSangmu ? "이며 상무 즉시 전역과 병역특례 대상이 됐다" : "이며 병역특례 대상이 됐다" : "로 기록됐다"}.`,
      careerContext(player, userTeamId, watchedIds, nextAfterUserPickIds),
    );
  });
}

function allStarDivisionForTeam(teamId: TeamId): "드림" | "나눔" {
  return ["team-jamsil", "team-suwon", "team-incheon", "team-daegu", "team-busan"].includes(teamId) ? "드림" : "나눔";
}

function nationalTeamTournamentInfo(seasonYear: number): { name: "아시안게임 대표팀" | "WBC 대표팀" | "올림픽 대표팀"; result: string } | undefined {
  if (seasonYear < 2026) return undefined;
  const cycle = (seasonYear - 2026) % 4;
  if (cycle === 0) return { name: "아시안게임 대표팀", result: nationalTeamTournamentResult(seasonYear, "asian-games") };
  if (cycle === 1) return { name: "WBC 대표팀", result: nationalTeamTournamentResult(seasonYear, "wbc") };
  if (cycle === 2) return { name: "올림픽 대표팀", result: nationalTeamTournamentResult(seasonYear, "olympic") };
  return undefined;
}

function nationalTeamTournamentResult(seasonYear: number, type: "asian-games" | "wbc" | "olympic"): string {
  const roll = deterministicNoise(`national-result-${type}-${seasonYear}`);
  if (type === "asian-games") {
    if (roll > 0.42) return "금메달";
    if (roll > 0.24) return "은메달";
    if (roll > 0.1) return "동메달";
    if (roll > 0.03) return "4강";
    return "8강탈락";
  }
  if (type === "wbc") {
    if (roll > 0.94) return "1위";
    if (roll > 0.87) return "2위";
    if (roll > 0.78) return "3위";
    if (roll > 0.68) return "4위";
    if (roll > 0.38) return "8강탈락";
    return "조별리그탈락";
  }
  if (roll > 0.7) return "금메달";
  if (roll > 0.52) return "은메달";
  if (roll > 0.36) return "동메달";
  if (roll > 0.22) return "4강탈락";
  if (roll > 0.11) return "8강탈락";
  if (roll > 0.04) return "16강탈락";
  return "예선탈락";
}

function nationalTeamResultGrantsMilitaryExemption(tournamentName: string, result: string): boolean {
  if (tournamentName.includes("아시안게임")) return result === "금메달";
  if (tournamentName.includes("올림픽")) return result === "금메달" || result === "은메달" || result === "동메달";
  return false;
}

function nationalTeamFitScore(player: CareerPlayerState, seasonYear: number, slot: string): number {
  const tools = getCareerTools(player);
  const positionPremium = ["SP", "C", "SS", "CF"].includes(player.prospect.primaryPosition) ? 4 : 0;
  const slotFit = isPitcherTools(tools)
    ? slot.startsWith("선발투수") ? tools.stamina * 0.05 + tools.command * 0.03 : tools.stuff * 0.05 + tools.mentality * 0.03
    : slot.includes("백업") || slot === "대주자/수비" ? tools.defense * 0.05 + tools.speed * 0.035 : slot === "지명타자" ? tools.power * 0.05 + tools.contact * 0.03 : tools.contact * 0.035 + tools.defense * 0.025;
  const experience = Math.min(8, player.yearsSinceDraft * 0.8);
  const militaryBonus = player.militaryStatus === "none" && careerAge(player) < 30 ? 2.5 : 0;
  return player.currentOverall * 1.12 + slotFit + positionPremium + experience + militaryBonus + deterministicNoise(`national-${seasonYear}-${slot}-${player.playerId}`) * 4;
}

function nationalTeamExistingScore(player: ExistingLeaguePlayer, seasonYear: number, slot: string): number {
  const roleBonus = slot === "마무리" ? 2.5 : slot.startsWith("선발투수") ? 1.5 : slot.includes("백업") ? 0.8 : 0;
  return player.overall * 1.15 + roleBonus + deterministicNoise(`national-existing-${seasonYear}-${slot}-${player.id}`) * 4;
}

function nationalTeamTakeoverMargin(yearsSinceDraft: number): number {
  if (yearsSinceDraft <= 1) return 8;
  if (yearsSinceDraft <= 2) return 6;
  if (yearsSinceDraft <= 4) return 4;
  return 2.5;
}

function applyMilitaryServiceTransitions(
  players: CareerPlayerState[],
  year: number,
  seasonYear: number,
  userTeamId: TeamId,
  watchedIds: Set<ProspectId>,
  nextAfterUserPickIds: Set<ProspectId>,
  news: CareerNewsItem[],
): CareerPlayerState[] {
  return players.map((player) => {
    if (player.status === "방출" || player.status === "은퇴" || player.status === "해외진출") return player;
    const age = careerAge(player, 1);
    if (player.militaryStatus === "serving" && player.militaryServiceUntilYear && year > player.militaryServiceUntilYear) {
      const completed = { ...player, militaryStatus: "completed" as const, militaryServiceUntilYear: undefined };
      completed.transactionLog = [...completed.transactionLog, `${seasonYear}년 병역 복귀`];
      addCareerNews(news, completed, year, completed.team.id === userTeamId ? 3 : 2, "병역 복귀", `${completed.prospect.name}, 병역 복귀`, "2년의 병역 일정을 마치고 팀 훈련에 다시 합류했다.", careerContext(completed, userTeamId, watchedIds, nextAfterUserPickIds));
      return completed;
    }
    if ((player.militaryStatus && player.militaryStatus !== "none") || age >= 30) return player;
    if (Math.random() > militaryEntryChance(player, age)) return player;

    const militaryType: "상무" | "일반 병역" = player.currentOverall >= 58 && player.debuted && Math.random() < 0.68 ? "상무" : "일반 병역";
    const entering = {
      ...player,
      militaryStatus: "serving" as const,
      militaryType,
      militaryServiceUntilYear: year + 1,
      transactionLog: [...player.transactionLog, `${seasonYear}년 ${militaryType} 입대`],
    };
    addCareerNews(
      news,
      entering,
      year,
      entering.team.id === userTeamId || entering.originalTeamId === userTeamId ? 3 : 2,
      "병역",
      `${entering.prospect.name}, ${militaryType} 입대`,
      militaryType === "상무"
        ? "구단은 실전 감각을 유지할 수 있는 상무 복무를 통해 성장 흐름이 크게 끊기지 않기를 기대한다."
        : "선수는 2년 병역 일정을 먼저 해결한 뒤 커리어 재개를 노린다.",
      careerContext(entering, userTeamId, watchedIds, nextAfterUserPickIds),
    );
    return entering;
  });
}

function militaryEntryChance(player: CareerPlayerState, age: number): number {
  if (age < 20 || age >= 30) return 0;
  const performanceDelay = player.currentOverall >= 68 || player.debuted ? -0.035 : 0;
  const lowLevelEarly = player.currentOverall < 52 && age <= 24 ? 0.045 : 0;
  const deadlinePressure = age >= 28 ? 0.22 : age >= 26 ? 0.105 : age >= 24 ? 0.055 : 0.025;
  return clampNumber(deadlinePressure + lowLevelEarly + performanceDelay, 0.01, age >= 29 ? 0.52 : 0.24);
}

function careerEvaluationText(player: CareerPlayerState): string {
  const change = player.currentOverall - player.initialOverall;
  if (player.status === "해외진출") return `리그 최상위권 활약을 바탕으로 메이저 진출이 발생했습니다. 초기 OVR ${player.initialOverall}에서 현재 OVR ${player.currentOverall}까지 성장했습니다.`;
  if (player.status === "방출" || player.status === "은퇴") return `${player.failureReason ?? releaseFailureReason(player)}로 인해 추적 상태가 보관 처리됐습니다. 초기 OVR ${player.initialOverall}에서 마지막 OVR ${player.currentOverall}로 마무리됐습니다.`;
  if (player.eventKeys.includes("rookie-award")) return `신인왕 수상까지 이어진 성공적인 성장 곡선입니다. 초기 대비 OVR ${formatSigned(change)}이며 현재 1군 기여가 확실합니다.`;
  if (player.eventKeys.includes("gold-glove") || player.eventKeys.includes("mvp")) return `리그 상위권 이벤트가 발생한 핵심 성공 사례입니다. 현재 OVR ${player.currentOverall}까지 성장했습니다.`;
  if (change >= 6) return `초기 평가보다 빠르게 성장 중입니다. OVR 변화 ${formatSigned(change)}로, 계속 상세 추적할 가치가 큽니다.`;
  if (player.debuted) return `1군 데뷔까지 도달했습니다. 성장 폭은 ${formatSigned(change)}이며 다음 이벤트가 실제 성공 여부를 가를 구간입니다.`;
  if (change <= 0 && player.yearsSinceDraft >= 2) return `아직 성장 신호가 약합니다. OVR 변화 ${formatSigned(change)}라 추적 단계를 낮출지 검토할 만합니다.`;
  return `아직 판단을 확정하기 이른 단계입니다. 초기 OVR ${player.initialOverall}, 현재 OVR ${player.currentOverall}입니다.`;
}

function createRemainingPoolSummary(prospects: Prospect[]): RemainingPoolSummary {
  const byRound = {
    "1-2R": prospects.filter((prospect) => prospect.visible.projectedRound.min <= 2).length,
    "3-5R": prospects.filter((prospect) => prospect.visible.projectedRound.min >= 3 && prospect.visible.projectedRound.min <= 5).length,
    "6-8R": prospects.filter((prospect) => prospect.visible.projectedRound.min >= 6 && prospect.visible.projectedRound.min <= 8).length,
    "9-10R": prospects.filter((prospect) => prospect.visible.projectedRound.min >= 9 && prospect.visible.projectedRound.min <= 10).length,
    미지명권: prospects.filter((prospect) => prospect.visible.projectedRound.min >= 11).length,
  };

  return {
    byPosition: createPositionCounts(prospects),
    byRound,
    awarded: prospects.filter((prospect) => prospect.accolades.length > 0).length,
    highConfidence: prospects.filter((prospect) => prospect.visible.confidence >= 0.68).length,
    collegeRisk: prospects.filter((prospect) => prospect.collegeCommitRisk >= 60).length,
  };
}

function createRecommendations(prospects: Prospect[], team: Team | undefined, round: number, mode: "round" | "needs"): Prospect[] {
  return [...prospects]
    .sort((left, right) => recommendationScore(right, team, round, mode) - recommendationScore(left, team, round, mode))
    .slice(0, 8);
}

function createUserTurnRecommendations(prospects: Prospect[], team: Team | undefined, round: number, bigBoardTop: Prospect | undefined): Prospect[] {
  const recommended = createRecommendations(prospects, team, round, "needs");
  const merged = bigBoardTop ? [bigBoardTop, ...recommended.filter((prospect) => prospect.id !== bigBoardTop.id)] : recommended;
  return merged.slice(0, 5);
}

function draftReason(prospect: Prospect): string {
  if (prospect.pitcherStats) {
    const maxVelocity = prospect.pitcherStats.maxVelocityKph ?? 0;
    const walks = prospect.pitcherStats.walksPerNine ?? 99;
    if (maxVelocity >= 147 && walks >= 4) return `제구 변동성은 있지만 남은 투수 중 구속 경쟁력이 큽니다.`;
    if (maxVelocity <= 141 && walks <= 2.4) return `구속 상단은 낮아도 볼넷 억제 지표가 안정적입니다.`;
    if ((prospect.pitcherStats.pitchCount ?? 0) <= 2 && prospect.pitcherStats.outPitch) return `${pitchLabel(prospect.pitcherStats.outPitch)} 중심의 뚜렷한 무기가 있습니다.`;
    if (prospect.physical.heightCm >= 190 && prospect.visible.expectedOverallRange.max >= 58) return `큰 체격과 성장 여지를 함께 볼 수 있는 투수입니다.`;
    if (["sidearm", "submarine", "low-three-quarter"].includes(prospect.pitcherStats.armSlot)) return `${armSlotLabel(prospect.pitcherStats.armSlot)} 릴리스로 타자 시야를 흔들 수 있습니다.`;
    if (prospect.collegeCommitRisk >= 65) return `진학 변수 때문에 순위가 내려온 후보입니다.`;
    if (prospect.physical.heightCm >= 190 && prospect.physical.weightKg <= 86) return `장신 마른 체형이라 증량 후 구위 상승 여지를 볼 수 있습니다.`;
    if (prospect.physical.heightCm <= 180 && maxVelocity >= 145) return `크지 않은 체구지만 팔 스피드가 먼저 보입니다.`;
  }

  if (prospect.hitterStats) {
    if (prospect.physical.heightCm <= 176 && ((prospect.hitterStats.homeRuns ?? 0) >= 6 || (prospect.hitterStats.slugging ?? 0) >= 0.5)) return `작은 체구지만 장타 생산이 있어 타구 질 확인 가치가 있습니다.`;
    if (prospect.physical.weightKg >= 90 && ((prospect.hitterStats.stolenBases ?? 0) >= 8 || (prospect.hitterStats.athleticismGrade ?? 0) >= 55)) return `체형에 비해 움직임이 좋아 수비와 주루 활용도를 볼 수 있습니다.`;
    if (prospect.physical.weightKg <= 74 && ((prospect.hitterStats.stolenBases ?? 0) >= 10 || (prospect.hitterStats.athleticismGrade ?? 0) >= 58)) return `가벼운 체형에서 나오는 순발력이 남은 풀에서 눈에 띕니다.`;
    if (prospect.primaryPosition === "C" && (prospect.hitterStats.defensiveGrade ?? 0) >= 58) return `타격보다 포수 수비 완성도에서 선택 이유가 있습니다.`;
    if (prospect.primaryPosition === "C" && prospect.physical.throws === "R") return `송구와 포구 쪽에서 백업 포수 가능성을 볼 수 있습니다.`;
    if (prospect.primaryPosition === "SS" && (prospect.hitterStats.defensiveGrade ?? 0) >= 58) return `타격보다 유격수 수비 범위가 먼저 보이는 후보입니다.`;
    if (["LF", "CF", "RF"].includes(prospect.primaryPosition) && ((prospect.hitterStats.stolenBases ?? 0) >= 13 || (prospect.hitterStats.athleticismGrade ?? 0) >= 58)) return `주루와 수비 범위로 벤치 활용도를 기대할 수 있습니다.`;
    if (["1B", "LF", "RF"].includes(prospect.primaryPosition) && (prospect.hitterStats.homeRuns ?? 0) >= 7) return `수비 부담은 있지만 장타 한 가지는 남은 풀에서 눈에 띕니다.`;
    if ((prospect.hitterStats.strikeoutRate ?? 0) >= 0.24 && (prospect.hitterStats.slugging ?? 0) >= 0.48) return `삼진 부담은 있으나 강한 타구 생산을 볼 수 있습니다.`;
    if (prospect.leagueLevel === "전국권" && (prospect.hitterStats.ops ?? 1) < 0.74) return `기록은 낮지만 상대 수준을 감안하면 재평가 여지가 있습니다.`;
    if ((prospect.leagueLevel === "약한 리그" || prospect.leagueLevel === "정보 부족") && (prospect.hitterStats.ops ?? 0) >= 0.88) return `성적은 좋지만 리그 수준 보정이 필요한 후보입니다.`;
  }

  if (prospect.visible.riskTags.includes("injury-history")) return `몸 상태 변수로 순위가 내려왔지만 관찰 가치는 남아 있습니다.`;
  if (prospect.collegeCommitRisk >= 65) return `진학 리스크가 있어 계약 가능성까지 함께 봐야 합니다.`;
  if (prospect.visible.visibility === "thin") return `공개 정보는 적지만 하위 라운드에서 확인할 만한 프로필입니다.`;
  return `순위보다 특정 지표나 팀 니즈 관점에서 검토할 만합니다.`;
}

function recommendationScore(prospect: Prospect, team: Team | undefined, round: number, mode: "round" | "needs"): number {
  const talent = 380 - prospect.visible.publicRank + GRADE_WEIGHT[prospect.visible.scoutGrade] * 11 + prospect.visible.expectedOverallRange.max * 1.4;
  const need = team ? teamNeedScore(team, prospect.primaryPosition) : 0;
  const scarcity = positionScarcity(prospect.primaryPosition);
  const upside = prospect.visible.expectedOverallRange.max >= 65 ? 22 : 0;
  const safe = prospect.visible.confidence >= 0.7 && prospect.visible.riskLevel !== "high" ? 18 : 0;
  const lateTool = round >= 6 && isLateRoundHookProspect(prospect) ? 34 : 0;
  const roundShape = round <= 2 ? talent * 0.42 + upside : round <= 5 ? need * 1.1 + scarcity + safe : need * 0.9 + scarcity * 1.2 + lateTool;
  return talent + roundShape + (mode === "needs" ? need * 1.6 : 0) - (prospect.visible.riskLevel === "high" && round <= 5 ? 18 : 0);
}

function isLateRoundHookProspect(prospect: Prospect): boolean {
  if (prospect.archetype === "하위 라운드 관찰 후보") return true;
  if (prospect.visible.visibility === "thin") return true;
  if (prospect.visible.riskTags.includes("injury-history") || prospect.collegeCommitRisk >= 65) return true;
  if (prospect.pitcherStats) {
    if ((prospect.pitcherStats.maxVelocityKph ?? 0) >= 147 && (prospect.pitcherStats.walksPerNine ?? 0) >= 4) return true;
    if ((prospect.pitcherStats.maxVelocityKph ?? 200) <= 141 && (prospect.pitcherStats.walksPerNine ?? 99) <= 2.4) return true;
    if (["sidearm", "submarine", "low-three-quarter"].includes(prospect.pitcherStats.armSlot)) return true;
  }
  if (prospect.hitterStats) {
    if ((prospect.hitterStats.defensiveGrade ?? 0) >= 58 && ["C", "SS", "CF"].includes(prospect.primaryPosition)) return true;
    if ((prospect.hitterStats.homeRuns ?? 0) >= 7 || (prospect.hitterStats.stolenBases ?? 0) >= 13) return true;
  }
  return false;
}

function positionScarcity(position: Position): number {
  if (position === "C" || position === "SS") return 24;
  if (position === "SP" || position === "CF") return 18;
  if (position === "2B" || position === "3B") return 10;
  return 5;
}

function pickValueType(pick: DraftPick, prospect: Prospect): "overpick" | "slide" | "fit" {
  const expectedStart = (prospect.visible.projectedRound.min - 1) * 10 + 1;
  const expectedEnd = prospect.visible.projectedRound.max * 10;
  const expectedRoundCenter = (prospect.visible.projectedRound.min + prospect.visible.projectedRound.max) / 2;
  const overpickBuffer =
    prospect.visible.projectedRound.min <= 2
      ? 5
      : pick.round <= 3
        ? 4
        : pick.round <= 6
          ? 6
          : 8;
  const slideBuffer =
    pick.round >= 7
      ? prospect.visible.projectedRound.max <= 3
        ? 28
        : 36
      : prospect.visible.projectedRound.max <= 2
        ? 10
        : prospect.visible.projectedRound.max <= 5
          ? 14
          : 18;
  if (prospect.visible.projectedRound.min >= 11 && pick.round <= 10) return "overpick";
  if (expectedRoundCenter - pick.round >= 2) return "overpick";
  if (pick.overall < expectedStart - overpickBuffer) return "overpick";
  if (pick.round >= 7 && (prospect.visible.publicRank > 120 || prospect.visible.projectedRound.max >= 7)) return "fit";
  if (pick.overall > expectedEnd + slideBuffer) return "slide";
  return "fit";
}

function pickValueLabel(pick: DraftPick, prospect: Prospect): string {
  const type = pickValueType(pick, prospect);
  if (type === "overpick") return "오버픽";
  if (type === "slide") return "슬라이드";
  return "적정";
}

function formatExpectedPickRange(prospect: Prospect): string {
  const min = (prospect.visible.projectedRound.min - 1) * 10 + 1;
  const max = prospect.visible.projectedRound.max >= 11 ? 999 : prospect.visible.projectedRound.max * 10;
  if (prospect.visible.projectedRound.min >= 11) return "미지명권";
  if (max >= 999) return `${min}번 이후`;
  return min === max ? `${min}번` : `${min}-${max}번`;
}

function shortRiskTags(prospect: Prospect): string {
  if (prospect.visible.riskTags.length === 0) return "-";
  const labels = prospect.visible.riskTags.map((tag) => RISK_LABELS[tag]);
  return labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} 외 ${labels.length - 2}`;
}

function formatPositionCounts(counts: Partial<Record<Position, number>>): string {
  const items = POSITIONS.filter((position) => counts[position]).map((position) => `${positionLabel(position)} ${counts[position]}`);
  return items.length ? items.join(" / ") : "-";
}

function createDraftSummary(selections: DraftSelectionView[], team: Team | undefined, reactions: FanPickReaction[]): DraftSummary {
  const pitcherCount = selections.filter((selection) => selection.prospect.playerGroup === "pitcher").length;
  const hitterCount = selections.length - pitcherCount;
  const top100Count = selections.filter((selection) => selection.prospect.visible.publicRank <= 100).length;
  const lotteryCount = selections.filter((selection) => selection.prospect.visible.publicRank >= 201).length;
  const overpickCount = selections.filter((selection) => pickValueType(selection.pick, selection.prospect) === "overpick").length;
  const slidePickCount = selections.filter((selection) => pickValueType(selection.pick, selection.prospect) === "slide").length;
  const injuryRiskCount = selections.filter((selection) => selection.prospect.visible.riskTags.includes("injury-history")).length;
  const collegeRiskCount = selections.filter((selection) => selection.prospect.collegeCommitRisk >= 60).length;
  const awardedCount = selections.filter((selection) => selection.prospect.accolades.length > 0).length;
  const positionCounts = selections.reduce(
    (counts, selection) => ({ ...counts, [selection.prospect.primaryPosition]: (counts[selection.prospect.primaryPosition] ?? 0) + 1 }),
    {} as Partial<Record<Position, number>>,
  );
  const averageNeed = selections.length && team ? selections.reduce((sum, selection) => sum + teamNeedScore(team, selection.prospect.primaryPosition), 0) / selections.length : 0;
  const averageFan = reactions.length ? reactions.reduce((sum, reaction) => sum + reaction.score, 0) / reactions.length : 0;
  const internalScore = clampNumber(
    50 +
      top100Count * 4 +
      slidePickCount * 3 +
      lotteryCount * 1.5 +
      averageNeed * 0.22 -
      overpickCount * 3 -
      injuryRiskCount * 2 -
      collegeRiskCount * 1.5,
    0,
    100,
  );
  const notes = createDraftEvaluationNotes({
    selections,
    team,
    pitcherCount,
    hitterCount,
    top100Count,
    lotteryCount,
    overpickCount,
    slidePickCount,
    injuryRiskCount,
    collegeRiskCount,
    awardedCount,
    averageNeed,
    averageFan,
  });

  return {
    pitcherCount,
    hitterCount,
    top100Count,
    lotteryCount,
    overpickCount,
    slidePickCount,
    injuryRiskCount,
    collegeRiskCount,
    awardedCount,
    positionCounts,
    needGrade: summaryGrade(averageNeed),
    fanGrade: plusGrade(averageFan),
    fanAverage: Math.round(averageFan),
    internalGrade: plusGrade(internalScore),
    notes,
  };
}

function createDraftEvaluationNotes(context: {
  selections: DraftSelectionView[];
  team: Team | undefined;
  pitcherCount: number;
  hitterCount: number;
  top100Count: number;
  lotteryCount: number;
  overpickCount: number;
  slidePickCount: number;
  injuryRiskCount: number;
  collegeRiskCount: number;
  awardedCount: number;
  averageNeed: number;
  averageFan: number;
}): string[] {
  const notes: string[] = [];
  const earlyStable = context.selections.filter((selection) => selection.pick.round <= 3 && selection.prospect.visible.publicRank <= 100).length >= 2;
  const lateUpside = context.selections.filter((selection) => selection.pick.round >= 6 && (selection.prospect.visible.publicRank >= 201 || isLateRoundHookProspect(selection.prospect))).length;

  if (earlyStable && lateUpside <= 1) notes.push("상위 라운드는 안정적이지만 하위 라운드 고점이 부족합니다.");
  if (context.team) {
    const topNeed = context.team.needs[0]?.position;
    const filledTopNeed = topNeed ? context.selections.some((selection) => selection.prospect.primaryPosition === topNeed) : false;
    const spNeed = teamNeedScore(context.team, "SP");
    const spCount = context.selections.filter((selection) => selection.prospect.primaryPosition === "SP").length;
    if (topNeed && filledTopNeed && spNeed >= 55 && spCount === 0) notes.push(`팀 니즈였던 ${positionLabel(topNeed)} 보강에는 성공했지만 선발투수 뎁스는 여전히 부족합니다.`);
  }
  if (context.overpickCount >= 3 && context.lotteryCount >= 3) notes.push("컨센서스보다 빠른 지명이 많아 팬 반응은 낮을 수 있지만, 고점은 높은 드래프트입니다.");
  if (context.injuryRiskCount + context.collegeRiskCount >= 4) notes.push("부상 또는 대학 진학 리스크가 큰 선수들이 많아 장기 결과의 변동성이 큽니다.");
  if (context.slidePickCount >= 2) notes.push("예상보다 밀린 선수를 여러 명 확보해 보드 가치 측면의 여지가 있습니다.");
  if (context.averageNeed >= 60) notes.push("팀 니즈와의 정합성은 높은 편이지만 실제 성공 여부는 커리어 시뮬레이션에서 확인해야 합니다.");
  if (notes.length === 0) notes.push("뚜렷한 강점과 리스크가 섞인 드래프트입니다. 현재 평가는 최종 성공/실패 판정이 아닙니다.");
  return notes.slice(0, 4);
}

function summaryGrade(score: number): string {
  if (score >= 72) return "A";
  if (score >= 60) return "B";
  if (score >= 45) return "C";
  if (score >= 32) return "D";
  return "F";
}

function plusGrade(score: number): string {
  if (score >= 88) return "A+";
  if (score >= 80) return "A";
  if (score >= 72) return "B+";
  if (score >= 64) return "B";
  if (score >= 56) return "C+";
  if (score >= 48) return "C";
  if (score >= 36) return "D";
  return "F";
}

function riskText(riskLevel: string) {
  return { low: "낮음", medium: "중간", high: "높음", extreme: "극상" }[riskLevel] ?? riskLevel;
}

function isMlbDirectSigned(prospect: Prospect): boolean {
  return prospect.mlbDirectStatus === "signed";
}

function mlbDirectLabel(prospect: Prospect): string {
  if (prospect.mlbDirectStatus === "signed") return "MLB 직행 계약";
  if (prospect.mlbDirectStatus === "interest") return `MLB 관심 ${prospect.mlbInterestLevel ?? "-"}점`;
  return "없음";
}

function needLevel(value: number): "low" | "normal" | "high" | "priority" {
  if (value >= 75) return "priority";
  if (value >= 58) return "high";
  if (value >= 38) return "normal";
  return "low";
}

function needLevelLabel(value: number): string {
  return { low: "낮음", normal: "보통", high: "높음", priority: "최우선" }[needLevel(value)];
}

function positionLabel(position: Position): string {
  return POSITION_LABELS[position];
}

function prospectSourceType(prospect: Prospect): ProspectSourceType {
  return prospect.sourceType ?? "high-school";
}

function sourceTypeLabel(prospect: Prospect): string {
  return SOURCE_TYPE_LABELS[prospectSourceType(prospect)];
}

function prospectPathLabel(prospect: Prospect): string {
  if (prospect.sourceType === "college") return `대학 ${prospect.collegeYear ?? "-"}학년`;
  if (prospect.sourceType === "overseas-returnee") return `${overseasPathLabel(prospect.overseasPath)} ${prospect.overseasYears ?? "-"}년`;
  return `${prospect.schoolYear}학년`;
}

function prospectDraftPathSummary(prospect: Prospect): string {
  if (prospect.sourceType === "college") return prospect.draftEligibilityNote ?? `대학 ${prospect.collegeYear ?? "-"}학년 지명 대상`;
  if (prospect.sourceType === "overseas-returnee") {
    const reason = prospect.returnReason ? ` · 복귀 사유: ${prospect.returnReason}` : "";
    return `${prospect.draftEligibilityNote ?? "해외 경력 후 국내 복귀"}${reason}`;
  }
  return `${prospect.schoolYear}학년 · ${prospect.draftEligibleYear}년 드래프트 예정`;
}

function overseasPathLabel(path?: Prospect["overseasPath"]): string {
  if (path === "mlb-minor") return "MLB 마이너";
  if (path === "npb-minor") return "NPB 육성/2군";
  if (path === "independent") return "해외 독립리그";
  if (path === "academy") return "해외 아카데미";
  return "해외 경력";
}

function isDraftEligibleProspect(prospect: Prospect, year: number): boolean {
  return prospect.draftEligibleYear === year && prospect.schoolYear === 3 && !isMlbDirectSigned(prospect);
}

function gradeLabel(grade: ScoutGrade): string {
  return GRADE_LABELS[grade];
}

function schoolTierLabel(tier: SchoolTier): string {
  return SCHOOL_TIER_LABELS[tier];
}

function schoolTraitLabel(trait: SchoolTrait): string {
  return SCHOOL_TRAIT_LABELS[trait];
}

function schoolProfileText(prospect: Prospect): string {
  const traits = prospect.schoolTraits.map(schoolTraitLabel).join(", ");
  return `${prospect.school}는 ${prospect.schoolRegion} ${schoolTierLabel(prospect.schoolTier)} 학교입니다. 리그 강도 ${prospect.schoolLeagueStrength}, 기본 리포트 신뢰도 ${prospect.schoolReportReliabilityBase}%이며 ${SCHOOL_BIAS_LABELS[prospect.schoolDevelopmentBias]} 성향이 선수 생성과 평가 표본에 반영됩니다.${traits ? ` 주요 특성: ${traits}.` : ""}`;
}

function throwsBatsText(prospect: Prospect): string {
  return `${handLabel(prospect.physical.throws)}투/${handLabel(prospect.physical.bats)}타`;
}

function handLabel(hand: "L" | "R" | "S"): string {
  if (hand === "L") return "좌";
  if (hand === "R") return "우";
  return "양";
}

function pitchLabel(pitch: PitcherStats["outPitch"] | undefined): string {
  if (!pitch) return "-";
  return {
    "four-seam": "포심",
    "two-seam": "투심",
    fastball: "직구",
    slider: "슬라이더",
    curveball: "커브",
    changeup: "체인지업",
    splitter: "스플리터",
    forkball: "포크볼",
    sinker: "싱커",
    cutter: "커터",
  }[pitch];
}

function pitchArsenalLine(stats: PitcherStats): string {
  if (!stats.pitchArsenal || stats.pitchArsenal.length === 0) return "-";
  return stats.pitchArsenal.map((pitch) => `${pitchLabel(pitch.type)} ${pitch.grade}`).join(" / ");
}

function mergePitchArsenal(snapshots: PitcherStats[]): PitcherStats["pitchArsenal"] {
  const pitchMap = new Map<NonNullable<PitcherStats["outPitch"]>, number>();
  snapshots.forEach((stats) => {
    stats.pitchArsenal?.forEach((pitch) => {
      pitchMap.set(pitch.type, Math.max(pitchMap.get(pitch.type) ?? 0, pitch.grade));
    });
  });
  if (pitchMap.size === 0) return undefined;
  return Array.from(pitchMap.entries())
    .map(([type, grade]) => ({ type, grade: roundGrade(grade) }))
    .sort((left, right) => pitchDisplayOrder(left.type) - pitchDisplayOrder(right.type));
}

function strongestVisiblePitch(stats: PitcherStats): PitcherStats["outPitch"] {
  return [...(stats.pitchArsenal ?? [])].sort((left, right) => right.grade - left.grade)[0]?.type ?? stats.outPitch;
}

function pitchDisplayOrder(type: NonNullable<PitcherStats["outPitch"]>): number {
  return {
    "four-seam": 0,
    "two-seam": 1,
    sinker: 2,
    cutter: 3,
    curveball: 4,
    slider: 5,
    changeup: 6,
    forkball: 7,
    splitter: 8,
    fastball: 9,
  }[type];
}

function armSlotLabel(armSlot: PitcherStats["armSlot"] | undefined): string {
  if (!armSlot) return "-";
  return {
    "three-quarter": "쓰리쿼터",
    overhand: "오버핸드",
    "low-three-quarter": "로우쓰리쿼터",
    sidearm: "사이드암",
    submarine: "언더핸드",
  }[armSlot];
}

function createFanMockDraft(team: Team, prospects: Prospect[]): FanMockCandidate[] {
  const scored = prospects
    .map((prospect) => {
      const reasons = fanSupportReasons(team, prospect);
      const score =
        Math.max(0, 90 - prospect.visible.publicRank) * 0.9 +
        prospect.reputation * 0.9 +
        prospect.draftHype * 0.75 +
        teamNeedScore(team, prospect.primaryPosition) * 0.38 +
        localSchoolScore(team, prospect) * 18 +
        (prospect.accolades.length * 8) +
        (hasAccolade(prospect, "baseball-variety-breakout") ? 7 : hasAccolade(prospect, "baseball-variety") ? 3 : 0) -
        (prospect.visible.riskTags.includes("reputation-risk") ? 14 : 0) +
        (prospect.leagueLevel === "전국권" ? 10 : prospect.leagueLevel === "상위권" ? 5 : 0) -
        (prospect.collegeCommitRisk >= 70 ? 9 : 0) +
        ((prospect.pitcherStats?.maxVelocityKph ?? 0) >= 150 ? 16 : 0) +
        ((prospect.hitterStats?.homeRuns ?? 0) >= 8 ? 14 : 0) +
        deterministicNoise(`${team.id}-${prospect.id}`) * 11;

      return {
        prospect,
        reasons,
        concern: fanConcern(prospect),
        score,
        supportRate: 0,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  const total = scored.reduce((sum, candidate) => sum + candidate.score, 0) || 1;
  return scored.map((candidate) => ({
    ...candidate,
    supportRate: Math.max(7, Math.round((candidate.score / total) * 100)),
  }));
}

function createTeamFanOpinion(
  team: Team | undefined,
  userTeamId: TeamId | undefined,
  latestResults: TeamSeasonResult[],
  userHistory: TeamSeasonResult[],
  needRows: ReturnType<typeof createNeedRows>,
  players: CareerPlayerState[],
  trades: PickTradeEvent[],
  nextPicks: DraftPick[],
  strengthAdjustments: Record<string, number>,
) {
  const base = {
    score: 50,
    label: "관망",
    mood: "neutral" as "positive" | "neutral" | "negative",
    positives: ["새 시즌 방향성을 지켜보자는 분위기입니다."],
    negatives: ["뚜렷한 성과가 나오기 전까지는 여론이 쉽게 움직이지 않습니다."],
    comments: ["아직은 판단 보류입니다. 드래프트랑 육성 결과를 더 봐야죠."],
  };
  if (!team || !userTeamId) return base;

  const latest = latestResults.find((result) => result.teamId === userTeamId);
  const previous = userHistory[userHistory.length - 2];
  const userPlayers = players.filter((player) => player.originalTeamId === userTeamId || player.team.id === userTeamId);
  const activeUserPlayers = userPlayers.filter((player) => player.status !== "방출" && player.status !== "은퇴" && player.status !== "해외진출");
  const debutCount = activeUserPlayers.filter((player) => player.debuted).length;
  const risingProspects = activeUserPlayers.filter((player) => player.currentOverall - player.initialOverall >= 5).length;
  const releasedCount = userPlayers.filter((player) => player.status === "방출" || player.status === "은퇴").length;
  const topNeed = needRows[0];
  const priorityNeeds = needRows.filter((row) => row.need >= 70).slice(0, 3);
  const userPickCount = nextPicks.filter((pick) => pick.ownerTeamId === userTeamId).length;
  const tradeImpact = strengthAdjustments[String(userTeamId)] ?? 0;
  const userTrades = trades.filter((event) => event.fromTeamId === userTeamId || event.toTeamId === userTeamId);

  let score = 52;
  const positives: string[] = [];
  const negatives: string[] = [];
  const comments: string[] = [];

  if (latest) {
    const rankChange = latest.previousRank ? latest.previousRank - latest.rank : 0;
    score += (11 - latest.rank) * 3.4;
    score -= Math.max(0, latest.rank - 7) * 7.5;
    score += rankChange * 2.8;
    score += latest.prospectContribution * 1.1 + latest.regularContribution * 0.9 + latest.draftImpact * 0.75;
    score -= latest.injuryPenalty * 0.65;
    score += latest.pickTradeImpact * 0.55;
    if (latest.rank <= 3) positives.push(`${latest.rank}위 마감으로 팬 여론은 확실히 달아올랐습니다.`);
    if (latest.rank >= 8) negatives.push(`${latest.rank}위 시즌에 대한 불만이 큽니다.`);
    if (rankChange > 0) positives.push(`전년 대비 ${rankChange}계단 상승하며 방향성에 대한 신뢰가 조금 붙었습니다.`);
    if (rankChange < 0) negatives.push(`전년 대비 ${Math.abs(rankChange)}계단 하락해 프런트 책임론이 나옵니다.`);
    if (latest.prospectContribution >= 5) positives.push("드래프트 출신 유망주 기여가 보이면서 육성 파트 평가는 좋아졌습니다.");
    if (latest.injuryPenalty >= 5) negatives.push("부상 악재가 반복되며 선수 관리에 대한 불만이 있습니다.");
    comments.push(...seasonFanComments(team, latest, rankChange));
  } else {
    score += team.currentStrength - 52;
    positives.push("아직 시즌 결과 전이라 팬들은 드래프트 방향성과 팀 니즈를 먼저 보고 있습니다.");
    comments.push("올해는 순위보다 방향성이 먼저입니다. 어디를 보강할지 보겠습니다.");
  }

  if (risingProspects >= 2) {
    score += 7;
    positives.push(`성장세가 뚜렷한 유망주 ${risingProspects}명이 확인돼 팬들의 기대가 커졌습니다.`);
    comments.push("그래도 애들 크는 건 보입니다. 이 맛에 버티는 거죠.");
  }
  if (debutCount >= 2) {
    score += 4;
    positives.push(`1군 데뷔 경험자가 ${debutCount}명까지 늘어났습니다.`);
  }
  if (releasedCount >= 3) {
    score -= 7;
    negatives.push(`방출/은퇴 처리된 지명 선수가 ${releasedCount}명으로 늘며 최근 드래프트에 대한 의심이 있습니다.`);
    comments.push("뽑고 키우는 게 맞는지 모르겠습니다. 사라지는 선수가 너무 많아요.");
  }
  if (priorityNeeds.length > 0) {
    score -= priorityNeeds.length * 4;
    negatives.push(`팬들은 ${priorityNeeds.map((row) => positionLabel(row.position)).join(", ")} 보강을 강하게 요구하고 있습니다.`);
    comments.push(`${positionLabel(topNeed.position)} 안 메우면 또 같은 얘기 나옵니다. 이제는 좀 해결해야죠.`);
  }
  if (userPickCount >= 11) {
    score += 5;
    positives.push(`다음 드래프트 지명권이 ${userPickCount}장으로 늘어 기대감이 있습니다.`);
    comments.push("픽 많으면 일단 재밌습니다. 이번엔 제발 제대로 긁어봅시다.");
  } else if (userPickCount > 0 && userPickCount <= 8) {
    score -= 5;
    negatives.push(`다음 드래프트 지명권이 ${userPickCount}장뿐이라 비시즌 선택에 대한 우려가 있습니다.`);
    comments.push("픽을 너무 쉽게 쓰는 거 아닌가요? 미래가 얇아지는 느낌입니다.");
  }
  if (tradeImpact > 0) positives.push("즉전 전력 보강으로 단기 성적 기대감은 올라갔습니다.");
  if (tradeImpact < 0) negatives.push("지명권 확보 대신 전력이 약해졌다는 불만도 있습니다.");
  if (userTrades.length > 0) comments.push("트레이드 방향은 이해해도 결과 없으면 바로 말 나옵니다.");

  const scoreCap = latest
    ? latest.rank >= 10
      ? 42
      : latest.rank >= 8
        ? 55
        : latest.previousRank && latest.previousRank - latest.rank <= -5
          ? 62
          : 100
    : 100;
  const finalScore = Math.round(clampNumber(score, 0, scoreCap));
  const mood = finalScore >= 68 ? "positive" : finalScore <= 42 ? "negative" : "neutral";
  const label = finalScore >= 78 ? "우호적" : finalScore >= 60 ? "기대 우세" : finalScore >= 43 ? "관망" : finalScore >= 28 ? "불만" : "폭발 직전";
  return {
    score: finalScore,
    label,
    mood,
    positives: uniqueStrings(positives).slice(0, 4),
    negatives: uniqueStrings(negatives).slice(0, 4),
    comments: uniqueStrings(comments.length ? comments : ["팬들은 아직 반신반의하고 있습니다. 결과가 나오기 전까지는 조용하지 않을 분위기입니다."]).slice(0, 6),
  };
}

function createTeamFanMetrics(
  team: Team | undefined,
  userTeamId: TeamId | undefined,
  players: CareerPlayerState[],
  results: TeamSeasonResult[],
  opinion: ReturnType<typeof createTeamFanOpinion>,
  awards: YearlyAwardRow[],
  allStars: SelectionHistoryRow[],
  nationalTeams: SelectionHistoryRow[],
  records: RecordBreakerRow[],
): TeamFanMetrics {
  if (!team || !userTeamId) {
    return {
      popularity: 50,
      popularityLabel: "기준값",
      attendanceIndex: 50,
      merchandiseIndex: 50,
      onlineBuzz: 50,
      loyaltyIndex: 50,
      momentum: "아직 팬덤 흐름을 판단할 데이터가 부족합니다.",
      jerseyRows: [],
    };
  }
  const teamPlayers = players.filter((player) => player.team.id === userTeamId && player.status !== "방출" && player.status !== "은퇴" && player.status !== "해외진출");
  const latest = [...results].filter((result) => result.teamId === userTeamId).sort((left, right) => right.yearIndex - left.yearIndex)[0];
  const recent = [...results].filter((result) => result.teamId === userTeamId).sort((left, right) => right.yearIndex - left.yearIndex).slice(0, 3);
  const starPower = teamPlayers.reduce((sum, player) => sum + Math.max(0, jerseySalesScore(player, awards, allStars, nationalTeams, records) - 55) / 12, 0);
  const rankBoost = latest ? (11 - latest.rank) * 2.2 : 0;
  const recentAverageRank = recent.length ? recent.reduce((sum, result) => sum + result.rank, 0) / recent.length : 6;
  const playoffSignal = recent.filter((result) => result.rank <= 5).length;
  const draftedStarCount = teamPlayers.filter((player) => player.originalTeamId === userTeamId && player.currentOverall >= 70).length;
  const departedStarPenalty = players.filter((player) => player.originalTeamId === userTeamId && player.team.id !== userTeamId && player.currentOverall >= 70 && player.status !== "방출" && player.status !== "은퇴").length * 3;
  const rankChange = latest?.previousRank ? latest.previousRank - latest.rank : 0;
  const poorSeasonPenalty = latest ? Math.max(0, latest.rank - 7) * 8 : 0;
  const collapsePenalty = Math.max(0, -rankChange - 2) * 4.5;
  const popularityCap = latest
    ? latest.rank >= 10
      ? 58
      : latest.rank >= 8
        ? 70
        : rankChange <= -5
          ? 76
          : 100
    : 100;
  const attendanceCap = latest && latest.rank >= 10 ? 52 : latest && latest.rank >= 8 ? 66 : 100;
  const loyaltyCap = latest && latest.rank >= 10 ? 68 : latest && rankChange <= -5 ? 74 : 100;

  const popularity = Math.round(clampNumber(34 + opinion.score * 0.28 + rankBoost + starPower + playoffSignal * 3 + draftedStarCount * 1.8 - departedStarPenalty - poorSeasonPenalty - collapsePenalty, 0, popularityCap));
  const attendanceIndex = Math.round(clampNumber(popularity * 0.62 + (latest ? (11 - latest.rank) * 3.4 : 12) + opinion.score * 0.16 - poorSeasonPenalty * 0.55, 0, attendanceCap));
  const merchandiseIndex = Math.round(clampNumber(38 + starPower * 4.8 + teamPlayers.filter((player) => player.currentOverall >= 68).length * 2.2 + opinion.score * 0.16, 0, 100));
  const onlineBuzz = Math.round(clampNumber(35 + opinion.score * 0.2 + teamPlayers.filter((player) => player.eventKeys.length >= 5 || player.currentOverall >= 74).length * 4.2 + departedStarPenalty * 1.6 + collapsePenalty * 0.45, 0, 100));
  const loyaltyIndex = Math.round(clampNumber(42 + (11 - recentAverageRank) * 2.4 + teamPlayers.filter((player) => player.originalTeamId === userTeamId && yearsWithTeam(player, team) >= 5).length * 3 + opinion.score * 0.15 - poorSeasonPenalty * 0.35, 0, loyaltyCap));
  const jerseyRows = createJerseySalesRows(teamPlayers, awards, allStars, nationalTeams, records);

  return {
    popularity,
    popularityLabel: fanPopularityLabel(popularity),
    attendanceIndex,
    merchandiseIndex,
    onlineBuzz,
    loyaltyIndex,
    momentum: fanMomentumText(latest, recent, opinion.score),
    jerseyRows,
  };
}

function createJerseySalesRows(players: CareerPlayerState[], awards: YearlyAwardRow[], allStars: SelectionHistoryRow[], nationalTeams: SelectionHistoryRow[], records: RecordBreakerRow[]): JerseySalesRow[] {
  const scored = players
    .map((player) => ({
      player,
      score: jerseySalesScore(player, awards, allStars, nationalTeams, records),
      reason: jerseySalesReason(player, awards, allStars, nationalTeams, records),
    }))
    .filter((row) => row.score >= 42)
    .sort((left, right) => right.score - left.score || right.player.currentOverall - left.player.currentOverall)
    .slice(0, 10);
  const total = scored.reduce((sum, row) => sum + row.score, 0) || 1;
  return scored.map((row, index) => ({
    ...row,
    rank: index + 1,
    salesShare: Math.round((row.score / total) * 100),
  }));
}

function jerseySalesScore(player: CareerPlayerState, awards: YearlyAwardRow[], allStars: SelectionHistoryRow[], nationalTeams: SelectionHistoryRow[], records: RecordBreakerRow[]): number {
  const playerAwards = awards.filter((row) => row.playerId === player.playerId);
  const playerAllStars = allStars.filter((row) => row.playerId === player.playerId);
  const playerNationalTeams = nationalTeams.filter((row) => row.playerId === player.playerId);
  const playerRecords = records.filter((row) => row.player.playerId === player.playerId);
  const awardBoost = playerAwards.filter((row) => row.category.startsWith("골든글러브")).length * 9 + playerAwards.filter((row) => !row.category.startsWith("골든글러브")).length * 6;
  const starBoost = playerAllStars.length * 4 + playerNationalTeams.length * 5 + playerRecords.length * 8;
  const homegrownBoost = player.originalTeamId === player.team.id ? 7 : 0;
  const ageBoost = player.yearsSinceDraft <= 2 ? 4 : player.yearsSinceDraft >= 8 ? 5 : 0;
  const storyBoost = player.eventKeys.includes("rookie-award") ? 8 : player.eventKeys.includes("late-breakout") ? 10 : player.eventKeys.includes("mvp") ? 14 : 0;
  const positionBoost = ["SP", "C", "SS", "CF"].includes(player.prospect.primaryPosition) ? 4 : 1;
  return Math.round(clampNumber(player.currentOverall * 0.95 + legacyScore(player) * 0.16 + awardBoost + starBoost + homegrownBoost + ageBoost + storyBoost + positionBoost, 0, 160));
}

function jerseySalesReason(player: CareerPlayerState, awards: YearlyAwardRow[], allStars: SelectionHistoryRow[], nationalTeams: SelectionHistoryRow[], records: RecordBreakerRow[]): string {
  const reasons: string[] = [];
  const playerAwards = awards.filter((row) => row.playerId === player.playerId);
  const goldGloves = playerAwards.filter((row) => row.category.startsWith("골든글러브")).length;
  const titles = playerAwards.length - goldGloves;
  const allStarCount = allStars.filter((row) => row.playerId === player.playerId).length;
  const nationalCount = nationalTeams.filter((row) => row.playerId === player.playerId).length;
  const recordCount = records.filter((row) => row.player.playerId === player.playerId).length;
  if (player.currentOverall >= 76) reasons.push("팀 대표 스타");
  if (goldGloves > 0) reasons.push(`골글 ${goldGloves}회`);
  if (titles > 0) reasons.push(`타이틀 ${titles}회`);
  if (allStarCount > 0) reasons.push(`올스타 ${allStarCount}회`);
  if (nationalCount > 0) reasons.push(`국대 ${nationalCount}회`);
  if (recordCount > 0) reasons.push(`대기록 ${recordCount}건`);
  if (player.originalTeamId === player.team.id) reasons.push("홈그로운");
  if (player.pick.round >= 8 && player.currentOverall >= 65) reasons.push("하위라운드 서사");
  return reasons.slice(0, 3).join(" · ") || "성장 기대주";
}

function fanPopularityLabel(score: number): string {
  if (score >= 85) return "전국구 흥행팀";
  if (score >= 72) return "상위권 인기팀";
  if (score >= 58) return "관심 상승";
  if (score >= 42) return "보통";
  if (score >= 28) return "침체";
  return "무관심 위험";
}

function fanMomentumText(latest: TeamSeasonResult | undefined, recent: TeamSeasonResult[], opinionScore: number): string {
  if (!latest) return "시즌 결과 전이라 드래프트와 비시즌 여론이 팬덤 흐름을 좌우합니다.";
  const previous = recent[1];
  const rankChange = previous ? previous.rank - latest.rank : 0;
  if (latest.rank <= 3 && opinionScore >= 65) return "성적과 여론이 함께 올라오는 흥행 상승 구간입니다.";
  if (rankChange >= 3) return `전년 대비 ${rankChange}계단 상승하며 팬덤 유입이 늘었습니다.`;
  if (latest.rank >= 8 && opinionScore <= 45) return "성적 부진과 불만 여론이 겹쳐 팬덤 온도가 낮습니다.";
  if (rankChange <= -3) return `전년 대비 ${Math.abs(rankChange)}계단 하락해 충성 팬 중심으로 버티는 흐름입니다.`;
  return "큰 폭의 유입이나 이탈 없이 기존 팬덤이 유지되는 흐름입니다.";
}

function seasonFanComments(team: Team, result: TeamSeasonResult, rankChange: number): string[] {
  const comments: string[] = [];
  if (result.rank <= 3) comments.push(`${team.shortName} 팬들 오랜만에 야구 볼 맛 났습니다. 이 정도면 비시즌도 기대해볼 만하죠.`);
  if (result.rank >= 8) comments.push(`${result.rank}위면 말이 곱게 나올 수가 없습니다. 드래프트 순번 말고 위안이 없네요.`);
  if (rankChange > 0) comments.push(`작년보다 올라간 건 인정합니다. 그래도 여기서 만족하면 안 됩니다.`);
  if (rankChange < 0) comments.push(`작년보다 내려갔는데 같은 말만 반복하면 팬들이 못 참습니다.`);
  if (result.prospectContribution >= 5) comments.push("어린 선수들이 조금씩 보이는 건 좋습니다. 이 흐름은 계속 밀어야죠.");
  if (result.injuryPenalty >= 5) comments.push("부상 얘기는 이제 지겹습니다. 관리 시스템부터 봐야 하는 거 아닌가요.");
  if (result.nextFirstRoundPick <= 3) comments.push(`${result.nextFirstRoundPick}순위면 진짜 제대로 뽑아야 합니다. 이번 픽은 변명 안 됩니다.`);
  if (comments.length === 0) comments.push("좋지도 나쁘지도 않은 시즌이라 더 애매합니다. 비시즌에 방향을 보여줘야죠.");
  return comments;
}

function fanSupportReasons(team: Team, prospect: Prospect): string[] {
  const reasons: string[] = [];
  if (prospect.visible.publicRank <= 15) reasons.push("언론 상위 랭킹");
  if (teamNeedScore(team, prospect.primaryPosition) >= 55) reasons.push("팀 니즈 적합");
  const primaryAccolade = prospect.accolades.find((accolade) => accolade.id !== "baseball-variety" && accolade.id !== "baseball-variety-breakout");
  if (primaryAccolade) reasons.push(primaryAccolade.label);
  if (hasAccolade(prospect, "baseball-variety-breakout")) reasons.push("예능 활약 인지도");
  else if (hasAccolade(prospect, "baseball-variety")) reasons.push("방송 노출");
  if (prospect.leagueLevel === "전국권") reasons.push("전국권 검증");
  if (localSchoolScore(team, prospect) > 0) reasons.push("지역 연고");
  if ((prospect.pitcherStats?.maxVelocityKph ?? 0) >= 150) reasons.push("150㎞/시 구속");
  if ((prospect.hitterStats?.homeRuns ?? 0) >= 8) reasons.push("장타 실적");
  if (reasons.length === 0) reasons.push("데이터 기반 선호");
  return reasons.slice(0, 3);
}

function fanConcern(prospect: Prospect): string {
  if (prospect.visible.riskTags.includes("reputation-risk")) return "인지도는 높지만 학교생활 논란 때문에 팬 여론이 갈립니다.";
  if (prospect.visible.riskTags.includes("injury-history")) return "부상 루머가 있어 장기 육성 리스크를 걱정하는 여론이 있습니다.";
  if (prospect.visible.riskTags.includes("command")) return "구속은 매력적이지만 제구 완성도에 대한 의문이 있습니다.";
  if (prospect.visible.riskTags.includes("low-record-trust")) return "기록 신뢰도가 낮아 하이라이트만 보고 판단하기 어렵다는 반응이 있습니다.";
  if (prospect.visible.riskTags.includes("weak-competition")) return "상대 리그 수준을 감안해야 한다는 의견이 있습니다.";
  if (prospect.collegeCommitRisk >= 70) return "대학 진학 가능성이 높아 실제 계약까지 이어질지 우려가 있습니다.";
  if (prospect.draftHype >= 45) return "하이프가 높아 실제 툴보다 앞서 소비되는 것 아니냐는 우려가 있습니다.";
  return "팬 선호와 별개로 프로 적응은 더 지켜봐야 한다는 신중론이 있습니다.";
}

function hasAccolade(prospect: Prospect, id: string): boolean {
  return prospect.accolades.some((accolade) => accolade.id === id);
}

function createFanPickReaction(selection: DraftSelectionView, team: Team | undefined, mock: FanMockCandidate[]): FanPickReaction {
  const prospect = selection.prospect;
  const mockRank = mock.findIndex((candidate) => candidate.prospect.id === prospect.id) + 1 || undefined;
  const need = team ? teamNeedScore(team, prospect.primaryPosition) : 0;
  const expectedOverall = (prospect.visible.projectedRound.min - 1) * 10 + 1;
  const overpickPenalty = Math.max(0, expectedOverall - selection.pick.overall) * 1.8;
  const injuryPenalty = prospect.visible.riskTags.includes("injury-history") ? 12 : 0;
  const levelPenalty = prospect.visible.riskTags.includes("weak-competition") || prospect.visible.riskTags.includes("low-record-trust") ? 8 : 0;
  const signabilityPenalty = prospect.collegeCommitRisk >= 70 ? 10 : prospect.collegeCommitRisk >= 55 ? 5 : 0;
  const mockBonus = mockRank ? 28 - mockRank * 4 : 0;
  const rawScore = clampNumber(
    54 +
      mockBonus +
      need * 0.2 +
      prospect.accolades.length * 4 +
      (positionValue(prospect) ?? 0) * 1.5 +
      prospect.reputation * 0.12 -
      overpickPenalty -
      injuryPenalty -
      levelPenalty +
      (prospect.leagueLevel === "전국권" ? 5 : 0) -
      signabilityPenalty +
      deterministicNoise(`${selection.pick.id}-${prospect.id}`) * 10,
    0,
    100,
  );
  const grade = fanGrade(rawScore);
  const reasons = fanReactionReasons(selection, need, mockRank);

  return {
    selection,
    grade,
    score: rawScore,
    reasons,
    concern: fanConcern(prospect),
    comments: createFanComments(selection, grade, mockRank),
    mockRank,
  };
}

function fanReactionReasons(selection: DraftSelectionView, need: number, mockRank: number | undefined): string[] {
  const reasons: string[] = [];
  if (mockRank) reasons.push(`팬 모의지명 ${mockRank}위`);
  if (need >= 55) reasons.push("팀 니즈 충족");
  if (selection.prospect.accolades.length > 0) reasons.push("수상 경력 보유");
  if (selection.prospect.leagueLevel === "전국권") reasons.push("전국권 표본");
  if (selection.prospect.collegeCommitRisk >= 70) reasons.push("계약 변수 존재");
  if ((positionValue(selection.prospect) ?? 0) >= 8) reasons.push("포지션 가치 높음");
  if ((selection.prospect.pitcherStats?.maxVelocityKph ?? 0) >= 150) reasons.push("구속 화제성");
  if ((selection.prospect.hitterStats?.homeRuns ?? 0) >= 8) reasons.push("장타 기대감");
  if ((selection.prospect.hitterStats?.stolenBases ?? 0) >= 14) reasons.push("주루 툴");
  if (selection.prospect.visible.riskTags.includes("reputation-risk")) reasons.push("여론 변수");
  if (selection.prospect.visible.visibility === "thin") reasons.push("정보 부족형 픽");
  if (selection.pick.overall < (selection.prospect.visible.projectedRound.min - 1) * 10 + 1) reasons.push("예상보다 빠른 지명");
  if (reasons.length === 0) reasons.push("팬층 반응 엇갈림");
  return reasons.slice(0, 5);
}

function fanGrade(score: number): FanReactionGrade {
  if (score >= 82) return "A";
  if (score >= 68) return "B";
  if (score >= 52) return "C";
  if (score >= 36) return "D";
  return "F";
}

function pickOneDeterministic<T>(key: string, values: T[]): T {
  return values[Math.floor(deterministicNoise(key) * values.length)] ?? values[0];
}

function uniqueComments(comments: FanPickReaction["comments"]): FanPickReaction["comments"] {
  const seen = new Set<string>();
  return comments.filter((comment) => {
    if (seen.has(comment.text)) return false;
    seen.add(comment.text);
    return true;
  });
}

function createFanComments(selection: DraftSelectionView, grade: FanReactionGrade, mockRank: number | undefined): FanPickReaction["comments"] {
  const prospect = selection.prospect;
  const name = prospect.name;
  const comments: FanPickReaction["comments"] = [];
  const topPick = selection.pick.round <= 3;
  const latePick = selection.pick.round >= 8;
  const overpick = pickValueType(selection.pick, prospect) === "overpick";
  const slide = pickValueType(selection.pick, prospect) === "slide";

  if (grade === "A" || grade === "B") {
    comments.push({ tone: "긍정", text: pickOneDeterministic(`${selection.pick.id}-good-1`, [
      `${name}이면 일단 박수 나옵니다. 오늘 밤은 기분 좋게 잘 수 있겠네요.`,
      `드디어 우리도 이런 이름을 뽑네요. 이 맛에 드래프트 봅니다.`,
      `이건 팬들 사이에서 크게 싸울 픽은 아닌 것 같습니다. 일단 반응 좋을 만해요.`,
    ]) });
    comments.push({ tone: "기대", text: pickOneDeterministic(`${selection.pick.id}-good-2`, [
      `유니폼 입은 모습부터 빨리 보고 싶습니다. 괜히 설레네요.`,
      `제발 다치지만 말고 천천히 커줬으면 좋겠습니다.`,
      `이 선수 터지면 진짜 오래 얘기 나올 픽입니다.`,
    ]) });
  } else {
    comments.push({ tone: "회의", text: pickOneDeterministic(`${selection.pick.id}-bad-1`, [
      `${name}${objectParticle(name)} 여기서요? 솔직히 좀 당황스럽습니다.`,
      `아니 이 순번에 이 이름이 나올 줄은 몰랐네요. 머리가 잠깐 멈췄습니다.`,
      `좋은 선수일 수도 있는데 지금은 팬들이 놀랄 수밖에 없습니다.`,
    ]) });
    comments.push({ tone: "부정", text: pickOneDeterministic(`${selection.pick.id}-bad-2`, [
      `이건 결과로 증명 못 하면 오래 욕먹을 픽입니다.`,
      `팬들이 원하던 흐름이랑 너무 달라서 당장은 싸늘하겠네요.`,
      `또 우리만 어려운 길 가는 느낌이라 불안합니다.`,
    ]) });
  }

  comments.push(...fanTraitComments(selection, grade, mockRank));

  if (mockRank) comments.push({ tone: "긍정", text: `팬들이 계속 말하던 후보를 진짜 잡았습니다. 이런 날은 단순하게 기분 좋죠.` });
  if (overpick) comments.push({ tone: "분노", text: `오버픽이면 진짜 잘 커야 합니다. 실패하면 이 순번 계속 소환됩니다.` });
  if (slide) comments.push({ tone: "기대", text: `여기까지 밀렸는데 우리가 잡은 거면 괜히 로또 산 기분은 납니다.` });
  if (topPick && prospect.collegeCommitRisk >= 60) comments.push({ tone: "회의", text: `뽑아놓고 대학 간다고 하면 팬들 속 뒤집어집니다. 계약부터 봐야죠.` });
  if (latePick) comments.push({ tone: "기대", text: `하위 라운드는 원래 이런 맛이죠. 하나만 걸리면 됩니다.` });
  if (prospect.visible.riskTags.includes("injury-history")) comments.push({ tone: "회의", text: `아픈 얘기만 안 들렸으면 좋겠습니다. 이제 제발 건강이 먼저예요.` });
  if (prospect.visible.riskTags.includes("command")) comments.push({ tone: "회의", text: `볼넷 파티만 아니면 됩니다. 제발 스트라이크만 넣어주세요.` });
  if (prospect.primaryPosition === "C") comments.push({ tone: "기대", text: `포수는 기다리는 맛이 있긴 합니다. 문제는 우리가 그걸 참을 수 있느냐죠.` });
  if (prospect.draftHype >= 45) comments.push({ tone: "부정", text: `이름값 보고 뽑은 거 아니길 바랍니다. 팬들은 이런 픽에 예민합니다.` });
  comments.push({ tone: "재평가", text: pickOneDeterministic(`${selection.pick.id}-retro`, [
    `오늘 반응이 맞았는지는 결국 3년 뒤 커리어 로그가 말해줄 겁니다.`,
    `지금은 시끄럽지만, 첫 1군 콜업 때 분위기가 완전히 바뀔 수도 있습니다.`,
    `팬들은 당장 화내도 좋은 선수면 금방 돌아섭니다. 문제는 시간이죠.`,
  ]) });

  return uniqueComments(comments).slice(0, 5);
}

function fanTraitComments(selection: DraftSelectionView, grade: FanReactionGrade, mockRank: number | undefined): FanPickReaction["comments"] {
  const prospect = selection.prospect;
  const key = `${selection.pick.id}-${prospect.id}`;
  const comments: FanPickReaction["comments"] = [];
  const positiveTone: FanPickReaction["comments"][number]["tone"] = grade === "A" || grade === "B" ? "기대" : "회의";

  if (prospect.playerGroup === "pitcher") {
    const velocity = prospect.pitcherStats?.maxVelocityKph ?? 0;
    const bb9 = prospect.pitcherStats?.walksPerNine ?? 99;
    const k9 = prospect.pitcherStats?.strikeoutsPerNine ?? 0;
    if (velocity >= 150) comments.push({ tone: positiveTone, text: pickOneDeterministic(`${key}-velo`, [
      `${velocity}㎞/시요? 일단 숫자만 봐도 심장이 뜁니다.`,
      `구속 하나는 팬들 눈 돌아가게 만들 숫자네요. 이런 투수는 못 참죠.`,
    ]) });
    if (bb9 <= 2.4) comments.push({ tone: "긍정", text: `볼넷 적은 투수라니 벌써 마음이 편합니다. 우리 팬들 이런 거 귀합니다.` });
    if (k9 >= 10) comments.push({ tone: "기대", text: `삼진 잡는 투수는 보는 맛이 있습니다. 빨리 마운드에서 보고 싶네요.` });
    if (["sidearm", "submarine", "low-three-quarter"].includes(prospect.pitcherStats?.armSlot ?? "")) comments.push({ tone: "기대", text: `${armSlotLabel(prospect.pitcherStats?.armSlot)}면 일단 특이해서 끌립니다. 이런 선수 하나쯤은 있어야죠.` });
  } else {
    const homeRuns = prospect.hitterStats?.homeRuns ?? 0;
    const steals = prospect.hitterStats?.stolenBases ?? 0;
    const defense = prospect.hitterStats?.defensiveGrade ?? 0;
    const ops = prospect.hitterStats?.ops ?? 0;
    if (homeRuns >= 8) comments.push({ tone: "기대", text: `홈런 치는 유망주는 언제나 환영입니다. 우리도 좀 시원하게 보고 싶습니다.` });
    if (steals >= 14) comments.push({ tone: "긍정", text: `발 빠른 선수라니 좋네요. 답답한 경기에서 이런 선수가 분위기 바꿉니다.` });
    if (defense >= 60 && ["C", "SS", "CF"].includes(prospect.primaryPosition)) comments.push({ tone: "긍정", text: `${positionLabel(prospect.primaryPosition)} 수비 좋다는 말은 믿고 싶습니다. 그 포지션은 수비가 먼저니까요.` });
    if (ops >= 1.0) comments.push({ tone: "기대", text: `타격 성적만 보면 기대 안 할 수가 없습니다. 제발 방망이 진짜였으면 합니다.` });
  }

  if (prospect.accolades.length >= 2) comments.push({ tone: mockRank ? "긍정" : "회의", text: `상 받은 이름이라 팬들은 이미 좀 알고 있습니다. 그래서 더 기대도 크고 말도 많겠네요.` });
  if (prospect.physical.heightCm <= 176 && (prospect.hitterStats?.homeRuns ?? 0) >= 6) comments.push({ tone: "기대", text: `작은 체구에서 장타라니 낭만은 있습니다. 이런 선수 터지면 진짜 인기 많습니다.` });
  if (prospect.physical.heightCm >= 190 && prospect.playerGroup === "pitcher") comments.push({ tone: "기대", text: `큰 투수는 일단 상상하게 됩니다. 잘 크면 그림이 너무 좋죠.` });
  if (prospect.leagueLevel === "정보 부족" || prospect.visible.visibility === "thin") comments.push({ tone: "회의", text: `솔직히 잘 모르는 선수라 반응하기 어렵습니다. 구단이 뭘 본 건지 궁금하네요.` });
  if (prospect.visible.riskTags.includes("reputation-risk")) comments.push({ tone: "부정", text: `평판 얘기가 따라오는 픽은 시작부터 피곤합니다. 야구로 조용히 증명해야죠.` });
  if (prospect.collegeCommitRisk >= 70) comments.push({ tone: "회의", text: `대학 간다는 말 나오면 진짜 허탈할 것 같습니다. 계약부터 제발요.` });

  return comments;
}

function createFieldPickReaction(selection: DraftSelectionView, team: Team | undefined): FieldPickReaction {
  const prospect = selection.prospect;
  const need = team ? teamNeedScore(team, prospect.primaryPosition) : 0;
  const valueType = pickValueType(selection.pick, prospect);
  const positionValueScore = positionValue(prospect) ?? 0;
  const reliabilityScore = prospect.visible.confidence * 28 + (prospect.leagueLevel === "전국권" ? 8 : prospect.leagueLevel === "상위권" ? 4 : 0);
  const upsideSignal = Math.max(0, prospect.visible.expectedOverallRange.max - prospect.visible.expectedOverallRange.min) + Math.max(0, prospect.visible.expectedOverallRange.max - 62) * 1.4;
  const valueBonus = valueType === "slide" ? 13 : valueType === "overpick" ? -11 : 2;
  const riskPenalty =
    (prospect.visible.riskLevel === "high" ? 11 : prospect.visible.riskLevel === "medium" ? 5 : 0) +
    (prospect.collegeCommitRisk >= 70 ? 8 : prospect.collegeCommitRisk >= 55 ? 4 : 0) +
    (prospect.visible.riskTags.includes("reputation-risk") ? 5 : 0);
  const score = clampNumber(
    48 +
      valueBonus +
      reliabilityScore +
      need * 0.14 +
      positionValueScore * 1.8 +
      upsideSignal * 0.58 +
      (prospect.visible.publicRank <= 100 ? 5 : 0) -
      riskPenalty +
      deterministicNoise(`${selection.pick.id}-${prospect.id}-field`) * 8,
    0,
    100,
  );
  const grade = fanGrade(score);
  const reasons = fieldReactionReasons(selection, need);
  const concerns = fieldReactionConcerns(selection);
  return {
    selection,
    grade,
    score,
    verdict: fieldVerdict(selection, grade, valueType),
    reasons,
    concerns,
    scoutQuote: fieldScoutQuote(selection, grade, valueType),
  };
}

function fieldReactionAverage(reactions: FieldPickReaction[]): number {
  if (reactions.length === 0) return 0;
  return Math.round(reactions.reduce((sum, reaction) => sum + reaction.score, 0) / reactions.length);
}

function fieldReactionReasons(selection: DraftSelectionView, need: number): string[] {
  const prospect = selection.prospect;
  const reasons: string[] = [];
  const valueType = pickValueType(selection.pick, prospect);
  if (valueType === "slide") reasons.push("보드 가치 우위");
  if (valueType === "overpick") reasons.push("구단 확신형 지명");
  if (prospect.visible.confidence >= 0.7) reasons.push("리포트 신뢰도 높음");
  if (prospect.visible.expectedOverallRange.max >= 68) reasons.push("상단 기대치 높음");
  if (prospect.visible.expectedOverallRange.min >= 55) reasons.push("초기 완성도 양호");
  if ((positionValue(prospect) ?? 0) >= 8) reasons.push("희소 포지션");
  if (need >= 65) reasons.push("즉시 보강 니즈");
  if (prospect.leagueLevel === "전국권") reasons.push("전국권 표본");
  if (prospect.playerGroup === "pitcher" && (prospect.pitcherStats?.maxVelocityKph ?? 0) >= 148) reasons.push("프로급 구속 재료");
  if (prospect.playerGroup !== "pitcher" && (prospect.hitterStats?.defensiveGrade ?? 0) >= 60) reasons.push("수비 선행 가능");
  if (prospect.playerGroup !== "pitcher" && (prospect.hitterStats?.homeRuns ?? 0) >= 8) reasons.push("장타 툴 확인");
  if (isLateRoundHookProspect(prospect)) reasons.push("뚜렷한 관찰 포인트");
  if (reasons.length === 0) reasons.push("육성부 판단 반영");
  return reasons.slice(0, 4);
}

function fieldReactionConcerns(selection: DraftSelectionView): string[] {
  const prospect = selection.prospect;
  const concerns: string[] = [];
  if (prospect.visible.riskTags.includes("injury-history")) concerns.push("몸 상태 관리 필요");
  if (prospect.visible.riskTags.includes("command")) concerns.push("제구 개선 과제");
  if (prospect.visible.riskTags.includes("position-uncertainty") || prospect.visible.riskTags.includes("defensive-home")) concerns.push("수비 위치 정리 필요");
  if (prospect.visible.riskTags.includes("weak-competition") || prospect.visible.riskTags.includes("low-record-trust")) concerns.push("표본 보정 필요");
  if (prospect.collegeCommitRisk >= 60) concerns.push("계약 변수");
  if (pickValueType(selection.pick, prospect) === "overpick") concerns.push("순번 대비 부담");
  return concerns.slice(0, 3);
}

function fieldVerdict(selection: DraftSelectionView, grade: FanReactionGrade, valueType: "overpick" | "slide" | "fit"): string {
  const prospect = selection.prospect;
  if (selection.isPanicPick) return "직전 흐름에 흔들린 지명으로 보이지만, 구단은 대체 후보군에서 가장 설명 가능한 재료를 골랐습니다.";
  if (grade === "A" && valueType === "slide") return "현장에서는 순번 대비 가치가 남았다고 보는 픽입니다.";
  if (prospect.primaryPosition === "C" && grade !== "D" && grade !== "F") return "포수는 결과가 늦게 나오는 포지션이라, 현장은 단기 성적보다 수비 성장 곡선을 먼저 볼 픽입니다.";
  if (prospect.playerGroup === "pitcher" && (prospect.pitcherStats?.maxVelocityKph ?? 0) >= 150 && prospect.visible.riskTags.includes("command")) return "구속은 상위 재료지만, 제구를 잡지 못하면 평가가 크게 갈릴 수 있는 투수 픽입니다.";
  if (prospect.playerGroup !== "pitcher" && (prospect.hitterStats?.defensiveGrade ?? 0) >= 60 && (prospect.hitterStats?.ops ?? 0) < 0.85) return "방망이보다 수비로 먼저 생존 경로를 만들어야 하는 지명입니다.";
  if (grade === "A" || grade === "B") return "스카우트실 기준으로 설명 가능한 강점이 뚜렷한 지명입니다.";
  if (valueType === "overpick") return "현장 확신은 있으나 보드 대비 빠른 지명이라 육성 결과가 필요합니다.";
  if (prospect.visible.riskLevel === "high") return "툴은 보이지만 리스크 관리가 평가의 핵심인 픽입니다.";
  if (selection.pick.round >= 8) return "하위 라운드에서 하나의 장점을 보고 붙잡은 관찰형 지명입니다.";
  return "장점과 결함이 동시에 보여 내부 평가가 갈릴 수 있는 지명입니다.";
}

function fieldScoutQuote(selection: DraftSelectionView, grade: FanReactionGrade, valueType: "overpick" | "slide" | "fit"): string {
  const prospect = selection.prospect;
  const key = `${selection.pick.id}-${prospect.id}-quote`;
  if (prospect.playerGroup === "pitcher") {
    const velocity = prospect.pitcherStats?.maxVelocityKph ?? 0;
    const avgVelocity = prospect.pitcherStats?.averageVelocityKph ?? 0;
    const bb9 = prospect.pitcherStats?.walksPerNine ?? 99;
    const k9 = prospect.pitcherStats?.strikeoutsPerNine ?? 0;
    if (velocity >= 150) return pickOneDeterministic(key, [
      `최고 ${velocity}㎞/시, 평균 ${avgVelocity || "-"}㎞/시 구간은 이 순번에서 확실한 분리 요소입니다. 다만 BB/9 ${formatDecimal(bb9, 1)}라면 스트라이크존 관리가 1차 과제입니다.`,
      `직구 구속은 상위권입니다. K/9 ${formatDecimal(k9, 1)}가 구속과 같이 움직인다면 불펜 전환 시점이 빨라질 수 있습니다.`,
    ]);
    if (prospect.physical.throws === "L" && velocity >= 145) return `좌완 ${velocity}㎞/시 재료는 시장에서 과소평가되기 어렵습니다. 변화구가 평균만 되어도 선발 테스트 명분이 있습니다.`;
    if (prospect.pitcherStats?.armSlot === "sidearm" || prospect.pitcherStats?.armSlot === "submarine") return `${armSlotLabel(prospect.pitcherStats.armSlot)} 투구폼은 표본이 적어 변동성이 큽니다. 대신 우타 상대 스페셜리스트로 역할을 좁히면 빠른 활용 가능성이 있습니다.`;
    if (bb9 <= 2.4) return `BB/9 ${formatDecimal(bb9, 1)}는 하위 레벨에서 이닝을 먹을 수 있는 신호입니다. 구위보다 커맨드 기반으로 선발 잔류 여부를 봐야 합니다.`;
    if ((prospect.pitcherStats?.pitchCount ?? 0) >= 4 && (prospect.pitcherStats?.commandGrade ?? 0) >= 55) return `구종 ${prospect.pitcherStats?.pitchCount}개와 제구 ${prospect.pitcherStats?.commandGrade}점 조합이면 선발 플랜을 먼저 깔아볼 만합니다.`;
    return pickOneDeterministic(key, [
      `현재 리포트 신뢰도 ${Math.round(prospect.visible.confidence * 100)}% 기준으로는 역할 확정이 먼저입니다. 선발 유지와 불펜 전환 중 어느 쪽이 OVR 상승에 유리한지 1년 안에 봐야 합니다.`,
      `고교 기록보다 프로 첫해 볼넷률과 구속 유지가 더 중요합니다. 평균 구속이 떨어지면 평가 하락 폭이 클 유형입니다.`,
    ]);
  }
  if ((prospect.hitterStats?.homeRuns ?? 0) >= 8) return `홈런 ${prospect.hitterStats?.homeRuns}개와 장타율 ${formatDecimal(prospect.hitterStats?.slugging, 3)}는 파워 신호입니다. 관건은 삼진율 ${formatPercent(prospect.hitterStats?.strikeoutRate)}를 감당할 수 있느냐입니다.`;
  if (prospect.primaryPosition === "C" && (prospect.hitterStats?.defensiveGrade ?? 0) >= 58) return `포수 수비 ${prospect.hitterStats?.defensiveGrade}점이면 타격 지연을 감수할 수 있습니다. 2군에서는 송구와 블로킹 안정성부터 봐야 합니다.`;
  if (prospect.primaryPosition === "SS" && (prospect.hitterStats?.defensiveGrade ?? 0) >= 58) return `유격수 수비 ${prospect.hitterStats?.defensiveGrade}점이면 포지션 유지 가능성이 픽 가치의 핵심입니다. 2루 이동 시 가치는 한 단계 내려갑니다.`;
  if ((prospect.hitterStats?.stolenBases ?? 0) >= 13) return `도루 ${prospect.hitterStats?.stolenBases}개와 운동능력 ${prospect.hitterStats?.athleticismGrade ?? "-"}점은 대주자/대수비 경로를 열어둡니다. 출루율이 따라와야 1군 가치가 생깁니다.`;
  if ((prospect.hitterStats?.defensiveGrade ?? 0) >= 60) return `수비 ${prospect.hitterStats?.defensiveGrade}점이 먼저 보입니다. 타격 기대치가 낮아도 백업 플랜이 있는 픽입니다.`;
  if (valueType === "overpick" && grade === "D") return "현장은 좋아하지만 외부 보드보다 빠른 건 사실입니다. 이건 육성팀이 책임질 픽입니다.";
  if (valueType === "slide") return "밀린 이유가 치명적이지 않다면 이 순번에서는 충분히 잡아볼 만한 이름입니다.";
  return `현재 기대 범위 ${prospect.visible.expectedOverallRange.min}-${prospect.visible.expectedOverallRange.max}, 리포트 신뢰도 ${Math.round(prospect.visible.confidence * 100)}%입니다. 첫 2년은 한 가지 툴을 1군 평균까지 올릴 수 있는지가 핵심입니다.`;
}

function createFanRetrospectives(reactions: FanPickReaction[], players: CareerPlayerState[], mock: FanMockCandidate[], careerYear: number): FanRetrospective[] {
  if (careerYear < 3) return [];
  const items: FanRetrospective[] = [];

  reactions.forEach((reaction) => {
    const player = players.find((candidate) => candidate.playerId === reaction.selection.prospect.id);
    if (!player) return;
    const wasBad = ["D", "F"].includes(reaction.grade);
    const wasGood = ["A", "B"].includes(reaction.grade);
    const success = player.overall >= 68 || player.eventKeys.some((key) => ["rookie-award", "gold-glove", "mvp"].includes(key));
    const failure = player.status === "방출" || player.overall < 52;

    if (wasBad && success) {
      items.push({
        id: `fan-retro-up-${player.playerId}`,
        year: careerYear,
        type: "오버픽 재평가",
        title: pickOneDeterministic(`${player.playerId}-retro-up-title`, [
          `${player.prospect.name}, 야유를 박수로 바꾸다`,
          `${player.prospect.name}, "왜 뽑냐"던 밤을 뒤집다`,
          `${player.prospect.name}, 오버픽 딱지를 떼다`,
        ]),
        body: createFanRetrospectiveBody(player, reaction, "up"),
      });
    }

    if (wasGood && failure) {
      items.push({
        id: `fan-retro-fail-${player.playerId}`,
        year: careerYear,
        type: "컨센서스 실패",
        title: pickOneDeterministic(`${player.playerId}-retro-fail-title`, [
          `${player.prospect.name}, 모두가 웃었던 픽의 씁쓸한 현재`,
          `${player.prospect.name}, 박수 속 출발이 보장하지 못한 것`,
          `${player.prospect.name}, 컨센서스가 빗나간 사례로 남다`,
        ]),
        body: createFanRetrospectiveBody(player, reaction, "fail"),
      });
    }
  });

  const topFanPick = mock[0]?.prospect;
  const selectedTop = reactions.some((reaction) => reaction.selection.prospect.id === topFanPick?.id);
  const topPlayer = players.find((player) => player.playerId === topFanPick?.id);
  const firstUserPick = reactions[0]?.selection.prospect;
  const firstUserPlayer = players.find((player) => player.playerId === firstUserPick?.id);

  if (topFanPick && !selectedTop && topPlayer && firstUserPlayer) {
    items.push({
      id: `fan-retro-compare-${topFanPick.id}`,
      year: careerYear,
      type: "팬 1순위 비교",
      title: pickOneDeterministic(`${topFanPick.id}-retro-compare-title`, [
        `그때 팬들은 ${topFanPick.name}${objectParticle(topFanPick.name)} 외쳤다`,
        `${topFanPick.name} 대신 ${firstUserPick?.name}, 그 선택의 현재`,
        `팬 1순위와 실제 1픽, 시간이 만든 답안지`,
      ]),
      body: createFanTopPickComparisonBody(topFanPick, topPlayer, firstUserPick, firstUserPlayer),
    });
  }

  return items.slice(0, 6);
}

function createFanRetrospectiveBody(player: CareerPlayerState, reaction: FanPickReaction, kind: "up" | "fail"): string {
  const prospect = player.prospect;
  const quote = reaction.comments[0]?.text;
  const delta = player.currentOverall - player.initialOverall;
  const pickText = `${player.pick.round}라운드 ${player.pick.overall}순위`;
  const statusText = `${player.status}, 현재 OVR ${player.currentOverall}(${formatSigned(delta)})`;
  if (kind === "up") {
    return pickOneDeterministic(`${player.playerId}-retro-up-body`, [
      `드래프트 당일 팬 반응은 ${reaction.grade}. "${quote ?? "왜 이 순번이냐"}"는 말이 먼저 나왔지만, ${pickText} ${prospect.name}${subjectParticle(prospect.name)} 지금은 ${statusText}까지 올라왔다. 당시의 분노는 이제 "구단이 뭘 본 거냐"가 아니라 "구단이 뭘 봤길래 맞혔냐"는 질문으로 바뀌었다.`,
      `${prospect.name}${topicParticle(prospect.name)} 처음엔 환영받지 못했다. 하지만 ${careerYearLabel(player)} 동안 살아남으며 ${statusText}를 찍었고, 팬 게시판의 오래된 조롱은 회고 글의 단골 소재가 됐다. 이 픽은 아직 결론이 아니라도, 적어도 첫 반응만으로 판단할 수 없다는 증거가 됐다.`,
      `당시 등급 ${reaction.grade}, 분위기는 차가웠다. 그런데 ${pickText} 출신 ${prospect.name}${subjectParticle(prospect.name)} ${statusText}가 되면서 평가는 완전히 달라졌다. 오버픽이라는 말은 사라지고, 이제는 "그때 욕한 사람 나와"라는 농담이 먼저 붙는다.`,
    ]);
  }
  return pickOneDeterministic(`${player.playerId}-retro-fail-body`, [
    `드래프트 직후 반응은 ${reaction.grade}. 팬들은 "무난하다", "잘 잡았다"며 안도했지만, ${pickText} ${prospect.name}${topicParticle(prospect.name)} 현재 ${statusText}에 머물러 있다. 컨센서스가 늘 안전한 답은 아니라는, 꽤 아픈 사례다.`,
    `${prospect.name}${objectParticle(prospect.name)} 뽑던 날 분위기는 좋았다. 문제는 그 이후였다. ${careerYearLabel(player)}이 지난 지금 ${statusText}. 당시의 박수는 이제 "다들 속았다"는 씁쓸한 회고로 남았다.`,
    `팬 반응 ${reaction.grade}의 안정픽처럼 보였지만 결과는 기대와 달랐다. ${pickText} 출신 ${prospect.name}${subjectParticle(prospect.name)} ${statusText}에 그치면서, 이 픽은 "좋은 여론"과 "좋은 결과" 사이의 거리를 보여주는 사례가 됐다.`,
  ]);
}

function createFanTopPickComparisonBody(topFanPick: Prospect, topPlayer: CareerPlayerState, firstUserPick: Prospect | undefined, firstUserPlayer: CareerPlayerState): string {
  const chosenName = firstUserPick?.name ?? firstUserPlayer.prospect.name;
  const topDelta = topPlayer.currentOverall - topPlayer.initialOverall;
  const chosenDelta = firstUserPlayer.currentOverall - firstUserPlayer.initialOverall;
  const better = topPlayer.currentOverall > firstUserPlayer.currentOverall ? topFanPick.name : chosenName;
  return pickOneDeterministic(`${topFanPick.id}-${chosenName}-compare-body`, [
    `드래프트 전 팬 1순위는 ${topFanPick.name}였다. 구단은 대신 ${chosenName}${objectParticle(chosenName)} 택했다. 현재 ${topFanPick.name} OVR ${topPlayer.currentOverall}(${formatSigned(topDelta)}), ${chosenName} OVR ${firstUserPlayer.currentOverall}(${formatSigned(chosenDelta)}). 지금 시점의 판정승은 ${better} 쪽이지만, 팬들의 기억 속에서는 그날의 선택 자체가 이미 하나의 서사가 됐다.`,
    `"${topFanPick.name}${objectParticle(topFanPick.name)} 걸렀다"는 말은 드래프트 직후부터 따라붙었다. 시간이 흐른 지금 두 선수의 현재 OVR은 ${topPlayer.currentOverall} 대 ${firstUserPlayer.currentOverall}. 숫자만 보면 ${better}${subjectParticle(better)} 앞서지만, 진짜 무서운 건 이 비교가 앞으로도 매년 다시 소환된다는 점이다.`,
    `팬 여론은 ${topFanPick.name}, 실제 선택은 ${chosenName}. 지금은 ${topFanPick.name} ${topPlayer.status} OVR ${topPlayer.currentOverall}, ${chosenName} ${firstUserPlayer.status} OVR ${firstUserPlayer.currentOverall}. 이 정도면 단순한 픽 비교가 아니라, 스카우터 커리어에 붙는 긴 꼬리표에 가깝다.`,
  ]);
}

function careerYearLabel(player: CareerPlayerState): string {
  return player.yearsSinceDraft <= 1 ? "첫 시즌" : `${player.yearsSinceDraft}년`;
}

function legacyScore(player: CareerPlayerState): number {
  const allStarCount = player.transactionLog.filter((line) => line.includes("올스타")).length;
  const nationalTeamCount = player.transactionLog.filter((line) => line.includes("국가대표")).length;
  const titleProxy = player.careerLog.filter((entry) => ["골든글러브", "MVP급 시즌", "신인왕 수상", "국가대표 선발", "올스타 선발"].includes(entry.type)).length;
  const goldGloveCount = player.transactionLog.filter((line) => line.includes("골든글러브")).length + (player.eventKeys.includes("gold-glove") ? 1 : 0);
  const mvpCount = player.transactionLog.filter((line) => line.includes("MVP")).length + (player.eventKeys.includes("mvp") ? 1 : 0);
  const awards =
    mvpCount * 32 +
    goldGloveCount * 18 +
    allStarCount * 5 +
    nationalTeamCount * 8 +
    titleProxy * 3 +
    (player.eventKeys.includes("rookie-award") ? 14 : 0) +
    (player.eventKeys.includes("major-posting") ? 24 : 0) +
    (player.eventKeys.includes("late-breakout") ? 8 : 0);
  return player.currentOverall + player.yearsSinceDraft * 1.6 + awards + (player.originalTeamId === player.team.id ? 6 : 0);
}

function createTeamLegacyRows(teams: Team[], players: CareerPlayerState[]): TeamLegacyRow[] {
  return teams.map((team) => {
    const related = players
      .filter((player) => yearsWithTeam(player, team) >= 1)
      .sort((left, right) => legacyScore(right) - legacyScore(left));
    const retiredNumberPlayers = related
      .filter((player) => isOneClubPlayerForTeam(player, team) && yearsWithTeam(player, team) >= 15 && (legacyScore(player) >= 132 || player.currentOverall >= 84 || player.eventKeys.includes("mvp")))
      .slice(0, 3);
    const retiredNumberIds = new Set(retiredNumberPlayers.map((player) => player.playerId));
    const franchiseStars = related
      .filter((player) => player.status !== "은퇴" && yearsWithTeam(player, team) >= 7 && (legacyScore(player) >= 86 || player.currentOverall >= 72))
      .slice(0, 4)
      .map((player) => createLegacyPlayerItem(player, team));
    const hallOfFame = related
      .filter((player) => !retiredNumberIds.has(player.playerId))
      .filter((player) => yearsWithTeam(player, team) >= 10 && (legacyScore(player) >= 116 || player.eventKeys.includes("mvp") || player.eventKeys.includes("major-posting")))
      .slice(0, 4)
      .map((player) => ({ ...createLegacyPlayerItem(player, team), confirmed: player.status === "은퇴" }));
    const retiredNumbers = retiredNumberPlayers.map((player) => ({ ...createLegacyPlayerItem(player, team), confirmed: player.status === "은퇴", number: retiredNumberFor(player) }));

    return {
      teamId: team.id,
      teamName: team.name,
      franchiseStars,
      hallOfFame,
      retiredNumbers,
    };
  });
}

function createLegacyPlayerItem(player: CareerPlayerState, team: Team): LegacyPlayerItem {
  return {
    player,
    nickname: createPlayerNickname(player, team),
  };
}

function createPlayerNickname(player: CareerPlayerState, team: Team): string {
  if (player.customNickname?.trim()) return player.customNickname.trim();
  const key = `${player.playerId}-${team.id}-nickname`;
  const surn = surname(player.prospect.name);
  const market = team.market;
  const tools = getCareerTools(player);
  const mvp = player.eventKeys.includes("mvp");
  const glove = player.eventKeys.includes("gold-glove");
  const major = player.eventKeys.includes("major-posting");

  if (player.prospect.playerGroup === "pitcher" && isPitcherTools(tools)) {
    if (major || mvp || tools.velocity >= 90) return pickOneDeterministic(key, [`${market} 파이어볼`, `${surn}속구`, "강속구의 이름"]);
    if (tools.stamina >= 86 && player.prospect.primaryPosition === "SP") return pickOneDeterministic(key, ["무쇠팔", `${market} 철완`, `${surn}완투`]);
    if (tools.command >= 84) return pickOneDeterministic(key, ["바늘제구", `${market} 컴퍼스`, `${surn}코너`]);
    if (player.prospect.primaryPosition === "RP") return pickOneDeterministic(key, [`${market} 문지기`, `${surn}클로저`, "9회의 벽"]);
    return pickOneDeterministic(key, [`${market} 에이스`, `${surn}마운드`, "마운드의 기둥"]);
  }

  if (!isPitcherTools(tools)) {
    if (mvp || tools.power >= 88) return pickOneDeterministic(key, [`${market} 거포`, `${surn}대포`, "담장 밖 사나이"]);
    if (tools.contact >= 88) return pickOneDeterministic(key, [`${market} 안타기계`, `${surn}타격`, "라인드라이브 장인"]);
    if (tools.speed >= 88) return pickOneDeterministic(key, [`${market} 번개`, `${surn}바람`, "그라운드 위의 바람"]);
    if (glove || tools.defense >= 88) return pickOneDeterministic(key, [`${market} 철벽`, `${surn}글러브`, "수비의 기준"]);
    if (player.prospect.primaryPosition === "C") return pickOneDeterministic(key, [`${market} 안방마님`, `${surn}포수`, "홈플레이트의 벽"]);
    if (tools.mentality >= 86) return pickOneDeterministic(key, [`${market} 캡틴`, `${surn}주장`, "클럽하우스의 심장"]);
  }

  return pickOneDeterministic(key, [`${market}의 얼굴`, `${surn}스타`, "프랜차이즈의 이름"]);
}

function yearsWithTeam(player: CareerPlayerState, team: Team): number {
  const logs = player.transactionLog;
  if (player.originalTeamId === team.id) {
    const departure = logs
      .map((log) => parseTransactionYear(log, new RegExp(`${escapeRegExp(team.shortName)}\\s*→`)))
      .filter((year): year is number => year !== undefined)
      .sort((left, right) => left - right)[0];
    if (departure !== undefined) return Math.max(0, departure - 1);
    return player.yearsSinceDraft;
  }

  const arrivals = logs
    .map((log) => parseTransactionYear(log, new RegExp(`→\\s*${escapeRegExp(team.shortName)}`)))
    .filter((year): year is number => year !== undefined)
    .sort((left, right) => right - left);
  if (arrivals.length === 0) return 0;
  const latestArrival = arrivals[0];
  if (player.team.id === team.id) return Math.max(0, player.yearsSinceDraft - latestArrival + 1);
  const departureAfterArrival = logs
    .map((log) => parseTransactionYear(log, new RegExp(`${escapeRegExp(team.shortName)}\\s*→`)))
    .filter((year): year is number => year !== undefined && year > latestArrival)
    .sort((left, right) => left - right)[0];
  return departureAfterArrival ? Math.max(0, departureAfterArrival - latestArrival) : 0;
}

function parseTransactionYear(log: string, pattern: RegExp): number | undefined {
  if (!pattern.test(log)) return undefined;
  const match = log.match(/(\d+)년차/);
  return match ? Number(match[1]) : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isOneClubPlayerForTeam(player: CareerPlayerState, team: Team): boolean {
  if (player.originalTeamId !== team.id) return false;
  if (player.team.id !== team.id) return false;
  return !player.transactionLog.some((log) => log.includes("트레이드") || log.includes("FA 이적") || log.includes("→"));
}

function retiredNumberFor(player: CareerPlayerState): number {
  return 1 + Math.floor(deterministicNoise(`retired-number-${player.playerId}`) * 98);
}

function surname(name: string): string {
  return Array.from(name)[0] ?? name.slice(0, 1);
}

function createDraftRegretRecords(selections: DraftSelectionView[], players: CareerPlayerState[], teams: Team[]): DraftRegretRecord[] {
  return players
    .filter((player) => player.yearsSinceDraft >= 3 && (player.currentOverall >= 82 || player.eventKeys.includes("mvp") || player.eventKeys.includes("major-posting")))
    .map((missed) => {
      const selectionIndex = selections.findIndex((selection) => selection.prospect.id === missed.playerId);
      if (selectionIndex <= 0) return undefined;
      const previousSelection = selections[selectionIndex - 1];
      if (previousSelection.pick.round > 2) return undefined;
      const pickedPlayer = players.find((player) => player.playerId === previousSelection.prospect.id);
      const pickedOverall = pickedPlayer?.currentOverall ?? previousSelection.prospect.trueTalent.currentAbility;
      if (pickedOverall >= missed.currentOverall - 14) return undefined;
      if (pickedPlayer && pickedPlayer.eventKeys.some((key) => ["mvp", "major-posting", "gold-glove"].includes(key))) return undefined;
      const team = teams.find((candidate) => candidate.id === previousSelection.team.id);
      const label = `${surname(previousSelection.prospect.name)}거${surname(missed.prospect.name)}`;
      return {
        id: `regret-${missed.playerId}-${previousSelection.prospect.id}`,
        year: missed.yearsSinceDraft,
        label,
        teamName: team?.name ?? previousSelection.team.name,
        pickedName: previousSelection.prospect.name,
        missedName: missed.prospect.name,
        missedPlayerId: missed.playerId,
        body: `${team?.shortName ?? previousSelection.team.shortName}는 ${previousSelection.pick.round}라운드 ${previousSelection.pick.overall}순위에서 ${previousSelection.prospect.name}${objectParticle(previousSelection.prospect.name)} 택했고, 바로 다음 순번의 ${missed.prospect.name}${topicParticle(missed.prospect.name)} 리그 핵심급으로 성장했습니다.`,
      };
    })
    .filter((record): record is DraftRegretRecord => Boolean(record))
    .sort((left, right) => right.year - left.year)
    .slice(0, 12);
}

function createRecordBreakerRows(players: CareerPlayerState[], teams: Team[], limit = 18): RecordBreakerRow[] {
  const rows = players
    .flatMap((player) => {
      const team = teams.find((candidate) => candidate.id === player.team.id);
      return recordEventsForPlayer(player).map((event) => ({
        ...event,
        teamName: team?.name ?? player.team.name,
        player,
      }));
    });

  return applySequentialRecordOrdinals(rows)
    .sort((left, right) => right.year - left.year)
    .slice(0, limit);
}

function recordEventsForPlayer(player: CareerPlayerState): Array<Omit<RecordBreakerRow, "teamName" | "player">> {
  const rows: Array<Omit<RecordBreakerRow, "teamName" | "player">> = [];
  const pitcher = player.prospect.playerGroup === "pitcher";
  const seed = `record-${player.playerId}-${player.yearsSinceDraft}`;
  const add = (id: string, record: string, rarity: string, targetYears: number, minOverall: number, chance: number, ordinalStart?: number, earliestYears?: number) => {
    const activeCareer = player.debuted && player.status !== "방출";
    const exceptionalCareer = player.eventKeys.some((key) => ["gold-glove", "mvp", "major-posting"].includes(key));
    const yearFactor = recordYearFactor(player.yearsSinceDraft, targetYears, earliestYears);
    const adjustedChance = (exceptionalCareer ? chance * 1.35 : chance) * yearFactor;
    if (activeCareer && player.currentOverall >= minOverall && deterministicNoise(`${seed}-${id}`) < adjustedChance) {
      rows.push({ id: `record-${id}-${player.playerId}`, year: player.yearsSinceDraft, record, rarity, ordinalKey: ordinalStart ? id : undefined, ordinalStart });
    }
  };

  if (pitcher) {
    const currentPitcherRole = currentPlayerPosition(player);
    add("perfect", "리그 {{N}}번째 퍼펙트게임", "제구·구위·멘탈이 동시에 맞아야 하는 최상위 희귀 기록", 8, 92, pitcherCommandRecordChance(player, 0.003), 2, 3);
    add("nohit", "리그 {{N}}번째 노히트노런", "구위와 제구가 만든 한 세대급 기록", 6, 89, pitcherCommandRecordChance(player, 0.008), 10, 2);
    add("strikeout-season", "단일 시즌 최다 탈삼진 기록 경신", "구위·구속이 만든 기존 리그 대기록 경신", 8, 92, pitcherStrikeoutRecordChance(player, 0.004), undefined, 4);
    add("strikeout-game", "한 경기 최다 탈삼진 타이기록", "구위와 구속이 폭발한 쇼케이스", 6, 89, pitcherStrikeoutRecordChance(player, 0.007), undefined, 2);
    add("career-100-win", `통산 ${formatRecordNumber(100)}승 달성`, "체력·제구·멘탈로 오래 버틴 선발 누적 기록", 10, 78, pitcherStarterRecordChance(player, currentPitcherRole === "SP" ? 0.22 : 0.012), undefined, 4);
    add("career-150-win", `통산 ${formatRecordNumber(150)}승 달성`, "체력과 제구가 받친 리그 에이스급 장기 기록", 15, 84, pitcherStarterRecordChance(player, currentPitcherRole === "SP" ? 0.085 : 0.002));
    add("career-200-win", `통산 ${formatRecordNumber(200)}승 달성`, "체력·제구·멘탈이 모두 필요한 명예의 전당급 기록", 19, 89, pitcherStarterRecordChance(player, currentPitcherRole === "SP" ? 0.022 : 0));
    add("career-150-save", `통산 ${formatRecordNumber(150)}세이브 달성`, "구위와 멘탈로 버틴 마무리 장기 기록", 10, 78, pitcherReliefRecordChance(player, currentPitcherRole === "RP" ? 0.2 : 0.008), undefined, 4);
    add("career-250-save", `통산 ${formatRecordNumber(250)}세이브 달성`, "구위·제구·멘탈이 받친 대표 마무리 기록", 15, 84, pitcherReliefRecordChance(player, currentPitcherRole === "RP" ? 0.075 : 0));
    add("career-200-hold", `통산 ${formatRecordNumber(200)}홀드 달성`, "구위와 멘탈이 만든 불펜 전문성 기록", 10, 77, pitcherReliefRecordChance(player, currentPitcherRole === "RP" ? 0.18 : 0.01), undefined, 4);
    add("career-300-hold", `통산 ${formatRecordNumber(300)}홀드 달성`, "제구와 멘탈이 긴 커리어를 지탱한 셋업맨 기록", 15, 83, pitcherReliefRecordChance(player, currentPitcherRole === "RP" ? 0.065 : 0));
  } else {
    add("cycle", "리그 {{N}}번째 사이클링 히트", "컨택·파워·주루가 모두 맞아야 하는 단일 경기 진기록", 6, 82, cycleRecordChance(player, 0.007), 30, 2);
    add("forty-forty", "리그 {{N}}번째 40-40 클럽", "리그사 최상위 파워-스피드 시즌", 8, 92, powerSpeedRecordChance(player, 0.004), 2, 4);
    add("fifty-hr", `단일 시즌 ${formatRecordNumber(50)}홈런 돌파`, "거포 계보를 바꾸는 시즌", 8, 91, powerRecordChance(player, 0.005), undefined, 4);
    add("hit-streak", `${formatRecordNumber(30)}경기 연속 안타 달성`, "컨택과 선구안이 만든 장기 연속 기록권", 7, 87, hitStreakRecordChance(player, 0.008), undefined, 3);
    add("career-1000-hit", `통산 ${formatRecordNumber(1000)}안타 달성`, "특급 타자는 6~7년차에도 노릴 수 있는 주전 누적 기록", 9, 74, hitRecordChance(player, 0.36), undefined, 5);
    add("career-2000-hit", `통산 ${formatRecordNumber(2000)}안타 달성`, "리그 역사급 장기 주전 누적 기록", 17, 85, hitRecordChance(player, 0.09), undefined, 8);
    add("career-200-hr", `통산 ${formatRecordNumber(200)}홈런 달성`, "장타자 누적 기록", 10, 80, powerRecordChance(player, 0.12), undefined, 4);
    add("career-300-hr", `통산 ${formatRecordNumber(300)}홈런 달성`, "리그 대표 거포급 누적 기록", 15, 86, powerRecordChance(player, 0.052), undefined, 7);
    add("career-500-hr", `통산 ${formatRecordNumber(500)}홈런 달성`, "리그사 최상위 거포 누적 기록", 20, 92, powerRecordChance(player, 0.012), undefined, 11);
    add("steal-season", `단일 시즌 ${formatRecordNumber(70)}도루 돌파`, "주루툴이 만든 리그 희귀 시즌", 7, 84, speedRecordChance(player, 0.018), undefined, 3);
    add("career-300-steal", `통산 ${formatRecordNumber(300)}도루 달성`, "장기 주루 생산성 누적 기록", 10, 79, speedRecordChance(player, 0.1), undefined, 4);
    add("career-500-steal", `통산 ${formatRecordNumber(500)}도루 달성`, "리그 최상위 주루 누적 기록", 15, 86, speedRecordChance(player, 0.035), undefined, 7);
  }

  if (player.eventKeys.includes("major-posting")) {
    rows.push({
      id: `record-major-${player.playerId}`,
      year: player.yearsSinceDraft,
      record: "고교 드래프트 출신 메이저 진출",
      rarity: "역대 {{N}}번째급",
      ordinalKey: "major",
      ordinalStart: 2,
    });
  }
  if (player.pick.round >= 9 && player.yearsSinceDraft >= 6 && player.currentOverall >= 84 && (player.eventKeys.includes("gold-glove") || player.eventKeys.includes("mvp") || player.eventKeys.includes("major-posting"))) {
    rows.push({
      id: `record-late-${player.playerId}`,
      year: player.yearsSinceDraft,
      record: `${player.pick.round}라운드 출신 주전급 대성공`,
      rarity: "10년에 한 번 나올 만한 하위 지명 사례",
    });
  }
  return rows;
}

function applySequentialRecordOrdinals(rows: RecordBreakerRow[]): RecordBreakerRow[] {
  const counts: Record<string, number> = {};
  return [...rows]
    .sort((left, right) => left.year - right.year || left.player.pick.overall - right.player.pick.overall || left.id.localeCompare(right.id))
    .map((row) => {
      if (!row.ordinalKey || !row.ordinalStart) return row;
      const count = counts[row.ordinalKey] ?? 0;
      counts[row.ordinalKey] = count + 1;
      const ordinal = formatRecordNumber(row.ordinalStart + count);
      return {
        ...row,
        record: row.record.replace("{{N}}", ordinal),
        rarity: row.rarity.replace("{{N}}", ordinal),
      };
    });
}

function recordYearFactor(years: number, targetYears: number, earliestYears?: number): number {
  const earliest = earliestYears ?? Math.max(1, Math.floor(targetYears * 0.45));
  if (years < earliest) return 0;
  const span = Math.max(1, targetYears - earliest);
  const progress = (years - earliest) / span;
  if (progress < 1) return Math.pow(progress, 1.85) * 0.56;
  return clampNumber(0.86 + (years - targetYears) * 0.17, 0.86, 2.35);
}

function formatRecordNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

function pitcherCommandRecordChance(player: CareerPlayerState, baseChance: number): number {
  const tools = getCareerTools(player);
  if (!isPitcherTools(tools)) return 0;
  if (tools.command < 78 || tools.stuff < 78 || tools.mentality < 70) return baseChance * 0.18;
  const toolSignal = tools.command * 0.42 + tools.stuff * 0.34 + tools.mentality * 0.24;
  return clampNumber(baseChance + Math.max(0, toolSignal - 82) * 0.0007 + Math.max(0, player.currentOverall - 88) * 0.0009, baseChance * 0.25, baseChance * 2.4);
}

function pitcherStrikeoutRecordChance(player: CareerPlayerState, baseChance: number): number {
  const tools = getCareerTools(player);
  if (!isPitcherTools(tools)) return 0;
  if (tools.stuff < 80 || tools.velocity < 74) return baseChance * 0.15;
  const kPerNine = player.prospect.pitcherStats?.strikeoutsPerNine ?? 8;
  const toolSignal = tools.stuff * 0.5 + tools.velocity * 0.28 + tools.command * 0.14 + tools.mentality * 0.08;
  return clampNumber(baseChance + Math.max(0, toolSignal - 82) * 0.0009 + Math.max(0, kPerNine - 10) * 0.0016, baseChance * 0.22, baseChance * 2.6);
}

function pitcherStarterRecordChance(player: CareerPlayerState, baseChance: number): number {
  const tools = getCareerTools(player);
  if (!isPitcherTools(tools)) return 0;
  if (tools.stamina < 66 || tools.command < 64) return baseChance * 0.18;
  const toolSignal = tools.stamina * 0.34 + tools.command * 0.3 + tools.mentality * 0.22 + tools.stuff * 0.14;
  return clampNumber(baseChance + Math.max(0, toolSignal - 72) * 0.006 + Math.max(0, player.currentOverall - 78) * 0.01, baseChance * 0.25, baseChance * 2.3);
}

function pitcherReliefRecordChance(player: CareerPlayerState, baseChance: number): number {
  const tools = getCareerTools(player);
  if (!isPitcherTools(tools)) return 0;
  if (tools.stuff < 66 || tools.mentality < 62) return baseChance * 0.22;
  const toolSignal = tools.stuff * 0.36 + tools.command * 0.25 + tools.velocity * 0.18 + tools.mentality * 0.21;
  return clampNumber(baseChance + Math.max(0, toolSignal - 72) * 0.006 + Math.max(0, player.currentOverall - 76) * 0.009, baseChance * 0.25, baseChance * 2.25);
}

function cycleRecordChance(player: CareerPlayerState, baseChance: number): number {
  const tools = getCareerTools(player);
  if (isPitcherTools(tools)) return 0;
  if (tools.contact < 68 || tools.power < 58 || tools.speed < 58) return baseChance * 0.18;
  const toolSignal = tools.contact * 0.38 + tools.power * 0.28 + tools.speed * 0.24 + tools.mentality * 0.1;
  return clampNumber(baseChance + Math.max(0, toolSignal - 72) * 0.0008 + Math.max(0, player.currentOverall - 82) * 0.001, baseChance * 0.25, baseChance * 2.35);
}

function hitStreakRecordChance(player: CareerPlayerState, baseChance: number): number {
  const tools = getCareerTools(player);
  if (isPitcherTools(tools)) return 0;
  if (tools.contact < 74 || tools.discipline < 62) return baseChance * 0.2;
  const average = player.prospect.hitterStats?.average ?? 0.28;
  const toolSignal = tools.contact * 0.52 + tools.discipline * 0.28 + tools.mentality * 0.2;
  return clampNumber(baseChance + Math.max(0, toolSignal - 76) * 0.0009 + Math.max(0, average - 0.32) * 0.05, baseChance * 0.25, baseChance * 2.5);
}

function speedRecordChance(player: CareerPlayerState, baseChance: number): number {
  const steals = player.prospect.hitterStats?.stolenBases ?? 0;
  const athleticism = player.prospect.hitterStats?.athleticismGrade ?? 40;
  const tools = getCareerTools(player);
  const speedTool = !isPitcherTools(tools) ? tools.speed : 40;
  if (steals < 14 && athleticism < 64 && speedTool < 72) return 0;
  return clampNumber(baseChance + Math.max(0, steals - 18) * 0.0015 + Math.max(0, athleticism - 68) * 0.001 + Math.max(0, speedTool - 76) * 0.001, 0, baseChance * 1.8);
}

function hitRecordChance(player: CareerPlayerState, baseChance: number): number {
  const stats = player.prospect.hitterStats;
  const tools = getCareerTools(player);
  if (isPitcherTools(tools)) return 0;
  const contactSignal = (stats?.average ?? 0.28) * 100 + tools.contact * 0.55 + tools.discipline * 0.18;
  const generationalPace = player.yearsSinceDraft <= 7 && player.currentOverall >= 88 && tools.contact >= 82 ? baseChance * 0.55 : 0;
  const earlyRegularPace = player.yearsSinceDraft <= 7 && player.debuted && player.status === "1군" && player.currentOverall >= 82 ? baseChance * 0.22 : 0;
  if (tools.contact < 58 && player.currentOverall < 72) return baseChance * 0.18;
  return clampNumber(baseChance + generationalPace + earlyRegularPace + Math.max(0, contactSignal - 68) * 0.006 + Math.max(0, player.currentOverall - 78) * 0.012, baseChance * 0.25, baseChance * 2.6);
}

function powerRecordChance(player: CareerPlayerState, baseChance: number): number {
  const statsPower = player.prospect.hitterStats?.slugging ? player.prospect.hitterStats.slugging * 100 : 40;
  const tools = getCareerTools(player);
  const powerTool = !isPitcherTools(tools) ? tools.power : 40;
  if (statsPower < 58 && powerTool < 78) return 0;
  return clampNumber(baseChance + Math.max(0, statsPower - 62) * 0.0008 + Math.max(0, powerTool - 82) * 0.001, 0, baseChance * 1.7);
}

function powerSpeedRecordChance(player: CareerPlayerState, baseChance: number): number {
  const tools = getCareerTools(player);
  if (isPitcherTools(tools)) return 0;
  if (tools.power < 84 || tools.speed < 84) return 0;
  return clampNumber(baseChance + Math.min(tools.power - 84, tools.speed - 84) * 0.0007, 0, baseChance * 1.8);
}

function createInitialExistingPlayers(teams: Team[]): ExistingLeaguePlayer[] {
  return teams.flatMap((team) =>
    Array.from({ length: 26 }, (_, index) => {
      const age = 22 + Math.floor(Math.random() * 15);
      const peakOverall = Math.round(clampNumber(56 + Math.random() * 27 + (index < 5 ? 5 : 0), 50, 90));
      const ageDecline = Math.max(0, age - 29) * (0.7 + Math.random() * 0.35);
      return {
        id: `existing-${team.id}-${index}`,
        teamId: team.id,
        age,
        peakOverall,
        overall: Math.round(clampNumber(peakOverall - ageDecline + Math.random() * 4 - 2, 42, 90)),
        playerGroup: index % 3 === 0 ? "pitcher" : "hitter",
        status: "active",
        yearsTracked: 0,
      };
    }),
  );
}

function advanceExistingPlayers(players: ExistingLeaguePlayer[], year: number): ExistingLeaguePlayer[] {
  return players.map((player) => {
    if (player.status !== "active") return player;
    const age = player.age + 1;
    const declineStart = player.playerGroup === "pitcher" ? 31 : 32;
    const decline = Math.max(0, age - declineStart) * (0.8 + Math.random() * 0.7);
    const injuryOrRoleLoss = Math.random() < Math.max(0.02, (age - 33) * 0.018) ? 2 + Math.random() * 5 : 0;
    const overall = Math.round(clampNumber(player.overall - decline * 0.35 - injuryOrRoleLoss + Math.random() * 2 - 0.8, 30, player.peakOverall));
    const retireChance = clampNumber((age - 35) * 0.08 + (overall < 47 ? 0.12 : 0), 0, 0.62);
    const releaseChance = clampNumber((55 - overall) * 0.018 + (age > 33 ? 0.03 : 0), 0, 0.36);

    if (age >= 38 && Math.random() < retireChance) {
      return { ...player, age, overall, yearsTracked: player.yearsTracked + 1, status: "retired", lastEvent: `${year}년차 은퇴` };
    }
    if (overall < 54 && Math.random() < releaseChance) {
      return { ...player, age, overall, yearsTracked: player.yearsTracked + 1, status: "released", lastEvent: `${year}년차 방출` };
    }
    return { ...player, age, overall, yearsTracked: player.yearsTracked + 1 };
  });
}

function createTeamCycleSummary(team: Team | undefined, existingPlayers: ExistingLeaguePlayer[], careerPlayers: CareerPlayerState[]): TeamCycleSummary | undefined {
  if (!team) return undefined;
  const activeDrafted = careerPlayers.filter((player) => player.team.id === team.id && player.status !== "방출" && player.status !== "은퇴" && player.status !== "해외진출");
  const activeExisting = existingPlayers.filter((player) => player.teamId === team.id && player.status === "active");
  const hitterCycles: WeightedCycle[] = [];
  const pitcherCycles: WeightedCycle[] = [];

  activeDrafted.forEach((player) => {
    const cycle = player.prospect.seasonFormCycle ?? fallbackSeasonFormCycle(player.prospect);
    const weight = rosterCycleWeight(player.currentOverall, player.status === "1군", careerAge(player));
    const target = player.prospect.playerGroup === "pitcher" ? pitcherCycles : hitterCycles;
    target.push({ cycle, weight });
  });

  activeExisting.forEach((player) => {
    const cycle = createExistingEstimatedSeasonCycle(player);
    const weight = rosterCycleWeight(player.overall, true, player.age) * 0.9;
    const target = player.playerGroup === "pitcher" ? pitcherCycles : hitterCycles;
    target.push({ cycle, weight });
  });

  if (hitterCycles.length === 0 && pitcherCycles.length === 0) return undefined;
  const hitters = averageSeasonCycles(hitterCycles, "hitter", "타자 평균 사이클");
  const pitchers = averageSeasonCycles(pitcherCycles, "pitcher", "투수 평균 사이클");
  const total = averageSeasonCycles([...hitterCycles, ...pitcherCycles], "hitter", "팀 전체 평균 사이클");
  const lateAverage = averageCycleMonths(total, [8, 9, 10]);
  const postseasonFit = averageCycleMonths(total, [9, 10]) * 0.72 + total.staminaSignal * 0.18 + total.clutchSignal * 0.1;
  return {
    total,
    hitters,
    pitchers,
    lateSeasonGrade: cycleGrade(lateAverage),
    postseasonFitGrade: cycleGrade(postseasonFit),
    strongMonths: total.points.filter((point) => point.value >= 60).map((point) => `${point.month}월`).join(", "),
    weakMonths: total.points.filter((point) => point.value <= 45).map((point) => `${point.month}월`).join(", "),
  };
}

function rosterCycleWeight(overall: number, firstTeam: boolean, age: number): number {
  const role = firstTeam ? 1.15 : 0.72;
  const quality = clampNumber((overall - 40) / 35, 0.35, 1.65);
  const ageAdjustment = age >= 35 ? 0.88 : age <= 22 ? 0.82 : 1;
  return role * quality * ageAdjustment;
}

function averageSeasonCycles(items: WeightedCycle[], kind: SeasonFormCycle["kind"], fallbackReport: string): SeasonFormCycle {
  if (items.length === 0) {
    return {
      kind,
      pattern: "steady",
      points: ([3, 4, 5, 6, 7, 8, 9, 10] as const).map((month) => ({ month, value: 50 })),
      reliability: 0.3,
      staminaSignal: 50,
      clutchSignal: 50,
      report: "표본이 부족해 리그 평균에 가까운 추정치를 표시합니다.",
    };
  }
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0) || 1;
  const months = [3, 4, 5, 6, 7, 8, 9, 10] as const;
  const points = months.map((month) => ({
    month,
    value: Math.round(items.reduce((sum, item) => sum + (item.cycle.points.find((point) => point.month === month)?.value ?? 50) * item.weight, 0) / totalWeight),
  }));
  const staminaSignal = Math.round(items.reduce((sum, item) => sum + item.cycle.staminaSignal * item.weight, 0) / totalWeight);
  const clutchSignal = Math.round(items.reduce((sum, item) => sum + item.cycle.clutchSignal * item.weight, 0) / totalWeight);
  const reliability = roundTo(clampNumber(items.reduce((sum, item) => sum + item.cycle.reliability * item.weight, 0) / totalWeight, 0.2, 0.95), 2);
  const pattern = inferAverageCyclePattern(points);
  return {
    kind,
    pattern,
    points,
    reliability,
    staminaSignal,
    clutchSignal,
    report: teamCycleReport(fallbackReport, pattern, points, staminaSignal, clutchSignal),
  };
}

function createExistingEstimatedSeasonCycle(player: ExistingLeaguePlayer): SeasonFormCycle {
  const kind: SeasonFormCycle["kind"] = player.playerGroup === "pitcher" ? "pitcher" : "hitter";
  const ageFade = Math.max(0, player.age - 31) * 1.6;
  const base = clampNumber(45 + (player.overall - 55) * 0.32, 36, 67);
  const volatility = deterministicNoise(`${player.id}-cycle-vol`) * 7;
  const months = [3, 4, 5, 6, 7, 8, 9, 10] as const;
  const points = months.map((month, index) => {
    const latePenalty = index >= 5 ? ageFade : index >= 4 ? ageFade * 0.45 : 0;
    const veteranAdjustment = player.age >= 34 && index <= 2 ? 2 : 0;
    const noise = (deterministicNoise(`${player.id}-cycle-${month}`) - 0.5) * volatility;
    return { month, value: Math.round(clampNumber(base + veteranAdjustment - latePenalty + noise, 25, 82)) };
  });
  const staminaSignal = Math.round(clampNumber(58 - ageFade + (player.overall - 60) * 0.25, 25, 88));
  const clutchSignal = Math.round(clampNumber(50 + (player.overall - 60) * 0.18 - Math.max(0, player.age - 36) * 1.2, 25, 84));
  const pattern = inferAverageCyclePattern(points);
  return {
    kind,
    pattern,
    points,
    reliability: 0.48,
    staminaSignal,
    clutchSignal,
    report: "기존 선수층은 상세 리포트가 없어 OVR, 나이, 역할 기반 추정치로 반영합니다.",
  };
}

function inferAverageCyclePattern(points: SeasonFormCycle["points"]): SeasonFormCycle["pattern"] {
  const early = averageCycleMonths({ points }, [3, 4]);
  const summer = averageCycleMonths({ points }, [7, 8]);
  const late = averageCycleMonths({ points }, [9, 10]);
  const values = points.map((point) => point.value);
  const spread = Math.max(...values) - Math.min(...values);
  if (spread >= 17) return "volatile";
  if (late - early >= 7) return "late-surge";
  if (early - late >= 8) return "stamina-fade";
  if (summer <= early - 7 && summer <= late - 5) return "summer-slump";
  if (early >= late + 5) return "early-peak";
  return "steady";
}

function averageCycleMonths(cycle: Pick<SeasonFormCycle, "points">, months: number[]): number {
  const values = cycle.points.filter((point) => months.includes(point.month)).map((point) => point.value);
  if (values.length === 0) return 50;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function cycleGrade(value: number): string {
  if (value >= 62) return "강함";
  if (value >= 55) return "양호";
  if (value >= 47) return "보통";
  if (value >= 40) return "주의";
  return "취약";
}

function teamCycleReport(title: string, pattern: SeasonFormCycle["pattern"], points: SeasonFormCycle["points"], staminaSignal: number, clutchSignal: number): string {
  const best = [...points].sort((left, right) => right.value - left.value)[0];
  const worst = [...points].sort((left, right) => left.value - right.value)[0];
  const late = averageCycleMonths({ points }, [9, 10]);
  const summer = averageCycleMonths({ points }, [7, 8]);
  const patternNote =
    pattern === "late-surge" ? "후반으로 갈수록 팀 컨디션이 올라오는 구성입니다." :
    pattern === "stamina-fade" ? "초반보다 후반 하락폭이 커 가을 경기력 관리가 필요합니다." :
    pattern === "summer-slump" ? "여름 구간에서 페이스가 꺾이는 구성이 보입니다." :
    pattern === "volatile" ? "월별 편차가 커 연승과 연패가 모두 나올 수 있는 구성입니다." :
    "월별 흐름이 비교적 안정적인 구성입니다.";
  const postseasonNote = late >= 58 && staminaSignal >= 56 ? "포스트시즌 적합도는 좋은 편입니다." : late <= 45 || staminaSignal <= 44 ? "포스트시즌에서는 체력과 후반 집중도가 변수입니다." : "포스트시즌 적합도는 보통 수준입니다.";
  return `${title}: ${patternNote} 강세월은 ${best?.month ?? "-"}월, 약세월은 ${worst?.month ?? "-"}월입니다. 여름 평균 ${Math.round(summer)}, 9~10월 평균 ${Math.round(late)}, 후반 집중도 ${clutchSignal}. ${postseasonNote}`;
}

function createExistingTeamSummaries(teams: Team[], players: ExistingLeaguePlayer[], careerPlayers: CareerPlayerState[]): ExistingTeamSummary[] {
  return teams.map((team) => {
    const teamPlayers = players.filter((player) => player.teamId === team.id);
    const active = teamPlayers.filter((player) => player.status === "active");
    const activeDrafted = careerPlayers.filter((player) => player.team.id === team.id && player.status !== "방출" && player.status !== "은퇴" && player.status !== "해외진출");
    const positionDepth = Object.fromEntries(
      POSITIONS.map((position) => {
        const existingCount = countExistingPlayersAtPosition(active, position);
        const draftedCount = activeDrafted.filter((player) => currentPlayerPosition(player) === position).length;
        return [position, { total: existingCount + draftedCount, existing: existingCount }];
      }),
    ) as Partial<Record<Position, { total: number; existing: number }>>;
    return {
      teamId: team.id,
      teamName: team.name,
      positionDepth,
      activeTotal: active.length + activeDrafted.length,
      existingActive: active.length,
      retired: teamPlayers.filter((player) => player.status === "retired").length,
      released: teamPlayers.filter((player) => player.status === "released").length,
    };
  });
}

function createCurrentRosterRows(team: Team | undefined, existingPlayers: ExistingLeaguePlayer[], careerPlayers: CareerPlayerState[]) {
  if (!team) {
    return POSITIONS.map((position) => ({ position, starters: [], platoon: [], secondTeam: [], inactive: [], draftedCount: 0, existingCount: 0, need: 0 }));
  }

  const usedStarterIds = new Set<string>();
  return POSITIONS.map((position) => {
    const { draftedMembers, existingMembers, inactiveMembers } = createRosterMembersForPosition(team, existingPlayers, careerPlayers, position);
    const members = [...draftedMembers, ...existingMembers].sort((left, right) => right.overall - left.overall || (left.age ?? 99) - (right.age ?? 99));
    if (position === "RP") {
      const bullpenMembers = assignBullpenRolesToRosterMembers(members);
      const leverageRoles = new Set(["마무리", "셋업맨", "필승조"]);
      const starters = bullpenMembers.filter((member) => member.bullpenRole && leverageRoles.has(member.bullpenRole)).slice(0, 4);
      starters.forEach((member) => usedStarterIds.add(member.id));
      const starterIds = new Set(starters.map((member) => member.id));
      const platoon = bullpenMembers.filter((member) => !starterIds.has(member.id) && member.bullpenRole).slice(0, 5);
      const usedIds = new Set([...Array.from(starterIds), ...platoon.map((member) => member.id)]);
      const secondTeam = bullpenMembers.filter((member) => !usedIds.has(member.id)).slice(0, 4);
      return {
        position,
        starters,
        platoon,
        secondTeam,
        inactive: inactiveMembers,
        draftedCount: draftedMembers.length,
        existingCount: existingMembers.length,
        need: calculateRosterAwareNeed(team.positionDepth[position]?.need ?? 0, bullpenMembers, position),
      };
    }
    const starterCount = position === "SP" ? 5 : 1;
    const platoonCount = position === "SP" ? 3 : 2;
    const starterCandidates = members.filter((member) => !usedStarterIds.has(member.id) && !member.fieldingRole && (member.primaryPosition === position || position === "SP"));
    const fallbackStarterCandidates = members.filter((member) => !usedStarterIds.has(member.id) && !member.fieldingRole && !starterCandidates.some((candidate) => candidate.id === member.id));
    const starters = [...starterCandidates, ...fallbackStarterCandidates].slice(0, starterCount);
    starters.forEach((member) => usedStarterIds.add(member.id));
    const starterIds = new Set(starters.map((member) => member.id));
    const backups = members.filter((member) => !starterIds.has(member.id));
    const platoon = backups.slice(0, platoonCount);
    const secondTeam = backups.slice(platoonCount, platoonCount + 4);
    return {
      position,
      starters,
      platoon,
      secondTeam,
      inactive: inactiveMembers,
      draftedCount: draftedMembers.length,
      existingCount: existingMembers.length,
      need: calculateRosterAwareNeed(team.positionDepth[position]?.need ?? 0, members, position),
    };
  });
}

function createRosterMembersForPosition(team: Team, existingPlayers: ExistingLeaguePlayer[], careerPlayers: CareerPlayerState[], position: Position): { draftedMembers: RosterMember[]; existingMembers: RosterMember[]; inactiveMembers: RosterMember[] } {
  const activeExisting = existingPlayers.filter((player) => player.teamId === team.id && player.status === "active");
  const activeDrafted = careerPlayers.filter((player) => player.team.id === team.id && player.status !== "방출" && player.status !== "은퇴" && player.status !== "해외진출");
  const inactivePlayers = activeDrafted.filter((player) => currentPlayerPosition(player) === position && isInactiveRosterPlayer(player));
  const draftedMembers: RosterMember[] = activeDrafted
    .filter((player) => !isInactiveRosterPlayer(player))
    .filter((player) => draftedPlayerCountsForRosterPosition(player, position))
    .map((player) => ({
      id: `drafted-${player.playerId}`,
      name: player.prospect.name,
      overall: player.currentOverall,
      age: careerAge(player),
      primaryPosition: currentPlayerPosition(player),
      source: "drafted",
      playerId: player.playerId,
      bullpenRole: player.bullpenRole,
      fieldingRole: player.fieldingRole,
      note: `${player.pick.round}R · ${player.status}${currentPlayerPosition(player) !== player.prospect.primaryPosition ? ` · ${positionLabel(player.prospect.primaryPosition)} 출신` : ""}`,
    }));
  const inactiveMembers: RosterMember[] = inactivePlayers
    .sort((left, right) => inactiveRosterRank(left) - inactiveRosterRank(right) || right.currentOverall - left.currentOverall)
    .map((player) => ({
      id: `inactive-${player.playerId}`,
      name: player.prospect.name,
      overall: player.currentOverall,
      age: careerAge(player),
      primaryPosition: currentPlayerPosition(player),
      source: "drafted",
      playerId: player.playerId,
      bullpenRole: player.bullpenRole,
      fieldingRole: player.fieldingRole,
      note: inactiveRosterNote(player),
    }));
  const existingMembers: RosterMember[] = existingPlayersAtPosition(activeExisting, position)
    .map((player) => ({
      id: player.id,
      name: existingPlayerName(player),
      overall: player.overall,
      age: player.age,
      primaryPosition: position,
      source: "existing",
      note: "기존 선수층",
    }));
  return { draftedMembers, existingMembers, inactiveMembers };
}

function isInactiveRosterPlayer(player: CareerPlayerState): boolean {
  return player.status === "부상" || player.militaryStatus === "serving";
}

function inactiveRosterRank(player: CareerPlayerState): number {
  if (player.status === "부상") return 0;
  if (player.militaryType === "상무") return 1;
  return 2;
}

function inactiveRosterNote(player: CareerPlayerState): string {
  if (player.status === "부상") return `부상자 엔트리 · OVR ${player.currentOverall}`;
  if (player.militaryStatus === "serving" && player.militaryType === "상무") return `상무 복무 · ${player.militaryServiceUntilYear ?? "-"}년 복귀 예정`;
  if (player.militaryStatus === "serving") return `현역 복무 · ${player.militaryServiceUntilYear ?? "-"}년 복귀 예정`;
  return player.status;
}

function draftedPlayerCountsForRosterPosition(player: CareerPlayerState, position: Position): boolean {
  const currentPosition = currentPlayerPosition(player);
  if (position === "SP" || position === "RP") return currentPosition === position;
  return currentPosition === position || (!player.currentPosition && player.prospect.secondaryPositions.includes(position));
}

function currentPlayerPosition(player: CareerPlayerState): Position {
  return player.currentPosition ?? player.prospect.primaryPosition;
}

function applyTeamRoleAdjustments(
  players: CareerPlayerState[],
  teams: Team[],
  year: number,
  userTeamId: TeamId,
  watchedIds: Set<ProspectId>,
  nextAfterUserPickIds: Set<ProspectId>,
  news: CareerNewsItem[],
): CareerPlayerState[] {
  const nextPlayers = players.map((player) => ({ ...player }));
  teams.forEach((team) => {
    const roster = nextPlayers.filter((player) => player.team.id === team.id && player.status !== "방출" && player.status !== "은퇴" && player.status !== "해외진출");
    applyPitchingRolePressure(roster, year, userTeamId, watchedIds, nextAfterUserPickIds, news);
    applyFielderPositionPressure(roster, team, year, userTeamId, watchedIds, nextAfterUserPickIds, news);
  });
  return nextPlayers;
}

function applyPitchingRolePressure(
  roster: CareerPlayerState[],
  year: number,
  userTeamId: TeamId,
  watchedIds: Set<ProspectId>,
  nextAfterUserPickIds: Set<ProspectId>,
  news: CareerNewsItem[],
) {
  const activePitchers = roster.filter((player) => player.prospect.playerGroup === "pitcher");
  const relievers = activePitchers.filter((player) => currentPlayerPosition(player) === "RP");
  const starters = activePitchers.filter((player) => currentPlayerPosition(player) === "SP");
  const bullpenShortage = relievers.filter((player) => player.currentOverall >= 50 || player.status === "1군").length < 5;
  const starterShortage = starters.filter((player) => player.currentOverall >= 54 || player.status === "1군").length < 5;

  if (bullpenShortage) {
    const candidate = starters
      .filter((player) => !player.eventKeys.includes("team-role-sp-to-rp") && player.yearsSinceDraft >= 1 && player.currentOverall >= 48)
      .sort((left, right) => starterToBullpenFit(right) - starterToBullpenFit(left))[0];
    if (candidate && starterToBullpenFit(candidate) >= 56 && Math.random() < 0.72) {
      candidate.currentPosition = "RP";
      candidate.bullpenRole = undefined;
      candidate.eventKeys = [...candidate.eventKeys, "team-role-sp-to-rp"];
      candidate.transactionLog = [...candidate.transactionLog, `${year}년차 팀 불펜 사정으로 선발 후보→불펜 전환`];
      addCareerNews(
        news,
        candidate,
        year,
        3,
        "보직 전환",
        `${candidate.prospect.name}, 팀 사정으로 불펜 이동`,
        `선발 후보로 지명됐지만 팀 불펜 뎁스가 얇아지면서 짧은 이닝에서 먼저 기회를 받게 됐다. 드래프트 당시 포지션 평가는 유지되지만, 현재 활용은 불펜 쪽으로 옮겨간다.`,
        careerContext(candidate, userTeamId, watchedIds, nextAfterUserPickIds),
      );
    }
  }

  if (starterShortage) {
    const candidate = relievers
      .filter((player) => !player.eventKeys.includes("team-role-rp-to-sp") && player.yearsSinceDraft >= 2 && player.currentOverall >= 55)
      .sort((left, right) => bullpenToStarterFit(right) - bullpenToStarterFit(left))[0];
    if (candidate && bullpenToStarterFit(candidate) >= 64 && Math.random() < 0.34) {
      candidate.currentPosition = "SP";
      candidate.bullpenRole = undefined;
      candidate.eventKeys = [...candidate.eventKeys, "team-role-rp-to-sp"];
      candidate.transactionLog = [...candidate.transactionLog, `${year}년차 선발진 공백으로 불펜→선발 전환`];
      addCareerNews(
        news,
        candidate,
        year,
        3,
        "보직 전환",
        `${candidate.prospect.name}, 선발 전환 테스트`,
        `선발진 공백이 길어지면서 불펜에서 버티던 투수가 긴 이닝 테스트를 받는다. 체력과 제구가 따라오면 대체선발 이상의 역할도 가능하다는 판단이다.`,
        careerContext(candidate, userTeamId, watchedIds, nextAfterUserPickIds),
      );
    }
  }
}

function applyFielderPositionPressure(
  roster: CareerPlayerState[],
  team: Team,
  year: number,
  userTeamId: TeamId,
  watchedIds: Set<ProspectId>,
  nextAfterUserPickIds: Set<ProspectId>,
  news: CareerNewsItem[],
) {
  const fielders = roster.filter((player) => player.prospect.playerGroup !== "pitcher" && !player.fieldingRole);
  const thinPositions = POSITIONS.filter((position) => !["SP", "RP"].includes(position) && teamNeedScore(team, position) >= 66)
    .sort((left, right) => teamNeedScore(team, right) - teamNeedScore(team, left));
  thinPositions.slice(0, 2).forEach((position) => {
    const enoughCurrent = fielders.filter((player) => currentPlayerPosition(player) === position && player.currentOverall >= 50).length >= (position === "C" ? 2 : 3);
    if (enoughCurrent) return;
    const candidate = fielders
      .filter((player) => currentPlayerPosition(player) !== position && !player.eventKeys.includes(`team-position-${position}`))
      .sort((left, right) => fielderTransitionFit(right, position) - fielderTransitionFit(left, position))[0];
    if (!candidate || fielderTransitionFit(candidate, position) < 48 || Math.random() > 0.46) return;
    const from = currentPlayerPosition(candidate);
    candidate.currentPosition = position;
    candidate.eventKeys = [...candidate.eventKeys, `team-position-${position}`, "position-change"];
    candidate.transactionLog = [...candidate.transactionLog, `${year}년차 팀 사정으로 ${positionLabel(from)}→${positionLabel(position)} 전환`];
    addCareerNews(
      news,
      candidate,
      year,
      3,
      "포지션 전환",
      `${candidate.prospect.name}, ${positionLabel(position)} 전환`,
      `${candidate.team.shortName}의 ${positionLabel(position)} 뎁스가 얇아지면서 코칭스태프가 포지션 전환을 추진한다. 선수 개인의 원래 평가는 남지만, 당장의 팀 사정이 활용법을 바꾼 사례다.`,
      careerContext(candidate, userTeamId, watchedIds, nextAfterUserPickIds),
    );
  });
}

function starterToBullpenFit(player: CareerPlayerState): number {
  const tools = getCareerTools(player);
  if (!isPitcherTools(tools)) return 0;
  const starterChance = player.prospect.pitcherStats?.starterChance ?? 55;
  return player.currentOverall * 0.35 + tools.stuff * 0.22 + tools.velocity * 0.18 + tools.mentality * 0.12 + Math.max(0, 60 - tools.stamina) * 0.18 + Math.max(0, 58 - starterChance) * 0.12;
}

function bullpenToStarterFit(player: CareerPlayerState): number {
  const tools = getCareerTools(player);
  if (!isPitcherTools(tools)) return 0;
  const starterChance = player.prospect.pitcherStats?.starterChance ?? 38;
  return player.currentOverall * 0.32 + tools.stamina * 0.28 + tools.command * 0.18 + tools.mentality * 0.12 + starterChance * 0.1;
}

function fielderTransitionFit(player: CareerPlayerState, target: Position): number {
  const tools = getCareerTools(player);
  if (isPitcherTools(tools)) return 0;
  const current = currentPlayerPosition(player);
  const currentFit = player.prospect.trueTalent.truePositionFit[target] ?? (player.prospect.secondaryPositions.includes(target) ? 58 : 42);
  const defensiveCore = tools.defense * 0.34 + tools.speed * 0.18 + tools.mentality * 0.14 + currentFit * 0.22 + player.currentOverall * 0.12;
  const difficultyPenalty = positionTransitionPenalty(current, target);
  return defensiveCore - difficultyPenalty + (player.prospect.secondaryPositions.includes(target) ? 10 : 0);
}

function positionTransitionPenalty(from: Position, to: Position): number {
  if (from === to) return 0;
  if (to === "C") return from === "1B" || from === "3B" ? 22 : 34;
  if (to === "SS") return ["2B", "3B", "CF"].includes(from) ? 8 : 20;
  if (to === "CF") return ["LF", "RF", "SS", "2B"].includes(from) ? 8 : 18;
  if (to === "2B" || to === "3B") return ["SS", "2B", "3B"].includes(from) ? 5 : 14;
  if (["LF", "RF", "1B"].includes(to)) return 3;
  return 12;
}

function assignBullpenRoles(players: CareerPlayerState[], teams: Team[]): CareerPlayerState[] {
  const roleMap = new Map<ProspectId, NonNullable<CareerPlayerState["bullpenRole"]>>();
  teams.forEach((team) => {
    const relievers = players
      .filter((player) => player.team.id === team.id && currentPlayerPosition(player) === "RP" && player.status !== "방출" && player.status !== "은퇴" && player.status !== "해외진출")
      .sort((left, right) => bullpenRoleScore(right, "필승조") - bullpenRoleScore(left, "필승조"));
    assignBullpenRoleForTeam(relievers).forEach((role, playerId) => roleMap.set(playerId, role));
  });
  return players.map((player) => {
    if (currentPlayerPosition(player) !== "RP") return player.bullpenRole ? { ...player, bullpenRole: undefined } : player;
    return { ...player, bullpenRole: roleMap.get(player.playerId) };
  });
}

function assignBullpenRoleForTeam(relievers: CareerPlayerState[]): Map<ProspectId, NonNullable<CareerPlayerState["bullpenRole"]>> {
  const roles = new Map<ProspectId, NonNullable<CareerPlayerState["bullpenRole"]>>();
  const available = [...relievers];
  const take = (role: NonNullable<CareerPlayerState["bullpenRole"]>, count: number, scoreRole = role) => {
    for (let index = 0; index < count; index += 1) {
      if (available.length === 0) return;
      available.sort((left, right) => bullpenRoleScore(right, scoreRole) - bullpenRoleScore(left, scoreRole));
      const [player] = available.splice(0, 1);
      if (player) roles.set(player.playerId, role);
    }
  };

  take("마무리", relievers.length >= 5 ? 1 : 0);
  take("셋업맨", relievers.length >= 4 ? 1 : 0);
  take("필승조", relievers.length >= 8 ? 2 : relievers.length >= 3 ? 1 : 0);
  take("롱맨", relievers.length >= 7 ? 2 : relievers.length >= 4 ? 1 : 0);
  take("추격조", relievers.length >= 6 ? 2 : relievers.length >= 2 ? 1 : 0);
  available
    .sort((left, right) => bullpenRoleScore(left, "패전조") - bullpenRoleScore(right, "패전조"))
    .forEach((player) => roles.set(player.playerId, "패전조"));
  return roles;
}

function bullpenRoleScore(player: CareerPlayerState, role: NonNullable<CareerPlayerState["bullpenRole"]>): number {
  const tools = getCareerTools(player);
  const pitcherTools = isPitcherTools(tools)
    ? tools
    : { command: player.currentOverall, stuff: player.currentOverall, velocity: player.currentOverall, stamina: player.currentOverall, mentality: player.currentOverall };
  const starterChance = player.prospect.pitcherStats?.starterChance ?? 0;
  const statusPenalty = player.status === "2군" ? -7 : player.status === "부상" ? -14 : 0;
  if (role === "마무리") return player.currentOverall * 0.52 + pitcherTools.stuff * 0.18 + pitcherTools.velocity * 0.14 + pitcherTools.mentality * 0.16 + statusPenalty;
  if (role === "셋업맨") return player.currentOverall * 0.48 + pitcherTools.stuff * 0.2 + pitcherTools.command * 0.16 + pitcherTools.mentality * 0.16 + statusPenalty;
  if (role === "필승조") return player.currentOverall * 0.5 + pitcherTools.stuff * 0.17 + pitcherTools.command * 0.15 + pitcherTools.velocity * 0.1 + pitcherTools.mentality * 0.08 + statusPenalty;
  if (role === "롱맨") return player.currentOverall * 0.38 + pitcherTools.stamina * 0.32 + pitcherTools.command * 0.14 + starterChance * 0.12 + (player.prospect.secondaryPositions.includes("SP") ? 5 : 0) + statusPenalty;
  if (role === "추격조") return player.currentOverall * 0.42 + pitcherTools.stuff * 0.18 + pitcherTools.command * 0.12 + pitcherTools.stamina * 0.08 + statusPenalty;
  return player.currentOverall + (player.status === "2군" ? -6 : 0) + (careerAge(player) >= 34 ? -2 : 0);
}

function assignBullpenRolesToRosterMembers(members: RosterMember[]): RosterMember[] {
  const roleMap = new Map<string, NonNullable<CareerPlayerState["bullpenRole"]>>();
  const roleOrder: NonNullable<CareerPlayerState["bullpenRole"]>[] = ["마무리", "셋업맨", "필승조", "필승조", "롱맨", "롱맨", "추격조", "추격조", "패전조", "패전조"];
  members
    .filter((member) => member.bullpenRole)
    .forEach((member) => roleMap.set(member.id, member.bullpenRole!));
  const missing = members
    .filter((member) => !roleMap.has(member.id))
    .sort((left, right) => right.overall - left.overall);
  missing.forEach((member) => {
    const role = roleOrder.find((candidate) => bullpenRoleCount(roleMap, candidate) < bullpenRoleDisplayCap(candidate)) ?? "패전조";
    roleMap.set(member.id, role);
  });
  return members.map((member) => ({
    ...member,
    bullpenRole: roleMap.get(member.id),
  }));
}

function bullpenRoleCount(roleMap: Map<string, NonNullable<CareerPlayerState["bullpenRole"]>>, role: NonNullable<CareerPlayerState["bullpenRole"]>): number {
  return Array.from(roleMap.values()).filter((value) => value === role).length;
}

function bullpenRoleDisplayCap(role: NonNullable<CareerPlayerState["bullpenRole"]>): number {
  if (role === "마무리" || role === "셋업맨") return 1;
  if (role === "필승조" || role === "롱맨" || role === "추격조") return 2;
  return 99;
}

function calculateRosterAwareNeed(baseNeed: number, members: RosterMember[], position: Position): number {
  const target = rosterDepthTarget(position);
  const coreCount = members.filter((member) => member.overall >= target.coreOverall).length;
  const usableCount = members.filter((member) => member.overall >= target.usableOverall).length;
  const topAverage = members
    .slice()
    .sort((left, right) => right.overall - left.overall)
    .slice(0, target.core)
    .reduce((sum, member, _, array) => sum + member.overall / Math.max(1, array.length), 0);
  const coreShortage = Math.max(0, target.core - coreCount);
  const depthShortage = Math.max(0, target.usable - usableCount);
  const coreSurplus = Math.max(0, coreCount - target.core);
  const depthSurplus = Math.max(0, usableCount - target.usable);
  const qualityPenalty = topAverage > 0 ? clampNumber(target.coreOverall - topAverage, 0, 18) * 1.1 : 18;
  const shortagePenalty = coreShortage * target.coreShortageWeight + depthShortage * target.depthShortageWeight + qualityPenalty;
  const surplusDiscount = coreSurplus * 5 + depthSurplus * 2.5;
  return Math.round(clampNumber(baseNeed * 0.55 + shortagePenalty - surplusDiscount, 0, 100));
}

function rosterDepthTarget(position: Position): { core: number; usable: number; coreOverall: number; usableOverall: number; coreShortageWeight: number; depthShortageWeight: number } {
  if (position === "SP") return { core: 5, usable: 8, coreOverall: 62, usableOverall: 52, coreShortageWeight: 12, depthShortageWeight: 5 };
  if (position === "RP") return { core: 7, usable: 11, coreOverall: 58, usableOverall: 50, coreShortageWeight: 8, depthShortageWeight: 5 };
  if (position === "C") return { core: 2, usable: 4, coreOverall: 58, usableOverall: 49, coreShortageWeight: 12, depthShortageWeight: 6 };
  if (position === "SS" || position === "CF") return { core: 2, usable: 4, coreOverall: 59, usableOverall: 50, coreShortageWeight: 10, depthShortageWeight: 5 };
  return { core: 1, usable: 3, coreOverall: 58, usableOverall: 49, coreShortageWeight: 12, depthShortageWeight: 5 };
}

function countExistingPlayersAtPosition(players: ExistingLeaguePlayer[], position: Position): number {
  if (position === "SP") return players.filter((player) => player.playerGroup === "pitcher" && deterministicNoise(`${player.id}-position`) < 0.62).length;
  if (position === "RP") return players.filter((player) => player.playerGroup === "pitcher" && deterministicNoise(`${player.id}-position`) >= 0.62).length;
  const hitterPositions: Position[] = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  const index = hitterPositions.indexOf(position);
  if (index < 0) return 0;
  return players.filter((player) => player.playerGroup === "hitter" && Math.floor(deterministicNoise(`${player.id}-position`) * hitterPositions.length) === index).length;
}

function existingPlayersAtPosition(players: ExistingLeaguePlayer[], position: Position): ExistingLeaguePlayer[] {
  if (position === "SP") return players.filter((player) => player.playerGroup === "pitcher" && deterministicNoise(`${player.id}-position`) < 0.62);
  if (position === "RP") return players.filter((player) => player.playerGroup === "pitcher" && deterministicNoise(`${player.id}-position`) >= 0.62);
  const hitterPositions: Position[] = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  const index = hitterPositions.indexOf(position);
  if (index < 0) return [];
  return players.filter((player) => player.playerGroup === "hitter" && Math.floor(deterministicNoise(`${player.id}-position`) * hitterPositions.length) === index);
}

function createAllStarHistoryRows(results: TeamSeasonResult[], players: CareerPlayerState[], teams: Team[], existingPlayers: ExistingLeaguePlayer[]): SelectionHistoryRow[] {
  const seasons = Array.from(new Set(results.map((result) => result.seasonYear))).sort((left, right) => right - left);
  return seasons.flatMap((seasonYear) => {
    const yearIndex = results.find((result) => result.seasonYear === seasonYear)?.yearIndex ?? 0;
    return createAllStarRowsForSeason(seasonYear, yearIndex, players, teams, existingPlayers);
  });
}

function createAllStarRowsForSeason(seasonYear: number, yearIndex: number, players: CareerPlayerState[], teams: Team[], existingPlayers: ExistingLeaguePlayer[]): SelectionHistoryRow[] {
  const slots = ["선발투수", "계투", "마무리", "포수", "1루수", "2루수", "3루수", "유격수", "좌익수", "중견수", "우익수", "지명타자"];
  return (["드림", "나눔"] as const).flatMap((division) => {
    const rows: SelectionHistoryRow[] = [];
    const usedDrafted = new Set<ProspectId>();
    const usedExisting = new Set<string>();
    slots.forEach((slot, index) => {
      const row = selectAllStarSlot(seasonYear, yearIndex, division, slot, index, players, teams, existingPlayers, usedDrafted, usedExisting);
      if (!row) return;
      rows.push(row);
      if (row.playerId) usedDrafted.add(row.playerId);
      else usedExisting.add(row.id.replace(`allstar-${seasonYear}-${division}-${slot}-existing-`, ""));
    });
    return rows;
  });
}

function selectAllStarSlot(
  seasonYear: number,
  yearIndex: number,
  division: "드림" | "나눔",
  slot: string,
  index: number,
  players: CareerPlayerState[],
  teams: Team[],
  existingPlayers: ExistingLeaguePlayer[],
  usedDrafted: Set<ProspectId>,
  usedExisting: Set<string>,
): SelectionHistoryRow | undefined {
  const draftedCandidates = players
    .filter((player) => isDraftedAllStarEligible(player, division, slot))
    .filter((player) => !usedDrafted.has(player.playerId))
    .map((player) => ({ player, score: allStarDraftedScore(player, slot, seasonYear) }))
    .sort((left, right) => right.score - left.score);
  const existingCandidates = existingPlayers
    .filter((player) => isExistingAllStarEligible(player, teams, division, slot))
    .filter((player) => !usedExisting.has(player.id))
    .map((player) => ({ player, score: allStarExistingScore(player, slot, seasonYear) }))
    .sort((left, right) => right.score - left.score);
  const drafted = draftedCandidates[0];
  const existing = existingCandidates[0];
  if (!drafted && !existing) return undefined;
  const draftedWins = drafted && (!existing || drafted.score >= existing.score + allStarTakeoverMargin(drafted.player.yearsSinceDraft));
  if (draftedWins) {
    const team = teams.find((candidate) => candidate.id === drafted.player.team.id);
    return {
      id: `allstar-${seasonYear}-${division}-${slot}-${drafted.player.playerId}`,
      seasonYear,
      group: division,
      category: slot,
      teamName: team?.name ?? drafted.player.team.name,
      playerName: drafted.player.prospect.name,
      playerId: drafted.player.playerId,
      note: `${seasonYear}년 올스타 ${division} ${slot} 선발`,
    };
  }
  if (!existing) return undefined;
  const team = teams.find((candidate) => candidate.id === existing.player.teamId);
  return {
    id: `allstar-${seasonYear}-${division}-${slot}-existing-${existing.player.id}`,
    seasonYear,
    group: division,
    category: slot,
    teamName: team?.name ?? "-",
    playerName: existingPlayerName(existing.player),
    note: `${seasonYear}년 올스타 ${division} ${slot} 선발 · 기존 선수`,
  };
}

function isDraftedAllStarEligible(player: CareerPlayerState, division: "드림" | "나눔", slot: string): boolean {
  if (allStarDivisionForTeam(player.team.id) !== division) return false;
  if (!isFirstTeamAwardEligible(player) || player.currentOverall < 76) return false;
  if (player.fieldingRole === "지명타자") return slot === "지명타자";
  return matchesAllStarSlot(currentPlayerPosition(player), slot);
}

function isExistingAllStarEligible(player: ExistingLeaguePlayer, teams: Team[], division: "드림" | "나눔", slot: string): boolean {
  if (player.status !== "active" || player.overall < 66) return false;
  if (allStarDivisionForTeam(player.teamId) !== division) return false;
  const position = existingAllStarPosition(player);
  if (slot === "선발투수") return position === "SP";
  if (slot === "계투" || slot === "마무리") return position === "RP";
  return matchesAllStarSlot(position, slot);
}

function matchesAllStarSlot(position: Position, slot: string): boolean {
  if (slot === "선발투수") return position === "SP";
  if (slot === "계투" || slot === "마무리") return position === "RP";
  if (slot === "포수") return position === "C";
  if (slot === "1루수") return position === "1B";
  if (slot === "2루수") return position === "2B";
  if (slot === "3루수") return position === "3B";
  if (slot === "유격수") return position === "SS";
  if (slot === "좌익수") return position === "LF";
  if (slot === "중견수") return position === "CF";
  if (slot === "우익수") return position === "RF";
  return ["1B", "LF", "RF"].includes(position);
}

function existingAllStarPosition(player: ExistingLeaguePlayer): Position {
  if (player.playerGroup === "pitcher") return deterministicNoise(`${player.id}-position`) < 0.62 ? "SP" : "RP";
  const hitterPositions: Position[] = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  return hitterPositions[Math.floor(deterministicNoise(`${player.id}-position`) * hitterPositions.length)] ?? "1B";
}

function allStarDraftedScore(player: CareerPlayerState, slot: string, seasonYear: number): number {
  const tools = getCareerTools(player);
  const toolBonus = !isPitcherTools(tools)
    ? slot === "지명타자" || ["1루수", "좌익수", "우익수"].includes(slot)
      ? tools.power * 0.045 + tools.contact * 0.025
      : tools.defense * 0.045 + tools.contact * 0.02
    : slot === "선발투수"
      ? tools.stamina * 0.045 + tools.command * 0.025
      : tools.stuff * 0.04 + tools.mentality * 0.03;
  const rookieWall = player.yearsSinceDraft <= 1 ? -8 : player.yearsSinceDraft <= 2 ? -5 : player.yearsSinceDraft <= 4 ? -2.5 : 0;
  return player.currentOverall * 1.08 + toolBonus + rookieWall + deterministicNoise(`allstar-drafted-${seasonYear}-${slot}-${player.playerId}`) * 2.5;
}

function allStarExistingScore(player: ExistingLeaguePlayer, slot: string, seasonYear: number): number {
  const roleBonus = slot === "마무리" ? 2 : slot === "선발투수" ? 1.5 : 0;
  const incumbentBonus = player.age >= 26 && player.age <= 34 ? 2.4 : player.age > 34 ? 0.8 : 1.4;
  return player.overall * 1.14 + roleBonus + incumbentBonus + deterministicNoise(`allstar-existing-${seasonYear}-${slot}-${player.id}`) * 3.5;
}

function allStarTakeoverMargin(yearsSinceDraft: number): number {
  if (yearsSinceDraft <= 1) return 7.5;
  if (yearsSinceDraft <= 2) return 5.5;
  if (yearsSinceDraft <= 4) return 3.5;
  return 2.2;
}

function createNationalTeamHistoryRows(results: TeamSeasonResult[], players: CareerPlayerState[], teams: Team[], existingPlayers: ExistingLeaguePlayer[]): SelectionHistoryRow[] {
  const seasons = Array.from(new Set(results.map((result) => result.seasonYear))).filter((seasonYear) => Boolean(nationalTeamTournamentInfo(seasonYear))).sort((left, right) => right - left);
  return seasons.flatMap((seasonYear) => {
    const yearIndex = results.find((result) => result.seasonYear === seasonYear)?.yearIndex ?? 0;
    return createNationalTeamRowsForSeason(seasonYear, yearIndex, players, teams, existingPlayers);
  });
}

function createNationalTeamRowsForSeason(seasonYear: number, yearIndex: number, players: CareerPlayerState[], teams: Team[], existingPlayers: ExistingLeaguePlayer[]): SelectionHistoryRow[] {
  const tournament = nationalTeamTournamentInfo(seasonYear);
  if (!tournament) return [];
  const slots = [
    "선발투수 1", "선발투수 2", "선발투수 3", "선발투수 4",
    "불펜 1", "불펜 2", "불펜 3", "불펜 4", "마무리",
    "포수", "1루수", "2루수", "3루수", "유격수", "좌익수", "중견수", "우익수", "지명타자",
    "백업 포수", "백업 내야", "백업 내야", "백업 외야", "백업 외야", "대주자/수비",
  ];
  const usedDrafted = new Set<ProspectId>();
  const usedExisting = new Set<string>();
  const context: NationalTeamSelectionContext = {
    isAsianGames: tournament.name === "아시안게임 대표팀",
    wildcardsUsed: 0,
    wildcardLimit: 3,
  };
  return slots
    .map((slot, index) => {
      const row = selectNationalTeamSlot(seasonYear, yearIndex, tournament.name, tournament.result, slot, index, players, teams, existingPlayers, usedDrafted, usedExisting, context);
      if (!row) return undefined;
      if (row.playerId) usedDrafted.add(row.playerId);
      else usedExisting.add(row.id.replace(`national-${seasonYear}-${slot}-existing-`, ""));
      return row;
    })
    .filter((row): row is SelectionHistoryRow => Boolean(row));
}

function selectNationalTeamSlot(
  seasonYear: number,
  yearIndex: number,
  tournamentName: string,
  tournamentResult: string,
  slot: string,
  index: number,
  players: CareerPlayerState[],
  teams: Team[],
  existingPlayers: ExistingLeaguePlayer[],
  usedDrafted: Set<ProspectId>,
  usedExisting: Set<string>,
  context: NationalTeamSelectionContext,
): SelectionHistoryRow | undefined {
  const draftedCandidates = players
    .filter((player) => isDraftedNationalTeamEligible(player, slot, context))
    .filter((player) => !usedDrafted.has(player.playerId))
    .map((player) => ({ player, score: nationalTeamFitScore(player, seasonYear, slot) }))
    .sort((left, right) => right.score - left.score);
  const existingCandidates = existingPlayers
    .filter((player) => isExistingNationalTeamEligible(player, slot, context))
    .filter((player) => !usedExisting.has(player.id))
    .map((player) => ({ player, score: nationalTeamExistingScore(player, seasonYear, slot) }))
    .sort((left, right) => right.score - left.score);
  const drafted = draftedCandidates[0];
  const existing = existingCandidates[0];
  if (!drafted && !existing) return undefined;
  const draftedWins = drafted && (!existing || drafted.score >= existing.score + nationalTeamTakeoverMargin(drafted.player.yearsSinceDraft));
  if (draftedWins) {
    const rosterRule = nationalTeamRosterRuleLabel(context, careerAge(drafted.player));
    if (rosterRule === "와일드카드") context.wildcardsUsed += 1;
    return {
      id: `national-${seasonYear}-${slot}-${drafted.player.playerId}`,
      seasonYear,
      group: `${tournamentName} · ${tournamentResult}`,
      category: slot,
      teamName: drafted.player.team.name,
      playerName: drafted.player.prospect.name,
      playerId: drafted.player.playerId,
      note: `${seasonYear}년 ${tournamentName} ${slot} 선발 · ${tournamentResult}${rosterRule ? ` · ${rosterRule}` : ""}`,
    };
  }
  if (!existing) return undefined;
  const rosterRule = nationalTeamRosterRuleLabel(context, existing.player.age);
  if (rosterRule === "와일드카드") context.wildcardsUsed += 1;
  const team = teams.find((candidate) => candidate.id === existing.player.teamId);
  return {
    id: `national-${seasonYear}-${slot}-existing-${existing.player.id}`,
    seasonYear,
    group: `${tournamentName} · ${tournamentResult}`,
    category: slot,
    teamName: team?.name ?? "-",
    playerName: existingPlayerName(existing.player),
    note: `${seasonYear}년 ${tournamentName} ${slot} 선발 · ${tournamentResult} · 기존 선수${rosterRule ? ` · ${rosterRule}` : ""}`,
  };
}

function isDraftedNationalTeamEligible(player: CareerPlayerState, slot: string, context?: NationalTeamSelectionContext): boolean {
  if (!isNationalTeamMilitaryEligible(player)) return false;
  if (player.militaryStatus !== "serving" && player.status !== "1군") return false;
  if (player.currentOverall < 76) return false;
  if (!isAsianGamesAgeEligible(careerAge(player), context)) return false;
  if (player.fieldingRole === "지명타자") return slot === "지명타자";
  return matchesNationalTeamSlot(currentPlayerPosition(player), slot);
}

function isNationalTeamMilitaryEligible(player: CareerPlayerState): boolean {
  if (player.militaryStatus !== "serving") return true;
  if (player.militaryType !== "상무") return false;
  return player.currentOverall >= 78 && player.debuted;
}

function isExistingNationalTeamEligible(player: ExistingLeaguePlayer, slot: string, context?: NationalTeamSelectionContext): boolean {
  if (player.status !== "active" || player.overall < 74) return false;
  if (!isAsianGamesAgeEligible(player.age, context)) return false;
  return matchesNationalTeamSlot(existingAllStarPosition(player), slot);
}

function isAsianGamesAgeEligible(age: number, context?: NationalTeamSelectionContext): boolean {
  if (!context?.isAsianGames) return true;
  if (age <= 23) return true;
  return context.wildcardsUsed < context.wildcardLimit;
}

function nationalTeamRosterRuleLabel(context: NationalTeamSelectionContext, age: number): string {
  if (!context.isAsianGames) return "";
  return age <= 23 ? "U-23" : "와일드카드";
}

function matchesNationalTeamSlot(position: Position, slot: string): boolean {
  if (slot.startsWith("선발투수")) return position === "SP";
  if (slot.startsWith("불펜") || slot === "마무리") return position === "RP";
  if (slot === "포수" || slot === "백업 포수") return position === "C";
  if (slot === "1루수") return position === "1B";
  if (slot === "2루수") return position === "2B";
  if (slot === "3루수") return position === "3B";
  if (slot === "유격수") return position === "SS";
  if (slot === "좌익수") return position === "LF";
  if (slot === "중견수") return position === "CF";
  if (slot === "우익수") return position === "RF";
  if (slot === "지명타자") return ["1B", "LF", "RF"].includes(position);
  if (slot === "백업 내야") return ["2B", "3B", "SS"].includes(position);
  if (slot === "백업 외야") return ["LF", "CF", "RF"].includes(position);
  return ["SS", "2B", "CF", "LF", "RF"].includes(position);
}

function createSelectionHistoryRows(players: CareerPlayerState[], type: "올스타 선발" | "국가대표 선발"): SelectionHistoryRow[] {
  const keyword = type === "올스타 선발" ? "올스타" : "국가대표";
  return players
    .flatMap((player) =>
      player.transactionLog
        .filter((line) => type === "국가대표 선발" ? line.includes("국가대표") || line.includes("대표팀") : line.includes(keyword))
        .map((note) => {
          const seasonYear = Number(note.match(/^(\d{4})년/)?.[1] ?? player.draftYear);
          return {
            id: `${type}-${seasonYear}-${player.playerId}`,
            seasonYear,
            group: type === "올스타 선발" ? allStarDivisionFromNote(note) : nationalTeamResultFromNote(note),
            teamName: player.team.name,
            playerName: player.prospect.name,
            playerId: player.playerId,
            note,
          };
        }),
    )
    .sort((left, right) => right.seasonYear - left.seasonYear || left.group.localeCompare(right.group, "ko") || left.playerName.localeCompare(right.playerName, "ko"));
}

function allStarDivisionFromNote(note: string): string {
  if (note.includes("드림")) return "드림";
  if (note.includes("나눔")) return "나눔";
  return "올스타";
}

function nationalTeamResultFromNote(note: string): string {
  if (note.includes("금메달")) return "금메달";
  if (note.includes("은메달")) return "은메달";
  if (note.includes("동메달")) return "동메달";
  if (note.includes("1위")) return "1위";
  if (note.includes("2위")) return "2위";
  if (note.includes("3위")) return "3위";
  if (note.includes("4위")) return "4위";
  if (note.includes("4강탈락") || note.includes("4강")) return "4강";
  if (note.includes("8강탈락")) return "8강탈락";
  if (note.includes("16강탈락")) return "16강탈락";
  if (note.includes("조별리그탈락")) return "조별리그탈락";
  if (note.includes("예선탈락")) return "예선탈락";
  return "대표팀";
}

function createYearlyAwardRows(results: TeamSeasonResult[], players: CareerPlayerState[], teams: Team[], existingPlayers: ExistingLeaguePlayer[]): YearlyAwardRow[] {
  const seasons = Array.from(new Set(results.map((result) => result.seasonYear))).sort((left, right) => right - left);
  const categories = [
    "골든글러브 투수",
    "골든글러브 포수",
    "골든글러브 1루수",
    "골든글러브 2루수",
    "골든글러브 3루수",
    "골든글러브 유격수",
    "골든글러브 외야수 1",
    "골든글러브 외야수 2",
    "골든글러브 외야수 3",
    "골든글러브 지명타자",
    "타율왕",
    "홈런왕",
    "타점왕",
    "도루왕",
    "다승왕",
    "평균자책점왕",
    "탈삼진왕",
    "홀드왕",
    "세이브왕",
    "신인왕",
    "MVP",
  ];

  return seasons.flatMap((seasonYear) => {
    const yearIndex = results.find((result) => result.seasonYear === seasonYear)?.yearIndex ?? 0;
    const seasonRows: YearlyAwardRow[] = [];

    categories.forEach((category, index) => {
      const rookieAwardRow = category === "신인왕" ? chooseRookieAwardRow(players, teams, seasonYear, yearIndex) : undefined;
      if (rookieAwardRow) {
        seasonRows.push(rookieAwardRow);
        return;
      }
      if (category === "신인왕") return;

      const mvpFromGoldGlove = category === "MVP" ? chooseMvpFromGoldGloveRows(seasonRows, players, teams, seasonYear, yearIndex) : undefined;
      if (mvpFromGoldGlove) {
        seasonRows.push(mvpFromGoldGlove);
        return;
      }

      const excludedDraftedIds = awardedDraftedIdsForCategory(seasonRows, category);
      const excludedExistingSlots = awardedExistingSlotsForCategory(seasonRows, category);
      const eligible = players
        .filter((player) => isDraftedPlayerAwardEligible(player, category, yearIndex))
        .filter((player) => !excludedDraftedIds.has(player.playerId))
        .sort((left, right) => awardFitScore(right, category) - awardFitScore(left, category));
      const existingWinner = selectExistingAwardWinner(existingPlayers, category, seasonYear, index, excludedExistingSlots);
      const draftedScore = eligible[0] ? awardFitScore(eligible[0], category) : 0;
      const existingScore = existingWinner ? existingAwardFitScore(existingWinner, category) : 0;
      const draftedWinner =
        eligible[0] &&
        (!existingWinner ||
          (draftedScore >= existingScore + awardTakeoverMargin(category, yearIndex, eligible[0].yearsSinceDraft) &&
            deterministicNoise(`${seasonYear}-${category}-${eligible[0].playerId}`) > awardTakeoverThreshold(category, yearIndex)))
          ? eligible[0]
          : undefined;
      if (!draftedWinner && !existingWinner) return;
      const team = draftedWinner ? teams.find((candidate) => candidate.id === draftedWinner.team.id) : teams.find((candidate) => candidate.id === existingWinner?.teamId);

      if (draftedWinner) {
        seasonRows.push({
          id: `award-${seasonYear}-${category}-${index}`,
          seasonYear,
          category,
          teamName: team?.name ?? "-",
          playerName: draftedWinner.prospect.name,
          playerId: draftedWinner.playerId,
          note: `드래프트 출신 · 현재 OVR ${draftedWinner.currentOverall}`,
        });
        return;
      }

      if (!existingWinner) return;

      seasonRows.push({
        id: `award-${seasonYear}-${category}-${index}`,
        seasonYear,
        category,
        teamName: team?.name ?? "-",
        playerName: existingPlayerName(existingWinner),
        note: existingPlayerNote(yearIndex),
      });
    });
    return seasonRows;
  });
}

function awardedDraftedIdsForCategory(rows: YearlyAwardRow[], category: string): Set<ProspectId> {
  if (!category.startsWith("골든글러브")) return new Set();
  const sameGroupRows = rows.filter((row) => {
    if (!row.playerId) return false;
    if (category.startsWith("골든글러브 외야수")) return row.category.startsWith("골든글러브 외야수");
    return row.category === category;
  });
  return new Set(sameGroupRows.map((row) => row.playerId).filter((id): id is ProspectId => Boolean(id)));
}

function awardedExistingSlotsForCategory(rows: YearlyAwardRow[], category: string): Set<string> {
  if (!category.startsWith("골든글러브")) return new Set();
  return new Set(
    rows
      .filter((row) => {
        if (row.playerId) return false;
        if (category.startsWith("골든글러브 외야수")) return row.category.startsWith("골든글러브 외야수");
        return row.category === category;
      })
      .map((row) => row.playerName),
  );
}

function chooseRookieAwardRow(players: CareerPlayerState[], teams: Team[], seasonYear: number, yearIndex: number): YearlyAwardRow | undefined {
  const winner = players
    .filter((player) => player.careerLog.some((entry) => entry.year === yearIndex && entry.type === "신인왕 수상"))
    .filter((player) => isFirstTeamAwardEligible(player))
    .sort((left, right) => right.currentOverall - left.currentOverall || left.pick.overall - right.pick.overall)[0];
  if (!winner) return undefined;
  const team = teams.find((candidate) => candidate.id === winner.team.id);
  return {
    id: `award-${seasonYear}-rookie-${winner.playerId}`,
    seasonYear,
    category: "신인왕",
    teamName: team?.name ?? winner.team.name,
    playerName: winner.prospect.name,
    playerId: winner.playerId,
    note: `${winner.pick.round}라운드 ${winner.pick.overall}순위 · 현재 OVR ${winner.currentOverall}`,
  };
}

function chooseMvpFromGoldGloveRows(rows: YearlyAwardRow[], players: CareerPlayerState[], teams: Team[], seasonYear: number, yearIndex: number): YearlyAwardRow | undefined {
  const goldGloveWinners = rows
    .filter((row) => row.category.startsWith("골든글러브") && row.playerId)
    .map((row) => players.find((player) => player.playerId === row.playerId))
    .filter((player): player is CareerPlayerState => Boolean(player))
    .filter((player) => isFirstTeamAwardEligible(player))
    .sort((left, right) => awardFitScore(right, "MVP") - awardFitScore(left, "MVP"));
  const winner = goldGloveWinners[0];
  if (!winner) return undefined;
  if (deterministicNoise(`${seasonYear}-mvp-from-gg-${winner.playerId}`) < 0.68) return undefined;
  const team = teams.find((candidate) => candidate.id === winner.team.id);
  return {
    id: `award-${seasonYear}-MVP-from-gg`,
    seasonYear,
    category: "MVP",
    teamName: team?.name ?? winner.team.name,
    playerName: winner.prospect.name,
    playerId: winner.playerId,
    note: `골든글러브 수상자 중 MVP · 현재 OVR ${winner.currentOverall}`,
  };
}

function selectExistingAwardWinner(players: ExistingLeaguePlayer[], category: string, seasonYear: number, index: number, excludedLabels: Set<string>): ExistingLeaguePlayer | undefined {
  const pool = players
    .filter((player) => player.status === "active")
    .filter((player) => !excludedLabels.has(existingPlayerLabel(index, player.yearsTracked, category, 0, player)))
    .filter((player) => {
      const pitcherTitle = ["다승왕", "평균자책점왕", "탈삼진왕", "홀드왕", "세이브왕"].includes(category) || category === "골든글러브 투수";
      const hitterTitle = ["타율왕", "홈런왕", "타점왕", "도루왕"].includes(category);
      if (pitcherTitle) return player.playerGroup === "pitcher";
      if (hitterTitle || category.startsWith("골든글러브")) return player.playerGroup === "hitter";
      return true;
    })
    .sort((left, right) => existingAwardFitScore(right, category) - existingAwardFitScore(left, category));
  if (pool.length === 0) return undefined;
  const offset = Math.floor(deterministicNoise(`${seasonYear}-${category}-existing-${index}`) * Math.min(5, pool.length));
  return pool[offset] ?? pool[0];
}

function existingAwardFitScore(player: ExistingLeaguePlayer, category: string): number {
  const agePrimeBonus = player.age >= 27 && player.age <= 32 ? 4 : player.age >= 35 ? -4 : 0;
  const roleBonus = category === "MVP" ? 5 : category.startsWith("골든글러브") ? 2 : 0;
  return player.overall + agePrimeBonus + roleBonus + deterministicNoise(`${player.id}-${category}`) * 7;
}

function isDraftedPlayerAwardEligible(player: CareerPlayerState, category: string, yearIndex: number): boolean {
  if (player.status === "방출" || player.status === "은퇴" || player.status === "해외진출") return false;
  if (!player.debuted || !isFirstTeamAwardEligible(player)) return false;
  if (player.yearsSinceDraft > yearIndex + 1) return false;

  const pitcherTitle = ["다승왕", "평균자책점왕", "탈삼진왕", "홀드왕", "세이브왕"].includes(category);
  const hitterTitle = ["타율왕", "홈런왕", "타점왕", "도루왕"].includes(category);
  if (pitcherTitle && player.prospect.playerGroup !== "pitcher") return false;
  if ((category === "홀드왕" || category === "세이브왕") && currentPlayerPosition(player) !== "RP") return false;
  if (hitterTitle && player.prospect.playerGroup === "pitcher") return false;
  if (!matchesGoldenGloveCategory(player, category)) return false;

  const generationDiscount = yearIndex >= 12 ? 3 : yearIndex >= 9 ? 2 : yearIndex >= 7 ? 1 : 0;
  const rookieWall = player.yearsSinceDraft <= 1 ? 10 : player.yearsSinceDraft <= 2 ? 7 : player.yearsSinceDraft <= 4 ? 4 : 0;
  const minimumOverall = (category === "MVP" ? 84 : category.startsWith("골든글러브") ? 78 : 82) + rookieWall - generationDiscount;
  return player.currentOverall >= minimumOverall;
}

function matchesGoldenGloveCategory(player: CareerPlayerState, category: string): boolean {
  if (!category.startsWith("골든글러브")) return true;
  const position = currentPlayerPosition(player);
  if (player.fieldingRole === "지명타자") return category === "골든글러브 지명타자";
  if (category === "골든글러브 투수") return position === "SP";
  if (category === "골든글러브 포수") return position === "C";
  if (category === "골든글러브 1루수") return position === "1B";
  if (category === "골든글러브 2루수") return position === "2B";
  if (category === "골든글러브 3루수") return position === "3B";
  if (category === "골든글러브 유격수") return position === "SS";
  if (category.startsWith("골든글러브 외야수")) return ["LF", "CF", "RF"].includes(position);
  if (category === "골든글러브 지명타자") return player.prospect.playerGroup !== "pitcher" && ["1B", "LF", "RF"].includes(position);
  return true;
}

function awardTakeoverThreshold(category: string, yearIndex: number): number {
  const base = category === "MVP" ? 0.9 : category.startsWith("골든글러브") ? 0.84 : 0.94;
  const retirementPressure = Math.max(0, yearIndex - 5) * 0.045;
  return clampNumber(base - retirementPressure, category === "MVP" ? 0.42 : category.startsWith("골든글러브") ? 0.36 : 0.5, base);
}

function awardTakeoverMargin(category: string, yearIndex: number, playerYears: number): number {
  const earlyWall = playerYears <= 1 ? 12 : playerYears <= 2 ? 8 : playerYears <= 4 ? 4 : 0;
  const base = category === "MVP" ? 5 : category.startsWith("골든글러브") ? 3 : 6;
  const leagueOpening = Math.max(0, yearIndex - 7) * 0.5;
  return Math.max(0, base + earlyWall - leagueOpening);
}

function existingPlayerLabel(index: number, yearIndex: number, category?: string, slot = index + 1, player?: ExistingLeaguePlayer): string {
  if (player) return existingPlayerName(player);
  if (category?.startsWith("골든글러브 외야수")) return `기존 외야수 ${slot}`;
  if (yearIndex <= 6) return `기존 선수 ${index + 1}`;
  if (yearIndex <= 10) return `기존 베테랑 ${index + 1}`;
  if (yearIndex <= 14) return `과도기 주전 ${index + 1}`;
  return `후속 세대 선수 ${index + 1}`;
}

function existingPlayerName(player: ExistingLeaguePlayer): string {
  const parts = player.id.split("-");
  return `기존 ${player.playerGroup === "pitcher" ? "투수" : "야수"} ${parts[parts.length - 1]}`;
}

function existingPlayerNote(yearIndex: number): string {
  if (yearIndex <= 6) return "기존 선수층 우세";
  if (yearIndex <= 10) return "기존 선수층 노쇠화 구간";
  if (yearIndex <= 14) return "세대교체 과도기";
  return "드래프트 세대 중심 리그";
}

function awardFitScore(player: CareerPlayerState, category: string): number {
  const pitcher = player.prospect.playerGroup === "pitcher";
  const hitterScore = player.currentOverall + (player.prospect.hitterStats?.homeRuns ?? 0) * 0.7 + (player.prospect.hitterStats?.ops ?? 0) * 8;
  const pitcherScore = player.currentOverall + (player.prospect.pitcherStats?.strikeoutsPerNine ?? 0) * 1.2 - (player.prospect.pitcherStats?.era ?? 4) * 1.5;
  if (["다승왕", "평균자책점왕", "탈삼진왕", "홀드왕", "세이브왕"].includes(category)) {
    if (!pitcher) return 0;
    const holdRoleBonus = category === "홀드왕" ? bullpenTitleBonus(player, "hold") : 0;
    const saveRoleBonus = category === "세이브왕" ? bullpenTitleBonus(player, "save") : 0;
    return pitcherScore + holdRoleBonus + saveRoleBonus;
  }
  if (category === "골든글러브 지명타자") return pitcher ? 0 : hitterScore + (player.fieldingRole === "지명타자" ? 8 : 0);
  if (category.startsWith("골든글러브")) return player.currentOverall + (player.prospect.hitterStats?.defensiveGrade ?? player.prospect.pitcherStats?.commandGrade ?? 45) * 0.35 + (category === "골든글러브 투수" && currentPlayerPosition(player) === "SP" ? 3 : 0);
  if (category === "MVP") return player.currentOverall + (player.eventKeys.includes("mvp") ? 18 : 0);
  return pitcher ? 0 : hitterScore;
}

function bullpenTitleBonus(player: CareerPlayerState, title: "hold" | "save"): number {
  if (currentPlayerPosition(player) !== "RP") return title === "save" ? -8 : -4;
  if (title === "save") {
    if (player.bullpenRole === "마무리") return 16;
    if (player.bullpenRole === "셋업맨") return 2;
    if (player.bullpenRole === "패전조") return -12;
    return -6;
  }
  if (player.bullpenRole === "셋업맨") return 12;
  if (player.bullpenRole === "필승조") return 10;
  if (player.bullpenRole === "추격조") return 2;
  if (player.bullpenRole === "마무리") return -2;
  if (player.bullpenRole === "패전조") return -10;
  return 4;
}

function teamNeedScore(team: Team, position: Position): number {
  const direct = team.positionDepth[position]?.need ?? team.needs.find((need) => need.position === position)?.urgency ?? 0;
  const broad = team.needs.some((need) => positionGroupMatchesNeed(need.position, position)) ? 45 : 0;
  return Math.max(direct, broad);
}

function positionGroupMatchesNeed(need: Position, position: Position): boolean {
  if ((need === "SP" || need === "RP") && (position === "SP" || position === "RP")) return true;
  if (["1B", "2B", "3B", "SS"].includes(need) && ["1B", "2B", "3B", "SS"].includes(position)) return true;
  if (["LF", "CF", "RF"].includes(need) && ["LF", "CF", "RF"].includes(position)) return true;
  return false;
}

function localSchoolScore(team: Team, prospect: Prospect): number {
  const marketRegions: Record<string, SchoolRegion[]> = {
    서울: ["서울권"],
    잠실: ["서울권"],
    고척: ["서울권", "경기·인천권"],
    수원: ["경기·인천권"],
    인천: ["경기·인천권"],
    대구: ["대구·경북권"],
    부산: ["부산·울산·경남권"],
    대전: ["대전·세종권", "충청권"],
    창원: ["부산·울산·경남권"],
    광주: ["광주·전남권", "전북권"],
  };
  return marketRegions[team.market]?.includes(prospect.schoolRegion) ? 1 : 0;
}

function deterministicNoise(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 9973;
  }
  return hash / 9973;
}

function shortAccolades(prospect: Prospect): string {
  if (prospect.accolades.length === 0) return "-";
  const labels = prospect.accolades.map((accolade) => accolade.label);
  return labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} 외 ${labels.length - 2}`;
}

function createAccoladeReview(players: CareerPlayerState[]) {
  const awarded = players.filter((player) => player.prospect.accolades.length > 0);
  const successes = awarded.filter((player) => player.overall >= 68 || player.eventKeys.some((key) => ["rookie-award", "gold-glove", "mvp"].includes(key)));
  const failures = awarded.filter((player) => player.status === "방출" || player.overall < 56);
  const examples = [...successes.slice(0, 3), ...failures.slice(0, 3)].slice(0, 6);

  return {
    total: awarded.length,
    successes: successes.length,
    failures: failures.length,
    examples,
  };
}

function createInitialCareerPlayers(selections: DraftSelectionView[]): CareerPlayerState[] {
  return selections.map((selection) => ({
    playerId: selection.prospect.id,
    prospect: selection.prospect,
    team: selection.team,
    pick: selection.pick,
    draftYear: selection.pick.year,
    initialOverall: selection.prospect.trueTalent.currentAbility,
    currentOverall: selection.prospect.trueTalent.currentAbility,
    overall: selection.prospect.trueTalent.currentAbility,
    currentTools: initialCareerTools(selection.prospect),
    yearsPro: 0,
    yearsSinceDraft: 0,
    releaseProtectionUntilYear: 1,
    trackingStatus: "auto",
    status: "2군",
    debuted: false,
    firstHit: false,
    firstHomeRun: false,
    firstStart: false,
    eventKeys: [],
    careerLog: [],
    originalTeamId: selection.team.id,
    transactionLog: [`${selection.pick.year}년 ${selection.team.shortName} 지명`],
    militaryStatus: "none",
  }));
}

function initialCareerTools(prospect: Prospect): DevelopmentTools {
  if (prospect.playerGroup === "pitcher") {
    return prospect.trueTalent.pitcherTools ?? {
      command: prospect.trueTalent.currentAbility,
      stuff: prospect.trueTalent.currentAbility,
      velocity: prospect.trueTalent.currentAbility,
      stamina: prospect.primaryPosition === "SP" ? prospect.trueTalent.currentAbility : Math.max(30, prospect.trueTalent.currentAbility - 8),
      mentality: prospect.trueTalent.currentAbility,
    };
  }

  return prospect.trueTalent.hitterTools ?? {
    contact: prospect.trueTalent.currentAbility,
    discipline: prospect.trueTalent.currentAbility,
    speed: prospect.trueTalent.currentAbility,
    power: prospect.trueTalent.currentAbility,
    defense: prospect.trueTalent.currentAbility,
    mentality: prospect.trueTalent.currentAbility,
  };
}

function getCareerTools(player: CareerPlayerState): DevelopmentTools {
  return player.currentTools ?? initialCareerTools(player.prospect);
}

function isPitcherTools(tools: DevelopmentTools): tools is PitcherDevelopmentTools {
  return "command" in tools;
}

function weightedToolOverall(tools: DevelopmentTools): number {
  if (isPitcherTools(tools)) {
    return Math.round(tools.command * 0.24 + tools.stuff * 0.26 + tools.velocity * 0.2 + tools.stamina * 0.14 + tools.mentality * 0.16);
  }
  return Math.round(tools.contact * 0.2 + tools.discipline * 0.15 + tools.speed * 0.13 + tools.power * 0.2 + tools.defense * 0.17 + tools.mentality * 0.15);
}

function shouldHaveMilitaryPowerBreakout(player: CareerPlayerState, tools: DevelopmentTools): boolean {
  if (isPitcherTools(tools) || player.eventKeys.includes("military-power-breakout")) return false;
  const powerWindow = tools.power >= 42 && tools.power <= 68;
  if (!powerWindow) return false;
  const typeBonus = player.militaryType === "상무" ? 0.006 : 0.002;
  const physicalHint = player.prospect.physical.weightKg >= 86 || player.prospect.physical.heightCm >= 185 ? 0.003 : 0;
  const workBonus = player.prospect.trueTalent.workEthic >= 0.68 ? 0.004 : 0;
  return Math.random() < typeBonus + physicalHint + workBonus;
}

function advanceCareerTools(player: CareerPlayerState, cycle: SeasonCycleResult, climate: SeasonDevelopmentClimate): DevelopmentTools {
  const outcome = cycle.developmentOutcome;
  const age = careerAge(player, 1);
  const agingDrag = agingCurveDrag(player, age) * 0.48;
  const growthBase = developmentOutcomeBase(outcome) + climate.growthShift * 1.1 + (Math.random() * 2 - 1) * player.prospect.trueTalent.volatility * 0.7 - agingDrag;
  const cap = Math.max(player.prospect.trueTalent.potential + 4, player.currentOverall + 2);
  const currentTools = getCareerTools(player);
  const toolPlan = developmentToolPlan(currentTools, outcome);
  const improve = (key: string, value: number, bias = 0) => {
    const planBias = toolPlan[key] ?? 0;
    return Math.round(clampNumber(value + growthBase + planBias + bias + Math.random() * 1.4 - 0.7, 20, cap));
  };

  if (isPitcherTools(currentTools)) {
    const pitcher = currentTools;
    return {
      command: improve("command", pitcher.command, player.prospect.trueTalent.proAdaptation >= 0.6 ? 0.7 : -0.2),
      stuff: improve("stuff", pitcher.stuff, player.prospect.trueTalent.growthRate >= 0.65 ? 0.6 : 0),
      velocity: improve("velocity", pitcher.velocity, player.yearsSinceDraft <= 3 ? 0.4 : age >= 34 ? -0.8 : -0.15),
      stamina: improve("stamina", pitcher.stamina, pitcherStaminaAgingBias(player, age)),
      mentality: improve("mentality", pitcher.mentality, veteranMentalityBias(player, age)),
    };
  }

  const hitter = currentTools;
  return {
    contact: improve("contact", hitter.contact, player.prospect.trueTalent.proAdaptation >= 0.6 ? 0.55 : 0),
    discipline: improve("discipline", hitter.discipline, player.prospect.trueTalent.workEthic >= 0.62 ? 0.6 : 0),
    speed: improve("speed", hitter.speed, hitterSpeedAgingBias(player, age)),
    power: improve("power", hitter.power, player.prospect.trueTalent.growthRate >= 0.62 ? 0.7 : 0),
    defense: improve("defense", hitter.defense, hitterDefenseAgingBias(player, age)),
    mentality: improve("mentality", hitter.mentality, veteranMentalityBias(player, age)),
  };
}

function pitcherStaminaAgingBias(player: CareerPlayerState, age: number): number {
  const starterBase = player.prospect.primaryPosition === "SP" ? 0.45 : -0.25;
  if (age < 31) return starterBase;
  if (age < 34) return starterBase - 0.45;
  if (age < 37) return starterBase - 1.25;
  if (age < 40) return starterBase - 2.05;
  return starterBase - 2.8;
}

function hitterSpeedAgingBias(player: CareerPlayerState, age: number): number {
  if (player.yearsSinceDraft <= 4 && age < 28) return 0.15;
  if (age < 31) return -0.25;
  if (age < 34) return -0.9;
  if (age < 37) return -1.55;
  return -2.25;
}

function hitterDefenseAgingBias(player: CareerPlayerState, age: number): number {
  const defensivePositionBonus = ["C", "SS", "CF", "2B"].includes(player.prospect.primaryPosition) ? 0.45 : 0;
  if (player.fieldingRole === "지명타자") return -1.4;
  if (age < 31) return defensivePositionBonus;
  if (age < 34) return defensivePositionBonus - 0.35;
  if (age < 37) return defensivePositionBonus - 1.05;
  return defensivePositionBonus - 1.75;
}

function veteranMentalityBias(player: CareerPlayerState, age: number): number {
  const makeup = player.prospect.trueTalent.workEthic >= 0.68 ? 0.45 : player.prospect.trueTalent.workEthic <= 0.38 ? -0.15 : 0.15;
  const adaptation = player.prospect.trueTalent.proAdaptation >= 0.62 ? 0.25 : player.prospect.trueTalent.proAdaptation <= 0.34 ? -0.1 : 0;
  if (age < 29) return player.prospect.trueTalent.workEthic >= 0.62 ? 0.55 : 0;
  if (age < 33) return 0.55 + makeup + adaptation;
  if (age < 37) return 0.95 + makeup + adaptation;
  if (age < 40) return 1.15 + makeup + adaptation;
  return 0.75 + makeup + adaptation;
}

function developmentOutcomeBase(outcome: DevelopmentOutcome): number {
  if (outcome === "overall-growth") return 2.2;
  if (outcome === "strength-focus") return 0.8;
  if (outcome === "weakness-fix") return 0.7;
  if (outcome === "maintain") return 0;
  if (outcome === "strength-fade") return -0.7;
  if (outcome === "weakness-worsen") return -0.8;
  if (outcome === "major-injury") return -3.4;
  return -2.1;
}

function developmentToolPlan(tools: DevelopmentTools, outcome: DevelopmentOutcome): Record<string, number> {
  const entries = Object.entries(tools).sort((left, right) => right[1] - left[1]);
  const strengths = entries.slice(0, 2).map(([key]) => key);
  const weaknesses = entries.slice(-2).map(([key]) => key);
  const plan: Record<string, number> = {};
  const assign = (keys: string[], value: number) => keys.forEach((key) => { plan[key] = value; });

  if (outcome === "strength-focus") assign(strengths, 2.4);
  if (outcome === "weakness-fix") assign(weaknesses, 2.6);
  if (outcome === "strength-fade") assign(strengths, -2.8);
  if (outcome === "weakness-worsen") assign(weaknesses, -2.8);
  if (outcome === "major-injury") assign(isPitcherTools(tools) ? ["velocity", "stamina"] : ["speed", "defense"], -2.2);
  return plan;
}

function createSeasonDevelopmentClimate(): SeasonDevelopmentClimate {
  const roll = Math.random();
  if (roll < 0.12) {
    return {
      id: "excellent",
      label: "육성 대성공",
      description: "리그 전체적으로 신인 적응과 퓨처스 육성 성과가 좋았던 시즌입니다.",
      growthShift: 0.34,
      adaptationShift: 0.16,
      volatilityShift: -0.08,
      injuryShift: -0.018,
    };
  }
  if (roll < 0.34) {
    return {
      id: "good",
      label: "육성 양호",
      description: "몇몇 구단의 육성 성과가 좋고 신인들의 시즌 적응도도 평년보다 나았습니다.",
      growthShift: 0.16,
      adaptationShift: 0.08,
      volatilityShift: -0.035,
      injuryShift: -0.008,
    };
  }
  if (roll < 0.72) {
    return {
      id: "normal",
      label: "평년 육성",
      description: "특별한 쏠림 없이 평년 수준의 성장과 정체가 섞인 시즌입니다.",
      growthShift: 0,
      adaptationShift: 0,
      volatilityShift: 0,
      injuryShift: 0,
    };
  }
  if (roll < 0.91) {
    return {
      id: "poor",
      label: "육성 난조",
      description: "신인 적응이 더딘 팀이 많고 기대 유망주의 정체가 눈에 띈 시즌입니다.",
      growthShift: -0.18,
      adaptationShift: -0.08,
      volatilityShift: 0.06,
      injuryShift: 0.01,
    };
  }
  return {
    id: "rough",
    label: "육성 흉년",
    description: "전체적으로 부상, 정체, 적응 실패가 겹치며 유망주 성과가 부진한 시즌입니다.",
    growthShift: -0.36,
    adaptationShift: -0.16,
    volatilityShift: 0.11,
    injuryShift: 0.024,
  };
}

function createDevelopmentClimateNews(year: number, climate: SeasonDevelopmentClimate): CareerNewsItem {
  const importance = climate.id === "excellent" || climate.id === "rough" ? 4 : climate.id === "normal" ? 2 : 3;
  return {
    id: `development-climate-${year}-${climate.id}`,
    year,
    week: 2,
    grade: importance >= 4 ? "major" : importance <= 2 ? "archive" : "normal",
    importance,
    type: "육성 환경",
    headline: `${year}년차 유망주 육성 흐름: ${climate.label}`,
    body: climate.description,
  };
}

function simulateSeasonCycle(player: CareerPlayerState, climate: SeasonDevelopmentClimate): SeasonCycleResult {
  const talent = player.prospect.trueTalent;
  const age = careerAge(player, 1);
  const growthGap = Math.max(0, talent.potential - player.overall);
  const ceilingDrag = Math.max(0, player.overall - talent.potential) * 0.34;
  const adjustedVolatility = clampNumber(talent.volatility + climate.volatilityShift, 0.06, 1);
  const adjustedAdaptation = clampNumber(talent.proAdaptation + climate.adaptationShift, 0.05, 1);
  const proFriction = 0.2 + (player.yearsPro <= 2 ? 0.1 : 0.18) + (adjustedAdaptation < 0.45 ? (0.45 - adjustedAdaptation) * 0.95 : 0);
  const ageDrag = agingCurveDrag(player, age);
  const secondPrime = secondPrimeBonus(player, age, adjustedAdaptation);
  const phaseBase = growthGap * 0.018 + talent.growthRate * 0.34 + talent.workEthic * 0.2 + adjustedAdaptation * 0.12 + climate.growthShift - ceilingDrag - proFriction - ageDrag * 0.22;
  const earlyAdaptationDrag = adjustedAdaptation < 0.45 && player.yearsPro <= 2 ? (0.45 - adjustedAdaptation) * 3.1 : 0;
  const workloadDrag = player.status === "1군" && talent.injuryRisk > 0.55 ? talent.injuryRisk * 0.8 : 0;
  const stallChance = clampNumber(0.1 + adjustedVolatility * 0.18 + agingCurveRisk(age) + (talent.workEthic < 0.42 ? 0.13 : 0) + (adjustedAdaptation < 0.42 ? 0.14 : 0), 0.08, 0.64);
  const stallDrag = Math.random() < stallChance ? 0.8 + Math.random() * (1.4 + talent.volatility * 1.7) : 0;
  const randomPhase = (scale: number) => (Math.random() * 2 - 1) * adjustedVolatility * scale;

  const earlyDelta = phaseBase + randomPhase(2.15) - earlyAdaptationDrag - stallDrag * 0.35;
  const midSlump = Math.random() < 0.12 + adjustedVolatility * 0.32 ? adjustedVolatility * 2.8 + Math.random() * 0.9 : 0;
  const midDelta = phaseBase + randomPhase(2.55) - midSlump - workloadDrag - stallDrag * 0.45;
  const reboundBonus = midDelta < -1 && talent.workEthic > 0.62 ? talent.workEthic * 0.58 : 0;
  const lateDelta = phaseBase + randomPhase(2.25) + reboundBonus - stallDrag * 0.2;
  const injuryRoll = Math.random() < clampNumber(talent.injuryRisk * 0.16 + climate.injuryShift + agingInjuryRisk(age), 0.005, 0.34);
  const longRehab = injuryRoll && Math.random() < talent.injuryRisk * 0.28;
  const injuryDrag = injuryRoll ? (longRehab ? 4.5 : 2.2) : 0;
  const roundedDelta = Math.round(clampNumber(earlyDelta + midDelta + lateDelta - injuryDrag - ageDrag + secondPrime, -11, 7));
  const upperBound = Math.max(talent.potential + 1, player.overall + 2);
  const nextOverall = clampNumber(player.overall + roundedDelta, 20, upperBound);
  const actualDelta = nextOverall - player.overall;
  const pattern =
    actualDelta <= -2
      ? "regression"
      : (earlyDelta < -1 || midDelta < -1) && lateDelta >= 1.2
        ? "rebound"
        : earlyDelta < -1 || midDelta < -1
          ? "slump"
          : actualDelta >= 3
            ? "steady-growth"
            : "plateau";
  const developmentOutcome = chooseDevelopmentOutcome(player, actualDelta, injuryRoll, longRehab, climate);

  return {
    earlyDelta,
    midDelta,
    lateDelta,
    totalDelta: actualDelta,
    nextOverall,
    injuryRoll,
    longRehab,
    pattern,
    developmentOutcome,
  };
}

function chooseDevelopmentOutcome(player: CareerPlayerState, delta: number, injuryRoll: boolean, longRehab: boolean, climate: SeasonDevelopmentClimate): DevelopmentOutcome {
  if (longRehab && Math.random() < 0.78) return "major-injury";
  if (injuryRoll && Math.random() < 0.22) return "overall-decline";

  const talent = player.prospect.trueTalent;
  const age = careerAge(player, 1);
  const positiveBias = climate.growthShift + talent.growthRate * 0.4 + talent.workEthic * 0.28 + talent.proAdaptation * 0.22 - talent.volatility * 0.22 - agingCurveDrag(player, age) * 0.18;
  const roll = Math.random() + positiveBias * 0.22;

  if (delta >= 3) {
    if (roll < 0.34) return "strength-focus";
    if (roll < 0.62) return "weakness-fix";
    return "overall-growth";
  }
  if (delta >= 1) {
    if (roll < 0.34) return "weakness-fix";
    if (roll < 0.68) return "strength-focus";
    return "overall-growth";
  }
  if (delta === 0) {
    if (roll < 0.18) return "weakness-fix";
    if (roll > 0.88) return "strength-fade";
    return "maintain";
  }
  if (delta <= -3) {
    if (roll < 0.38) return "weakness-worsen";
    if (roll < 0.68) return "strength-fade";
    return "overall-decline";
  }
  if (roll < 0.45) return "weakness-worsen";
  if (roll < 0.78) return "strength-fade";
  return "overall-decline";
}

function careerAge(player: CareerPlayerState, offsetYears = 0): number {
  return 18 + player.yearsSinceDraft + offsetYears;
}

function agingCurveRisk(age: number): number {
  if (age < 32) return 0;
  if (age < 34) return 0.04;
  if (age < 37) return 0.1 + (age - 34) * 0.035;
  if (age < 40) return 0.2 + (age - 37) * 0.055;
  return 0.38;
}

function agingInjuryRisk(age: number): number {
  if (age < 33) return 0;
  if (age < 37) return (age - 32) * 0.008;
  if (age < 40) return 0.045 + (age - 37) * 0.018;
  return 0.1;
}

function agingCurveDrag(player: CareerPlayerState, age: number): number {
  if (age < 32) return 0;
  const talent = player.prospect.trueTalent;
  const base = age < 34 ? (age - 31) * 0.18 : age < 37 ? 0.7 + (age - 34) * 0.42 : age < 40 ? 2.0 + (age - 37) * 0.68 : 4.3 + (age - 40) * 0.82;
  const longevity = clampNumber((talent.workEthic - 0.55) * 0.45 + (talent.proAdaptation - 0.55) * 0.28 - Math.max(0, talent.injuryRisk - 0.55) * 0.35, -0.2, 0.38);
  return Math.max(0, base * (1 - longevity));
}

function secondPrimeBonus(player: CareerPlayerState, age: number, adjustedAdaptation: number): number {
  if (age < 33 || age > 39) return 0;
  const talent = player.prospect.trueTalent;
  const chance = clampNumber(0.006 + Math.max(0, talent.workEthic - 0.68) * 0.055 + Math.max(0, adjustedAdaptation - 0.66) * 0.05 - Math.max(0, talent.injuryRisk - 0.55) * 0.04, 0.002, 0.04);
  if (Math.random() > chance) return 0;
  return 1.5 + Math.random() * 2.5;
}

function agingRetirementChance(player: CareerPlayerState): number {
  const age = careerAge(player);
  if (age < 39) return 0;
  const eliteHold = player.currentOverall >= 82 ? -0.1 : player.currentOverall >= 74 ? -0.055 : 0;
  const lowRolePressure = player.currentOverall < 50 ? 0.18 : player.currentOverall < 58 ? 0.08 : 0;
  const makeup = player.prospect.trueTalent.workEthic >= 0.72 && player.prospect.trueTalent.proAdaptation >= 0.62 ? -0.035 : 0;
  const agePressure = (age - 38) * 0.025 + Math.max(0, age - 42) * 0.055;
  return clampNumber(agePressure + lowRolePressure + eliteHold + makeup, 0.005, age >= 45 ? 0.62 : 0.42);
}

function applyAgingRoleTransition(
  player: CareerPlayerState,
  year: number,
  userTeamId: TeamId,
  watchedIds: Set<ProspectId>,
  nextAfterUserPickIds: Set<ProspectId>,
  news: CareerNewsItem[],
) {
  if (player.status === "방출" || player.status === "은퇴" || player.status === "해외진출") return;
  const tools = getCareerTools(player);
  const age = careerAge(player);

  if (isPitcherTools(tools) && currentPlayerPosition(player) === "SP" && !player.eventKeys.includes("starter-to-bullpen")) {
    const stamina = tools.stamina;
    const starterChance = player.prospect.pitcherStats?.starterChance ?? 55;
    const rolePressure = clampNumber((age - 30) * 0.035 + Math.max(0, 56 - stamina) * 0.012 + Math.max(0, 45 - starterChance) * 0.006, 0, 0.48);
    if (age >= 31 && stamina <= 58 && player.currentOverall >= 52 && Math.random() < rolePressure) {
      player.currentPosition = "RP";
      player.bullpenRole = undefined;
      player.eventKeys = [...player.eventKeys, "starter-to-bullpen"];
      player.transactionLog = [...player.transactionLog, `${year}년차 체력 저하로 선발→불펜 전환`];
      addCareerNews(
        news,
        player,
        year,
        4,
        "보직 전환",
        `${player.prospect.name}, 선발에서 불펜으로 전환`,
        `나이와 누적 이닝 부담 속에 긴 이닝을 끌고 가는 힘이 떨어졌다. 구단은 짧은 이닝에서 구위와 경험을 살리는 방향으로 보직을 조정했다.`,
        careerContext(player, userTeamId, watchedIds, nextAfterUserPickIds),
      );
    }
    return;
  }

  if (!isPitcherTools(tools) && !player.fieldingRole && !player.eventKeys.includes("dh-transition")) {
    const batScore = tools.contact * 0.34 + tools.power * 0.34 + tools.discipline * 0.2 + tools.mentality * 0.12;
    const defensivePressure = Math.max(0, 48 - tools.defense) + Math.max(0, 45 - tools.speed) * 0.75;
    const positionPressure = ["C", "SS", "CF", "2B"].includes(player.prospect.primaryPosition) ? 0.55 : 1;
    const chance = clampNumber((age - 31) * 0.035 + defensivePressure * 0.01 * positionPressure + (batScore >= 62 ? 0.08 : -0.04), 0, 0.44);
    if (age >= 32 && defensivePressure >= 8 && batScore >= 56 && player.currentOverall >= 54 && Math.random() < chance) {
      player.fieldingRole = "지명타자";
      player.eventKeys = [...player.eventKeys, "dh-transition"];
      player.transactionLog = [...player.transactionLog, `${year}년차 수비 부담으로 지명타자 비중 확대`];
      addCareerNews(
        news,
        player,
        year,
        4,
        "보직 전환",
        `${player.prospect.name}, 지명타자 전향`,
        `순발력과 수비 범위가 내려오면서 매일 수비를 맡기기는 어려워졌다. 대신 타격 생산력을 살리기 위해 지명타자 출전 비중을 늘리는 방향으로 역할이 바뀌었다.`,
        careerContext(player, userTeamId, watchedIds, nextAfterUserPickIds),
      );
    }
  }
}

function uniquePositions(positions: Position[]): Position[] {
  return Array.from(new Set(positions));
}

function developmentOutcomeLabel(outcome: DevelopmentOutcome, player?: CareerPlayerState): string {
  const years = player?.yearsSinceDraft ?? 0;
  const age = player ? careerAge(player) : 18;
  if (outcome === "overall-growth") {
    if (age >= 34) return "베테랑 기량 반등";
    if (years >= 6) return "커리어 재상승";
    if (years >= 3) return "1군 기량 확장";
    return "전반적 스탯 상승";
  }
  if (outcome === "strength-focus") {
    if (years >= 6) return "주무기 재정비";
    if (years >= 3) return "핵심 툴 강화";
    return "장점 강화";
  }
  if (outcome === "weakness-fix") {
    if (years >= 6) return "역할 조정 성공";
    if (years >= 3) return "1군 약점 보완";
    return "단점 보완";
  }
  if (outcome === "maintain") return "유지";
  if (outcome === "strength-fade") {
    if (age >= 34) return "강점 둔화";
    if (years >= 5) return "무기 위력 감소";
    return "장점 퇴색";
  }
  if (outcome === "weakness-worsen") {
    if (years >= 5) return "약점 노출 확대";
    return "단점 심화";
  }
  if (outcome === "major-injury") return "선수생활 영향 부상";
  if (age >= 34) return "에이징커브 하락";
  if (years >= 6) return "커리어 하락세";
  return "전반적 기량 하락";
}

function developmentOutcomeImportance(outcome: DevelopmentOutcome): 2 | 3 | 4 {
  if (outcome === "major-injury" || outcome === "overall-growth" || outcome === "overall-decline") return 4;
  if (outcome === "strength-focus" || outcome === "weakness-fix" || outcome === "strength-fade" || outcome === "weakness-worsen") return 3;
  return 2;
}

function developmentOutcomeBody(player: CareerPlayerState, outcome: DevelopmentOutcome, delta: number): string {
  const change = `시즌 종료 기준 OVR 변화는 ${formatSigned(delta)}.`;
  const years = player.yearsSinceDraft;
  const age = careerAge(player);
  const stage =
    years <= 2 ? "early" :
    age >= 34 ? "veteran" :
    years >= 7 ? "established" :
    "middle";
  if (outcome === "overall-growth") {
    if (stage === "veteran") return `나이를 감안하면 보기 드문 반등이다. 훈련 방식과 역할 조정이 맞물리며 하락세를 잠시 밀어냈다는 평가가 나온다. ${change}`;
    if (stage === "established") return `이미 리그 적응을 마친 선수지만, 올 시즌에는 경기 운영과 몸 관리가 함께 좋아지며 커리어 두 번째 상승 곡선을 만들었다. ${change}`;
    if (stage === "middle") return `1군에서 요구하는 속도와 강도에 적응한 뒤 세부 툴이 함께 올라왔다. 이제 단순 유망주보다 전력 자원으로 보는 시선이 강해졌다. ${change}`;
    return `컨택/제구 같은 단일 항목보다 전반적인 훈련 성과가 함께 올라온 시즌이다. ${change}`;
  }
  if (outcome === "strength-focus") {
    if (stage === "veteran") return `전성기만큼의 폭발력은 아니지만, 살아남을 수 있는 주무기를 다시 정리한 시즌이다. 벤치가 쓰임새를 더 명확히 보고 있다. ${change}`;
    if (stage === "established") return `이미 검증된 강점을 다시 날카롭게 다듬으며 역할 경쟁력을 유지했다. 기량 유지 이상의 의미가 있는 변화다. ${change}`;
    if (stage === "middle") return `1군에서 통하는 장점이 무엇인지 더 선명해졌다. 구단은 이 툴을 중심으로 역할을 넓힐 수 있다고 본다. ${change}`;
    return `구단은 이미 강점으로 보던 툴을 더 밀어붙이는 방향으로 육성했고, 해당 장점의 프로 적용 가능성이 조금 더 선명해졌다. ${change}`;
  }
  if (outcome === "weakness-fix") {
    if (stage === "veteran") return `약점 자체가 사라진 것은 아니지만, 경험으로 노출 빈도를 줄이는 데 성공했다. 남은 커리어의 활용 폭을 지키는 변화다. ${change}`;
    if (stage === "established") return `상대가 집요하게 파고들던 약점을 일부 줄였다. 주전 경쟁이나 1군 잔류에 꽤 직접적인 의미가 있다. ${change}`;
    if (stage === "middle") return `프로에서 반복 노출되던 약점을 보완하며 1군 안착 가능성을 높였다. 성장보다 생존에 가까운 진전이다. ${change}`;
    return `스카우트 리포트에서 과제로 잡혔던 약점을 보완하는 데 초점을 맞춘 시즌이다. 당장 스타가 됐다는 뜻은 아니지만 실패 확률을 낮추는 변화로 평가된다. ${change}`;
  }
  if (outcome === "maintain") return `큰 상승도 큰 하락도 없이 현재 기량을 유지했다. ${stage === "early" ? "아직 프로 적응을 확인하는 단계다." : stage === "veteran" ? "베테랑에게는 유지 자체도 의미 있는 시즌이다." : "다음 시즌 역할 변화가 중요해졌다."} ${change}`;
  if (outcome === "strength-fade") {
    if (stage === "veteran") return `한때 확실한 무기였던 툴의 위력이 조금씩 줄어들고 있다. 코칭스태프는 출전 관리와 역할 축소를 함께 검토하고 있다. ${change}`;
    if (stage === "established") return `상대 분석이 쌓이면서 기존 강점의 효율이 떨어졌다. 반등하려면 보조 툴이나 경기 운영의 보완이 필요하다. ${change}`;
    return `고교 시절 강점으로 보였던 부분이 프로 템포 안에서는 예전만큼 도드라지지 않는다는 평가가 나왔다. ${change}`;
  }
  if (outcome === "weakness-worsen") {
    if (stage === "veteran") return `기존 약점이 체력 저하와 겹치며 더 자주 드러났다. 단순 부진보다 역할 재편에 가까운 신호다. ${change}`;
    if (stage === "established") return `상대가 약점을 파고드는 방식이 명확해졌고, 시즌 내내 수정 폭이 크지 않았다. 다음 시즌 반등 과제가 뚜렷하다. ${change}`;
    return `기존 약점이 시즌을 지나며 더 뚜렷해졌다. 코칭스태프는 역할 조정 또는 기술 수정이 필요하다고 보고 있다. ${change}`;
  }
  if (outcome === "major-injury") return `부상과 재활이 시즌 흐름을 크게 끊었다. 단순한 컨디션 문제가 아니라 향후 선수 생활 설계에도 영향을 줄 수 있는 변수로 분류된다. ${change}`;
  if (stage === "veteran") return `시즌 누적 피로와 회복 속도 저하가 동시에 드러났다. 아직 끝났다고 단정할 수는 없지만 하락 압력은 뚜렷해졌다. ${change}`;
  if (stage === "established") return `기존 역할을 유지하기 어려울 만큼 여러 지표가 함께 내려갔다. 반등 여부에 따라 팀 내 입지가 달라질 수 있다. ${change}`;
  return `프로 강도와 시즌 누적 피로를 이겨내지 못하며 여러 지표가 함께 내려간 시즌이다. ${change}`;
}

function advanceCareerPlayer(
  player: CareerPlayerState,
  year: number,
  userTeamId: TeamId,
  watchedIds: Set<ProspectId>,
  nextAfterUserPickIds: Set<ProspectId>,
  teams: Team[],
  news: CareerNewsItem[],
  developmentClimate: SeasonDevelopmentClimate,
): CareerPlayerState {
  if (player.status === "방출" || player.status === "은퇴" || player.status === "해외진출") {
    return player;
  }
  if (player.militaryStatus === "serving") {
    const currentTools = getCareerTools(player);
    const powerBreakout = shouldHaveMilitaryPowerBreakout(player, currentTools);
    const nextTools = powerBreakout && !isPitcherTools(currentTools)
      ? { ...currentTools, power: Math.round(clampNumber(currentTools.power + 8 + Math.random() * 7, 20, 95)), mentality: Math.round(clampNumber(currentTools.mentality + 1 + Math.random() * 3, 20, 95)) }
      : currentTools;
    const serviceDelta = powerBreakout ? 3 : player.militaryType === "상무" ? (Math.random() < 0.62 ? 1 : 0) : Math.random() < 0.45 ? -1 : 0;
    const nextOverall = Math.round(clampNumber((player.currentOverall + serviceDelta + weightedToolOverall(nextTools)) / 2, 20, Math.max(player.prospect.trueTalent.potential + 3, player.currentOverall + 4)));
    const next: CareerPlayerState = {
      ...player,
      overall: nextOverall,
      currentOverall: nextOverall,
      currentTools: nextTools,
      yearsPro: player.yearsPro + 1,
      yearsSinceDraft: player.yearsSinceDraft + 1,
      status: "2군",
    };
    if (powerBreakout) {
      next.eventKeys = [...next.eventKeys, "military-power-breakout"];
      addCareerNews(news, next, year, 4, "병역 후 파워 상승", `${next.prospect.name}, 복무 중 파워 툴 급상승`, "웨이트와 타격 접근 변화가 맞물리며 복무 기간 중 장타 생산력 기대치가 크게 올랐다는 평가가 나왔다.", careerContext(next, userTeamId, watchedIds, nextAfterUserPickIds));
    }
    if (player.militaryType === "상무") {
      addCareerNews(news, next, year, 2, "상무 복무", `${next.prospect.name}, 상무에서 실전 감각 유지`, `공식 1군 기록은 쌓이지 않지만 복무 중에도 경기 감각과 훈련 루틴을 이어가고 있다. OVR 변화는 ${formatSigned(serviceDelta)}.`, careerContext(next, userTeamId, watchedIds, nextAfterUserPickIds));
    }
    return next;
  }

  const seasonCycle = simulateSeasonCycle(player, developmentClimate);
  const nextTools = advanceCareerTools(player, seasonCycle, developmentClimate);
  const nextOverall = Math.round(clampNumber((seasonCycle.nextOverall + weightedToolOverall(nextTools)) / 2, 20, Math.max(player.prospect.trueTalent.potential + 2, player.overall + 2)));
  const injuryRoll = seasonCycle.injuryRoll;
  const longRehab = seasonCycle.longRehab;
  const debutOpportunity = !player.debuted && nextOverall >= 58 && Math.random() < firstTeamDebutChance(nextOverall, player);
  const next: CareerPlayerState = {
    ...player,
    overall: nextOverall,
    currentOverall: nextOverall,
    currentTools: nextTools,
    yearsPro: player.yearsPro + 1,
    yearsSinceDraft: player.yearsSinceDraft + 1,
    status: injuryRoll ? "부상" : debutOpportunity || player.debuted ? "1군" : "2군",
  };

  const context = careerContext(next, userTeamId, watchedIds, nextAfterUserPickIds);
  const lateRoundPick = next.pick.round >= 6;
  const protectedFromRelease = next.yearsSinceDraft <= next.releaseProtectionUntilYear;
  const outcomeImportance = developmentOutcomeImportance(seasonCycle.developmentOutcome);

  addCareerNews(
    news,
    next,
    year,
    outcomeImportance,
    "육성 결과",
    `${next.prospect.name}, ${developmentOutcomeLabel(seasonCycle.developmentOutcome, next)}`,
    developmentOutcomeBody(next, seasonCycle.developmentOutcome, seasonCycle.totalDelta),
    context,
  );

  if (seasonCycle.pattern === "regression") {
    const veteran = careerAge(next) >= 34 || next.yearsSinceDraft >= 7;
    addCareerNews(news, next, year, 3, "시즌 하락", veteran ? `${next.prospect.name}, 역할 축소 신호` : `${next.prospect.name}, 시즌 사이클에서 후퇴`, veteran ? `시즌 초반부터 회복 속도와 경기력 유지가 흔들렸다. 시즌 종료 기준 OVR은 ${formatSigned(seasonCycle.totalDelta)} 변했고, 다음 시즌 역할 재조정 가능성이 커졌다.` : `초반과 중반의 부진이 길어지며 시즌 종료 기준 OVR이 ${formatSigned(seasonCycle.totalDelta)} 변했다.`, context);
  } else if (seasonCycle.pattern === "rebound") {
    const veteran = careerAge(next) >= 34 || next.yearsSinceDraft >= 7;
    addCareerNews(news, next, year, 3, "후반기 반등", veteran ? `${next.prospect.name}, 베테랑 조정력 확인` : `${next.prospect.name}, 후반기 반등 신호`, veteran ? `시즌 중반 이후 루틴과 역할을 조정하며 하락세를 끊었다. 최종 OVR 변화는 ${formatSigned(seasonCycle.totalDelta)}로 마무리됐다.` : `시즌 중반까지 흔들렸지만 후반기 조정 이후 OVR 변화가 ${formatSigned(seasonCycle.totalDelta)}로 마무리됐다.`, context);
  } else if (seasonCycle.pattern === "slump") {
    addCareerNews(news, next, year, 2, "시즌 부침", next.yearsSinceDraft >= 5 ? `${next.prospect.name}, 시즌 내 기복 확대` : `${next.prospect.name}, 시즌 중 부침 확인`, next.yearsSinceDraft >= 5 ? "기량 자체가 무너진 것은 아니지만, 한 시즌을 안정적으로 끌고 가는 힘에서 편차가 커졌다." : "성장 곡선 자체는 유지됐지만 일정 구간에서 경기력 편차가 드러났다.", context);
  }

  const seasonAge = careerAge(next);
  if (seasonAge >= 34 && seasonCycle.totalDelta <= -2) {
    addCareerNews(news, next, year, seasonAge >= 38 || seasonCycle.totalDelta <= -4 ? 4 : 3, "에이징커브", `${next.prospect.name}, 에이징커브 징후`, `${seasonAge}세 시즌을 지나며 순발력과 회복력 저하가 수치에 반영됐다. 시즌 종료 기준 OVR 변화는 ${formatSigned(seasonCycle.totalDelta)}.`, context);
  }

  applyAgingRoleTransition(next, year, userTeamId, watchedIds, nextAfterUserPickIds, news);

  if (next.yearsSinceDraft === 1 && seasonCycle.totalDelta >= 3) {
    addCareerNews(news, next, year, 2, "퓨처스 적응", `${next.prospect.name}, 첫해 적응 속도 양호`, "첫 프로 시즌에서 훈련 루틴과 경기 템포에 비교적 빠르게 적응하고 있다는 평가가 나왔다.", context);
  } else if (next.yearsSinceDraft === 1 && seasonCycle.totalDelta <= -1) {
    addCareerNews(news, next, year, 2, "성장 정체", `${next.prospect.name}, 첫해 적응 과제 확인`, "기술 과제와 경기 적응이 겹치며 첫 시즌 성장 속도는 다소 더디게 나타났다.", context);
  }

  if (next.yearsSinceDraft >= 3 && next.status === "1군" && seasonCycle.totalDelta >= 3 && Math.random() < 0.42) {
    const veteran = careerAge(next) >= 34 || next.yearsSinceDraft >= 7;
    addCareerNews(
      news,
      next,
      year,
      veteran ? 4 : 3,
      veteran ? "베테랑 반등" : "기량 상승",
      veteran ? `${next.prospect.name}, 베테랑 반등 시즌` : `${next.prospect.name}, 1군 기량 상승`,
      veteran
        ? `전성기 이후 구간에서도 몸 관리와 역할 적응으로 생산성을 다시 끌어올렸다. OVR 변화는 ${formatSigned(seasonCycle.totalDelta)}.`
        : `이제 단순 유망주 평가를 넘어 1군 전력으로 계산할 만한 상승세가 확인됐다. OVR 변화는 ${formatSigned(seasonCycle.totalDelta)}.`,
      context,
    );
  } else if (next.yearsSinceDraft >= 4 && seasonCycle.totalDelta <= -3 && Math.random() < 0.48) {
    const veteran = careerAge(next) >= 34 || next.yearsSinceDraft >= 7;
    addCareerNews(
      news,
      next,
      year,
      veteran ? 4 : 3,
      veteran ? "기량 저하" : "입지 흔들림",
      veteran ? `${next.prospect.name}, 기량 저하 경고등` : `${next.prospect.name}, 1군 입지 흔들림`,
      veteran
        ? `나이와 누적 피로가 경기력에 반영되며 팀 내 역할이 줄어들 가능성이 커졌다. OVR 변화는 ${formatSigned(seasonCycle.totalDelta)}.`
        : `시즌 내내 강점보다 약점 노출이 많았다. 다음 시즌 반등하지 못하면 경쟁 구도가 바뀔 수 있다. OVR 변화는 ${formatSigned(seasonCycle.totalDelta)}.`,
      context,
    );
  }

  if (injuryRoll) {
    addCareerNews(news, next, year, longRehab ? 4 : 3, longRehab ? "장기 재활" : "부상", longRehab ? `${next.prospect.name}, 장기 재활 돌입` : `${next.prospect.name}, 부상자 명단 등재`, longRehab ? "구단은 복귀 일정을 길게 잡고 투구/타격 프로그램을 다시 설계하기로 했다." : "큰 부상은 아니지만 시즌 흐름이 한 차례 끊겼다.", context);
  }

  if (!next.debuted && next.status === "1군") {
    next.debuted = true;
    addCareerNews(news, next, year, lateRoundPick ? 5 : 4, "1군 데뷔", lateRoundPick ? `${next.prospect.name}, 하위 라운드 지명 후 1군 데뷔` : `${next.prospect.name}, 1군 데뷔`, `${next.team.shortName}${topicParticle(next.team.shortName)} 드래프트 당시 평가보다 빠른 적응 속도를 확인했다.`, context);
  }

  if (next.debuted && !next.firstHit && next.prospect.playerGroup !== "pitcher" && Math.random() < 0.65) {
    next.firstHit = true;
    addCareerNews(news, next, year, 2, "첫 안타", `${next.prospect.name}, 데뷔 첫 안타`, "짧은 출전 기회에서 첫 안타를 기록하며 벤치의 신뢰를 조금씩 얻고 있다.", context);
  }

  if (next.debuted && !next.firstHomeRun && next.prospect.playerGroup !== "pitcher" && next.overall >= 58 && Math.random() < 0.35) {
    next.firstHomeRun = true;
    addCareerNews(news, next, year, 3, "첫 홈런", `${next.prospect.name}, 프로 첫 홈런`, "고교 시절 장타 지표가 프로 무대에서도 조금씩 번역되기 시작했다.", context);
  }

  if (next.debuted && !next.firstStart && next.prospect.playerGroup === "pitcher" && next.overall >= 57 && Math.random() < 0.55) {
    next.firstStart = true;
    addCareerNews(news, next, year, 3, "첫 선발 등판", `${next.prospect.name}, 첫 선발 등판`, "구단은 짧은 이닝부터 선발 가능성을 시험하기로 했다.", context);
  }

  if (next.prospect.playerGroup === "pitcher" && next.overall - player.overall >= 4 && Math.random() < 0.45) {
    addCareerNews(news, next, year, 3, "구속 상승", `${next.prospect.name}, 구속 상승 보고`, "비시즌 훈련 이후 평균 구속이 올라왔다는 구단 내부 평가가 나왔다.", context);
  }

  if (next.yearsPro >= 2 && next.status !== "방출" && next.status !== "은퇴" && Math.random() < tradeChance(next)) {
    const newTeam = pickRandom(teams.filter((team) => team.id !== next.team.id));
    const traded: CareerPlayerState = { ...next, team: newTeam };
    const tradeContext = careerContext(traded, userTeamId, watchedIds, nextAfterUserPickIds);
    addCareerNews(news, traded, year, next.originalTeamId === userTeamId ? 4 : 3, "트레이드", `${next.prospect.name}, ${newTeam.shortName}로 트레이드`, `${next.team.shortName}는 즉시 전력 보강을 택했고 ${newTeam.shortName}는 성장 여지가 남은 젊은 선수를 확보했다.`, tradeContext);
    next.transactionLog = [...next.transactionLog, `${year}년차 ${next.team.shortName} → ${newTeam.shortName} 트레이드`];
    next.team = newTeam;
  }

  if (next.yearsSinceDraft >= 7 && next.status !== "방출" && next.status !== "은퇴" && next.status !== "해외진출" && Math.random() < freeAgencyExitChance(next)) {
    const oldTeam = next.team;
    const newTeam = pickRandom(teams.filter((team) => team.id !== oldTeam.id));
    next.team = newTeam;
    next.transactionLog = [...next.transactionLog, `${year}년차 FA 이적: ${oldTeam.shortName} → ${newTeam.shortName}`];
    const faContext = careerContext(next, userTeamId, watchedIds, nextAfterUserPickIds);
    addCareerNews(news, next, year, next.originalTeamId === userTeamId || oldTeam.id === userTeamId ? 5 : 4, "FA 이적", `${next.prospect.name}, FA로 ${newTeam.shortName} 이적`, `${oldTeam.shortName} 보호기간 이후 시장에 나온 선수가 새 팀과 계약했다. 드래프트 당시 지명 구단과 현재 소속 구단이 달라졌다.`, faContext);
  }

  if (next.yearsSinceDraft >= 4 && next.status !== "해외진출" && next.overall >= 88 && Math.random() < majorPostingChance(next)) {
    next.status = "해외진출";
    next.trackingStatus = "follow";
    next.eventKeys = [...next.eventKeys, "major-posting"];
    next.transactionLog = [...next.transactionLog, `${year}년차 메이저 진출`];
    const majorContext = careerContext(next, userTeamId, watchedIds, nextAfterUserPickIds);
    addCareerNews(news, next, year, 5, "메이저 진출", `${next.prospect.name}, 메이저 진출 확정`, "리그에서 압도적인 시즌을 이어간 끝에 해외 구단의 관심을 받았고, 구단도 도전을 허용했다.", majorContext);
    return next;
  }

  if (!next.eventKeys.includes("position-change") && next.prospect.visible.riskTags.includes("position-uncertainty") && Math.random() < 0.18) {
    next.eventKeys = [...next.eventKeys, "position-change"];
    addCareerNews(news, next, year, 2, "포지션 전환", `${next.prospect.name}, 포지션 전환 테스트`, "아마추어 시절부터 따라붙던 수비 위치 문제를 해결하기 위해 다른 포지션 훈련을 병행한다.", context);
  }

  if (next.debuted && next.yearsPro <= 3 && next.overall >= 64 && !next.eventKeys.includes("first-team-regular") && Math.random() < firstTeamRegularChance(next)) {
    next.eventKeys = [...next.eventKeys, "first-team-regular"];
    addCareerNews(news, next, year, 3, "1군 안착", `${next.prospect.name}, 1군 안착 신호`, "콜업 이후 제한된 역할에서 꾸준히 출전 기회를 받으며 코칭스태프의 선택지를 넓히고 있다.", context);
  }

  if (next.debuted && next.yearsPro <= 3 && next.overall >= 66 && !next.eventKeys.includes("rookie-standout") && !next.eventKeys.includes("young-core-progress") && Math.random() < rookieStandoutChance(next)) {
    const alreadyDecorated = next.eventKeys.includes("rookie-award") || next.eventKeys.includes("rookie-candidate");
    const eventKey = alreadyDecorated || next.yearsPro >= 3 ? "young-core-progress" : "rookie-standout";
    next.eventKeys = [...next.eventKeys, eventKey];
    addCareerNews(
      news,
      next,
      year,
      4,
      alreadyDecorated || next.yearsPro >= 3 ? "차세대 전력" : "주요 신인 주목",
      alreadyDecorated ? `${next.prospect.name}, 신인 타이틀 이후 검증 구간 통과` : next.yearsPro >= 3 ? `${next.prospect.name}, 차세대 전력으로 이동` : `${next.prospect.name}, 주요 신인 그룹 진입`,
      alreadyDecorated
        ? "이미 신인 레이스에서 존재감을 보인 뒤에도 1군 경쟁력을 유지하고 있다. 이제 관심은 신인 프레임을 넘어 주전급 지속성으로 옮겨간다."
        : next.yearsPro >= 3
          ? "초기 적응기를 지나 팀이 장기 전력으로 계산하기 시작했다. 더 이상 단순 신인 이슈가 아니라 로스터 설계의 한 축에 가깝다."
          : "아직 수상권을 단정할 단계는 아니지만 같은 연차 선수들 사이에서 존재감이 뚜렷해지고 있다.",
      context,
    );
  }

  if (next.yearsPro <= 3 && next.overall >= 72 && next.debuted && isFirstTeamAwardEligible(next) && (next.eventKeys.includes("rookie-standout") || next.overall >= 75) && !next.eventKeys.includes("rookie-candidate") && Math.random() < rookieCandidateChance(next)) {
    next.eventKeys = [...next.eventKeys, "rookie-candidate"];
    addCareerNews(news, next, year, 4, "신인왕 후보", `${next.prospect.name}, 신인왕 후보 급부상`, "전반기 활약만 놓고 보면 신인왕 레이스에 이름을 올릴 만하다는 평가가 나온다.", context);
  }

  if (lateRoundPick && next.yearsPro >= 3 && next.overall >= 62 && !next.eventKeys.includes("late-role") && Math.random() < lateRoundRoleChance(next)) {
    next.eventKeys = [...next.eventKeys, "late-role"];
    const role = next.prospect.playerGroup === "pitcher" ? "불펜 자원" : next.prospect.primaryPosition === "C" ? "백업 포수" : ["SS", "2B", "CF"].includes(next.prospect.primaryPosition) ? "수비형 백업" : "벤치 전력";
    addCareerNews(news, next, year, 4, "하위 라운드 성과", `${next.prospect.name}, ${role} 가능성 확인`, `${next.pick.round}라운드 지명 당시에는 제한적인 프로필이었지만 특정 역할에서 1군 활용 가능성을 보이고 있다.`, context);
  }

  if (next.pick.round >= 8 && next.yearsPro >= 5 && next.overall >= 76 && !next.eventKeys.includes("late-breakout") && Math.random() < lateRoundBreakoutChance(next)) {
    next.eventKeys = [...next.eventKeys, "late-breakout"];
    addCareerNews(news, next, year, 5, "하위 라운드 성공", `${next.prospect.name}, 하위 라운드 성공 사례로 부상`, `${next.pick.round}라운드 지명 선수가 주전 경쟁권까지 올라오며 해당 드래프트의 대표 회고 사례가 됐다.`, context);
  }

  const goldGloveThreshold = next.yearsPro <= 1 ? 90 : next.yearsPro <= 2 ? 86 : next.yearsPro <= 4 ? 82 : 78;
  const goldGloveChance = next.yearsPro <= 1 ? 0.004 : next.yearsPro <= 2 ? 0.01 : next.yearsPro <= 4 ? 0.025 : 0.08;
  if (next.overall >= goldGloveThreshold && isFirstTeamAwardEligible(next) && !next.eventKeys.includes("gold-glove") && Math.random() < goldGloveChance) {
    next.eventKeys = [...next.eventKeys, "gold-glove"];
    addCareerNews(news, next, year, 4, "골든글러브", `${next.prospect.name}, 골든글러브 경쟁권 진입`, "수비와 공격 기여가 동시에 올라오며 리그 정상급 후보로 거론되기 시작했다.", context);
  }

  const mvpThreshold = next.yearsPro <= 1 ? 94 : next.yearsPro <= 2 ? 91 : next.yearsPro <= 4 ? 88 : 84;
  const mvpChance = next.yearsPro <= 1 ? 0.0015 : next.yearsPro <= 2 ? 0.004 : next.yearsPro <= 4 ? 0.012 : 0.055;
  if (next.overall >= mvpThreshold && isFirstTeamAwardEligible(next) && !next.eventKeys.includes("mvp") && Math.random() < mvpChance) {
    next.eventKeys = [...next.eventKeys, "mvp"];
    addCareerNews(news, next, year, 5, "MVP급 시즌", `${next.prospect.name}, MVP급 시즌`, "드래프트 당시의 불확실성을 넘어 리그 전체 판도를 흔드는 시즌을 만들고 있다.", context);
  }

  if (!protectedFromRelease && next.status !== "방출" && next.status !== "은퇴" && next.status !== "해외진출" && Math.random() < agingRetirementChance(next)) {
    next.status = "은퇴";
    next.trackingStatus = "archived";
    next.trackingArchivedAtYear = year;
    next.failureReason = "에이징커브";
    addCareerNews(news, next, year, 4, "은퇴", `${next.prospect.name}, 현역 은퇴`, `${careerAge(next)}세 시즌을 마친 뒤 기량 하락과 역할 축소를 받아들이고 선수 생활을 마무리하기로 했다.`, context);
  }

  if (!protectedFromRelease && next.status !== "방출" && next.status !== "은퇴" && next.status !== "해외진출" && next.yearsSinceDraft >= 2 && next.overall < 43 && Math.random() < 0.42) {
    next.status = "방출";
    next.trackingStatus = "archived";
    next.trackingArchivedAtYear = year;
    next.failureReason = releaseFailureReason(next);
    addCareerNews(news, next, year, 4, "방출", `${next.prospect.name}, 방출 통보`, `${next.failureReason} 문제를 끝내 해결하지 못하며 팀을 떠나게 됐다.`, context);
  }

  if (!protectedFromRelease && next.status !== "방출" && next.status !== "은퇴" && next.status !== "해외진출" && next.yearsSinceDraft >= 3 && next.overall < 48 && next.prospect.trueTalent.injuryRisk > 0.72 && Math.random() < 0.12) {
    next.status = "은퇴";
    next.trackingStatus = "archived";
    next.trackingArchivedAtYear = year;
    next.failureReason = "반복 부상";
    addCareerNews(news, next, year, 4, "은퇴", `${next.prospect.name}, 현역 은퇴`, "반복된 재활과 컨디션 저하로 선수 생활을 마무리하기로 했다.", context);
  }

  if (next.yearsPro >= 2 && next.overall >= 65 && context === "missed" && !next.eventKeys.includes("missed-success")) {
    next.eventKeys = [...next.eventKeys, "missed-success"];
    addCareerNews(news, next, year, 5, "우리 팀이 거른 선수의 성공", `바로 다음 순번 ${next.prospect.name}, 주전급 성장`, "당시 우리 팀 다음 순번에서 지명된 선수가 빠르게 성공하며 드래프트 회고 기사에 이름이 오르내린다.", "missed");
  }

  return next;
}

function applyRosterLimitCuts(
  players: CareerPlayerState[],
  year: number,
  userTeamId: TeamId,
  watchedIds: Set<ProspectId>,
  nextAfterUserPickIds: Set<ProspectId>,
  teams: Team[],
  news: CareerNewsItem[],
): CareerPlayerState[] {
  teams.forEach((team) => {
    const teamPlayers = () => players.filter((player) => player.team.id === team.id && isRosterCountedPlayer(player));
    let roster = teamPlayers();
    while (roster.length > TEAM_ROSTER_LIMIT) {
      const positionCounts = countRosterPositions(roster);
      const cuttable = roster.filter((player) => {
        const position = currentPlayerPosition(player);
        if (player.yearsSinceDraft <= player.releaseProtectionUntilYear) return false;
        return (positionCounts[position] ?? 0) > MIN_POSITION_DEPTH_FOR_CUTS[position];
      });
      const fallbackCuttable = roster.filter((player) => player.yearsSinceDraft > player.releaseProtectionUntilYear);
      const candidates = cuttable.length > 0 ? cuttable : fallbackCuttable;
      if (candidates.length === 0) break;

      const cut = [...candidates].sort((left, right) => rosterCutScore(left, positionCounts) - rosterCutScore(right, positionCounts))[0];
      cut.status = "방출";
      cut.failureReason = "선수단 80명 제한";
      cut.transactionLog = [...cut.transactionLog, `${year}년차 선수단 정리 방출`];
      addCareerNews(
        news,
        cut,
        year,
        cut.team.id === userTeamId || cut.originalTeamId === userTeamId ? 4 : 3,
        "방출",
        `${cut.prospect.name}, 선수단 정리로 방출`,
        `${team.shortName}는 1년차 신인을 제외한 선수단이 ${TEAM_ROSTER_LIMIT}명을 넘어서자 포지션 뎁스를 고려해 낮은 OVR 선수부터 정리했다.`,
        careerContext(cut, userTeamId, watchedIds, nextAfterUserPickIds),
      );
      cut.trackingStatus = "archived";
      cut.trackingArchivedAtYear = year;
      roster = teamPlayers();
    }
  });
  return players;
}

function isRosterCountedPlayer(player: CareerPlayerState): boolean {
  if (player.status === "방출" || player.status === "은퇴" || player.status === "해외진출") return false;
  return player.yearsSinceDraft > ROOKIE_ROSTER_EXEMPT_YEARS;
}

function countRosterPositions(players: CareerPlayerState[]): Record<Position, number> {
  return POSITIONS.reduce(
    (counts, position) => {
      counts[position] = players.filter((player) => currentPlayerPosition(player) === position).length;
      return counts;
    },
    {} as Record<Position, number>,
  );
}

function rosterCutScore(player: CareerPlayerState, positionCounts: Record<Position, number>): number {
  const position = currentPlayerPosition(player);
  const surplus = Math.max(0, (positionCounts[position] ?? 0) - MIN_POSITION_DEPTH_FOR_CUTS[position]);
  const positionScarcityProtection = surplus <= 1 ? 8 : surplus <= 2 ? 4 : 0;
  const draftInvestmentProtection = player.pick.round <= 2 ? 4 : player.pick.round <= 5 ? 2 : 0;
  const firstTeamProtection = player.debuted ? 2.5 : 0;
  const agePressure = Math.max(0, player.yearsSinceDraft - 2) * 1.4 + Math.max(0, player.yearsSinceDraft - 6) * 1.2;
  const youngUpsideProtection = player.yearsSinceDraft <= 3 ? clampNumber((player.prospect.trueTalent.potential - player.currentOverall) * 0.16, 0, 5) : 0;
  return player.currentOverall - agePressure + positionScarcityProtection + draftInvestmentProtection + firstTeamProtection + youngUpsideProtection;
}

function createUndraftedNews(year: number, undrafted: Prospect[], watchedIds: Set<ProspectId>): CareerNewsItem[] {
  return undrafted
    .filter((prospect) => Math.random() < (prospect.trueTalent.potential >= 68 ? 0.035 : 0.006))
    .slice(0, 3)
    .map((prospect, index) => {
      const path = pickRandom(["대학 진학 후 재평가", "독립리그 입단", "육성선수 계약"]);
      const watched = watchedIds.has(prospect.id);
      return {
        id: `undrafted-${year}-${prospect.id}-${index}`,
        year,
        week: seasonWeekForEvent(path, year, prospect.id),
        grade: watched ? "major" : "archive",
        importance: watched ? 4 : 2,
        type: path,
        headline: `${prospect.name}, ${path}`,
        body: watched ? "드래프트 당시 관심 목록에 있던 선수가 다른 경로로 다시 주목받기 시작했다." : "지명되지 않았지만 다른 무대에서 프로 도전을 이어간다.",
        playerId: prospect.id,
        emphasis: watched ? "watched" : undefined,
      };
    });
}

function simulateTeamSeason(
  teams: Team[],
  selections: DraftSelectionView[],
  careerPlayers: CareerPlayerState[],
  existingPlayers: ExistingLeaguePlayer[],
  seasonYear: number,
  yearIndex: number,
  previousResults: TeamSeasonResult[],
  teamTradeStrengthAdjustments: Record<string, number>,
): TeamSeasonResult[] {
  const ranked = teams
    .map((team) => {
      const roster = careerPlayers.filter((player) => player.team.id === team.id && player.status !== "방출" && player.status !== "은퇴" && player.status !== "해외진출");
      const existingRoster = existingPlayers.filter((player) => player.teamId === team.id && player.status === "active");
      const draftedByTeam = selections.filter((selection) => selection.team.id === team.id);
      const acquiredPicks = selections.filter((selection) => selection.team.id === team.id && selection.pick.originalTeamId !== team.id).length;
      const lostPicks = selections.filter((selection) => selection.team.id !== team.id && selection.pick.originalTeamId === team.id).length;
      const previous = previousResults.find((result) => result.teamId === team.id);

      const previousStrength = previous?.strengthScore ?? team.baseStrength;
      const reboundPressure = previous?.rank
        ? previous.rank >= 8
          ? 1.8 + Math.random() * 2.2
          : previous.rank <= 2
            ? -1.2 - Math.random() * 2.1
            : Math.random() * 1.4 - 0.7
        : 0;
      const windowShift = team.teamWindow === "rebuilding" ? Math.random() * 3.2 - 0.8 : team.teamWindow === "contending" ? Math.random() * 2.4 - 1.5 : Math.random() * 2.8 - 1.2;
      const baseStrength = previous
        ? clampNumber(previousStrength * 0.58 + team.baseStrength * 0.42 + reboundPressure + windowShift, 34, 88)
        : team.baseStrength;
      const draftImpact = draftedByTeam.reduce((total, selection) => {
        const expected = 63 - selection.pick.overall * 0.42;
        const pickLeverage = selection.pick.round <= 2 ? 1.2 : selection.pick.round <= 5 ? 0.82 : 0.45;
        return total + clampNumber((selection.prospect.trueTalent.currentAbility - expected) * 0.14 * pickLeverage, -2.6, 3.4);
      }, 0);
      const prospectContribution = roster.reduce((total, player) => {
        const developmentGain = (player.overall - player.prospect.trueTalent.currentAbility) * 0.18;
        const usableTalent = Math.max(0, player.overall - 55) * (player.status === "1군" ? 0.13 : 0.055);
        const ageCurve = player.yearsSinceDraft >= 7 ? -0.28 * (player.yearsSinceDraft - 6) : 0;
        return total + developmentGain + usableTalent + ageCurve;
      }, 0);
      const regularContribution = roster.reduce((total, player) => {
        if (player.overall >= 82) return total + 4.6;
        if (player.overall >= 74) return total + 3.1;
        if (player.overall >= 66) return total + 1.8;
        if (player.overall >= 60) return total + 0.7;
        return total;
      }, 0);
      const existingCoreContribution = existingRoster
        .sort((left, right) => right.overall - left.overall)
        .slice(0, 14)
        .reduce((total, player, index) => total + Math.max(0, player.overall - 58) * (index < 5 ? 0.085 : 0.052), 0);
      const injuryPenalty = roster.filter((player) => player.status === "부상").length * 1.6 + existingRoster.filter((player) => player.overall < 58).length * 0.12;
      const pickTradeImpact = acquiredPicks * 1.15 - lostPicks * 1.25;
      const tradeStrengthAdjustment = teamTradeStrengthAdjustments[String(team.id)] ?? 0;
      const strengthScore = clampNumber(baseStrength + existingCoreContribution + draftImpact + prospectContribution + regularContribution - injuryPenalty + pickTradeImpact + tradeStrengthAdjustment, 28, 99);
      const paritySwing = Math.random() * 18 - 9;
      const chaosSwing = Math.random() < 0.18 ? Math.random() * 12 - 6 : 0;
      const contenderPressure = previous?.rank && previous.rank <= 2 ? Math.random() * 4 - 2.8 : 0;
      const underdogRun = previous?.rank && previous.rank >= 8 ? Math.random() * 5.2 - 1.4 : 0;
      const randomSwing = paritySwing + chaosSwing + contenderPressure + underdogRun;
      const seasonPerformanceScore = clampNumber(strengthScore + randomSwing, 20, 105);

      return {
        seasonYear,
        yearIndex,
        teamId: team.id,
        rank: 0,
        previousRank: previous?.rank,
        strengthScore,
        seasonPerformanceScore,
        wins: 0,
        draws: 0,
        losses: 0,
        winningPct: 0,
        baseStrength,
        draftImpact,
        prospectContribution,
        regularContribution,
        injuryPenalty,
        pickTradeImpact: pickTradeImpact + tradeStrengthAdjustment,
        randomSwing,
        nextFirstRoundPick: 0,
      };
    })
    .sort((left, right) => right.seasonPerformanceScore - left.seasonPerformanceScore)
    .map((result, index) => ({ ...result, rank: index + 1 }));

  const records = createSeasonRecords(ranked, seasonYear);

  return ranked.map((result, index) => ({
    ...result,
    ...records[index],
    nextFirstRoundPick: ranked.length - result.rank + 1,
  }));
}

function createSeasonRecords(results: TeamSeasonResult[], seasonYear: number): Array<Pick<TeamSeasonResult, "wins" | "draws" | "losses" | "winningPct">> {
  const games = 144;
  const averageScore = results.reduce((total, result) => total + result.seasonPerformanceScore, 0) / Math.max(1, results.length);
  const records = results.map((result, index) => {
    const rankShape = (results.length - 1 - index) / Math.max(1, results.length - 1) - 0.5;
    const scoreEdge = (result.seasonPerformanceScore - averageScore) * 0.0072;
    const drawBase = 4 + Math.round(deterministicNoise(`draws-${seasonYear}-${result.teamId}`) * 6);
    const draws = Math.round(clampNumber(drawBase + (Math.abs(scoreEdge) < 0.03 ? 1 : 0), 1, 12));
    const pctNoise = (deterministicNoise(`record-${seasonYear}-${result.teamId}`) - 0.5) * 0.035;
    const rawPct = clampNumber(0.5 + rankShape * 0.19 + scoreEdge + pctNoise, 0.34, 0.66);
    return {
      wins: Math.round((games - draws) * rawPct),
      draws,
      losses: 0,
      winningPct: 0,
    };
  });

  ensureEvenDrawTotal(records);
  const totalDraws = records.reduce((total, record) => total + record.draws, 0);
  const targetWins = Math.round((games * results.length - totalDraws) / 2);
  let winDelta = targetWins - records.reduce((total, record) => total + record.wins, 0);
  const direction = winDelta >= 0 ? 1 : -1;

  while (winDelta !== 0) {
    let changed = false;
    for (let index = 0; index < records.length && winDelta !== 0; index += 1) {
      const record = records[direction > 0 ? index : records.length - 1 - index];
      const nextWins = record.wins + direction;
      const maxWins = games - record.draws - 36;
      const minWins = 35;
      if (nextWins >= minWins && nextWins <= maxWins) {
        record.wins = nextWins;
        winDelta -= direction;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return records.map((record) => {
    const losses = games - record.draws - record.wins;
    return {
      ...record,
      losses,
      winningPct: record.wins / Math.max(1, record.wins + losses),
    };
  });
}

function ensureEvenDrawTotal(records: Array<{ draws: number; wins: number }>): void {
  const totalDraws = records.reduce((total, record) => total + record.draws, 0);
  if (totalDraws % 2 === 0) return;
  const increaseTarget = records.find((record) => record.draws < 12);
  if (increaseTarget) {
    increaseTarget.draws += 1;
    return;
  }
  const decreaseTarget = records.find((record) => record.draws > 1);
  if (decreaseTarget) decreaseTarget.draws -= 1;
}

function createNextDraftPicksFromSeason(results: TeamSeasonResult[], draftYear: number, rounds: number): DraftPick[] {
  const teamOrder = [...results].sort((left, right) => right.rank - left.rank).map((result) => result.teamId);
  const picks: DraftPick[] = [];

  for (let round = 1; round <= rounds; round += 1) {
    for (let slot = 0; slot < teamOrder.length; slot += 1) {
      const overall = (round - 1) * teamOrder.length + slot + 1;
      const originalTeamId = teamOrder[slot];
      picks.push({
        id: `pick-${draftYear}-${overall}` as DraftPickId,
        year: draftYear,
        round,
        overall,
        originalTeamId,
        ownerTeamId: originalTeamId,
      });
    }
  }

  return picks;
}

function applyPickTradeEvents(
  picks: DraftPick[],
  teams: Team[],
  userTeamId: TeamId,
  seasonYear: number,
  yearIndex: number,
): { picks: DraftPick[]; events: PickTradeEvent[]; news: CareerNewsItem[]; strengthAdjustments: Record<string, number> } {
  if (Math.random() > 0.24) {
    return { picks, events: [], news: [], strengthAdjustments: {} };
  }

  const roll = Math.random();
  const type: PickTradeEvent["type"] = roll < 0.36 ? "user-pick-gain" : roll < 0.62 ? "user-pick-loss" : "other-teams";
  const event = createPickTradeEvent(type, picks, teams, userTeamId, seasonYear, yearIndex);

  if (!event) {
    return { picks, events: [], news: [], strengthAdjustments: {} };
  }

  const updatedPicks = picks.map((pick) => (pick.id === event.pickId ? { ...pick, ownerTeamId: event.toTeamId } : pick));
  const strengthAdjustments = event.userStrengthImpact === 0 ? {} : { [String(userTeamId)]: event.userStrengthImpact };

  return {
    picks: updatedPicks,
    events: [event],
    news: [createPickTradeNews(event, teams)],
    strengthAdjustments,
  };
}

function createPickTradeEvent(
  type: PickTradeEvent["type"],
  picks: DraftPick[],
  teams: Team[],
  userTeamId: TeamId,
  seasonYear: number,
  yearIndex: number,
): PickTradeEvent | undefined {
  if (type === "user-pick-gain") {
    const candidates = picks.filter((pick) => pick.ownerTeamId !== userTeamId && pick.round >= 2 && pick.round <= 4);
    const pick = pickRandom(candidates);
    if (!pick) return undefined;
    const fromTeam = teams.find((team) => team.id === pick.ownerTeamId);
    return {
      id: `pick-trade-${seasonYear}-${pick.id}-gain`,
      seasonYear,
      yearIndex,
      type,
      pickId: pick.id,
      round: pick.round,
      overall: pick.overall,
      originalTeamId: pick.originalTeamId,
      fromTeamId: pick.ownerTeamId,
      toTeamId: userTeamId,
      userStrengthImpact: -1.6,
      headline: `우리 팀, ${pick.round}라운드 지명권 확보`,
      body: `베테랑 즉전 전력을 내주고 ${fromTeam?.shortName ?? "상대 팀"}의 다음 드래프트 지명권을 받아왔다. 단기 전력은 조금 내려가지만 지명권 자산은 늘었다.`,
    };
  }

  if (type === "user-pick-loss") {
    const candidates = picks.filter((pick) => pick.ownerTeamId === userTeamId && pick.round >= 2 && pick.round <= 4);
    const pick = pickRandom(candidates);
    const toTeam = pickRandom(teams.filter((team) => team.id !== userTeamId));
    if (!pick || !toTeam) return undefined;
    return {
      id: `pick-trade-${seasonYear}-${pick.id}-loss`,
      seasonYear,
      yearIndex,
      type,
      pickId: pick.id,
      round: pick.round,
      overall: pick.overall,
      originalTeamId: pick.originalTeamId,
      fromTeamId: userTeamId,
      toTeamId: toTeam.id,
      userStrengthImpact: 1.5,
      headline: `우리 팀, 즉전감 영입 위해 ${pick.round}라운드 지명권 이동`,
      body: `${toTeam.shortName}에 다음 드래프트 지명권을 넘기는 대신 당장 전력에 보탬이 되는 선수를 확보했다.`,
    };
  }

  const nonUserTeams = teams.filter((team) => team.id !== userTeamId);
  const fromTeam = pickRandom(nonUserTeams);
  const toTeam = pickRandom(nonUserTeams.filter((team) => team.id !== fromTeam?.id));
  if (!fromTeam || !toTeam) return undefined;
  const candidates = picks.filter((pick) => pick.ownerTeamId === fromTeam.id && pick.round >= 2 && pick.round <= 5);
  const pick = pickRandom(candidates);
  if (!pick) return undefined;

  return {
    id: `pick-trade-${seasonYear}-${pick.id}-other`,
    seasonYear,
    yearIndex,
    type,
    pickId: pick.id,
    round: pick.round,
    overall: pick.overall,
    originalTeamId: pick.originalTeamId,
    fromTeamId: fromTeam.id,
    toTeamId: toTeam.id,
    userStrengthImpact: 0,
    headline: `${fromTeam.shortName}-${toTeam.shortName}, 다음 드래프트 지명권 거래`,
    body: `우리 팀과 직접 관련은 없지만 ${pick.round}라운드 ${pick.overall}순위 지명권의 현재 보유 구단이 바뀌었다.`,
  };
}

function createPickTradeNews(event: PickTradeEvent, teams: Team[]): CareerNewsItem {
  const toTeam = teams.find((team) => team.id === event.toTeamId);
  return {
    id: `news-${event.id}`,
    year: event.yearIndex,
    week: 30,
    grade: event.type === "other-teams" ? "normal" : "major",
    importance: event.type === "other-teams" ? 3 : 4,
    type: "지명권 트레이드",
    headline: event.headline,
    body: event.body,
    teamName: toTeam?.name,
    emphasis: event.type === "other-teams" ? undefined : "user",
  };
}

function mergeStrengthAdjustments(current: Record<string, number>, incoming: Record<string, number>): Record<string, number> {
  const next = { ...current };
  Object.entries(incoming).forEach(([teamId, value]) => {
    next[teamId] = (next[teamId] ?? 0) + value;
  });
  return next;
}

function updateTeamNeedsAfterSeason(teams: Team[], players: CareerPlayerState[], seasonYear: number): { teams: Team[]; news: CareerNewsItem[] } {
  const news: CareerNewsItem[] = [];
  const updated = teams.map((team) => {
    const nextDepth = { ...team.positionDepth } as Record<Position, PositionDepth>;

    POSITIONS.forEach((position) => {
      const current = nextDepth[position];
      const positionPlayers = players.filter((player) => player.team.id === team.id && currentPlayerPosition(player) === position);
      const regular = positionPlayers.find((player) => player.overall >= 64 && player.status !== "방출" && player.status !== "은퇴" && player.status !== "해외진출");
      const failed = positionPlayers.find((player) => player.yearsPro >= 2 && (player.overall < 50 || player.status === "방출" || player.status === "은퇴" || player.status === "해외진출"));
      const next: PositionDepth = { ...current, changeReason: undefined };

      if (regular) {
        next.majorLeagueStrength = clampNumber(next.majorLeagueStrength + 7, 0, 100);
        next.prospectDepth = clampNumber(next.prospectDepth + 5, 0, 100);
        next.agingRisk = clampNumber(next.agingRisk - 5, 0, 100);
        next.changeReason = `${seasonYear}년 ${regular.pick.round}라운드 ${positionLabel(position)} ${regular.prospect.name}의 주전 도약으로 ${position} 니즈 하락`;
      }

      if (failed && !regular) {
        next.prospectDepth = clampNumber(next.prospectDepth - 8, 0, 100);
        next.changeReason = `${failed.prospect.name} 성장 정체로 ${position} 유망주층 평가 하락`;
      }

      if (Math.random() < 0.18) {
        const event = randomDepthEvent(team, position, seasonYear);
        next.majorLeagueStrength = clampNumber(next.majorLeagueStrength + event.majorLeagueDelta, 0, 100);
        next.prospectDepth = clampNumber(next.prospectDepth + event.prospectDelta, 0, 100);
        next.agingRisk = clampNumber(next.agingRisk + event.agingDelta, 0, 100);
        next.injuryRisk = clampNumber(next.injuryRisk + event.injuryDelta, 0, 100);
        next.contractRisk = clampNumber(next.contractRisk + event.contractDelta, 0, 100);
        next.changeReason = event.reason;
        news.push({
          id: `team-need-${seasonYear}-${team.id}-${position}`,
          year: seasonYear,
          week: 28,
          grade: event.importance >= 4 ? "major" : "normal",
          importance: event.importance,
          type: "팀 니즈 변화",
          headline: `${team.shortName} ${positionLabel(position)} 전력 변동`,
          body: event.reason,
          teamName: team.name,
          emphasis: undefined,
        });
      }

      next.need = calculateNeed(next);
      nextDepth[position] = next;
    });

    const needs = POSITIONS.map((position) => ({ position, urgency: nextDepth[position].need }))
      .sort((left, right) => right.urgency - left.urgency)
      .slice(0, 4);

    return { ...team, positionDepth: nextDepth, needs };
  });

  return { teams: updated, news };
}

function randomDepthEvent(team: Team, position: Position, seasonYear: number): {
  majorLeagueDelta: number;
  prospectDelta: number;
  agingDelta: number;
  injuryDelta: number;
  contractDelta: number;
  importance: CareerNewsItem["importance"];
  reason: string;
} {
  const roll = Math.random();
  if (roll < 0.18) return { majorLeagueDelta: -12, prospectDelta: 0, agingDelta: 0, injuryDelta: 6, contractDelta: 18, importance: 4, reason: `주전 ${positionLabel(position)} FA 이탈로 ${position} 니즈 상승` };
  if (roll < 0.34) return { majorLeagueDelta: -9, prospectDelta: 0, agingDelta: 10, injuryDelta: 0, contractDelta: 0, importance: 3, reason: `${seasonYear}시즌 주전 노쇠화 징후로 ${position} 장기 보강 필요 상승` };
  if (roll < 0.5) return { majorLeagueDelta: -10, prospectDelta: 0, agingDelta: 0, injuryDelta: 18, contractDelta: 0, importance: 4, reason: `주전 ${positionLabel(position)} 장기 부상으로 ${team.shortName} 보강 우선순위 상승` };
  if (roll < 0.66) return { majorLeagueDelta: 0, prospectDelta: -12, agingDelta: 0, injuryDelta: 0, contractDelta: 0, importance: 3, reason: `기대 유망주 부진으로 ${position} 유망주층 평가 하락` };
  if (roll < 0.82) return { majorLeagueDelta: 9, prospectDelta: 8, agingDelta: -8, injuryDelta: -3, contractDelta: -4, importance: 3, reason: `기대 유망주 주전 도약으로 ${position} 니즈 하락` };
  return { majorLeagueDelta: -7, prospectDelta: -2, agingDelta: 8, injuryDelta: 0, contractDelta: 0, importance: 3, reason: `베테랑 은퇴와 뎁스 공백으로 ${position} 보강 필요 상승` };
}

function calculateNeed(depth: PositionDepth): number {
  return Math.round(clampNumber(
    (100 - depth.majorLeagueStrength) * 0.35 +
    (100 - depth.prospectDepth) * 0.25 +
    depth.agingRisk * 0.15 +
    depth.injuryRisk * 0.12 +
    depth.contractRisk * 0.13,
    0,
    100,
  ));
}

function createNeedSnapshots(year: number, teams: Team[]): TeamNeedSnapshot[] {
  return teams.map((team) => snapshotTeamNeeds(year, team));
}

function createNeedRows(team: Team, history: TeamNeedSnapshot[], existingPlayers: ExistingLeaguePlayer[], careerPlayers: CareerPlayerState[]) {
  const snapshots = history.filter((snapshot) => snapshot.teamId === team.id);
  const previous = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : snapshots[snapshots.length - 1];
  return POSITIONS.map((position) => {
    const depth = team.positionDepth[position];
    const { draftedMembers, existingMembers } = createRosterMembersForPosition(team, existingPlayers, careerPlayers, position);
    const rosterAwareNeed = calculateRosterAwareNeed(depth.need, [...draftedMembers, ...existingMembers], position);
    const previousNeed = previous?.needs[position] ?? rosterAwareNeed;
    return {
      position,
      depth,
      need: rosterAwareNeed,
      change: rosterAwareNeed - previousNeed,
    };
  }).sort((left, right) => right.need - left.need);
}

function snapshotTeamNeeds(year: number, team: Team): TeamNeedSnapshot {
  return {
    year,
    teamId: team.id,
    needs: Object.fromEntries(POSITIONS.map((position) => [position, team.positionDepth[position].need])) as Partial<Record<Position, number>>,
  };
}

function careerContext(player: CareerPlayerState, userTeamId: TeamId, watchedIds: Set<ProspectId>, nextAfterUserPickIds: Set<ProspectId>): CareerNewsItem["emphasis"] {
  if (player.team.id === userTeamId) return "user";
  if (nextAfterUserPickIds.has(player.prospect.id)) return "missed";
  if (watchedIds.has(player.prospect.id)) return "watched";
  return undefined;
}

function addCareerNews(
  news: CareerNewsItem[],
  player: CareerPlayerState,
  year: number,
  importance: CareerNewsItem["importance"],
  type: string,
  headline: string,
  body: string,
  emphasis: CareerNewsItem["emphasis"],
) {
  const week = seasonWeekForEvent(type, year, player.playerId);
  const grade = newsGradeForEvent(type, importance, player);
  const overallChange = extractOverallChange(body);
  const logEntry: CareerLogEntry = {
    year,
    week,
    grade,
    type,
    headline,
    importance,
    overallChange: STAT_CAREER_LOG_TYPES.has(type) ? overallChange : undefined,
    overallAfter: STAT_CAREER_LOG_TYPES.has(type) ? player.currentOverall : undefined,
  };
  player.careerLog = [...player.careerLog, logEntry].slice(-30);
  const trackingStatus = player.trackingStatus;
  const majorType = ["1군 데뷔", "장기 재활", "방출", "은퇴", "신인왕 후보", "신인왕 수상", "골든글러브", "MVP급 시즌", "하위 라운드 성공", "우리 팀이 거른 선수의 성공", "트레이드", "FA 이적", "메이저 진출", "해외 평가전 활약", "해외 관심", "올스타 선발", "국가대표 선발", "병역 후 파워 상승", "차세대 전력", "베테랑 반등", "기량 저하"].includes(type);
  if (trackingStatus === "summary" && !majorType && importance < 4) return;
  if (trackingStatus === "archived") {
    if (importance < 5 || !["1군 데뷔", "하위 라운드 성공", "MVP급 시즌", "트레이드", "우리 팀이 거른 선수의 성공"].includes(type)) return;
    headline = `추적 종료 선수 재등장: ${headline}`;
  }

  const publishChance = { 1: 0.04, 2: 0.06, 3: 0.1, 4: 0.16, 5: 0.34 }[importance];
  if (!emphasis && Math.random() > publishChance) return;
  const article = createArticleCopy(player, year, type, headline, body);

  news.push({
    id: `${year}-${player.playerId}-${type}-${news.length}`,
    year,
    week,
    grade,
    importance,
    type,
    headline: article.headline,
    body: article.body,
    teamName: player.team.name,
    playerId: player.playerId,
    emphasis,
  });
}

function extractOverallChange(text: string): number | undefined {
  const match = text.match(/OVR(?:이|은| 변화는| 변화가)?\s*([+-]?\d+)/);
  return match ? Number(match[1]) : undefined;
}

function createArticleCopy(player: CareerPlayerState, year: number, type: string, headline: string, body: string): { headline: string; body: string } {
  const dateline = `${player.team.shortName} 구단 소식`;
  const pickInfo = `${player.pick.round}라운드 ${player.pick.overall}순위`;
  const lead =
    type === "부상" || type === "장기 재활"
      ? `${dateline}에 따르면 ${pickInfo} ${player.prospect.name}${topicParticle(player.prospect.name)} 재활 프로그램에 들어갔다.`
      : type === "방출" || type === "은퇴" || type === "해외진출" || type === "메이저 진출"
        ? `${dateline}은 ${pickInfo} 출신 ${player.prospect.name}와의 동행을 마무리했다.`
        : type === "1군 데뷔"
          ? `${dateline}은 ${pickInfo} ${player.prospect.name}${objectParticle(player.prospect.name)} 1군 엔트리에 올렸다.`
          : `${dateline}에서 ${pickInfo} ${player.prospect.name} 관련 변화가 포착됐다.`;
  const context = `현재 OVR ${player.currentOverall}, 입단 후 ${player.yearsSinceDraft}년차.`;
  return {
    headline: headline.includes("|") ? headline : `${headline}`,
    body: `${lead} ${body} ${context}`,
  };
}

function curateYearlyNews(news: CareerNewsItem[]): CareerNewsItem[] {
  return [...news]
    .sort((left, right) => newsPriority(right) - newsPriority(left))
    .slice(0, 34)
    .sort(compareNewsChronologically);
}

function newsPriority(news: CareerNewsItem): number {
  const emphasisWeight = news.emphasis === "user" ? 80 : news.emphasis === "missed" ? 64 : news.emphasis === "watched" ? 56 : 0;
  const gradeWeight = news.grade === "headline" ? 40 : news.grade === "major" ? 24 : news.grade === "normal" ? 8 : 0;
  return emphasisWeight + gradeWeight + news.importance * 8;
}

function newsGradeForEvent(type: string, importance: CareerNewsItem["importance"], player: CareerPlayerState): NewsGrade {
  if (["신인왕 수상", "MVP급 시즌", "하위 라운드 성공", "우리 팀이 거른 선수의 성공", "메이저 진출", "해외 평가전 활약", "FA 영입", "트레이드 영입", "국가대표 선발"].includes(type)) return "headline";
  if (["1군 데뷔", "장기 재활", "방출", "은퇴", "골든글러브", "신인왕 후보", "주요 신인 주목", "차세대 전력", "트레이드", "FA 이적", "해외 관심", "올스타 선발", "병역 후 파워 상승", "베테랑 반등", "기량 저하"].includes(type)) return "major";
  if (player.trackingStatus === "archived" || importance <= 2) return "archive";
  if (player.trackingStatus === "summary" && importance <= 3) return "archive";
  return "normal";
}

function newsSentiment(news: CareerNewsItem): "positive" | "neutral" | "negative" {
  const positiveTypes = new Set([
    "1군 데뷔",
    "첫 안타",
    "첫 홈런",
    "첫 선발 등판",
    "구속 상승",
    "신인왕 후보",
    "주요 신인 주목",
    "신인왕 수상",
    "골든글러브",
    "MVP급 시즌",
    "하위 라운드 성공",
    "우리 팀이 거른 선수의 성공",
    "FA 영입",
    "트레이드 영입",
    "메이저 진출",
    "해외 평가전",
    "해외 평가전 활약",
    "해외 관심",
    "차세대 전력",
    "베테랑 반등",
    "올스타 선발",
    "국가대표 선발",
    "병역 후 파워 상승",
  ]);
  const negativeTypes = new Set([
    "부상",
    "장기 재활",
    "방출",
    "은퇴",
    "기량 저하",
    "FA 이적",
    "트레이드",
    "지명권 트레이드",
  ]);
  if (positiveTypes.has(news.type)) return "positive";
  if (negativeTypes.has(news.type)) return "negative";

  const text = `${news.headline} ${news.body}`;
  if (/단점 보완|1군 약점 보완|역할 조정 성공|전반적 스탯 상승|장점 강화|핵심 툴 강화|주무기 재정비|커리어 재상승|베테랑 기량 반등/.test(text)) return "positive";
  if (/단점 심화|약점 노출 확대|장점 퇴색|강점 둔화|무기 위력 감소|전반적 기량 하락|에이징커브 하락|커리어 하락세|선수생활 영향 부상/.test(text)) return "negative";
  if (/^유지| 유지 /.test(text)) return "neutral";
  if (/성공|상승|반등|데뷔|수상|선발|영입|확보|도약|호평|금메달|면제|대기록|기록 경신/.test(text)) return "positive";
  if (/부상|재활|방출|은퇴|하락|저하|부진|실패|이탈|악재|손실|논란|정체|공백/.test(text)) return "negative";
  return "neutral";
}

function orderedNews(news: CareerNewsItem[]): CareerNewsItem[] {
  return [...news].sort(compareNewsChronologically);
}

function compareNewsChronologically(left: CareerNewsItem, right: CareerNewsItem): number {
  return left.year - right.year || left.week - right.week || right.importance - left.importance;
}

function groupNewsByPlayer(news: CareerNewsItem[], prospects: Prospect[], players: CareerPlayerState[]) {
  const byPlayer = new Map<ProspectId, CareerNewsItem[]>();
  orderedNews(news).forEach((item) => {
    if (!item.playerId) return;
    const current = byPlayer.get(item.playerId) ?? [];
    byPlayer.set(item.playerId, [...current, item]);
  });

  return Array.from(byPlayer.entries())
    .map(([playerId, items]) => {
      const player = players.find((candidate) => candidate.playerId === playerId);
      const prospect = player?.prospect ?? prospects.find((candidate) => candidate.id === playerId);
      return {
        playerId,
        name: prospect?.name ?? String(playerId),
        meta: player ? `${player.pick.round}R ${player.pick.overall}번 · ${positionLabel(player.prospect.primaryPosition)} · ${player.status}` : `${prospect ? positionLabel(prospect.primaryPosition) : "선수"} · 미지명`,
        items,
        priority: Math.max(...items.map(newsPriority)),
        firstWeek: items[0]?.week ?? 99,
      };
    })
    .sort((left, right) => right.priority - left.priority || left.firstWeek - right.firstWeek || left.name.localeCompare(right.name, "ko"));
}

function seasonWeekForEvent(type: string, year: number, key: string): number {
  const seed = `${year}-${type}-${key}`;
  const jitter = Math.floor(deterministicNoise(seed) * 3);
  if (type === "퓨처스 적응" || type === "성장 정체") return 3 + jitter;
  if (type === "육성 결과") return 6 + Math.floor(deterministicNoise(`${seed}-dev`) * 18);
  if (type === "시즌 하락" || type === "시즌 부침") return 10 + jitter;
  if (type === "후반기 반등") return 19 + jitter;
  if (type === "부상") return 5 + Math.floor(deterministicNoise(`${seed}-inj`) * 16);
  if (type === "장기 재활") return 8 + Math.floor(deterministicNoise(`${seed}-rehab`) * 12);
  if (type === "1군 데뷔" || type === "첫 안타" || type === "첫 선발 등판") return 9 + Math.floor(deterministicNoise(`${seed}-debut`) * 12);
  if (type === "첫 홈런" || type === "구속 상승") return 13 + Math.floor(deterministicNoise(`${seed}-mid`) * 10);
  if (type === "트레이드" || type === "FA 이적" || type === "트레이드 영입" || type === "FA 영입" || type === "포지션 전환") return 16 + Math.floor(deterministicNoise(`${seed}-turn`) * 8);
  if (type === "하위 라운드 성과" || type === "하위 라운드 성공" || type === "우리 팀이 거른 선수의 성공") return 20 + Math.floor(deterministicNoise(`${seed}-late`) * 6);
  if (type === "1군 안착") return 14 + jitter;
  if (type === "주요 신인 주목" || type === "차세대 전력" || type === "신인왕 후보") return 18 + jitter;
  if (type === "기량 상승" || type === "베테랑 반등" || type === "기량 저하" || type === "입지 흔들림") return 17 + jitter;
  if (type === "올스타 선발") return 15 + jitter;
  if (type === "국가대표 선발") return 23 + jitter;
  if (type === "병역" || type === "상무 복무" || type === "병역 복귀" || type === "병역 후 파워 상승") return 25 + jitter;
  if (type === "해외 평가전" || type === "해외 평가전 활약" || type === "해외 관심") return 28 + jitter;
  if (type === "신인왕 수상" || type === "골든글러브" || type === "MVP급 시즌" || type === "방출" || type === "은퇴" || type === "메이저 진출") return 27 + jitter;
  if (type.includes("대학") || type.includes("독립리그") || type.includes("육성선수")) return 24 + jitter;
  return 12 + Math.floor(deterministicNoise(seed) * 14);
}

function formatSeasonWeek(week: number): string {
  if (week >= 30) return "오프시즌";
  if (week >= 27) return "시즌 종료";
  return `${week}주차`;
}

function pickRandom<T>(values: T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatScore(value: number): string {
  return value.toFixed(1);
}

function seasonRecordForDisplay(result: TeamSeasonResult): Pick<TeamSeasonResult, "wins" | "draws" | "losses" | "winningPct"> {
  if (Number.isFinite(result.wins) && Number.isFinite(result.draws) && Number.isFinite(result.losses)) {
    return {
      wins: result.wins,
      draws: result.draws,
      losses: result.losses,
      winningPct: Number.isFinite(result.winningPct) ? result.winningPct : result.wins / Math.max(1, result.wins + result.losses),
    };
  }
  const games = 144;
  const draws = 5;
  const rankPct = clampNumber(0.64 - (result.rank - 1) * 0.03 + (result.seasonPerformanceScore - 65) * 0.002, 0.36, 0.64);
  const wins = Math.round((games - draws) * rankPct);
  const losses = games - draws - wins;
  return { wins, draws, losses, winningPct: wins / Math.max(1, wins + losses) };
}

function formatSeasonRecord(result: TeamSeasonResult): string {
  const record = seasonRecordForDisplay(result);
  return `${record.wins}승 ${record.draws}무 ${record.losses}패`;
}

function formatWinningPct(result: TeamSeasonResult): string {
  return seasonRecordForDisplay(result).winningPct.toFixed(3).replace(/^0/, "");
}

function formatSigned(value: number): string {
  if (Math.abs(value) < 0.05) return "0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatRankChange(value: number): string {
  if (value === 0) return "변화 없음";
  return value > 0 ? `${value}계단 상승` : `${Math.abs(value)}계단 하락`;
}

function pickTradeTypeLabel(type: PickTradeEvent["type"]): string {
  if (type === "user-pick-gain") return "우리 팀 지명권 증가";
  if (type === "user-pick-loss") return "우리 팀 지명권 감소";
  return "타 구단 이동";
}

function topicParticle(value: string): "은" | "는" {
  const last = value.charCodeAt(value.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "는";
  return (last - 0xac00) % 28 === 0 ? "는" : "은";
}

function objectParticle(value: string): "을" | "를" {
  const last = value.charCodeAt(value.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "를";
  return (last - 0xac00) % 28 === 0 ? "를" : "을";
}

function subjectParticle(value: string): "이" | "가" {
  const last = value.charCodeAt(value.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "가";
  return (last - 0xac00) % 28 === 0 ? "가" : "이";
}

export default App;
