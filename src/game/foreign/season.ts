import { effectiveForeignOverall } from "../generation/foreignPlayers";
import { randomFloat, randomInt, type Rng } from "../generation/random";
import { createForeignContract, isForeignContractActive } from "../selectors/foreignContracts";
import type { ForeignContract, ForeignKboSeason, ForeignRetentionEvaluation, ForeignRosterDecision } from "../types/foreignContract";
import type { ForeignPlayerCandidate, ForeignRecentStats } from "../types/foreignPlayer";
import type { SeasonFormCycle } from "../types/player";
import type { Team } from "../types/team";
import { clamp, roundTo } from "../utils/math";

export function simulateForeignContractSeasons(
  contracts: ForeignContract[],
  candidates: ForeignPlayerCandidate[],
  seasonYear: number,
  rng: Rng,
): ForeignContract[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return contracts.map((contract) => {
    if (!isForeignContractActive(contract, seasonYear)) return contract;
    if (contract.seasonHistory?.some((season) => season.seasonYear === seasonYear)) return contract;
    const player = candidateById.get(contract.playerId) ?? contract.playerSnapshot;
    if (!player) return contract;
    const season = simulateForeignSeason(contract, player, seasonYear, rng);
    const evaluation = evaluateForeignRetention(contract, player, season);
    const rolePromise = evaluateRolePromise(contract, season);
    const overseasDeparture = resolveOverseasDeparture(player, season, evaluation, rolePromise.dissatisfaction, rolePromise.status, rng);
    return {
      ...contract,
      playerSnapshot: player,
      seasonHistory: [...(contract.seasonHistory ?? []), season],
      latestRetentionEvaluation: evaluation,
      currentRole: rolePromise.currentRole,
      rolePromiseStatus: rolePromise.status,
      rolePromiseNote: rolePromise.note,
      dissatisfaction: rolePromise.dissatisfaction,
      ...(overseasDeparture ? {
        status: "overseas-departed" as const,
        endedYear: seasonYear,
        exitReason: "overseas-return" as const,
        overseasDestination: overseasDeparture,
      } : {}),
    };
  });
}

export function resolveForeignRosterDecisions(
  contracts: ForeignContract[],
  teams: Team[],
  seasonYear: number,
  rng: Rng,
): { contracts: ForeignContract[]; decisions: ForeignRosterDecision[] } {
  const decisions: ForeignRosterDecision[] = [];
  const renewedContracts: ForeignContract[] = [];
  const nextContracts = contracts.map((contract) => {
    const evaluation = contract.latestRetentionEvaluation;
    const player = contract.playerSnapshot;
    if (!evaluation || evaluation.seasonYear !== seasonYear || !player) return contract;
    if (contract.status === "overseas-departed") {
      decisions.push({
        seasonYear,
        teamId: contract.teamId,
        playerId: contract.playerId,
        playerName: player.name,
        decision: "overseas-departure",
        score: evaluation.score,
        summary: `낮은 생활 적응도에도 좋은 성적을 남겨 ${contract.overseasDestination ?? "해외 리그"} 진출을 선택했습니다.`,
        destination: contract.overseasDestination,
      });
      return contract;
    }

    const team = teams.find((candidate) => candidate.id === contract.teamId);
    const activeRole = activeForeignRole(contract);
    const rosterPosition = activeRole === "closer" || activeRole === "bullpen" ? "RP" : activeRole === "starting-pitcher" ? "SP" : player.primaryPosition;
    const need = team?.positionDepth[rosterPosition]?.need ?? 50;
    const performance = evaluation.performanceScore;
    const dissatisfaction = contract.dissatisfaction ?? 0;

    if (contract.endYear <= seasonYear) {
      const baseChance = evaluation.score >= 76 ? 0.9 : evaluation.score >= 61 ? 0.67 : evaluation.score >= 45 ? 0.24 : 0.03;
      const renewalChance = clamp(baseChance + (need - 50) * 0.0035 - Math.max(0, contract.annualSalaryUsd - 900000) / 9000000 - dissatisfaction * 0.004, 0.01, 0.96);
      const expired = { ...contract, status: "expired" as const, endedYear: seasonYear, exitReason: "contract-complete" as const };
      if (rng.next() < renewalChance) {
        const salaryMultiplier = clamp(0.82 + evaluation.score / 155 + randomFloat(rng, -0.06, 0.07), 0.82, 1.48);
        const years = evaluation.score >= 80 && player.age + (seasonYear - contract.startYear) <= 33 && rng.next() < 0.58 ? 2 : 1;
        const renewed = createForeignContract(player, contract.teamId, seasonYear + 1, {
          years,
          annualSalaryUsd: Math.round(contract.annualSalaryUsd * salaryMultiplier / 10000) * 10000,
          guaranteedRole: contract.currentRole ?? contract.guaranteedRole,
          incentivesUsd: Math.round(contract.incentivesUsd * 1.05),
        }, { previousContractId: contract.id, renewalCount: contract.renewalCount + 1 });
        renewed.seasonHistory = contract.seasonHistory;
        renewed.latestRetentionEvaluation = evaluation;
        renewedContracts.push(renewed);
        decisions.push({
          seasonYear,
          teamId: contract.teamId,
          playerId: contract.playerId,
          playerName: player.name,
          decision: "renewed",
          score: evaluation.score,
          summary: `${foreignDecisionPerformanceSummary(contract)}을 바탕으로 ${years}년 재계약했습니다.`,
          nextContractId: renewed.id,
        });
      } else {
        decisions.push({
          seasonYear,
          teamId: contract.teamId,
          playerId: contract.playerId,
          playerName: player.name,
          decision: "non-renewal",
          score: evaluation.score,
          summary: performance < 50 ? "외국인 선수 기대치에 못 미친 시즌 성적으로 재계약하지 않았습니다." : "성적과 요구 조건, 다음 시즌 보직 구상을 종합해 결별했습니다.",
        });
      }
      return expired;
    }

    const poorSeasons = (contract.seasonHistory ?? []).slice(-2).filter((season) => foreignSeasonBelowExpectation(season.stats, contract)).length;
    const waiverChance = evaluation.score < 30 ? 0.76 : evaluation.score < 38 ? 0.5 : evaluation.score < 45 ? 0.24 : 0;
    const adjustedWaiverChance = clamp(waiverChance + (poorSeasons >= 2 ? 0.13 : 0) - Math.max(0, need - 65) * 0.004, 0, 0.88);
    if (adjustedWaiverChance > 0 && rng.next() < adjustedWaiverChance) {
      decisions.push({
        seasonYear,
        teamId: contract.teamId,
        playerId: contract.playerId,
        playerName: player.name,
        decision: "waived",
        score: evaluation.score,
        summary: "계약 기간이 남았지만 시즌 성적이 외국인 선수 기대선에 미달해 웨이버 공시했습니다.",
      });
      return { ...contract, status: "released" as const, endedYear: seasonYear, exitReason: "performance" as const };
    }
    const roleDowngraded = contract.rolePromiseStatus === "downgraded" && contract.rolePromiseNote?.includes(`${seasonYear}시즌 종료`);
    decisions.push({
      seasonYear,
      teamId: contract.teamId,
      playerId: contract.playerId,
      playerName: player.name,
      decision: roleDowngraded ? "role-downgrade" : "retained",
      score: evaluation.score,
      summary: roleDowngraded
        ? contract.rolePromiseNote ?? "보장 유예기간 종료 후 현재 보직을 재조정했습니다."
        : evaluation.score >= 61 ? "계약 기간과 시즌 성과를 고려해 다음 시즌에도 동행합니다." : "보직 필요도와 잔여 계약을 고려해 일단 잔류시켰습니다.",
    });
    return contract;
  });
  return { contracts: [...nextContracts, ...renewedContracts], decisions };
}

function simulateForeignSeason(contract: ForeignContract, player: ForeignPlayerCandidate, seasonYear: number, rng: Rng): ForeignKboSeason {
  const previous = contract.seasonHistory?.[contract.seasonHistory.length - 1];
  const contractYear = Math.max(0, seasonYear - contract.startYear);
  const age = player.age + contractYear;
  const initialAdaptation = player.hidden.kboAdaptation + randomFloat(rng, -11, 8);
  const adaptationGain = 1.5 + player.hidden.adjustmentSpeed * 0.055 + randomFloat(rng, -3.5, 3.5);
  const actualAdaptation = Math.round(clamp(previous ? previous.actualAdaptation + adaptationGain : initialAdaptation, 8, 100));
  const ageDecline = Math.max(0, age - 32) * (0.45 + player.hidden.declineRisk * 0.9);
  const abilitySwing = randomFloat(rng, -2.8, 2.3) * (0.55 + player.hidden.volatility);
  const adjustedBaseOverall = clamp(player.hidden.baseOverall - ageDecline + abilitySwing, 42, 90);
  const baseEffectiveOverall = effectiveForeignOverall(adjustedBaseOverall, actualAdaptation);
  const formCycle = createForeignSeasonFormCycle(contract, player, actualAdaptation, baseEffectiveOverall, rng);
  const cycleAverage = formCycle.points.reduce((sum, point) => sum + point.value, 0) / formCycle.points.length;
  const effectiveOverall = roundTo(clamp(baseEffectiveOverall + (cycleAverage - 50) * 0.16, 38, 94), 1);
  const lateCycleLow = Math.min(...formCycle.points.filter((point) => point.month >= 7).map((point) => point.value));
  const fatigueInjuryRisk = Math.max(0, 45 - lateCycleLow) * 0.0025;
  const injuryProbability = clamp(player.hidden.injuryRisk * 0.42 + Math.max(0, age - 34) * 0.018 + fatigueInjuryRisk, 0.04, 0.68);
  const injuryDays = rng.next() < injuryProbability ? randomInt(rng, 8, rng.next() < 0.16 ? 120 : 55) : 0;
  const stats = player.playerGroup === "pitcher"
    ? simulatePitcherSeason(contract, player, effectiveOverall, injuryDays, rng)
    : simulateHitterSeason(contract, player, effectiveOverall, injuryDays, rng);
  return { seasonYear, age, actualAdaptation, effectiveOverall, injuryDays, formCycle, stats };
}

function createForeignSeasonFormCycle(
  contract: ForeignContract,
  player: ForeignPlayerCandidate,
  adaptation: number,
  effectiveOverall: number,
  rng: Rng,
): SeasonFormCycle {
  const kind: SeasonFormCycle["kind"] = player.playerGroup === "pitcher" ? "pitcher" : "hitter";
  const stamina = player.playerGroup === "pitcher"
    ? player.pitcherTools?.stamina ?? 50
    : (player.hitterTools?.mentality ?? 50) * 0.58 + (player.hitterTools?.speed ?? 50) * 0.22 + player.hidden.adjustmentSpeed * 0.2;
  const volatility = clamp(player.hidden.volatility, 0.05, 1);
  const firstSeason = (contract.seasonHistory?.length ?? 0) === 0;
  const pattern = pickForeignCyclePattern(stamina, volatility, adaptation, firstSeason, rng);
  const base = clamp(48 + (effectiveOverall - 65) * 0.18 + (adaptation - 55) * 0.045 + randomFloat(rng, -3.5, 3.5), 37, 67);
  const shapes: Record<SeasonFormCycle["pattern"], number[]> = {
    steady: [0, 1, 1, 0, -1, 0, 1, 0],
    "early-peak": [7, 8, 5, 1, -2, -4, -2, -1],
    "summer-slump": [2, 4, 3, -1, -8, -10, -4, 0],
    "late-surge": [-4, -2, 0, 2, 3, 5, 8, 9],
    volatile: [6, -5, 7, -6, 4, -7, 6, -2],
    "stamina-fade": [4, 5, 3, 1, -3, -7, -10, -12],
    rebound: [-7, -6, -3, 0, 3, 5, 7, 6],
  };
  const months = [3, 4, 5, 6, 7, 8, 9, 10] as const;
  const adaptationShape = firstSeason && adaptation < 50 ? [-4, -3, -2, 0, 1, 2, 3, 3] : [0, 0, 0, 0, 0, 0, 0, 0];
  const staminaShape = stamina < 47 ? [1, 1, 0, 0, -2, -4, -6, -7] : stamina >= 68 ? [0, 0, 0, 0, 1, 2, 3, 3] : [0, 0, 0, 0, 0, 0, 0, 0];
  const points = months.map((month, index) => ({
    month,
    value: Math.round(clamp(base + shapes[pattern][index] + adaptationShape[index] + staminaShape[index] + randomFloat(rng, -2 - volatility * 4, 2 + volatility * 4), 25, 85)),
  }));
  const strongest = [...points].sort((left, right) => right.value - left.value)[0];
  const weakest = [...points].sort((left, right) => left.value - right.value)[0];
  const staminaSignal = Math.round(clamp(stamina + (pattern === "stamina-fade" ? -12 : pattern === "late-surge" ? 7 : 0), 20, 95));
  const clutchSignal = Math.round(clamp(48 + (points[6].value + points[7].value - points[0].value - points[1].value) * 0.55 + (player.hitterTools?.mentality ?? player.pitcherTools?.mentality ?? 50) * 0.18 + randomFloat(rng, -7, 7), 20, 92));
  return {
    kind,
    pattern,
    points,
    reliability: roundTo(clamp(0.58 + (contract.seasonHistory?.length ?? 0) * 0.08, 0.58, 0.9), 2),
    staminaSignal,
    clutchSignal,
    report: `${firstSeason ? "KBO 첫 시즌 적응 변수를 포함한" : "최근 KBO 기록과 체력 흐름을 반영한"} ${kind === "pitcher" ? "투구" : "타격"} 사이클입니다. ${strongest.month}월 흐름이 가장 좋았고 ${weakest.month}월에 가장 크게 흔들렸습니다.`,
  };
}

function pickForeignCyclePattern(stamina: number, volatility: number, adaptation: number, firstSeason: boolean, rng: Rng): SeasonFormCycle["pattern"] {
  const weighted: Array<{ value: SeasonFormCycle["pattern"]; weight: number }> = [
    { value: "steady", weight: 22 + Math.max(0, stamina - 58) * 0.35 + Math.max(0, adaptation - 65) * 0.2 },
    { value: "early-peak", weight: 11 },
    { value: "summer-slump", weight: 13 + Math.max(0, 52 - stamina) * 0.45 },
    { value: "late-surge", weight: 11 + Math.max(0, adaptation - 60) * 0.25 },
    { value: "volatile", weight: 7 + volatility * 27 + (firstSeason && adaptation < 50 ? 7 : 0) },
    { value: "stamina-fade", weight: 8 + Math.max(0, 52 - stamina) * 0.7 },
    { value: "rebound", weight: 9 + (firstSeason && adaptation < 58 ? 8 : 0) },
  ];
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.next() * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) return entry.value;
  }
  return "steady";
}

function simulatePitcherSeason(contract: ForeignContract, player: ForeignPlayerCandidate, overall: number, injuryDays: number, rng: Rng): ForeignRecentStats {
  const role = activeForeignRole(contract);
  const starter = role === "starting-pitcher" || (role === "flexible-pitcher" && player.primaryPosition === "SP");
  const availability = clamp(1 - injuryDays / 170, 0.25, 1);
  const games = starter ? Math.round(randomFloat(rng, 25, 31) * availability) : Math.round(randomFloat(rng, 46, 68) * availability);
  const innings = roundTo((starter ? randomFloat(rng, 5.25, 6.15) : randomFloat(rng, 0.92, 1.18)) * games, 1);
  const command = player.pitcherTools?.command ?? overall;
  const stuff = player.pitcherTools?.stuff ?? overall;
  const era = roundTo(clamp(6.15 - (overall - 48) * 0.082 - (command - 60) * 0.012 + randomFloat(rng, -0.62, 0.72), 1.55, 7.8), 2);
  const strikeoutsPerNine = roundTo(clamp(5.3 + (stuff - 50) * 0.075 + randomFloat(rng, -0.75, 0.75), 3.5, 13.2), 1);
  const walksPerNine = roundTo(clamp(5.0 - (command - 45) * 0.055 + randomFloat(rng, -0.45, 0.5), 1.1, 6.8), 1);
  const whip = roundTo(clamp(0.74 + era * 0.13 + walksPerNine * 0.055 + randomFloat(rng, -0.08, 0.08), 0.82, 1.85), 2);
  const decisions = Math.max(1, Math.round(innings / (starter ? 9.5 : 20)));
  const winShare = clamp(0.68 - (era - 2.5) * 0.09, 0.25, 0.78);
  const wins = starter ? Math.round(decisions * winShare) : randomInt(rng, 1, Math.max(1, Math.round(games / 13)));
  const losses = starter ? Math.max(0, decisions - wins) : randomInt(rng, 0, Math.max(1, Math.round(games / 18)));
  const closer = role === "closer";
  const walks = Math.round(innings * walksPerNine / 9);
  const strikeouts = Math.round(innings * strikeoutsPerNine / 9);
  const hitsAllowed = Math.max(0, Math.round(whip * innings - walks));
  const earnedRuns = Math.round(innings * era / 9);
  const homeRunsAllowed = Math.round(innings * clamp(1.65 - stuff * 0.01, 0.35, 1.6) / 9);
  const war = roundTo(clamp(innings * ((4.65 - era) / 4.4) / 28 + (strikeoutsPerNine - walksPerNine - 3.2) * innings / 520, -2.5, 10), 1);
  return {
    kind: "pitcher",
    games,
    gamesStarted: starter ? games : 0,
    innings,
    wins,
    losses,
    saves: closer ? Math.round(clamp((41 - era * 3.2 + randomFloat(rng, -5, 6)) * availability, 0, 45)) : 0,
    holds: !starter && !closer ? Math.round(clamp((27 - era * 2 + randomFloat(rng, -5, 7)) * availability, 0, 34)) : 0,
    strikeouts,
    walks,
    hitsAllowed,
    homeRunsAllowed,
    earnedRuns,
    war,
    era,
    whip,
    strikeoutsPerNine,
    walksPerNine,
    averageVelocityKph: roundTo(140 + (player.pitcherTools?.velocity ?? 60) * 0.14, 1),
    maxVelocityKph: roundTo(145 + (player.pitcherTools?.velocity ?? 60) * 0.15, 1),
  };
}

function simulateHitterSeason(contract: ForeignContract, player: ForeignPlayerCandidate, overall: number, injuryDays: number, rng: Rng): ForeignRecentStats {
  const availability = clamp(1 - injuryDays / 170, 0.2, 1);
  const role = activeForeignRole(contract);
  const roleRate = role === "everyday-player" ? 1 : role === "platoon-player" ? 0.68 : 0.42;
  const games = Math.round(randomFloat(rng, 132, 144) * availability * roleRate);
  const plateAppearances = Math.max(20, Math.round(games * randomFloat(rng, 3.65, 4.35)));
  const discipline = player.hitterTools?.discipline ?? overall;
  const contact = player.hitterTools?.contact ?? overall;
  const power = player.hitterTools?.power ?? overall;
  const walkRate = clamp(0.045 + discipline * 0.00075 + randomFloat(rng, -0.012, 0.014), 0.035, 0.145);
  const strikeoutRate = clamp(0.29 - contact * 0.00145 + randomFloat(rng, -0.018, 0.022), 0.09, 0.32);
  const atBats = Math.max(1, Math.round(plateAppearances * (1 - walkRate - 0.025)));
  const average = roundTo(clamp(0.212 + (overall - 48) * 0.0032 + (contact - 60) * 0.00065 + randomFloat(rng, -0.022, 0.024), 0.185, 0.37), 3);
  const hits = Math.round(atBats * average);
  const homeRunRate = clamp(0.006 + (power - 45) * 0.00105 + (overall - 55) * 0.00028 + randomFloat(rng, -0.006, 0.007), 0.002, 0.085);
  const homeRuns = Math.round(plateAppearances * homeRunRate);
  const doubles = Math.round(plateAppearances * clamp(0.025 + (overall - 50) * 0.00055, 0.02, 0.055));
  const triples = Math.round(plateAppearances * clamp((player.hitterTools?.speed ?? 50) * 0.000055, 0.001, 0.007));
  const onBasePercentage = roundTo(clamp(average + walkRate * 0.72 + 0.012, average + 0.025, 0.47), 3);
  const sluggingPercentage = roundTo(clamp(average + doubles / atBats + triples * 2 / atBats + homeRuns * 3 / atBats, 0.27, 0.72), 3);
  const walks = Math.round(plateAppearances * walkRate);
  const strikeouts = Math.round(plateAppearances * strikeoutRate);
  const stolenBases = Math.round(plateAppearances * clamp((player.hitterTools?.speed ?? 45) * 0.00028 - 0.008, 0, 0.025));
  const caughtStealing = Math.round(stolenBases * clamp(0.42 - (player.hitterTools?.speed ?? 45) * 0.003, 0.12, 0.34));
  const runs = Math.round((hits + walks) * clamp(0.22 + (player.hitterTools?.speed ?? 45) * 0.003, 0.28, 0.52));
  const fieldingValue = roundTo(((player.hitterTools?.defense ?? 50) - 50) * games / 720 + randomFloat(rng, -1.8, 1.8), 1);
  const war = roundTo(clamp((onBasePercentage + sluggingPercentage - 0.71) * plateAppearances / 32 + fieldingValue * 0.12 + (stolenBases - caughtStealing * 1.6) * 0.025, -2.5, 9.5), 1);
  return {
    kind: "hitter",
    games,
    plateAppearances,
    atBats,
    runs,
    hits,
    doubles,
    triples,
    runsBattedIn: Math.round(homeRuns * 1.75 + hits * 0.23 + randomFloat(rng, 0, 12)),
    walks,
    strikeouts,
    average,
    onBasePercentage,
    sluggingPercentage,
    ops: roundTo(onBasePercentage + sluggingPercentage, 3),
    homeRuns,
    strikeoutRate: roundTo(strikeoutRate, 3),
    walkRate: roundTo(walkRate, 3),
    stolenBases,
    caughtStealing,
    fieldingValue,
    war,
  };
}

function evaluateForeignRetention(contract: ForeignContract, player: ForeignPlayerCandidate, season: ForeignKboSeason): ForeignRetentionEvaluation {
  const stats = season.stats;
  const reasons: string[] = [];
  let performanceScore: number;
  if (stats.kind === "hitter") {
    const averageScore = clamp(50 + (stats.average - 0.28) * 900, 10, 100);
    const opsScore = clamp(50 + (stats.ops - 0.78) * 180, 10, 100);
    const playingTimeScore = clamp(stats.plateAppearances / 5.2, 10, 100);
    performanceScore = averageScore * 0.48 + opsScore * 0.38 + playingTimeScore * 0.14;
    if (stats.average >= 0.3) { performanceScore += 10; reasons.push("3할 타율 충족"); }
    else if (stats.average < 0.27) { performanceScore -= 11; reasons.push("외국인 타자 기대 타율 미달"); }
    if (stats.ops >= 0.86) reasons.push("중심 타선 생산력 확인");
    else if (stats.ops < 0.75) reasons.push("장타·출루 생산성 부족");
  } else {
    const role = activeForeignRole(contract);
    const starter = role === "starting-pitcher" || role === "flexible-pitcher";
    const eraTarget = starter ? 3.55 : 3.75;
    const eraScore = clamp(62 - (stats.era - eraTarget) * 28, 5, 100);
    const workloadTarget = starter ? 155 : 58;
    const workloadScore = clamp(stats.innings / workloadTarget * 100, 10, 100);
    const commandScore = clamp(76 - (stats.walksPerNine - 2.5) * 18, 10, 100);
    performanceScore = eraScore * 0.62 + workloadScore * 0.25 + commandScore * 0.13;
    if (stats.era <= eraTarget) { performanceScore += 10; reasons.push(`${eraTarget.toFixed(2)} 이하 ERA 충족`); }
    else if (stats.era >= eraTarget + 0.85) { performanceScore -= 12; reasons.push("외국인 투수 기대 ERA 미달"); }
    if (stats.innings >= workloadTarget) reasons.push(starter ? "선발 로테이션 이닝 충족" : "불펜 가동률 충족");
  }
  performanceScore = clamp(performanceScore, 0, 100);
  const availabilityScore = clamp(100 - season.injuryDays * 0.85, 10, 100);
  const adaptationScore = season.actualAdaptation;
  const salaryExpectation = clamp((contract.annualSalaryUsd - 250000) / 12000, 0, 55);
  const salaryValueScore = clamp(performanceScore + 18 - salaryExpectation, 10, 100);
  const ageScore = clamp(92 - Math.max(0, season.age - 30) * 7, 25, 92);
  const score = Math.round(clamp(performanceScore * 0.7 + availabilityScore * 0.12 + adaptationScore * 0.08 + salaryValueScore * 0.07 + ageScore * 0.03, 0, 100));
  if (season.injuryDays >= 50) reasons.push("장기 이탈로 가용성 저하");
  if (season.actualAdaptation < 42) reasons.push("리그 적응 지연");
  if (season.effectiveOverall < player.hidden.baseOverall - 6) reasons.push("기량 활용도 하락");
  const overseasReturnProbability = performanceScore >= 68 && season.actualAdaptation < 58
    ? roundTo(clamp(0.04 + (58 - season.actualAdaptation) * 0.009 + (performanceScore - 68) * 0.006, 0.04, 0.42), 3)
    : 0;
  if (overseasReturnProbability >= 0.12) reasons.push("낮은 생활 적응도와 해외 복귀 가능성");
  const recommendation = score >= 76 ? "priority-renewal" : score >= 61 ? "renewal" : score >= 45 ? "review" : "release-candidate";
  return { seasonYear: season.seasonYear, score, performanceScore: Math.round(performanceScore), recommendation, reasons: reasons.slice(0, 4), overseasReturnProbability };
}

function foreignSeasonBelowExpectation(stats: ForeignRecentStats, contract: ForeignContract): boolean {
  if (stats.kind === "hitter") return stats.average < 0.27 || stats.ops < 0.75;
  const role = activeForeignRole(contract);
  const starter = role === "starting-pitcher" || role === "flexible-pitcher";
  return stats.era > (starter ? 4.4 : 4.6) || stats.whip > 1.5;
}

function activeForeignRole(contract: ForeignContract) {
  return contract.currentRole ?? contract.guaranteedRole;
}

function evaluateRolePromise(contract: ForeignContract, season: ForeignKboSeason): {
  status: NonNullable<ForeignContract["rolePromiseStatus"]>;
  currentRole: ForeignContract["guaranteedRole"];
  dissatisfaction: number;
  note: string;
} {
  const role = activeForeignRole(contract);
  const protectedRole = contract.guaranteedRole === "starting-pitcher" || contract.guaranteedRole === "closer" || contract.guaranteedRole === "everyday-player";
  if (!protectedRole) {
    return { status: contract.rolePromiseStatus ?? "fulfilled", currentRole: role, dissatisfaction: Math.max(0, (contract.dissatisfaction ?? 0) - 4), note: contract.rolePromiseNote ?? "보직 경쟁 계약" };
  }
  if (contract.rolePromiseStatus === "violated") {
    return { status: "violated", currentRole: role, dissatisfaction: Math.min(100, (contract.dissatisfaction ?? 0) + 18), note: "구단이 보장 유예기간 중 약속한 보직을 지키지 않아 선수 측 불만이 커졌습니다." };
  }
  const poor = foreignSeasonBelowExpectation(season.stats, contract);
  const graceComplete = season.seasonYear >= (contract.rolePromiseGraceUntilYear ?? contract.startYear);
  if (graceComplete && poor) {
    const currentRole = contract.guaranteedRole === "everyday-player" ? "platoon-player"
      : contract.guaranteedRole === "closer" ? "bullpen"
        : "flexible-pitcher";
    return {
      status: "downgraded",
      currentRole,
      dissatisfaction: Math.min(100, (contract.dissatisfaction ?? 0) + 16),
      note: `${season.seasonYear}시즌 종료 · 보장 기회를 부여했으나 기대 성적에 미달해 ${rolePromiseDowngradeLabel(currentRole)}으로 재조정`,
    };
  }
  return {
    status: "fulfilled",
    currentRole: contract.guaranteedRole,
    dissatisfaction: Math.max(0, (contract.dissatisfaction ?? 0) - 8),
    note: `${season.seasonYear}시즌 보장 보직 이행 완료`,
  };
}

function rolePromiseDowngradeLabel(role: ForeignContract["guaranteedRole"]): string {
  if (role === "platoon-player") return "플래툰";
  if (role === "flexible-pitcher") return "스윙맨";
  if (role === "bullpen") return "불펜";
  return "경쟁 보직";
}

function foreignDecisionPerformanceSummary(contract: ForeignContract): string {
  const history = contract.seasonHistory ?? [];
  const season = history[history.length - 1];
  if (!season) return "시즌 평가";
  const stats = season.stats;
  if (stats.kind === "hitter") return `타율 ${stats.average.toFixed(3)}, OPS ${stats.ops.toFixed(3)}`;
  return `ERA ${stats.era.toFixed(2)}, ${stats.innings.toFixed(1)}이닝`;
}

function resolveOverseasDeparture(
  player: ForeignPlayerCandidate,
  season: ForeignKboSeason,
  evaluation: ForeignRetentionEvaluation,
  dissatisfaction: number,
  promiseStatus: ForeignContract["rolePromiseStatus"],
  rng: Rng,
): "MLB" | "AAA" | "NPB" | undefined {
  const grievanceExitChance = evaluation.performanceScore >= 60
    ? dissatisfaction * 0.0025 + (promiseStatus === "violated" ? 0.12 : 0)
    : 0;
  const probability = clamp((evaluation.overseasReturnProbability ?? 0) + grievanceExitChance, 0, 0.68);
  if (probability <= 0 || rng.next() >= probability) return undefined;
  if (evaluation.performanceScore >= 90 && season.effectiveOverall >= 78 && rng.next() < 0.58) return "MLB";
  const npbAffinity = player.nationality === "Japan" || ["NPB", "NPB Futures", "Japanese Industrial"].includes(player.formerLeague);
  if (npbAffinity ? rng.next() < 0.72 : rng.next() < 0.3) return "NPB";
  return "AAA";
}
