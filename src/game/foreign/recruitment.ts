import type { ForeignOfferId, TeamId, Year } from "../types/common";
import type {
  ForeignContract,
  ForeignContractOffer,
  ForeignContractTerms,
  ForeignGuaranteedRole,
  ForeignRecruitmentDecision,
  ForeignRecruitmentState,
} from "../types/foreignContract";
import type { ForeignPlayerCandidate, ForeignPlayerPreference } from "../types/foreignPlayer";
import type { Team } from "../types/team";
import type { Rng } from "../generation/random";
import { randomFloat } from "../generation/random";
import { clamp, roundTo } from "../utils/math";
import { createForeignContract, getForeignRosterUsage, validateForeignRosterSigning } from "../selectors/foreignContracts";

export type ForeignRecruitmentRoundInput = {
  year: Year;
  round: number;
  teams: Team[];
  candidates: ForeignPlayerCandidate[];
  existingContracts: ForeignContract[];
  offers: ForeignContractOffer[];
  rng: Rng;
};

export type ForeignRecruitmentRoundResult = {
  offers: ForeignContractOffer[];
  contracts: ForeignContract[];
  decisions: ForeignRecruitmentDecision[];
  signedCandidates: ForeignPlayerCandidate[];
  winningTeamIds: TeamId[];
  nextRoundTeamIds: TeamId[];
  completedTeamIds: TeamId[];
};

export function createForeignRecruitmentState(year: Year, teamIds: TeamId[], maxRounds = 10): ForeignRecruitmentState {
  return {
    year,
    status: "open",
    currentRound: 1,
    maxRounds,
    pendingTeamIds: [...teamIds],
    completedTeamIds: [],
  };
}

export function createForeignContractOffer(
  year: Year,
  round: number,
  teamId: TeamId,
  candidate: ForeignPlayerCandidate,
  terms: ForeignContractTerms,
): ForeignContractOffer {
  return {
    id: `foreign-offer-${year}-${round}-${teamId}-${candidate.id}` as ForeignOfferId,
    recruitmentYear: year,
    round,
    teamId,
    playerId: candidate.id,
    terms,
    status: "submitted",
  };
}

export function resolveForeignRecruitmentRound(input: ForeignRecruitmentRoundInput): ForeignRecruitmentRoundResult {
  const teamById = new Map(input.teams.map((team) => [team.id, team]));
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const submitted = input.offers.filter((offer) => offer.recruitmentYear === input.year && offer.round === input.round && offer.status === "submitted");
  const firstOfferByTeam = new Map<TeamId, ForeignContractOffer>();
  const updatedById = new Map(input.offers.map((offer) => [offer.id, { ...offer }]));
  const validOffers: ForeignContractOffer[] = [];

  for (const offer of submitted) {
    const candidate = candidateById.get(offer.playerId);
    const team = teamById.get(offer.teamId);
    let rejectionReason: ForeignContractOffer["rejectionReason"];
    if (firstOfferByTeam.has(offer.teamId)) rejectionReason = "duplicate-team-offer";
    else firstOfferByTeam.set(offer.teamId, offer);
    if (!candidate || candidate.status !== "available" || !team) rejectionReason = "player-unavailable";
    else if (!roleMatchesPlayer(candidate, offer.terms.guaranteedRole)) rejectionReason = "role-mismatch";
    else if (!validateForeignRosterSigning(input.existingContracts, candidate, offer.teamId, input.year).allowed) rejectionReason = "roster-limit";

    if (rejectionReason) {
      updatedById.set(offer.id, { ...offer, status: "rejected", rejectionReason });
    } else {
      validOffers.push(offer);
    }
  }

  const offersByPlayer = new Map<string, ForeignContractOffer[]>();
  validOffers.forEach((offer) => offersByPlayer.set(offer.playerId, [...(offersByPlayer.get(offer.playerId) ?? []), offer]));
  const contracts: ForeignContract[] = [];
  const decisions: ForeignRecruitmentDecision[] = [];
  const signedCandidates: ForeignPlayerCandidate[] = [];
  const winningTeamIds = new Set<TeamId>();

  for (const [playerId, competingOffers] of offersByPlayer) {
    const candidate = candidateById.get(playerId as ForeignPlayerCandidate["id"]);
    if (!candidate) continue;
    const ranked = competingOffers
      .map((offer) => scoreOfferForPlayer(candidate, offer, teamById.get(offer.teamId)!, input.rng))
      .sort((left, right) => right.total - left.total);
    const winner = ranked[0];
    if (!winner) continue;
    updatedById.set(winner.offer.id, { ...winner.offer, status: "accepted", rejectionReason: undefined });
    competingOffers.filter((offer) => offer.id !== winner.offer.id).forEach((offer) => {
      updatedById.set(offer.id, { ...offer, status: "rejected", rejectionReason: "lost-player-choice" });
    });
    contracts.push(createForeignContract(candidate, winner.offer.teamId, input.year, winner.offer.terms));
    signedCandidates.push({ ...candidate, status: "signed" });
    winningTeamIds.add(winner.offer.teamId);
    decisions.push({
      year: input.year,
      round: input.round,
      playerId: candidate.id,
      winnerTeamId: winner.offer.teamId,
      winningOfferId: winner.offer.id,
      competingTeamIds: competingOffers.map((offer) => offer.teamId),
      winningFactor: winner.winningFactor,
      winningScore: roundTo(winner.total, 1),
    });
  }

  const submittedTeamIds = new Set(submitted.map((offer) => offer.teamId));
  const contractsAfterRound = [...input.existingContracts, ...contracts];
  const completedTeamIds = Array.from(submittedTeamIds).filter((teamId) => {
    const usage = getForeignRosterUsage(contractsAfterRound, teamId, input.year);
    return usage.standard >= 3 && usage.asianQuota >= 1;
  });
  const completedSet = new Set(completedTeamIds);
  return {
    offers: Array.from(updatedById.values()),
    contracts,
    decisions,
    signedCandidates,
    winningTeamIds: Array.from(winningTeamIds),
    nextRoundTeamIds: Array.from(submittedTeamIds).filter((teamId) => !completedSet.has(teamId)),
    completedTeamIds,
  };
}

export function advanceForeignRecruitmentState(
  state: ForeignRecruitmentState,
  result: ForeignRecruitmentRoundResult,
): ForeignRecruitmentState {
  const completed = new Set([...state.completedTeamIds, ...result.completedTeamIds]);
  const nextRound = state.currentRound + 1;
  const pendingTeamIds = result.nextRoundTeamIds.filter((teamId) => !completed.has(teamId));
  const complete = pendingTeamIds.length === 0 || nextRound > state.maxRounds;
  return {
    ...state,
    status: complete ? "complete" : "open",
    currentRound: complete ? state.currentRound : nextRound,
    pendingTeamIds: complete ? [] : pendingTeamIds,
    completedTeamIds: Array.from(completed),
  };
}

function roleMatchesPlayer(candidate: ForeignPlayerCandidate, role: ForeignGuaranteedRole): boolean {
  const pitcherRole = role === "starting-pitcher" || role === "closer" || role === "bullpen" || role === "flexible-pitcher";
  return candidate.playerGroup === "pitcher" ? pitcherRole : !pitcherRole;
}

function scoreOfferForPlayer(candidate: ForeignPlayerCandidate, offer: ForeignContractOffer, team: Team, rng: Rng) {
  const salaryCenter = (candidate.visible.expectedSalaryUsd.min + candidate.visible.expectedSalaryUsd.max) / 2;
  const salary = clamp(50 + (offer.terms.annualSalaryUsd - salaryCenter) / Math.max(5000, salaryCenter) * 55, 15, 95);
  const championship = clamp(team.currentStrength + (team.teamWindow === "contending" ? 18 : team.teamWindow === "developing" ? 7 : 0), 20, 95);
  const role = roleAppeal(offer.terms.guaranteedRole);
  const opportunity = clamp((team.positionDepth[candidate.primaryPosition]?.need ?? 45) * 0.65 + role * 0.35, 15, 95);
  const stability = clamp(offer.terms.years * 24 + championship * 0.32 + salary * 0.2, 15, 95);
  const largeMarket = marketAppeal(team.market);
  const overseasReturn = clamp(88 - Math.max(0, offer.terms.years - 1) * 18 + role * 0.12 + championship * 0.18, 20, 95);
  const factors: Record<ForeignPlayerPreference | "opportunity", number> = { money: salary, championship, "guaranteed-role": role, stability, "large-market": largeMarket, "overseas-return": overseasReturn, opportunity };
  const preferred = factors[candidate.preferredCondition];
  const total = preferred * 0.42 + salary * 0.2 + opportunity * 0.16 + championship * 0.1 + stability * 0.07 + randomFloat(rng, 0, 9);
  const winningFactor = (Object.entries(factors) as Array<[ForeignPlayerPreference | "opportunity", number]>).sort((left, right) => right[1] - left[1])[0][0];
  return { offer, total, winningFactor };
}

function roleAppeal(role: ForeignGuaranteedRole): number {
  if (role === "starting-pitcher" || role === "everyday-player") return 92;
  if (role === "closer") return 84;
  if (role === "flexible-pitcher" || role === "platoon-player") return 68;
  if (role === "bullpen") return 58;
  return 44;
}

function marketAppeal(market: string): number {
  if (market === "서울" || market === "잠실") return 92;
  if (market === "고척" || market === "인천" || market === "수원") return 82;
  if (market === "부산" || market === "대구") return 75;
  return 66;
}
