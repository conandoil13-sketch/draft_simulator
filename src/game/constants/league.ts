import type { GameSettings } from "../types/game";
import type { Position, TeamId } from "../types/common";
import type { DraftTendency, PositionDepth, Team, TeamNeed, TeamWindow } from "../types/team";
import type { Rng } from "../generation/random";

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  prospectsPerYear: 400,
  teams: 10,
  rounds: 10,
  enablePickTrades: true,
};

const POSITIONS: Position[] = ["SP", "RP", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const TENDENCIES: DraftTendency[] = ["prep-pitcher", "defense-first", "catcher-premium", "upside", "safe", "injury-risk-tolerant", "physical", "quick-impact"];
const STRATEGIES: Team["strategy"][] = ["best-player", "upside", "safe-pick", "pitching", "position-player", "needs"];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng.next() * (max - min + 1)) + min;
}

function pickOne<T>(rng: Rng, values: T[]): T {
  return values[Math.floor(rng.next() * values.length)] ?? values[0];
}

function createPositionDepth(baseStrength: number, needs: TeamNeed[]): Record<Position, PositionDepth> {
  return Object.fromEntries(
    POSITIONS.map((position, index) => {
      const listedNeed = needs.find((need) => need.position === position)?.urgency ?? 35;
      const majorLeagueStrength = Math.max(28, Math.min(78, baseStrength + ((index * 7) % 17) - listedNeed * 0.18));
      const prospectDepth = Math.max(22, Math.min(76, 72 - listedNeed * 0.45 + ((index * 11) % 19)));
      const agingRisk = Math.max(8, Math.min(70, listedNeed * 0.32 + ((index * 13) % 28)));
      const injuryRisk = Math.max(8, Math.min(68, listedNeed * 0.24 + ((index * 5) % 24)));
      const contractRisk = Math.max(6, Math.min(72, listedNeed * 0.28 + ((index * 17) % 25)));

      return [
        position,
        {
          majorLeagueStrength: Math.round(majorLeagueStrength),
          prospectDepth: Math.round(prospectDepth),
          agingRisk: Math.round(agingRisk),
          injuryRisk: Math.round(injuryRisk),
          contractRisk: Math.round(contractRisk),
          need: Math.round(listedNeed),
        },
      ];
    }),
  ) as Record<Position, PositionDepth>;
}

function team(overrides: Omit<Team, "positionDepth">): Team {
  return { ...overrides, positionDepth: createPositionDepth(overrides.baseStrength, overrides.needs) };
}

export const INITIAL_TEAMS: Team[] = [
  team({
    id: "team-seoul" as TeamId,
    name: "서울 듀오스",
    shortName: "서울",
    market: "서울",
    strategy: "best-player",
    tendencies: ["quick-impact", "safe"],
    teamWindow: "contending",
    baseStrength: 64,
    currentStrength: 64,
    needs: [{ position: "C", urgency: 80 }, { position: "RP", urgency: 45 }],
  }),
  team({
    id: "team-jamsil" as TeamId,
    name: "잠실 그리즐리스",
    shortName: "잠실",
    market: "잠실",
    strategy: "pitching",
    tendencies: ["prep-pitcher", "physical"],
    teamWindow: "contending",
    baseStrength: 61,
    currentStrength: 61,
    needs: [{ position: "SP", urgency: 90 }, { position: "SS", urgency: 40 }],
  }),
  team({
    id: "team-gocheok" as TeamId,
    name: "고척 가디언즈",
    shortName: "고척",
    market: "고척",
    strategy: "safe-pick",
    tendencies: ["safe", "defense-first"],
    teamWindow: "developing",
    baseStrength: 58,
    currentStrength: 58,
    needs: [{ position: "SS", urgency: 75 }, { position: "CF", urgency: 55 }],
  }),
  team({
    id: "team-suwon" as TeamId,
    name: "수원 메이지스",
    shortName: "수원",
    market: "수원",
    strategy: "upside",
    tendencies: ["upside", "injury-risk-tolerant"],
    teamWindow: "developing",
    baseStrength: 56,
    currentStrength: 56,
    needs: [{ position: "SP", urgency: 70 }, { position: "3B", urgency: 45 }],
  }),
  team({
    id: "team-incheon" as TeamId,
    name: "인천 드레이크스",
    shortName: "인천",
    market: "인천",
    strategy: "needs",
    tendencies: ["catcher-premium", "quick-impact"],
    teamWindow: "developing",
    baseStrength: 55,
    currentStrength: 55,
    needs: [{ position: "C", urgency: 95 }, { position: "2B", urgency: 35 }],
  }),
  team({
    id: "team-daegu" as TeamId,
    name: "대구 팬서스",
    shortName: "대구",
    market: "대구",
    strategy: "position-player",
    tendencies: ["defense-first", "safe"],
    teamWindow: "contending",
    baseStrength: 54,
    currentStrength: 54,
    needs: [{ position: "CF", urgency: 75 }, { position: "SS", urgency: 65 }],
  }),
  team({
    id: "team-busan" as TeamId,
    name: "부산 타이탄스",
    shortName: "부산",
    market: "부산",
    strategy: "best-player",
    tendencies: ["physical", "upside"],
    teamWindow: "developing",
    baseStrength: 52,
    currentStrength: 52,
    needs: [{ position: "RF", urgency: 55 }, { position: "SP", urgency: 55 }],
  }),
  team({
    id: "team-daejeon" as TeamId,
    name: "대전 팔콘스",
    shortName: "대전",
    market: "대전",
    strategy: "pitching",
    tendencies: ["prep-pitcher", "injury-risk-tolerant"],
    teamWindow: "rebuilding",
    baseStrength: 50,
    currentStrength: 50,
    needs: [{ position: "SP", urgency: 85 }, { position: "RP", urgency: 60 }],
  }),
  team({
    id: "team-changwon" as TeamId,
    name: "창원 랩터스",
    shortName: "창원",
    market: "창원",
    strategy: "upside",
    tendencies: ["upside", "physical"],
    teamWindow: "rebuilding",
    baseStrength: 48,
    currentStrength: 48,
    needs: [{ position: "3B", urgency: 60 }, { position: "LF", urgency: 45 }],
  }),
  team({
    id: "team-gwangju" as TeamId,
    name: "광주 재규어스",
    shortName: "광주",
    market: "광주",
    strategy: "safe-pick",
    tendencies: ["safe", "catcher-premium"],
    teamWindow: "rebuilding",
    baseStrength: 46,
    currentStrength: 46,
    needs: [{ position: "C", urgency: 65 }, { position: "1B", urgency: 40 }],
  }),
];

export function createVariedInitialTeams(rng: Rng): Team[] {
  return INITIAL_TEAMS.map((base) => {
    const strengthShift = randomInt(rng, -5, 5);
    const baseStrength = clamp(base.baseStrength + strengthShift, 42, 68);
    const needs = createVariedNeeds(rng, base.needs);
    const tendencies = createVariedTendencies(rng, base.tendencies);
    const strategy = rng.next() < 0.72 ? base.strategy : pickStrategyFromTendencies(rng, tendencies);
    const teamWindow = windowFromStrength(baseStrength, rng);
    return team({
      ...base,
      strategy,
      tendencies,
      teamWindow,
      baseStrength,
      currentStrength: baseStrength,
      needs,
    });
  });
}

export function createInitialStandings(teams: Team[], rng: Rng, userTeamId?: TeamId, userRank?: number): { teamId: TeamId; rank: number }[] {
  const sorted = [...teams].sort((left, right) => right.currentStrength - left.currentStrength + randomInt(rng, -5, 5));
  const ranks = new Map<TeamId, number>();
  sorted.forEach((team, index) => ranks.set(team.id, index + 1));

  if (userTeamId && userRank) {
    const clampedRank = clamp(Math.round(userRank), 1, teams.length);
    const others = sorted.filter((team) => team.id !== userTeamId);
    const ordered = [
      ...others.slice(0, clampedRank - 1),
      teams.find((team) => team.id === userTeamId),
      ...others.slice(clampedRank - 1),
    ].filter((team): team is Team => Boolean(team));
    ranks.clear();
    ordered.forEach((team, index) => ranks.set(team.id, index + 1));
  }

  return teams.map((team) => ({ teamId: team.id, rank: ranks.get(team.id) ?? teams.length }));
}

function createVariedNeeds(rng: Rng, baseNeeds: TeamNeed[]): TeamNeed[] {
  const urgencyByPosition = new Map<Position, number>();
  for (const position of POSITIONS) {
    const base = baseNeeds.find((need) => need.position === position)?.urgency ?? randomInt(rng, 18, 54);
    urgencyByPosition.set(position, clamp(base + randomInt(rng, -18, 22), 12, 96));
  }
  if (rng.next() < 0.55) urgencyByPosition.set(pickOne(rng, POSITIONS), randomInt(rng, 62, 92));
  if (rng.next() < 0.28) urgencyByPosition.set(pickOne(rng, POSITIONS), randomInt(rng, 56, 84));
  return [...urgencyByPosition.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, randomInt(rng, 2, 4))
    .map(([position, urgency]) => ({ position, urgency: Math.round(urgency) }));
}

function createVariedTendencies(rng: Rng, baseTendencies: DraftTendency[]): DraftTendency[] {
  const kept = baseTendencies.filter(() => rng.next() < 0.62);
  const next = new Set<DraftTendency>(kept.length ? kept : [pickOne(rng, baseTendencies)]);
  while (next.size < (rng.next() < 0.22 ? 3 : 2)) {
    next.add(pickOne(rng, TENDENCIES));
  }
  return [...next];
}

function pickStrategyFromTendencies(rng: Rng, tendencies: DraftTendency[]): Team["strategy"] {
  if (tendencies.includes("prep-pitcher")) return "pitching";
  if (tendencies.includes("upside")) return "upside";
  if (tendencies.includes("safe")) return "safe-pick";
  if (tendencies.includes("defense-first") || tendencies.includes("catcher-premium")) return "position-player";
  return pickOne(rng, STRATEGIES);
}

function windowFromStrength(strength: number, rng: Rng): TeamWindow {
  const shifted = strength + randomInt(rng, -4, 4);
  if (shifted >= 60) return "contending";
  if (shifted >= 52) return "developing";
  return "rebuilding";
}
