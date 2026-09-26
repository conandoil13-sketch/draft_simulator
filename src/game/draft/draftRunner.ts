import type { DraftPick, DraftSelection } from "../types/draft";
import type { DraftedPlayer, Prospect } from "../types/player";
import type { PlayerId, ProspectId } from "../types/common";
import { toRange } from "../utils/math";

export function draftProspect(pick: DraftPick, prospect: Prospect): { selection: DraftSelection; player: DraftedPlayer; prospect: Prospect } {
  const playerId = `player-${prospect.draftYear}-${pick.overall}` as PlayerId;
  const player: DraftedPlayer = {
    id: playerId,
    sourceProspectId: prospect.id,
    teamId: pick.ownerTeamId,
    name: prospect.name,
    draftYear: prospect.draftYear,
    primaryPosition: prospect.primaryPosition,
    archetype: prospect.archetype,
    leagueLevel: prospect.leagueLevel,
    collegeCommitRisk: prospect.collegeCommitRisk,
    accolades: prospect.accolades,
    reputation: prospect.reputation,
    draftHype: prospect.draftHype,
    trueTalent: prospect.trueTalent,
    revealed: {
      initialOverall: prospect.trueTalent.currentAbility,
      currentOverall: prospect.trueTalent.currentAbility,
      potentialBand: toRange(prospect.trueTalent.potential, Math.round(prospect.trueTalent.volatility * 10), 20, 90),
    },
    career: {
      status: "minors",
      yearsPro: 0,
      awards: [],
    },
  };

  return {
    selection: {
      pick,
      prospectId: prospect.id as ProspectId,
      playerId,
      selectedByTeamId: pick.ownerTeamId,
    },
    player,
    prospect: {
      ...prospect,
      isDrafted: true,
    },
  };
}
