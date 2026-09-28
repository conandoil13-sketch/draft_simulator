import { effectiveForeignOverall } from "../generation/foreignPlayers";
import { randomFloat, randomInt, type Rng } from "../generation/random";
import { createForeignContract, isForeignContractActive } from "../selectors/foreignContracts";
import type { ForeignContract, ForeignKboSeason, ForeignRetentionEvaluation, ForeignRosterDecision } from "../types/foreignContract";
import type { ForeignPlayerCandidate, ForeignRecentStats } from "../types/foreignPlayer";
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
    const overseasDeparture = resolveOverseasDeparture(player, season, evaluation, rng);
    return {
      ...contract,
      playerSnapshot: player,
      seasonHistory: [...(contract.seasonHistory ?? []), season],
      latestRetentionEvaluation: evaluation,
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
    const rosterPosition = contract.guaranteedRole === "closer" || contract.guaranteedRole === "bullpen" ? "RP" : contract.guaranteedRole === "starting-pitcher" ? "SP" : player.primaryPosition;
    const need = team?.positionDepth[rosterPosition]?.need ?? 50;
    const performance = evaluation.performanceScore;

    if (contract.endYear <= seasonYear) {
      const baseChance = evaluation.score >= 76 ? 0.9 : evaluation.score >= 61 ? 0.67 : evaluation.score >= 45 ? 0.24 : 0.03;
      const renewalChance = clamp(baseChance + (need - 50) * 0.0035 - Math.max(0, contract.annualSalaryUsd - 900000) / 9000000, 0.01, 0.96);
      const expired = { ...contract, status: "expired" as const, endedYear: seasonYear, exitReason: "contract-complete" as const };
      if (rng.next() < renewalChance) {
        const salaryMultiplier = clamp(0.82 + evaluation.score / 155 + randomFloat(rng, -0.06, 0.07), 0.82, 1.48);
        const years = evaluation.score >= 80 && player.age + (seasonYear - contract.startYear) <= 33 && rng.next() < 0.58 ? 2 : 1;
        const renewed = createForeignContract(player, contract.teamId, seasonYear + 1, {
          years,
          annualSalaryUsd: Math.round(contract.annualSalaryUsd * salaryMultiplier / 10000) * 10000,
          guaranteedRole: contract.guaranteedRole,
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
    decisions.push({
      seasonYear,
      teamId: contract.teamId,
      playerId: contract.playerId,
      playerName: player.name,
      decision: "retained",
      score: evaluation.score,
      summary: evaluation.score >= 61 ? "계약 기간과 시즌 성과를 고려해 다음 시즌에도 동행합니다." : "보직 필요도와 잔여 계약을 고려해 일단 잔류시켰습니다.",
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
  const effectiveOverall = roundTo(effectiveForeignOverall(adjustedBaseOverall, actualAdaptation), 1);
  const injuryProbability = clamp(player.hidden.injuryRisk * 0.42 + Math.max(0, age - 34) * 0.018, 0.04, 0.62);
  const injuryDays = rng.next() < injuryProbability ? randomInt(rng, 8, rng.next() < 0.16 ? 120 : 55) : 0;
  const stats = player.playerGroup === "pitcher"
    ? simulatePitcherSeason(contract, player, effectiveOverall, injuryDays, rng)
    : simulateHitterSeason(contract, player, effectiveOverall, injuryDays, rng);
  return { seasonYear, age, actualAdaptation, effectiveOverall, injuryDays, stats };
}

function simulatePitcherSeason(contract: ForeignContract, player: ForeignPlayerCandidate, overall: number, injuryDays: number, rng: Rng): ForeignRecentStats {
  const starter = contract.guaranteedRole === "starting-pitcher" || (contract.guaranteedRole === "flexible-pitcher" && player.primaryPosition === "SP");
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
  const closer = contract.guaranteedRole === "closer";
  return {
    kind: "pitcher",
    games,
    innings,
    wins,
    losses,
    saves: closer ? Math.round(clamp((41 - era * 3.2 + randomFloat(rng, -5, 6)) * availability, 0, 45)) : 0,
    holds: !starter && !closer ? Math.round(clamp((27 - era * 2 + randomFloat(rng, -5, 7)) * availability, 0, 34)) : 0,
    strikeouts: Math.round(innings * strikeoutsPerNine / 9),
    walks: Math.round(innings * walksPerNine / 9),
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
  const roleRate = contract.guaranteedRole === "everyday-player" ? 1 : contract.guaranteedRole === "platoon-player" ? 0.68 : 0.42;
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
  return {
    kind: "hitter",
    games,
    plateAppearances,
    atBats,
    hits,
    doubles,
    triples,
    runsBattedIn: Math.round(homeRuns * 1.75 + hits * 0.23 + randomFloat(rng, 0, 12)),
    average,
    onBasePercentage,
    sluggingPercentage,
    ops: roundTo(onBasePercentage + sluggingPercentage, 3),
    homeRuns,
    strikeoutRate: roundTo(strikeoutRate, 3),
    walkRate: roundTo(walkRate, 3),
    stolenBases: Math.round(plateAppearances * clamp((player.hitterTools?.speed ?? 45) * 0.00028 - 0.008, 0, 0.025)),
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
    const starter = contract.guaranteedRole === "starting-pitcher" || contract.guaranteedRole === "flexible-pitcher";
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
  const starter = contract.guaranteedRole === "starting-pitcher" || contract.guaranteedRole === "flexible-pitcher";
  return stats.era > (starter ? 4.4 : 4.6) || stats.whip > 1.5;
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
  rng: Rng,
): "MLB" | "AAA" | "NPB" | undefined {
  const probability = evaluation.overseasReturnProbability ?? 0;
  if (probability <= 0 || rng.next() >= probability) return undefined;
  if (evaluation.performanceScore >= 90 && season.effectiveOverall >= 78 && rng.next() < 0.58) return "MLB";
  const npbAffinity = player.nationality === "Japan" || ["NPB", "NPB Futures", "Japanese Industrial"].includes(player.formerLeague);
  if (npbAffinity ? rng.next() < 0.72 : rng.next() < 0.3) return "NPB";
  return "AAA";
}
