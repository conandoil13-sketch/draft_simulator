import type { DraftPick } from "../types/draft";
import type { Team } from "../types/team";
import type { TeamId } from "../types/common";

export function getTeamDraftAssets(teamId: TeamId, picks: DraftPick[]): DraftPick[] {
  return picks.filter((pick) => pick.ownerTeamId === teamId).sort((a, b) => a.overall - b.overall);
}

export function getTeamById(teams: Team[], teamId: TeamId): Team | undefined {
  return teams.find((team) => team.id === teamId);
}
