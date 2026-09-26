import type { Position, TeamId } from "./common";

export type TeamNeed = {
  position: Position;
  urgency: number;
};

export type PositionDepth = {
  majorLeagueStrength: number;
  prospectDepth: number;
  agingRisk: number;
  injuryRisk: number;
  contractRisk: number;
  need: number;
  changeReason?: string;
};

export type TeamWindow = "rebuilding" | "developing" | "contending";

export type DraftTendency =
  | "prep-pitcher"
  | "defense-first"
  | "catcher-premium"
  | "upside"
  | "safe"
  | "injury-risk-tolerant"
  | "physical"
  | "quick-impact";

export type Team = {
  id: TeamId;
  name: string;
  shortName: string;
  market: string;
  strategy: "best-player" | "upside" | "safe-pick" | "pitching" | "position-player" | "needs";
  tendencies: DraftTendency[];
  teamWindow: TeamWindow;
  baseStrength: number;
  currentStrength: number;
  needs: TeamNeed[];
  positionDepth: Record<Position, PositionDepth>;
};
