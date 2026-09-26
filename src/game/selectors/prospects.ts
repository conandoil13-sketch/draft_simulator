import type { Position } from "../types/common";
import type { Prospect, ProspectRiskTag, ScoutGrade } from "../types/player";

export type ProspectSortKey =
  | "rank"
  | "name"
  | "position"
  | "school"
  | "schoolYear"
  | "expectedOverall"
  | "projectedRound"
  | "scoutGrade"
  | "risk"
  | "confidence"
  | "height"
  | "weight"
  | "primaryStat";

export type ProspectFilters = {
  positions?: Position[];
  projectedRounds?: number[];
  scoutGrades?: ScoutGrade[];
  schools?: string[];
  riskTags?: ProspectRiskTag[];
  riskLevels?: string[];
  minConfidence?: number;
  onlyAvailable?: boolean;
};

export type ProspectTableRow = {
  id: string;
  rank: number;
  name: string;
  school: string;
  schoolYear: number;
  position: Position;
  playerGroup: string;
  archetype: string;
  leagueLevel: string;
  collegeCommitRisk: number;
  batsThrows: string;
  heightCm: number;
  weightKg: number;
  projectedRound: string;
  scoutGrade: ScoutGrade;
  expectedOverall: string;
  confidence: number;
  riskLevel: string;
  riskTags: ProspectRiskTag[];
  trend: string;
  primaryStat: string;
  oneLine: string;
  isDrafted: boolean;
};

export type ProspectDetailPanel = {
  row: ProspectTableRow;
  physical: Prospect["physical"];
  hitterStats?: Prospect["hitterStats"];
  pitcherStats?: Prospect["pitcherStats"];
  strengths: string[];
  weaknesses: string[];
  growthProjection: string;
  teamInterest: string[];
  summary: string;
  dataTier: string;
  visibility: string;
};

export function getProspectTableRows(prospects: Prospect[]): ProspectTableRow[] {
  return prospects.map(toProspectTableRow);
}

export function getProspectDetailPanel(prospect: Prospect): ProspectDetailPanel {
  return {
    row: toProspectTableRow(prospect),
    physical: prospect.physical,
    hitterStats: prospect.hitterStats,
    pitcherStats: prospect.pitcherStats,
    strengths: prospect.visible.strengths,
    weaknesses: prospect.visible.weaknesses,
    growthProjection: prospect.visible.growthProjection,
    teamInterest: prospect.visible.teamInterest,
    summary: prospect.visible.summary,
    dataTier: prospect.visible.dataTier,
    visibility: prospect.visible.visibility,
  };
}

export function filterProspects(prospects: Prospect[], filters: ProspectFilters): Prospect[] {
  return prospects.filter((prospect) => {
    if (filters.onlyAvailable && prospect.isDrafted) return false;
    if (filters.positions?.length && !filters.positions.includes(prospect.primaryPosition)) return false;
    if (filters.projectedRounds?.length && !roundsOverlap(filters.projectedRounds, prospect.visible.projectedRound)) return false;
    if (filters.scoutGrades?.length && !filters.scoutGrades.includes(prospect.visible.scoutGrade)) return false;
    if (filters.schools?.length && !filters.schools.includes(prospect.school)) return false;
    if (filters.riskLevels?.length && !filters.riskLevels.includes(prospect.visible.riskLevel)) return false;
    if (filters.riskTags?.length && !filters.riskTags.some((tag) => prospect.visible.riskTags.includes(tag))) return false;
    if (filters.minConfidence !== undefined && prospect.visible.confidence < filters.minConfidence) return false;
    return true;
  });
}

export function sortProspects(prospects: Prospect[], key: ProspectSortKey, direction: "asc" | "desc" = "asc"): Prospect[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...prospects].sort((a, b) => compareProspects(a, b, key) * multiplier);
}

export function queryProspects(
  prospects: Prospect[],
  filters: ProspectFilters,
  sortKey: ProspectSortKey = "rank",
  direction: "asc" | "desc" = "asc",
): ProspectTableRow[] {
  return getProspectTableRows(sortProspects(filterProspects(prospects, filters), sortKey, direction));
}

function toProspectTableRow(prospect: Prospect): ProspectTableRow {
  return {
    id: prospect.id,
    rank: prospect.visible.publicRank,
    name: prospect.name,
    school: prospect.school,
    schoolYear: prospect.schoolYear,
    position: prospect.primaryPosition,
    playerGroup: prospect.playerGroup,
    archetype: prospect.archetype,
    leagueLevel: prospect.leagueLevel,
    collegeCommitRisk: prospect.collegeCommitRisk,
    batsThrows: `${prospect.physical.bats}/${prospect.physical.throws}`,
    heightCm: prospect.physical.heightCm,
    weightKg: prospect.physical.weightKg,
    projectedRound: formatRange(prospect.visible.projectedRound),
    scoutGrade: prospect.visible.scoutGrade,
    expectedOverall: formatRange(prospect.visible.expectedOverallRange),
    confidence: prospect.visible.confidence,
    riskLevel: prospect.visible.riskLevel,
    riskTags: prospect.visible.riskTags,
    trend: prospect.visible.trend,
    primaryStat: primaryStat(prospect),
    oneLine: prospect.visible.oneLine,
    isDrafted: prospect.isDrafted,
  };
}

function compareProspects(a: Prospect, b: Prospect, key: ProspectSortKey): number {
  if (key === "rank") return a.visible.publicRank - b.visible.publicRank;
  if (key === "expectedOverall") return a.visible.expectedOverallRange.max - b.visible.expectedOverallRange.max;
  if (key === "projectedRound") return a.visible.projectedRound.min - b.visible.projectedRound.min;
  if (key === "risk") return riskWeight(a.visible.riskLevel) - riskWeight(b.visible.riskLevel);
  if (key === "confidence") return a.visible.confidence - b.visible.confidence;
  if (key === "position") return a.primaryPosition.localeCompare(b.primaryPosition);
  if (key === "school") return a.school.localeCompare(b.school);
  if (key === "schoolYear") return a.schoolYear - b.schoolYear;
  if (key === "height") return a.physical.heightCm - b.physical.heightCm;
  if (key === "weight") return a.physical.weightKg - b.physical.weightKg;
  if (key === "scoutGrade") return scoutGradeWeight(a.visible.scoutGrade) - scoutGradeWeight(b.visible.scoutGrade);
  if (key === "primaryStat") return primaryStatValue(a) - primaryStatValue(b);
  return a.name.localeCompare(b.name);
}

function roundsOverlap(rounds: number[], projectedRound: { min: number; max: number }): boolean {
  return rounds.some((round) => round >= projectedRound.min && round <= projectedRound.max);
}

function scoutGradeWeight(grade: ScoutGrade): number {
  return { S: 6, A: 5, B: 4, C: 3, D: 2, E: 1 }[grade];
}

function riskWeight(riskLevel: string): number {
  return { low: 1, medium: 2, high: 3, extreme: 4 }[riskLevel] ?? 0;
}

function formatRange(range: { min: number; max: number }): string {
  if (range.min > 10) return "미지명권";
  if (range.max > 10) return `${range.min}-미지명권`;
  return range.min === range.max ? String(range.min) : `${range.min}-${range.max}`;
}

function primaryStat(prospect: Prospect): string {
  if (prospect.pitcherStats) {
    const era = prospect.pitcherStats.era === null ? "ERA -" : `ERA ${prospect.pitcherStats.era.toFixed(2)}`;
    const velocity = prospect.pitcherStats.maxVelocityKph === null ? "Velo -" : `${prospect.pitcherStats.maxVelocityKph}km/h`;
    return `${era} / ${velocity}`;
  }

  if (prospect.hitterStats) {
    const average = prospect.hitterStats.average === null ? "AVG -" : `AVG ${prospect.hitterStats.average.toFixed(3)}`;
    const ops = prospect.hitterStats.ops === null ? "OPS -" : `OPS ${prospect.hitterStats.ops.toFixed(3)}`;
    return `${average} / ${ops}`;
  }

  return "-";
}

function primaryStatValue(prospect: Prospect): number {
  if (prospect.pitcherStats) {
    return prospect.pitcherStats.era === null ? 99 : prospect.pitcherStats.era;
  }

  if (prospect.hitterStats) {
    return prospect.hitterStats.ops ?? 0;
  }

  return 0;
}
