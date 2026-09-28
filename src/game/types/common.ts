export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type TeamId = Brand<string, "TeamId">;
export type ProspectId = Brand<string, "ProspectId">;
export type PlayerId = Brand<string, "PlayerId">;
export type DraftPickId = Brand<string, "DraftPickId">;
export type NewsId = Brand<string, "NewsId">;
export type ForeignPlayerId = Brand<string, "ForeignPlayerId">;
export type ForeignContractId = Brand<string, "ForeignContractId">;
export type ForeignOfferId = Brand<string, "ForeignOfferId">;

export type GamePhase =
  | "team-selection"
  | "pre-draft"
  | "draft"
  | "post-draft"
  | "season-simulation"
  | "offseason";

export type Position =
  | "SP"
  | "RP"
  | "C"
  | "1B"
  | "2B"
  | "3B"
  | "SS"
  | "LF"
  | "CF"
  | "RF";

export type Handedness = "L" | "R" | "S";

export type Grade20to80 = 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80;

export type RiskLevel = "low" | "medium" | "high" | "extreme";

export type Trend = "rising" | "steady" | "falling";

export type Range = {
  min: number;
  max: number;
};

export type Year = number;
