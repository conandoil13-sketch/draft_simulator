import type { DraftPickId, PlayerId, ProspectId, TeamId, Year } from "./common";

export type DraftPick = {
  id: DraftPickId;
  year: Year;
  round: number;
  overall: number;
  originalTeamId: TeamId;
  ownerTeamId: TeamId;
};

export type DraftSelection = {
  pick: DraftPick;
  prospectId: ProspectId;
  playerId: PlayerId;
  selectedByTeamId: TeamId;
};

export type DraftClass = {
  year: Year;
  prospectIds: ProspectId[];
  generatedAtTurn: number;
};

export type DraftResult = {
  year: Year;
  selections: DraftSelection[];
  undraftedProspectIds: ProspectId[];
};
