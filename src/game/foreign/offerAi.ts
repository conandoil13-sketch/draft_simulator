import type { TeamId, Year } from "../types/common";
import type { ForeignContract, ForeignContractOffer, ForeignContractTerms, ForeignGuaranteedRole } from "../types/foreignContract";
import type { ForeignOriginLeague, ForeignPlayerCandidate } from "../types/foreignPlayer";
import type { Team } from "../types/team";
import type { Rng } from "../generation/random";
import { randomFloat } from "../generation/random";
import { clamp, roundTo } from "../utils/math";
import { getForeignRosterUsage, validateForeignRosterSigning } from "../selectors/foreignContracts";
import { createForeignContractOffer } from "./recruitment";

const GRADE_VALUE = { S: 94, A: 84, B: 73, C: 62, D: 52, E: 43 } as const;

const LEAGUE_VALUE: Record<ForeignOriginLeague, number> = {
  MLB: 94,
  AAA: 83,
  AA: 70,
  MiLB: 62,
  "Mexican League": 74,
  Independent: 58,
  NPB: 88,
  "NPB Futures": 68,
  "Japanese Industrial": 64,
  CPBL: 75,
  ABL: 58,
};

export type CpuForeignTargetEvaluation = {
  teamId: TeamId;
  playerId: ForeignPlayerCandidate["id"];
  score: number;
  needScore: number;
  talentScore: number;
  riskPenalty: number;
  valueScore: number;
  proposedTerms: ForeignContractTerms;
};

export type CpuForeignOfferPlan = {
  offers: ForeignContractOffer[];
  rankingsByTeam: Record<string, CpuForeignTargetEvaluation[]>;
};

export function generateCpuForeignOffers(input: {
  year: Year;
  round: number;
  teams: Team[];
  teamIds: TeamId[];
  candidates: ForeignPlayerCandidate[];
  contracts: ForeignContract[];
  previousOffers: ForeignContractOffer[];
  rng: Rng;
}): CpuForeignOfferPlan {
  const acceptedPlayerIds = new Set(input.previousOffers.filter((offer) => offer.status === "accepted").map((offer) => offer.playerId));
  const contractedPlayerIds = new Set(input.contracts.filter((contract) => contract.status === "active").map((contract) => contract.playerId));
  const available = input.candidates.filter((candidate) => candidate.status === "available" && !acceptedPlayerIds.has(candidate.id) && !contractedPlayerIds.has(candidate.id));
  const teamById = new Map(input.teams.map((team) => [team.id, team]));
  const offers: ForeignContractOffer[] = [];
  const rankingsByTeam: Record<string, CpuForeignTargetEvaluation[]> = {};

  for (const teamId of input.teamIds) {
    const team = teamById.get(teamId);
    if (!team) continue;
    const usage = getForeignRosterUsage(input.contracts, teamId, input.year);
    if (usage.standard >= 3 && usage.asianQuota >= 1) continue;
    const evaluations = available
      .filter((candidate) => validateForeignRosterSigning(input.contracts, candidate, teamId, input.year).allowed)
      .map((candidate) => evaluateCpuTarget(team, candidate, usage, input.round, input.rng))
      .sort((left, right) => right.score - left.score);
    rankingsByTeam[teamId] = evaluations.slice(0, 8);
    const target = evaluations[0];
    if (target) offers.push(createForeignContractOffer(input.year, input.round, teamId, available.find((candidate) => candidate.id === target.playerId)!, target.proposedTerms));
  }

  return { offers, rankingsByTeam };
}

function evaluateCpuTarget(
  team: Team,
  candidate: ForeignPlayerCandidate,
  usage: ReturnType<typeof getForeignRosterUsage>,
  round: number,
  rng: Rng,
): CpuForeignTargetEvaluation {
  const tools = candidate.pitcherTools ? Object.values(candidate.pitcherTools) : Object.values(candidate.hitterTools ?? {});
  const toolAverage = tools.length > 0 ? tools.reduce((sum, value) => sum + value, 0) / tools.length : 50;
  const performance = recentPerformance(candidate);
  const league = LEAGUE_VALUE[candidate.formerLeague];
  const grade = GRADE_VALUE[candidate.visible.scoutGrade];
  const confidence = candidate.visible.confidence * 100;
  const talentScore = grade * 0.32 + toolAverage * 0.23 + performance * 0.2 + league * 0.15 + confidence * 0.1;
  const needScore = team.positionDepth[candidate.primaryPosition]?.need ?? 45;
  const riskPenalty = { low: 0, medium: 5, high: 12, extreme: 20 }[candidate.visible.riskLevel];
  const salaryCenter = (candidate.visible.expectedSalaryUsd.min + candidate.visible.expectedSalaryUsd.max) / 2;
  const slotCeiling = candidate.slotType === "standard" ? 1_000_000 : 250_000;
  const valueScore = clamp(88 - salaryCenter / slotCeiling * 46, 25, 86);
  const windowFit = teamWindowFit(team, candidate, talentScore, riskPenalty);
  const slotPriority = candidate.slotType === "standard"
    ? usage.standard < 3 ? 8 : -50
    : usage.asianQuota < 1 ? (round >= 3 ? 11 : 4) : -50;
  const signability = preferredConditionFit(team, candidate);
  const randomness = randomFloat(rng, -7, 7 + Math.min(5, round));
  const score = talentScore * 0.42 + needScore * 0.22 + windowFit * 0.13 + valueScore * 0.08 + signability * 0.08 + slotPriority + randomness - riskPenalty;
  const proposedTerms = createCpuOfferTerms(team, candidate, needScore, talentScore, round, rng);
  return {
    teamId: team.id,
    playerId: candidate.id,
    score: roundTo(score, 1),
    needScore: roundTo(needScore, 1),
    talentScore: roundTo(talentScore, 1),
    riskPenalty,
    valueScore: roundTo(valueScore, 1),
    proposedTerms,
  };
}

function recentPerformance(candidate: ForeignPlayerCandidate): number {
  const stats = candidate.recentStats;
  if (stats.kind === "pitcher") {
    return clamp(92 - (stats.era - 2.2) * 11 + (stats.strikeoutsPerNine - 7) * 3.2 - Math.max(0, stats.walksPerNine - 2.5) * 4 + Math.min(8, stats.innings / 22), 35, 96);
  }
  return clamp(42 + (stats.ops - 0.62) * 115 + stats.homeRuns * 0.55 + stats.walkRate * 55 - stats.strikeoutRate * 24, 35, 96);
}

function teamWindowFit(team: Team, candidate: ForeignPlayerCandidate, talent: number, riskPenalty: number): number {
  if (team.teamWindow === "contending") return clamp(talent + candidate.visible.confidence * 15 - riskPenalty * 0.8, 25, 95);
  if (team.teamWindow === "rebuilding") return clamp(88 - Math.max(0, candidate.age - 27) * 4 + candidate.visible.expectedOverallRange.max * 0.12 - riskPenalty * 0.25, 25, 95);
  return clamp(talent * 0.62 + (90 - Math.max(0, candidate.age - 29) * 3) * 0.38 - riskPenalty * 0.45, 25, 95);
}

function preferredConditionFit(team: Team, candidate: ForeignPlayerCandidate): number {
  if (candidate.preferredCondition === "championship") return clamp(team.currentStrength + (team.teamWindow === "contending" ? 18 : 0), 30, 95);
  if (candidate.preferredCondition === "large-market") return ["서울", "잠실", "고척", "인천", "수원"].includes(team.market) ? 88 : 62;
  if (candidate.preferredCondition === "stability") return team.teamWindow === "rebuilding" ? 58 : 78;
  if (candidate.preferredCondition === "guaranteed-role") return team.positionDepth[candidate.primaryPosition]?.need ?? 55;
  return 70;
}

function createCpuOfferTerms(team: Team, candidate: ForeignPlayerCandidate, need: number, talent: number, round: number, rng: Rng): ForeignContractTerms {
  const expected = candidate.visible.expectedSalaryUsd;
  const urgencyPremium = Math.max(0, round - 1) * 0.025 + Math.max(0, need - 65) * 0.002;
  const contentionPremium = team.teamWindow === "contending" ? 0.07 : team.teamWindow === "rebuilding" ? -0.04 : 0;
  const salary = clamp(
    ((expected.min + expected.max) / 2) * (1 + urgencyPremium + contentionPremium + randomFloat(rng, -0.06, 0.08)),
    expected.min * 0.9,
    Math.min(candidate.slotType === "standard" ? 1_000_000 : 250_000, expected.max * 1.18),
  );
  const multiYearChance = candidate.age <= 30 && candidate.visible.riskLevel !== "extreme"
    ? candidate.preferredCondition === "stability" ? 0.34 : 0.14
    : 0.04;
  return {
    years: rng.next() < multiYearChance ? 2 : 1,
    annualSalaryUsd: Math.round(salary / 10_000) * 10_000,
    signingBonusUsd: 0,
    incentivesUsd: Math.round(clamp((talent - 58) * 2200, 0, candidate.slotType === "standard" ? 90_000 : 25_000) / 5_000) * 5_000,
    guaranteedRole: proposedRole(candidate, need, talent),
  };
}

function proposedRole(candidate: ForeignPlayerCandidate, need: number, talent: number): ForeignGuaranteedRole {
  if (candidate.playerGroup === "pitcher") {
    if (candidate.primaryPosition === "SP") return need >= 65 || talent >= 77 ? "starting-pitcher" : "flexible-pitcher";
    if ((candidate.pitcherTools?.mentality ?? 0) >= 76 && talent >= 75) return "closer";
    return need >= 68 ? "bullpen" : "flexible-pitcher";
  }
  if (need >= 62 || talent >= 78) return "everyday-player";
  return talent >= 66 ? "platoon-player" : "bench-player";
}
