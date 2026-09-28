import type { ForeignContractId, ForeignPlayerId, TeamId, Year } from "../types/common";
import type {
  ForeignContract,
  ForeignContractTerms,
  ForeignRosterUsage,
  ForeignRosterValidation,
} from "../types/foreignContract";
import type { ForeignPlayerCandidate } from "../types/foreignPlayer";

export const FOREIGN_ROSTER_LIMITS = {
  total: 4,
  standard: 3,
  asianQuota: 1,
  standardPitchers: 2,
  standardHitters: 2,
} as const;

export function isForeignContractActive(contract: ForeignContract, year: Year): boolean {
  return contract.status === "active" && contract.startYear <= year && contract.endYear >= year;
}

export function getActiveForeignContracts(
  contracts: Iterable<ForeignContract>,
  teamId: TeamId,
  year: Year,
): ForeignContract[] {
  return Array.from(contracts).filter((contract) => contract.teamId === teamId && isForeignContractActive(contract, year));
}

export function getForeignRosterUsage(contracts: Iterable<ForeignContract>, teamId: TeamId, year: Year): ForeignRosterUsage {
  const active = getActiveForeignContracts(contracts, teamId, year);
  return {
    total: active.length,
    standard: active.filter((contract) => contract.slotType === "standard").length,
    asianQuota: active.filter((contract) => contract.slotType === "asian-quota").length,
    standardPitchers: active.filter((contract) => contract.slotType === "standard" && contract.playerGroup === "pitcher").length,
    standardHitters: active.filter((contract) => contract.slotType === "standard" && contract.playerGroup === "hitter").length,
  };
}

export function validateForeignRosterSigning(
  contracts: Iterable<ForeignContract>,
  candidate: ForeignPlayerCandidate,
  teamId: TeamId,
  year: Year,
): ForeignRosterValidation {
  const allContracts = Array.from(contracts);
  const usage = getForeignRosterUsage(allContracts, teamId, year);
  const violations: ForeignRosterValidation["violations"] = [];
  if (allContracts.some((contract) => contract.playerId === candidate.id && isForeignContractActive(contract, year))) violations.push("player-already-contracted");
  if (usage.total >= FOREIGN_ROSTER_LIMITS.total) violations.push("total-limit");
  if (candidate.slotType === "standard" && usage.standard >= FOREIGN_ROSTER_LIMITS.standard) violations.push("standard-limit");
  if (candidate.slotType === "asian-quota" && usage.asianQuota >= FOREIGN_ROSTER_LIMITS.asianQuota) violations.push("asian-quota-limit");
  if (candidate.slotType === "standard" && candidate.playerGroup === "pitcher" && usage.standardPitchers >= FOREIGN_ROSTER_LIMITS.standardPitchers) violations.push("standard-pitcher-limit");
  if (candidate.slotType === "standard" && candidate.playerGroup === "hitter" && usage.standardHitters >= FOREIGN_ROSTER_LIMITS.standardHitters) violations.push("standard-hitter-limit");
  return { allowed: violations.length === 0, violations, usage };
}

export function createForeignContract(
  candidate: ForeignPlayerCandidate,
  teamId: TeamId,
  signedYear: Year,
  terms: ForeignContractTerms,
  renewal?: { previousContractId: ForeignContractId; renewalCount: number },
): ForeignContract {
  const years = Math.max(1, Math.round(terms.years));
  const annualSalaryUsd = Math.max(0, Math.round(terms.annualSalaryUsd));
  const signingBonusUsd = Math.max(0, Math.round(terms.signingBonusUsd ?? 0));
  const incentivesUsd = Math.max(0, Math.round(terms.incentivesUsd ?? 0));
  return {
    id: `foreign-contract-${signedYear}-${teamId}-${candidate.id}` as ForeignContractId,
    playerId: candidate.id as ForeignPlayerId,
    teamId,
    slotType: candidate.slotType,
    playerGroup: candidate.playerGroup,
    signedYear,
    startYear: signedYear,
    endYear: signedYear + years - 1,
    annualSalaryUsd,
    signingBonusUsd,
    incentivesUsd,
    totalValueUsd: annualSalaryUsd * years + signingBonusUsd + incentivesUsd,
    guaranteedRole: terms.guaranteedRole,
    status: "active",
    renewalCount: renewal?.renewalCount ?? 0,
    previousContractId: renewal?.previousContractId,
    playerSnapshot: candidate,
  };
}
