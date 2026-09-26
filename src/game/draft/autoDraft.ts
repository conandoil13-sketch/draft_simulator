import type { Prospect } from "../types/player";
import type { Team } from "../types/team";

export type CpuPickContext = {
  previousPick?: Prospect;
};

export type CpuPickResult = {
  prospect: Prospect;
  isPanicPick: boolean;
};

export function chooseCpuPick(team: Team, availableProspects: Prospect[], pickNumber: number, teamDraftedProspects: Prospect[] = [], context: CpuPickContext = {}): Prospect {
  return chooseCpuPickWithContext(team, availableProspects, pickNumber, teamDraftedProspects, context).prospect;
}

export function chooseCpuPickWithContext(team: Team, availableProspects: Prospect[], pickNumber: number, teamDraftedProspects: Prospect[] = [], context: CpuPickContext = {}): CpuPickResult {
  const ranked = [...availableProspects].sort((a, b) => scoreProspectForTeam(b, team, pickNumber, teamDraftedProspects) - scoreProspectForTeam(a, team, pickNumber, teamDraftedProspects));
  if (!context.previousPick || ranked.length === 0) return { prospect: ranked[0], isPanicPick: false };
  const previousPick = context.previousPick;

  const panicProfile = shouldPanicPick(team, availableProspects, pickNumber, teamDraftedProspects, previousPick);
  if (!panicProfile.triggered) return { prospect: ranked[0], isPanicPick: false };

  const panicCandidates = availableProspects.filter((prospect) => isPanicCandidate(prospect, team, pickNumber, previousPick, panicProfile.topNeedPosition));
  if (panicCandidates.length === 0) return { prospect: ranked[0], isPanicPick: false };

  return {
    prospect: [...panicCandidates].sort((a, b) => scorePanicPick(b, team, pickNumber, teamDraftedProspects, previousPick, panicProfile.topNeedPosition) - scorePanicPick(a, team, pickNumber, teamDraftedProspects, previousPick, panicProfile.topNeedPosition))[0],
    isPanicPick: true,
  };
}

export function scoreProspectForTeam(prospect: Prospect, team: Team, pickNumber: number, teamDraftedProspects: Prospect[] = []): number {
  const round = Math.ceil(pickNumber / 10);
  if (round <= 1 && prospect.archetype === "고교특급" && prospect.trueTalent.currentAbility >= 75) {
    return 100000 + (80 - prospect.visible.publicRank) * 100 + prospect.trueTalent.currentAbility * 10 + prospect.trueTalent.potential;
  }
  const rankScore = 370 - prospect.visible.publicRank;
  const consensusPremium = Math.max(0, 120 - prospect.visible.publicRank) * (round <= 2 ? 0.72 : round <= 5 ? 0.46 : 0.2);
  const gradeScore = scoutGradeScore(prospect.visible.scoutGrade) * 9;
  const confidenceScore = prospect.visible.confidence * 18;
  const positionScarcity = positionScarcityScore(prospect);
  const needValue = Math.max(
    team.positionDepth[prospect.primaryPosition]?.need ?? 0,
    ...prospect.secondaryPositions.map((position) => team.positionDepth[position]?.need ?? 0),
  );
  const needWeight = round <= 2 ? 0.3 : round <= 5 ? 0.5 : round <= 8 ? 0.68 : 0.78;
  const talentWeight = round <= 2 ? 1.2 : round <= 5 ? 1 : round <= 8 ? 0.78 : 0.62;
  const scarcityWeight = round <= 2 ? 0.25 : round <= 5 ? 0.55 : 0.9;
  const needScore = needValue * needWeight;
  const roundFit = Math.max(0, 18 - Math.abs(prospect.visible.publicRank - pickNumber) * 0.18);
  const lateRoundProfile =
    round >= 6 && (prospect.visible.expectedOverallRange.max >= 65 || prospect.collegeCommitRisk >= 65 || prospect.visible.visibility === "thin" || prospect.visible.riskLevel === "high")
      ? 18
      : 0;

  let tendencyScore = 0;
  for (const tendency of team.tendencies) {
    if (tendency === "prep-pitcher" && prospect.playerGroup === "pitcher") tendencyScore += 12;
    if (tendency === "defense-first" && (prospect.hitterStats?.defensiveGrade ?? 0) >= 55) tendencyScore += 18;
    if (tendency === "catcher-premium" && prospect.primaryPosition === "C") tendencyScore += 26;
    if (tendency === "upside" && prospect.visible.expectedOverallRange.max >= 65) tendencyScore += 18;
    if (tendency === "safe" && prospect.visible.confidence >= 0.68 && prospect.visible.riskLevel !== "high") tendencyScore += 18;
    if (tendency === "injury-risk-tolerant" && prospect.visible.expectedOverallRange.max >= 64) tendencyScore += prospect.visible.riskTags.includes("injury-history") ? 8 : 12;
    if (tendency === "physical" && prospect.physical.heightCm + prospect.physical.weightKg >= 280) tendencyScore += 14;
    if (tendency === "quick-impact" && prospect.visible.expectedOverallRange.min >= 50) tendencyScore += 18;
  }

  const balancePenalty = draftBalancePenalty(prospect, teamDraftedProspects, round);
  const signabilityPenalty = prospect.collegeCommitRisk >= 75 ? (round >= 9 ? 2 : 10) : prospect.collegeCommitRisk >= 60 ? (round >= 6 ? 2 : 5) : 0;
  const riskPenalty = (team.tendencies.includes("injury-risk-tolerant") ? 4 : prospect.visible.riskLevel === "high" ? (round >= 8 ? 8 : 18) : prospect.visible.riskLevel === "medium" ? 8 : 0) + signabilityPenalty;
  const randomJitter = deterministicNoise(`${team.id}-${prospect.id}-${round}`) * (round <= 2 ? 4 : round <= 5 ? 9 : 18);
  const needReachScore = urgentNeedReachScore(prospect, team, pickNumber, teamDraftedProspects);

  return (rankScore + gradeScore + confidenceScore) * talentWeight + consensusPremium + needScore + needReachScore + positionScarcity * scarcityWeight + roundFit + tendencyScore + lateRoundProfile + randomJitter - riskPenalty - balancePenalty;
}

function scoutGradeScore(grade: Prospect["visible"]["scoutGrade"]): number {
  return { S: 6, A: 5, B: 4, C: 3, D: 2, E: 1 }[grade];
}

function positionScarcityScore(prospect: Prospect): number {
  if (prospect.primaryPosition === "C" || prospect.primaryPosition === "SS") return 18;
  if (prospect.primaryPosition === "SP" || prospect.primaryPosition === "CF") return 14;
  if (prospect.primaryPosition === "2B" || prospect.primaryPosition === "3B") return 8;
  return 4;
}

function draftBalancePenalty(prospect: Prospect, drafted: Prospect[], round: number): number {
  if (drafted.length === 0) return 0;
  const pitcherCount = drafted.filter((item) => item.playerGroup === "pitcher").length;
  const hitterCount = drafted.length - pitcherCount;
  const samePositionCount = drafted.filter((item) => item.primaryPosition === prospect.primaryPosition).length;
  const sameGroupCount = prospect.playerGroup === "pitcher" ? pitcherCount : hitterCount;
  const projectedGroupCount = sameGroupCount + 1;
  const projectedTotal = drafted.length + 1;
  const groupShare = projectedGroupCount / projectedTotal;
  const groupPenalty = groupShare > 0.72 ? (groupShare - 0.72) * 140 : 0;
  const samePositionPenalty = Math.max(0, samePositionCount - 1) * (round <= 5 ? 18 : 12);
  const allSameGroupPenalty = drafted.length >= 4 && sameGroupCount === drafted.length ? 32 : 0;
  return groupPenalty + samePositionPenalty + allSameGroupPenalty;
}

function urgentNeedReachScore(prospect: Prospect, team: Team, pickNumber: number, drafted: Prospect[]): number {
  const round = Math.ceil(pickNumber / 10);
  if (round <= 1) return 0;
  const positionNeeds = Object.entries(team.positionDepth)
    .map(([position, depth]) => ({ position, need: depth.need }))
    .sort((left, right) => right.need - left.need);
  const topNeed = positionNeeds[0];
  if (!topNeed || topNeed.need < 72) return 0;

  const matchesNeed = prospect.primaryPosition === topNeed.position || prospect.secondaryPositions.includes(topNeed.position as Prospect["primaryPosition"]);
  if (!matchesNeed) return 0;

  const alreadyAddressed = drafted.some((item) => item.primaryPosition === topNeed.position || item.secondaryPositions.includes(topNeed.position as Prospect["primaryPosition"]));
  const expectedRoundCenter = (prospect.visible.projectedRound.min + prospect.visible.projectedRound.max) / 2;
  const reachRounds = expectedRoundCenter - round;
  const needDesperation = Math.max(0, topNeed.need - 70);
  const frontOfficePressure =
    deterministicNoise(`${team.id}-${pickNumber}-${topNeed.position}-need-reach`) <
    (team.teamWindow === "contending" ? 0.24 : team.teamWindow === "developing" ? 0.18 : 0.14);

  if (!frontOfficePressure && !(topNeed.need >= 86 && round >= 4 && !alreadyAddressed)) return 0;
  if (reachRounds < 1 && prospect.visible.projectedRound.min <= 10) return 0;

  const roundPressure = round <= 3 ? 0.75 : round <= 6 ? 1.05 : 0.82;
  const scarcityBoost = ["C", "SS", "SP", "CF"].includes(String(topNeed.position)) ? 18 : 8;
  const unaddressedBoost = alreadyAddressed ? -14 : 22;
  const reachBoost = Math.min(55, Math.max(0, reachRounds) * 18);
  return needDesperation * roundPressure + scarcityBoost + unaddressedBoost + reachBoost;
}

function shouldPanicPick(team: Team, availableProspects: Prospect[], pickNumber: number, drafted: Prospect[], previousPick: Prospect): { triggered: boolean; topNeedPosition?: Prospect["primaryPosition"] } {
  const round = Math.ceil(pickNumber / 10);
  if (availableProspects.length < 2) return { triggered: false };

  const hypotheticalBoard = [previousPick, ...availableProspects]
    .filter((prospect, index, list) => list.findIndex((item) => item.id === prospect.id) === index)
    .sort((a, b) => scoreProspectForTeam(b, team, pickNumber, drafted) - scoreProspectForTeam(a, team, pickNumber, drafted));
  const stolenIndex = hypotheticalBoard.findIndex((prospect) => prospect.id === previousPick.id);
  if (stolenIndex < 0 || stolenIndex > 3) return { triggered: false };

  const topNeed = Object.entries(team.positionDepth)
    .map(([position, depth]) => ({ position: position as Prospect["primaryPosition"], need: depth.need }))
    .sort((left, right) => right.need - left.need)[0];
  const previousNeed = Math.max(
    team.positionDepth[previousPick.primaryPosition]?.need ?? 0,
    ...previousPick.secondaryPositions.map((position) => team.positionDepth[position]?.need ?? 0),
  );
  const stoleNeedFit = previousNeed >= 68 || previousPick.primaryPosition === topNeed?.position || previousPick.secondaryPositions.includes(topNeed?.position as Prospect["primaryPosition"]);
  if (!stoleNeedFit && stolenIndex > 1) return { triggered: false, topNeedPosition: topNeed?.position };

  let chance = 0.018;
  chance += stolenIndex === 0 ? 0.062 : stolenIndex === 1 ? 0.042 : 0.024;
  chance += Math.max(0, previousNeed - 65) * 0.0022;
  chance += topNeed?.need >= 82 ? 0.026 : topNeed?.need >= 74 ? 0.014 : 0;
  chance += round <= 2 ? -0.014 : round <= 5 ? 0.018 : round <= 8 ? 0.026 : 0.006;
  chance += team.teamWindow === "contending" ? 0.014 : team.teamWindow === "rebuilding" ? -0.006 : 0;
  chance += team.tendencies.includes("safe") ? -0.018 : 0;
  chance += team.tendencies.includes("upside") || team.tendencies.includes("physical") || team.tendencies.includes("injury-risk-tolerant") ? 0.014 : 0;
  chance += drafted.some((prospect) => prospect.primaryPosition === previousPick.primaryPosition) ? -0.018 : 0;
  chance = Math.max(0.005, Math.min(0.16, chance));

  return {
    triggered: deterministicNoise(`${team.id}-${pickNumber}-${previousPick.id}-panic`) < chance,
    topNeedPosition: topNeed?.position,
  };
}

function isPanicCandidate(prospect: Prospect, team: Team, pickNumber: number, previousPick: Prospect, topNeedPosition?: Prospect["primaryPosition"]): boolean {
  const round = Math.ceil(pickNumber / 10);
  const sameRole = prospect.primaryPosition === previousPick.primaryPosition || prospect.secondaryPositions.includes(previousPick.primaryPosition);
  const needFit = Boolean(topNeedPosition && (prospect.primaryPosition === topNeedPosition || prospect.secondaryPositions.includes(topNeedPosition)));
  const visibleEnough = prospect.visible.publicRank <= pickNumber + 150 || prospect.visible.projectedRound.min <= round + 3 || prospect.visible.expectedOverallRange.max >= 62;
  const panicReachWindow = round >= 3 && prospect.visible.projectedRound.min <= Math.min(10, round + 4);
  return (sameRole || needFit || prospect.visible.publicRank <= pickNumber + 45) && (visibleEnough || panicReachWindow);
}

function scorePanicPick(prospect: Prospect, team: Team, pickNumber: number, drafted: Prospect[], previousPick: Prospect, topNeedPosition?: Prospect["primaryPosition"]): number {
  const round = Math.ceil(pickNumber / 10);
  const baseScore = scoreProspectForTeam(prospect, team, pickNumber, drafted);
  const sameRoleBoost = prospect.primaryPosition === previousPick.primaryPosition ? 48 : prospect.secondaryPositions.includes(previousPick.primaryPosition) ? 28 : 0;
  const needValue = Math.max(
    team.positionDepth[prospect.primaryPosition]?.need ?? 0,
    ...prospect.secondaryPositions.map((position) => team.positionDepth[position]?.need ?? 0),
  );
  const topNeedBoost = topNeedPosition && (prospect.primaryPosition === topNeedPosition || prospect.secondaryPositions.includes(topNeedPosition)) ? 28 : 0;
  const expectedRoundCenter = (prospect.visible.projectedRound.min + prospect.visible.projectedRound.max) / 2;
  const reachRounds = Math.max(0, expectedRoundCenter - round);
  const reachPressure = reachRounds >= 1 ? Math.min(54, reachRounds * (round <= 4 ? 10 : 15)) : 0;
  const familiarNameBoost = prospect.accolades.length * 5 + prospect.draftHype * 0.28 + prospect.reputation * 0.18;
  const lowTrustPenalty = prospect.visible.confidence < 0.42 ? 16 : prospect.visible.riskLevel === "high" && !team.tendencies.includes("injury-risk-tolerant") ? 10 : 0;
  const jitter = deterministicNoise(`${team.id}-${prospect.id}-${pickNumber}-panic-score`) * 20;
  return baseScore + sameRoleBoost + needValue * 0.58 + topNeedBoost + reachPressure + familiarNameBoost + jitter - lowTrustPenalty;
}

function deterministicNoise(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 33 + key.charCodeAt(index)) % 10007;
  }
  return hash / 10007;
}
