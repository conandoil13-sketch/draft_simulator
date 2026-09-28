import type { ProspectId } from "../types/common";
import type { GameState } from "../types/game";
import type { AppSaveState, CareerLogEntry, CareerNewsItem, CareerPlayerState } from "../types/app";

const SAVE_STATE_KEY = "draft-sm:save-state";
const SAVE_NEWS_LIMIT = 80;
const SAVE_PICK_TRADE_LIMIT = 40;
const SAVE_NEED_HISTORY_LIMIT = 120;
const SAVE_CAREER_LOG_LIMIT = 18;
const SAVE_TRANSACTION_LOG_LIMIT = 14;

export const JSON_SAVE_FILENAME = "draft-sm-save.json";

const HISTORICAL_EVENT_KEYS = new Set([
  "first-team-regular",
  "rookie-standout",
  "rookie-candidate",
  "rookie-award",
  "young-core-progress",
  "gold-glove",
  "mvp",
  "late-role",
  "late-breakout",
  "missed-success",
  "major-posting",
  "military-power-breakout",
]);

const HISTORICAL_NEWS_TYPES = new Set([
  "1군 데뷔",
  "신인왕",
  "신인왕 후보",
  "골든글러브",
  "타이틀홀더",
  "MVP급 시즌",
  "하위 라운드 성공",
  "하위 라운드 성과",
  "우리 팀이 거른 선수의 성공",
  "트레이드",
  "FA 이적",
  "메이저 진출",
  "은퇴",
]);

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

export function readSaveState(): AppSaveState | undefined {
  try {
    const raw = localStorage.getItem(SAVE_STATE_KEY);
    return raw ? (JSON.parse(raw) as AppSaveState) : undefined;
  } catch {
    return undefined;
  }
}

export function writeSaveState(value: AppSaveState): boolean {
  try {
    localStorage.setItem(SAVE_STATE_KEY, JSON.stringify(compactSaveState(value)));
    return true;
  } catch {
    return false;
  }
}

export function clearSaveState() {
  localStorage.removeItem(SAVE_STATE_KEY);
}

export function compactSaveState(value: AppSaveState): AppSaveState {
  const careerPlayers = compactCareerPlayersForSave(value.careerPlayers, value.careerYear);
  const savedPlayerIds = new Set(careerPlayers.map((player) => player.playerId));
  return {
    ...value,
    game: value.game ? compactGameStateForSave(value.game) : undefined,
    notifications: value.notifications.slice(0, 8),
    careerPlayers,
    careerNews: compactCareerNewsForSave(value.careerNews, savedPlayerIds),
    selectedCareerId: value.selectedCareerId && savedPlayerIds.has(value.selectedCareerId) ? value.selectedCareerId : "",
    pickTradeEvents: value.pickTradeEvents.slice(0, SAVE_PICK_TRADE_LIMIT),
    needHistory: value.needHistory.slice(-SAVE_NEED_HISTORY_LIMIT),
  };
}

function compactGameStateForSave(game: GameState): GameState {
  const currentPicks = game.draftPicksByYear[game.currentYear] ?? [];
  return {
    ...game,
    draftClassProfilesByYear: game.draftClassProfilesByYear?.[game.currentYear]
      ? { [game.currentYear]: game.draftClassProfilesByYear[game.currentYear] }
      : {},
    draftClassesByYear: {
      [game.currentYear]: game.draftClassesByYear[game.currentYear] ?? (Object.keys(game.prospectsById) as ProspectId[]),
    },
    foreignPlayerMarketYear: game.foreignPlayerMarketYear,
    foreignPlayersById: game.foreignPlayerMarketYear === game.currentYear ? game.foreignPlayersById : {},
    draftPicksByYear: {
      [game.currentYear]: currentPicks,
    },
    draftHistoryByYear: {},
    seasonHistoryByYear: {},
    newsFeed: [],
  };
}

function compactCareerPlayersForSave(players: CareerPlayerState[], careerYear: number): CareerPlayerState[] {
  return players
    .filter((player) => shouldPersistCareerPlayer(player, careerYear))
    .map((player) => ({
      ...player,
      careerLog: compactCareerLogForSave(player, careerYear),
      transactionLog: player.transactionLog.slice(-SAVE_TRANSACTION_LOG_LIMIT),
    }));
}

function shouldPersistCareerPlayer(player: CareerPlayerState, careerYear: number): boolean {
  if (player.status !== "방출" && player.status !== "은퇴") return true;
  if (player.customNickname?.trim()) return true;
  if (hasHistoricalTrace(player)) return true;
  if (player.trackingStatus !== "archived" && player.trackingArchivedAtYear === undefined) return true;
  return player.trackingArchivedAtYear !== undefined && careerYear <= player.trackingArchivedAtYear;
}

function hasHistoricalTrace(player: CareerPlayerState): boolean {
  if (player.status === "해외진출") return true;
  if (player.debuted || player.firstHit || player.firstHomeRun || player.firstStart) return true;
  if (player.currentOverall >= 70 || player.initialOverall >= 70) return true;
  if (player.eventKeys.some((key) => HISTORICAL_EVENT_KEYS.has(key))) return true;
  if (player.transactionLog.length > 1) return true;
  return player.careerLog.some((entry) => entry.importance >= 4 || entry.grade === "headline" || entry.grade === "major" || HISTORICAL_NEWS_TYPES.has(entry.type));
}

function compactCareerLogForSave(player: CareerPlayerState, careerYear: number): CareerLogEntry[] {
  const important = player.careerLog.filter((entry) => entry.importance >= 4 || entry.grade === "headline" || entry.grade === "major" || HISTORICAL_NEWS_TYPES.has(entry.type));
  const recent = player.careerLog.slice(-6);
  const deduped = new Map<string, CareerLogEntry>();
  [...important, ...recent].forEach((entry) => {
    const compacted = compactStatCareerLogEntry(entry, careerYear);
    deduped.set(`${compacted.year}-${compacted.week}-${compacted.type}-${compacted.headline}`, compacted);
  });
  return Array.from(deduped.values())
    .sort(compareCareerLogChronologically)
    .slice(-SAVE_CAREER_LOG_LIMIT);
}

function compactStatCareerLogEntry(entry: CareerLogEntry, careerYear: number): CareerLogEntry {
  if (!STAT_CAREER_LOG_TYPES.has(entry.type) || careerYear <= entry.year) return entry;
  const changeText = entry.overallChange === undefined ? "변동 기록 없음" : `OVR ${formatSignedForSave(entry.overallChange)}`;
  const afterText = entry.overallAfter === undefined ? "" : ` · 당시 ${entry.overallAfter}`;
  return {
    year: entry.year,
    week: entry.week,
    grade: entry.grade,
    type: "시즌 OVR 변동",
    headline: `${changeText}${afterText}`,
    importance: entry.importance,
    overallChange: entry.overallChange,
    overallAfter: entry.overallAfter,
    compacted: true,
  };
}

function compactCareerNewsForSave(news: CareerNewsItem[], savedPlayerIds: Set<ProspectId>): CareerNewsItem[] {
  return news
    .filter((item) => !item.playerId || savedPlayerIds.has(item.playerId) || item.importance >= 5 || item.emphasis === "user")
    .slice(0, SAVE_NEWS_LIMIT);
}

function compareCareerLogChronologically(left: CareerLogEntry, right: CareerLogEntry): number {
  return left.year - right.year || left.week - right.week;
}

function formatSignedForSave(value: number): string {
  if (Math.abs(value) < 0.05) return "0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}
