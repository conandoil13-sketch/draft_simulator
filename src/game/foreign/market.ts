import { createForeignCareerSeason, generateForeignPlayerMarket } from "../generation/foreignPlayers";
import { randomFloat, type Rng } from "../generation/random";
import { isForeignContractActive } from "../selectors/foreignContracts";
import type { ForeignContract } from "../types/foreignContract";
import type { ForeignPlayerCandidate, ForeignPlayerSlot } from "../types/foreignPlayer";
import { clamp, roundTo } from "../utils/math";

const MARKET_TARGETS: Record<ForeignPlayerSlot, number> = {
  standard: 80,
  "asian-quota": 30,
};

export function rolloverForeignPlayerMarket(
  previousMarket: ForeignPlayerCandidate[],
  contracts: ForeignContract[],
  year: number,
  rng: Rng,
): ForeignPlayerCandidate[] {
  if (previousMarket.length === 0) return generateForeignPlayerMarket(rng, year);

  const activePlayerIds = new Set(contracts.filter((contract) => isForeignContractActive(contract, year)).map((contract) => contract.playerId));
  const waiverPlayers = contracts
    .filter((contract) => contract.status === "released" && contract.endedYear === year - 1 && contract.playerSnapshot)
    .map((contract) => contract.playerSnapshot!)
    .filter((player, index, values) => values.findIndex((candidate) => candidate.id === player.id) === index)
    .map((player) => carryCandidate(player, year, "waiver", rng, year, false));
  const waiverIds = new Set(waiverPlayers.map((player) => player.id));

  const eligibleHoldovers = previousMarket
    .filter((player) => player.status === "available")
    .filter((player) => !activePlayerIds.has(player.id) && !waiverIds.has(player.id))
    .filter((player) => !player.waiverMarketUntilYear || player.waiverMarketUntilYear >= year);
  const topCount = Math.ceil(eligibleHoldovers.length * 0.1);
  const randomCount = Math.ceil(eligibleHoldovers.length * 0.1);
  const topPlayers = [...eligibleHoldovers]
    .sort((left, right) => marketRetentionScore(right) - marketRetentionScore(left) || left.name.localeCompare(right.name))
    .slice(0, topCount);
  const topIds = new Set(topPlayers.map((player) => player.id));
  const randomPlayers = eligibleHoldovers
    .filter((player) => !topIds.has(player.id))
    .map((player) => ({ player, roll: rng.next() }))
    .sort((left, right) => left.roll - right.roll)
    .slice(0, randomCount)
    .map(({ player }) => player);

  const retained = dedupeCandidates([
    ...waiverPlayers,
    ...topPlayers.map((player) => carryCandidate(player, year, "top", rng)),
    ...randomPlayers.map((player) => carryCandidate(player, year, "random", rng)),
  ]).filter((player) => retainedWithinSlotLimit(player, waiverPlayers, topPlayers, randomPlayers));
  const standardNeeded = Math.max(0, MARKET_TARGETS.standard - retained.filter((player) => player.slotType === "standard").length);
  const asianNeeded = Math.max(0, MARKET_TARGETS["asian-quota"] - retained.filter((player) => player.slotType === "asian-quota").length);
  const newcomers = generateForeignPlayerMarket(rng, year, standardNeeded, asianNeeded);
  return [...retained, ...newcomers];
}

function carryCandidate(
  player: ForeignPlayerCandidate,
  year: number,
  source: "waiver" | "top" | "random",
  rng: Rng,
  waiverUntilYear?: number,
  addSeasonRecord = true,
): ForeignPlayerCandidate {
  const yearDelta = Math.max(0, year - player.marketYear);
  let advancedPlayer = player;
  if (addSeasonRecord) {
    for (let index = 0; index < yearDelta; index += 1) {
      advancedPlayer = advanceRetainedCandidateOneYear(advancedPlayer, rng);
    }
  }
  return {
    ...advancedPlayer,
    marketYear: year,
    age: addSeasonRecord ? advancedPlayer.age : player.age + yearDelta,
    status: "available",
    marketCarryover: { source, sinceYear: player.marketCarryover?.sinceYear ?? year },
    waiverMarketUntilYear: source === "waiver" ? waiverUntilYear : player.waiverMarketUntilYear,
    visible: source === "waiver" ? {
      ...player.visible,
      expectedSalaryUsd: {
        min: Math.round(player.visible.expectedSalaryUsd.min * 0.78 / 10000) * 10000,
        max: Math.round(player.visible.expectedSalaryUsd.max * 0.9 / 10000) * 10000,
      },
      summary: `직전 KBO 구단에서 웨이버 공시된 뒤 재도전에 나섰다. ${player.visible.summary}`,
    } : player.visible,
  };
}

function advanceRetainedCandidateOneYear(player: ForeignPlayerCandidate, rng: Rng): ForeignPlayerCandidate {
  const season = createForeignCareerSeason(rng, player, player.marketYear);
  const performance = retainedSeasonPerformance(season.stats);
  const ageTrend = player.age <= 27 ? 0.75 : player.age <= 31 ? 0.15 : player.age <= 34 ? -0.7 : -1.55;
  const volatilitySwing = randomFloat(rng, -2.15, 1.95) * (0.55 + player.hidden.volatility);
  const abilityDelta = roundTo(clamp(ageTrend + volatilitySwing + performance * 0.28, -4.2, 3.6), 1);
  const nextBaseOverall = Math.round(clamp(player.hidden.baseOverall + abilityDelta, 44, 90));
  const nextPitcherTools = player.pitcherTools ? Object.fromEntries(
    Object.entries(player.pitcherTools).map(([key, value]) => [key, Math.round(clamp(value + abilityDelta * 0.72 + randomFloat(rng, -1.8, 1.8), 25, 95))]),
  ) as ForeignPlayerCandidate["pitcherTools"] : undefined;
  const nextHitterTools = player.hitterTools ? Object.fromEntries(
    Object.entries(player.hitterTools).map(([key, value]) => [key, Math.round(clamp(value + abilityDelta * 0.72 + randomFloat(rng, -1.8, 1.8), 25, 95))]),
  ) as ForeignPlayerCandidate["hitterTools"] : undefined;
  const publicShift = Math.round(abilityDelta * 0.65 + performance * 0.72 + randomFloat(rng, -1.2, 1.2));
  const salaryFactor = clamp(1 + performance * 0.055 + abilityDelta * 0.022, 0.78, 1.28);
  return {
    ...player,
    marketYear: player.marketYear + 1,
    age: player.age + 1,
    recentStats: season.stats,
    careerHistory: [...player.careerHistory, season].slice(-5),
    pitcherTools: nextPitcherTools,
    hitterTools: nextHitterTools,
    hidden: {
      ...player.hidden,
      baseOverall: nextBaseOverall,
      injuryRisk: roundTo(clamp(player.hidden.injuryRisk + (player.age >= 32 ? randomFloat(rng, 0.005, 0.035) : randomFloat(rng, -0.015, 0.015)), 0.06, 0.96), 2),
      declineRisk: roundTo(clamp(player.hidden.declineRisk + (player.age >= 32 ? 0.035 : randomFloat(rng, -0.02, 0.015)), 0.05, 0.96), 2),
    },
    visible: {
      ...player.visible,
      confidence: roundTo(clamp(player.visible.confidence + 0.015, 0.45, 0.96), 2),
      expectedOverallRange: {
        min: Math.round(clamp(player.visible.expectedOverallRange.min + publicShift, 42, 90)),
        max: Math.round(clamp(player.visible.expectedOverallRange.max + publicShift, 45, 92)),
      },
      expectedSalaryUsd: {
        min: Math.round(player.visible.expectedSalaryUsd.min * salaryFactor / 10000) * 10000,
        max: Math.round(player.visible.expectedSalaryUsd.max * salaryFactor / 10000) * 10000,
      },
    },
  };
}

function retainedSeasonPerformance(stats: ForeignPlayerCandidate["recentStats"]): number {
  if (stats.kind === "pitcher") {
    return clamp((4.15 - stats.era) * 0.72 + (stats.strikeoutsPerNine - 7.2) * 0.12 - Math.max(0, stats.walksPerNine - 3.4) * 0.18, -2.2, 2.2);
  }
  return clamp((stats.ops - 0.76) * 5.2 + (stats.average - 0.27) * 3.5 + (stats.homeRuns - 15) * 0.018, -2.2, 2.2);
}

function marketRetentionScore(player: ForeignPlayerCandidate): number {
  const estimatedOverall = (player.visible.expectedOverallRange.min + player.visible.expectedOverallRange.max) / 2;
  const adaptation = (player.visible.expectedAdaptationRange.min + player.visible.expectedAdaptationRange.max) / 2;
  const riskPenalty = { low: 0, medium: 3, high: 7, extreme: 12 }[player.visible.riskLevel];
  return estimatedOverall * 0.72 + adaptation * 0.28 - riskPenalty;
}

function dedupeCandidates(players: ForeignPlayerCandidate[]): ForeignPlayerCandidate[] {
  const seen = new Set<string>();
  return players.filter((player) => {
    if (seen.has(player.id)) return false;
    seen.add(player.id);
    return true;
  });
}

function retainedWithinSlotLimit(
  player: ForeignPlayerCandidate,
  waiverPlayers: ForeignPlayerCandidate[],
  topPlayers: ForeignPlayerCandidate[],
  randomPlayers: ForeignPlayerCandidate[],
): boolean {
  const ordered = dedupeCandidates([...waiverPlayers, ...topPlayers, ...randomPlayers]);
  const sameSlotBefore = ordered.findIndex((candidate) => candidate.id === player.id) >= 0
    ? ordered.slice(0, ordered.findIndex((candidate) => candidate.id === player.id) + 1).filter((candidate) => candidate.slotType === player.slotType).length
    : 0;
  return sameSlotBefore <= MARKET_TARGETS[player.slotType];
}
