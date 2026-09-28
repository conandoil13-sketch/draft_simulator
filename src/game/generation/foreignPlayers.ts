import type { ForeignPlayerId, Handedness, Position, Range, RiskLevel } from "../types/common";
import type {
  ForeignHiddenProfile,
  ForeignCareerSeason,
  ForeignHitterRecentStats,
  ForeignHitterTools,
  ForeignOriginLeague,
  ForeignPitcherRecentStats,
  ForeignPitcherTools,
  ForeignPlayerCandidate,
  ForeignPlayerGroup,
  ForeignPlayerPreference,
  ForeignPlayerSlot,
  ForeignRecentStats,
  ForeignRiskTag,
} from "../types/foreignPlayer";
import type { ScoutGrade } from "../types/player";
import { clamp, roundTo } from "../utils/math";
import { pickOne, randomFloat, randomInt, weightedPick, type Rng } from "./random";

const STANDARD_NATIONALITIES = [
  { value: "USA", weight: 43 },
  { value: "Dominican Republic", weight: 17 },
  { value: "Venezuela", weight: 13 },
  { value: "Mexico", weight: 7 },
  { value: "Cuba", weight: 6 },
  { value: "Puerto Rico", weight: 4 },
  { value: "Canada", weight: 3 },
  { value: "Panama", weight: 2 },
  { value: "Japan", weight: 3 },
  { value: "Taiwan", weight: 2 },
] as const;

const ASIAN_QUOTA_NATIONALITIES = [
  { value: "Japan", weight: 42 },
  { value: "Taiwan", weight: 28 },
  { value: "Australia", weight: 20 },
  { value: "Philippines", weight: 6 },
  { value: "China", weight: 4 },
] as const;

const GIVEN_NAMES: Record<string, readonly string[]> = {
  USA: ["Ethan", "Logan", "Mason", "Caleb", "Nolan", "Trevor", "Dylan", "Cole", "Grant", "Wyatt", "Austin", "Blake", "Jackson", "Cody", "Tyler", "Brandon", "Garrett", "Hunter", "Zachary", "Spencer", "Derek", "Connor", "Luke", "Jake"],
  "Dominican Republic": ["Luis", "Jose", "Rafael", "Miguel", "Carlos", "Elian", "Santo", "Javier", "Dario", "Marco", "Wander", "Junior", "Franchy", "Cristian", "Ronny", "Eury", "Jeimer", "Yairo", "Starlin", "Adonis"],
  Venezuela: ["Andres", "Diego", "Gabriel", "Jesus", "Manuel", "Eduardo", "Victor", "Samuel", "Tomas", "Adrian", "Keibert", "Ezequiel", "Gleyber", "Luisangel", "Wilmer", "Maikel", "Yonny", "Oswaldo", "Anthony", "Josef"],
  Mexico: ["Alejandro", "Emilio", "Mateo", "Rodrigo", "Julio", "Hector", "Ivan", "Ramon", "Fernando", "Gerardo", "Isaac", "Roberto", "Esteban", "Arturo", "Sebastian", "Gael", "Orlando", "Francisco"],
  Cuba: ["Yuniel", "Randy", "Dayan", "Yordan", "Lazaro", "Osmel", "Yoel", "Ariel", "Yadiel", "Adolis", "Yandy", "Luisan", "Norberto", "Rusney", "Yuli", "Andy", "Yosver", "Dairon"],
  "Puerto Rico": ["Enrique", "Jorge", "Xavier", "Edwin", "Angel", "Noel", "Joel", "Felix", "Francisco", "Emmanuel", "Jovani", "Carlos", "Christian", "Isan", "Jose", "Vimael", "Nelson", "Javier"],
  Canada: ["Liam", "Owen", "Noah", "Connor", "Lucas", "Nathan", "Cameron", "Evan", "Jacob", "Callum", "Tyson", "Jordan", "Brett", "Adam", "Ryan", "Michael", "Benjamin", "Dawson"],
  Panama: ["Ernesto", "Johan", "Abel", "Cesar", "Omar", "Renan", "Saul", "Nico", "Edmundo", "Jhonny", "Ivan", "Allen", "Leonardo", "Christian", "Rodrigo", "Dimas", "Jadher", "Luis"],
  Japan: ["Haruto", "Kaito", "Ren", "Sota", "Yuto", "Takumi", "Riku", "Kosei", "Daiki", "Shun", "Ryota", "Yuki", "Tatsuya", "Kenta", "Hiroto", "Masaki", "Naoki", "Shota", "Yusuke", "Kazuki", "Hayato", "Tomoya"],
  Taiwan: ["Wei-Chen", "Yu-Hao", "Chih-Hung", "Po-Yu", "Tzu-Wei", "Cheng-En", "Kai-Wen", "Jun-Hao", "Chun-Hsiu", "Kuo-Hua", "Li-Lin", "Cheng-Ting", "Yu-Cheng", "Chia-Hao", "Wei-Chung", "Po-Jung", "Tzu-Hsuan", "Chih-Wei"],
  Australia: ["Jack", "Oliver", "Cooper", "Mitchell", "Lachlan", "Harrison", "Bailey", "Riley", "Blake", "Travis", "Aaron", "Liam", "Samuel", "Jake", "Curtis", "Alex", "Darcy", "Jordan"],
  Philippines: ["Paolo", "Miguel", "Carlo", "Enzo", "Rafael", "Andres", "Nico", "Luis", "Marco", "Gabriel", "Jose", "Angelo", "Diego", "Joaquin", "Emilio", "Francis", "Mateo", "Ramon"],
  China: ["Wei", "Jun", "Hao", "Tao", "Bo", "Lei", "Ming", "Kai", "Peng", "Long", "Chao", "Jian", "Qiang", "Tian", "Yong", "Zhi", "Chen", "Rui"],
};

const FAMILY_NAMES: Record<string, readonly string[]> = {
  USA: ["Carter", "Brooks", "Bennett", "Hayes", "Foster", "Reed", "Cooper", "Griffin", "Turner", "Wells", "Parker", "Sullivan", "Mitchell", "Harris", "Miller", "Walker", "Morgan", "Russell", "Hamilton", "Bishop", "Lawson", "Morris", "Crawford", "Ramsey"],
  "Dominican Republic": ["Ramirez", "De La Cruz", "Santana", "Rosario", "Mendez", "Valdez", "Peralta", "Tejada", "Castillo", "Reyes", "Bautista", "Encarnacion", "Taveras", "Marte", "Sanchez", "Montero", "Severino", "Polanco", "Lora", "Brito"],
  Venezuela: ["Gonzalez", "Mendoza", "Salazar", "Rojas", "Cabrera", "Navarro", "Paredes", "Marquez", "Suarez", "Acosta", "Arcia", "Chirinos", "Contreras", "Escobar", "Guillorme", "Soteldo", "Urbina", "Velasquez", "Quintero", "Barreto"],
  Mexico: ["Hernandez", "Lozano", "Aguilar", "Solis", "Vega", "Ibarra", "Montoya", "Cervantes", "Urquidy", "Valenzuela", "Carrillo", "Munoz", "Ornelas", "Verdugo", "Aranda", "Trejo", "Tirado", "Zavala"],
  Cuba: ["Soler", "Mesa", "Vargas", "Morejon", "Cespedes", "Avila", "Miranda", "Duran", "Robert", "Moncada", "Diaz", "Abreu", "Gurriel", "Arozarena", "Chapman", "Colas", "Prieto", "Arruebarrena"],
  "Puerto Rico": ["Rivera", "Morales", "Santiago", "Colon", "Vazquez", "Torres", "Mercado", "Cintron", "Correa", "Lindor", "Baez", "Rosario", "Molina", "Berrios", "Lopez", "Melendez", "Velazquez", "Miranda"],
  Canada: ["Martin", "Fraser", "Campbell", "Murray", "Bouchard", "MacLeod", "Sinclair", "Clarke", "Naylor", "Freeman", "Jenkins", "Robinson", "Saunders", "O'Neill", "Leblanc", "Gauthier", "Matheson", "Wallace"],
  Panama: ["Aparicio", "Mosquera", "Guerra", "Espino", "Cordoba", "Barrios", "Quintero", "Batista", "Bethancourt", "Sosa", "Arauz", "Tejada", "Caballero", "Ramos", "Mendoza", "Munoz", "Escobar", "Almanza"],
  Japan: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Ito", "Watanabe", "Yamamoto", "Nakamura", "Kobayashi", "Fujita", "Kato", "Matsumoto", "Inoue", "Kondo", "Yoshida", "Yamada", "Ishikawa", "Okamoto", "Mori", "Aoki", "Shimizu", "Hasegawa"],
  Taiwan: ["Chen", "Lin", "Wang", "Chang", "Liu", "Huang", "Wu", "Tsai", "Yang", "Hsu", "Kuo", "Chiang", "Cheng", "Kao", "Lo", "Yeh", "Chou", "Lee"],
  Australia: ["Anderson", "Thompson", "Wilson", "Walker", "Murphy", "Hughes", "Collins", "Taylor", "Kennedy", "Whitefield", "Wingrove", "George", "Williams", "Hall", "Kent", "Blackley", "Perkins", "Shepherd"],
  Philippines: ["Reyes", "Santos", "Garcia", "Mendoza", "Cruz", "Bautista", "Navarro", "Castillo", "Ramos", "Aquino", "Flores", "Gonzales", "Villanueva", "Tolentino", "Pascual", "Mercado", "Soriano", "Evangelista"],
  China: ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou", "Xu", "Sun", "Ma", "Gao", "Lin", "He", "Guo", "Luo"],
};

const EXTRA_GIVEN_NAMES: Record<string, readonly string[]> = {
  USA: ["Bryce", "Tanner", "Carson", "Colton", "Gavin", "Preston", "Chase", "Eli"],
  "Dominican Republic": ["Yermín", "Leury", "Neftali", "Aderlin", "Raimel", "Elvis", "Kelvin", "Joely"],
  Venezuela: ["Renato", "Rougned", "Ender", "Ranger", "Jhoulys", "Yusmeiro", "Omar", "German"],
  Mexico: ["Javier", "Manuel", "Alonso", "Joey", "Efrain", "Oswaldo", "Marcelo", "Armando"],
  Cuba: ["Yasiel", "Yusniel", "Yennier", "Rogelio", "Michel", "Livan", "Orlando", "Yunito"],
  "Puerto Rico": ["Yadier", "Kike", "Roberto", "Giovanny", "Jorge", "Dereck", "Jonathan", "Victor"],
  Canada: ["Cal", "Bo", "Vladimir", "Russell", "Jamie", "Nick", "Tyler", "Jared"],
  Panama: ["Paolo", "Humberto", "Manny", "Jaime", "Ruben", "Javier", "Carlos", "Miguel"],
  Japan: ["Ryo", "Kohei", "Yuya", "Keita", "Seiya", "Kensuke", "Ryusei", "Akira"],
  Taiwan: ["Chun-Lin", "Wei-Yin", "Cheng-Hao", "Yao-Lin", "Chia-Jen", "Hung-Wen", "Jen-Ho", "Kuan-Yu"],
  Australia: ["Liam", "Tim", "Robbie", "Steven", "Kyle", "Daniel", "Jarryd", "Dylan"],
  Philippines: ["Joshua", "Marvin", "Jerome", "Dante", "Renzo", "Julian", "Vincent", "Anton"],
  China: ["Dong", "Sheng", "Yu", "Bin", "Feng", "Hong", "Xin", "Jie"],
};

const EXTRA_FAMILY_NAMES: Record<string, readonly string[]> = {
  USA: ["McCarthy", "Fletcher", "Hendricks", "Newman", "Holloway", "Beckett", "Davenport", "Whitaker"],
  "Dominican Republic": ["Alcantara", "Candelario", "Dominguez", "Jimenez", "Ozuna", "Peguero", "Villar", "Ynoa"],
  Venezuela: ["Altuve", "Astudillo", "Carrasco", "Fermin", "Galvis", "Odor", "Perez", "Tovar"],
  Mexico: ["Barrera", "Cantu", "Gallegos", "Kirk", "Paredes", "Romo", "Serrano", "Tellez"],
  Cuba: ["Alvarez", "Despaigne", "Fernandez", "Martinez", "Moinelo", "Pito", "Ramos", "Santana"],
  "Puerto Rico": ["Alomar", "Cora", "Delgado", "Diaz", "Feliciano", "Nieves", "Rios", "Serrano"],
  Canada: ["Quantrill", "Votto", "Paxton", "Romano", "Bay", "Lawrie", "Soroka", "Whitt"],
  Panama: ["Cedeño", "Delgado", "Herrera", "Lee", "Montero", "Rivera", "Rodriguez", "Stempel"],
  Japan: ["Adachi", "Endo", "Kaneko", "Maeda", "Miyazaki", "Ogawa", "Sakamoto", "Ueda"],
  Taiwan: ["Chu", "Fang", "Ho", "Hung", "Liao", "Pan", "Shih", "Teng"],
  Australia: ["Bazzana", "Bourne", "Dale", "Gibbons", "Hendrickson", "Mead", "Nilsson", "Rowland-Smith"],
  Philippines: ["Abad", "Alcantara", "De Leon", "Dela Rosa", "Lacson", "Salazar", "Tan", "Valdez"],
  China: ["Cao", "Deng", "Fan", "Hu", "Jiang", "Qian", "Tang", "Xie"],
};

const PITCHES = ["포심", "투심", "싱커", "커터", "슬라이더", "커브", "체인지업", "스플리터"] as const;
const FOREIGN_PLAYER_GENERATION_VERSION = 3;

const LEAGUE_OVERALL_PROFILE: Record<ForeignOriginLeague, { center: number; floor: number; ceiling: number }> = {
  MLB: { center: 82, floor: 78, ceiling: 89 },
  AAA: { center: 77, floor: 72, ceiling: 88 },
  AA: { center: 71, floor: 66, ceiling: 84 },
  MiLB: { center: 68, floor: 63, ceiling: 82 },
  "Mexican League": { center: 73, floor: 68, ceiling: 85 },
  Independent: { center: 67, floor: 61, ceiling: 81 },
  NPB: { center: 79, floor: 75, ceiling: 88 },
  "NPB Futures": { center: 70, floor: 65, ceiling: 83 },
  "Japanese Industrial": { center: 68, floor: 63, ceiling: 81 },
  CPBL: { center: 73, floor: 68, ceiling: 85 },
  ABL: { center: 66, floor: 60, ceiling: 80 },
};

export function generateForeignPlayerMarket(
  rng: Rng,
  year: number,
  standardCount = 80,
  asianQuotaCount = 30,
): ForeignPlayerCandidate[] {
  const usedNames = new Set<string>();
  return [
    ...Array.from({ length: standardCount }, (_, index) => createForeignCandidate(rng, year, "standard", index, usedNames)),
    ...Array.from({ length: asianQuotaCount }, (_, index) => createForeignCandidate(rng, year, "asian-quota", index, usedNames)),
  ];
}

export function foreignAdaptationEfficiency(adaptation: number): number {
  return roundTo(clamp(0.72 + clamp(adaptation, 0, 100) * 0.0033, 0.72, 1.05), 3);
}

export function effectiveForeignOverall(baseOverall: number, adaptation: number): number {
  return roundTo(baseOverall * foreignAdaptationEfficiency(adaptation), 1);
}

export function createForeignCareerSeason(
  rng: Rng,
  player: ForeignPlayerCandidate,
  seasonYear: number,
  league: ForeignOriginLeague = player.formerLeague,
  statsOverride?: ForeignRecentStats,
): ForeignCareerSeason {
  const age = player.age + Math.max(0, seasonYear - player.marketYear);
  const ageDecline = Math.max(0, age - 32) * randomFloat(rng, 0.35, 1.05);
  const seasonHidden = {
    ...player.hidden,
    baseOverall: Math.round(clamp(player.hidden.baseOverall - ageDecline + randomFloat(rng, -2.8, 2.5), 44, 89)),
  };
  const pitcherTools = player.playerGroup === "pitcher" ? createPitcherTools(rng, seasonHidden) : undefined;
  const hitterTools = player.playerGroup === "hitter" ? createHitterTools(rng, seasonHidden, player.primaryPosition) : undefined;
  return {
    seasonYear,
    age,
    league,
    stats: statsOverride ?? createRecentStats(rng, player.playerGroup, player.primaryPosition, seasonHidden, pitcherTools, hitterTools),
  };
}

function createForeignCandidate(
  rng: Rng,
  year: number,
  slotType: ForeignPlayerSlot,
  index: number,
  usedNames: Set<string>,
): ForeignPlayerCandidate {
  const nationality = weightedPick(rng, slotType === "standard" ? STANDARD_NATIONALITIES : ASIAN_QUOTA_NATIONALITIES);
  const name = uniqueForeignName(rng, nationality, usedNames);
  const playerGroup = weightedPick<ForeignPlayerGroup>(rng, slotType === "standard"
    ? [{ value: "pitcher", weight: 64 }, { value: "hitter", weight: 36 }]
    : [{ value: "pitcher", weight: 56 }, { value: "hitter", weight: 44 }]);
  const primaryPosition = createPosition(rng, playerGroup);
  const formerLeague = createFormerLeague(rng, slotType, nationality);
  const age = createAge(rng, formerLeague, slotType);
  const hidden = createHiddenProfile(rng, formerLeague, age, slotType);
  const throws = rng.next() < 0.27 ? "L" : "R";
  const bats: Handedness = playerGroup === "pitcher" ? (rng.next() < 0.22 ? "L" : "R") : weightedPick(rng, [
    { value: "R" as const, weight: 57 },
    { value: "L" as const, weight: 32 },
    { value: "S" as const, weight: 11 },
  ]);
  const pitcherTools = playerGroup === "pitcher" ? createPitcherTools(rng, hidden) : undefined;
  const hitterTools = playerGroup === "hitter" ? createHitterTools(rng, hidden, primaryPosition) : undefined;
  const careerHistory = createForeignCareerHistory(rng, year, age, formerLeague, playerGroup, primaryPosition, hidden);
  const recentStats = careerHistory[careerHistory.length - 1].stats;
  const riskTags = createRiskTags(rng, playerGroup, hidden, recentStats, age);
  const confidence = reportConfidence(rng, formerLeague);
  const estimatedOverall = clamp(hidden.baseOverall + randomInt(rng, -Math.round((1 - confidence) * 13), Math.round((1 - confidence) * 13)), 45, 88);
  const expectedOverallRange = createRange(estimatedOverall, Math.round(3 + (1 - confidence) * 7), 40, 90);
  const estimatedAdaptation = clamp(hidden.kboAdaptation + randomInt(rng, -16, 16), 10, 96);
  const expectedAdaptationRange = createRange(estimatedAdaptation, Math.round(8 + (1 - confidence) * 13), 0, 100);
  const expectedSalaryUsd = createSalaryRange(hidden.baseOverall, slotType, formerLeague, age);
  const riskLevel = createRiskLevel(hidden, riskTags);
  const strengths = createStrengths(playerGroup, pitcherTools, hitterTools, hidden);
  const weaknesses = createWeaknesses(playerGroup, pitcherTools, hitterTools, hidden, riskTags);

  return {
    id: `foreign-${year}-${slotType}-${index}-${slugName(name)}` as ForeignPlayerId,
    generationVersion: FOREIGN_PLAYER_GENERATION_VERSION,
    marketYear: year,
    slotType,
    status: "available",
    name,
    nationality,
    age,
    playerGroup,
    primaryPosition,
    secondaryPositions: createSecondaryPositions(rng, primaryPosition),
    throws,
    bats,
    formerLeague,
    formerClubLevel: formerClubLevel(formerLeague),
    preferredCondition: weightedPick<ForeignPlayerPreference>(rng, [
      { value: "money", weight: 25 },
      { value: "championship", weight: 17 },
      { value: "guaranteed-role", weight: 23 },
      { value: "stability", weight: 17 },
      { value: "large-market", weight: 8 },
      { value: "overseas-return", weight: 10 },
    ]),
    recentStats,
    careerHistory,
    pitcherTools,
    hitterTools,
    pitchMix: pitcherTools ? createPitchMix(rng, pitcherTools) : undefined,
    visible: {
      scoutGrade: scoutGrade(estimatedOverall),
      confidence,
      expectedOverallRange,
      expectedAdaptationRange,
      expectedSalaryUsd,
      riskLevel,
      riskTags,
      strengths,
      weaknesses,
      summary: createSummary(name, formerLeague, playerGroup, strengths, weaknesses, expectedAdaptationRange),
    },
    hidden,
  };
}

function createHiddenProfile(rng: Rng, league: ForeignOriginLeague, age: number, slotType: ForeignPlayerSlot): ForeignHiddenProfile {
  const profile = LEAGUE_OVERALL_PROFILE[league];
  const talentNoise = (rng.next() + rng.next() + rng.next() - 1.5) * 11;
  const agePenalty = Math.max(0, age - 32) * randomFloat(rng, 0.7, 1.4);
  const slotPenalty = slotType === "asian-quota" ? 2 : 0;
  const ageAdjustedFloor = profile.floor - Math.max(0, age - 34) * 1.5 - slotPenalty;
  const rawOverall = profile.center + talentNoise - agePenalty - slotPenalty;
  const baseOverall = Math.round(clamp(Math.max(rawOverall, ageAdjustedFloor), 48, profile.ceiling));
  const regionalBonus = league === "Japanese Industrial" ? 7 : ["NPB", "NPB Futures", "CPBL", "ABL"].includes(league) ? 9 : 0;
  return {
    baseOverall,
    kboAdaptation: Math.round(clamp(randomFloat(rng, 28, 88) + regionalBonus - Math.max(0, age - 34) * 1.3, 12, 98)),
    adjustmentSpeed: Math.round(clamp(randomFloat(rng, 25, 92) + regionalBonus * 0.4, 10, 98)),
    volatility: roundTo(randomFloat(rng, 0.18, 0.9), 2),
    injuryRisk: roundTo(clamp(randomFloat(rng, 0.12, 0.78) + Math.max(0, age - 32) * 0.025, 0.08, 0.94), 2),
    declineRisk: roundTo(clamp(0.12 + Math.max(0, age - 29) * 0.075 + randomFloat(rng, -0.08, 0.15), 0.06, 0.92), 2),
    motivation: Math.round(randomFloat(rng, 30, 96)),
  };
}

function createPitcherTools(rng: Rng, hidden: ForeignHiddenProfile): ForeignPitcherTools {
  const base = hidden.baseOverall;
  return {
    command: toolValue(rng, base, 13),
    stuff: toolValue(rng, base + 2, 11),
    velocity: toolValue(rng, base + 1, 12),
    stamina: toolValue(rng, base - 2, 13),
    mentality: toolValue(rng, (base + hidden.kboAdaptation) / 2, 11),
  };
}

function createHitterTools(rng: Rng, hidden: ForeignHiddenProfile, position: Position): ForeignHitterTools {
  const base = hidden.baseOverall;
  const cornerPower = ["1B", "3B", "LF", "RF"].includes(position) ? 5 : 0;
  const middleDefense = ["C", "2B", "SS", "CF"].includes(position) ? 5 : 0;
  return {
    contact: toolValue(rng, base, 12),
    discipline: toolValue(rng, base - 1, 13),
    speed: toolValue(rng, base - cornerPower + middleDefense, 15),
    power: toolValue(rng, base + cornerPower, 13),
    defense: toolValue(rng, base - cornerPower + middleDefense, 13),
    mentality: toolValue(rng, (base + hidden.kboAdaptation) / 2, 11),
  };
}

function createRecentStats(
  rng: Rng,
  group: ForeignPlayerGroup,
  position: Position,
  hidden: ForeignHiddenProfile,
  pitcherTools?: ForeignPitcherTools,
  hitterTools?: ForeignHitterTools,
): ForeignRecentStats {
  if (group === "pitcher" && pitcherTools) return createPitcherStats(rng, position, hidden, pitcherTools);
  return createHitterStats(rng, hidden, hitterTools!);
}

function createForeignCareerHistory(
  rng: Rng,
  marketYear: number,
  currentAge: number,
  currentLeague: ForeignOriginLeague,
  group: ForeignPlayerGroup,
  position: Position,
  hidden: ForeignHiddenProfile,
): ForeignCareerSeason[] {
  const seasonCount = randomInt(rng, 3, 5);
  return Array.from({ length: seasonCount }, (_, index) => {
    const seasonsAgo = seasonCount - index;
    const age = currentAge - seasonsAgo;
    const ageTrend = currentAge <= 29
      ? -seasonsAgo * randomFloat(rng, 0.35, 1.05)
      : currentAge >= 33
        ? seasonsAgo * randomFloat(rng, 0.25, 0.9)
        : randomFloat(rng, -1.5, 1.5);
    const seasonHidden = {
      ...hidden,
      baseOverall: Math.round(clamp(hidden.baseOverall + ageTrend + randomFloat(rng, -3.2, 3.2), 44, 88)),
    };
    const pitcherTools = group === "pitcher" ? createPitcherTools(rng, seasonHidden) : undefined;
    const hitterTools = group === "hitter" ? createHitterTools(rng, seasonHidden, position) : undefined;
    return {
      seasonYear: marketYear - seasonsAgo,
      age,
      league: historicalLeague(currentLeague, seasonsAgo, seasonCount, rng),
      stats: createRecentStats(rng, group, position, seasonHidden, pitcherTools, hitterTools),
    };
  });
}

function historicalLeague(currentLeague: ForeignOriginLeague, seasonsAgo: number, seasonCount: number, rng: Rng): ForeignOriginLeague {
  const earlyCareer = seasonsAgo >= Math.max(2, seasonCount - 1);
  if (currentLeague === "MLB") return earlyCareer || rng.next() < 0.25 ? "AAA" : "MLB";
  if (currentLeague === "AAA") return earlyCareer && rng.next() < 0.68 ? "AA" : "AAA";
  if (currentLeague === "AA") return earlyCareer && rng.next() < 0.55 ? "MiLB" : "AA";
  if (currentLeague === "NPB") return earlyCareer || rng.next() < 0.2 ? "NPB Futures" : "NPB";
  if (currentLeague === "CPBL" && earlyCareer && rng.next() < 0.25) return "Independent";
  return currentLeague;
}

function createPitcherStats(rng: Rng, position: Position, hidden: ForeignHiddenProfile, tools: ForeignPitcherTools): ForeignPitcherRecentStats {
  const starter = position === "SP";
  const innings = starter ? randomInt(rng, 82, 162) : randomInt(rng, 38, 79);
  const era = clamp(6.15 - (hidden.baseOverall - 48) * 0.075 - (tools.command - 50) * 0.018 + randomFloat(rng, -0.55, 0.65), 1.85, 7.2);
  const strikeoutsPerNine = clamp(5.1 + (tools.stuff - 45) * 0.075 + randomFloat(rng, -0.7, 0.8), 4.2, 13.2);
  const walksPerNine = clamp(5.2 - (tools.command - 42) * 0.055 + randomFloat(rng, -0.35, 0.5), 1.1, 6.3);
  const averageVelocityKph = clamp(139 + (tools.velocity - 45) * 0.22 + randomFloat(rng, -1.4, 1.4), 137, 156);
  return {
    kind: "pitcher",
    games: starter ? randomInt(rng, 18, 29) : randomInt(rng, 34, 65),
    innings: roundTo(innings + randomInt(rng, 0, 2) / 3, 1),
    wins: starter ? randomInt(rng, 4, Math.max(5, Math.min(17, Math.round(18 - era * 1.4)))) : randomInt(rng, 1, 6),
    losses: starter ? randomInt(rng, 3, Math.max(4, Math.min(14, Math.round(era * 1.8)))) : randomInt(rng, 1, 7),
    saves: starter ? 0 : tools.mentality >= 70 && rng.next() < 0.28 ? randomInt(rng, 8, 31) : randomInt(rng, 0, 4),
    holds: starter ? 0 : randomInt(rng, 1, tools.stuff >= 65 ? 22 : 13),
    strikeouts: Math.round(innings * strikeoutsPerNine / 9),
    walks: Math.round(innings * walksPerNine / 9),
    era: roundTo(era, 2),
    whip: roundTo(clamp(0.86 + era * 0.105 + walksPerNine * 0.03 + randomFloat(rng, -0.08, 0.1), 0.86, 1.78), 2),
    strikeoutsPerNine: roundTo(strikeoutsPerNine, 1),
    walksPerNine: roundTo(walksPerNine, 1),
    averageVelocityKph: roundTo(averageVelocityKph, 1),
    maxVelocityKph: roundTo(clamp(averageVelocityKph + randomFloat(rng, 3.1, 6.4), 142, 161), 1),
  };
}

function createHitterStats(rng: Rng, hidden: ForeignHiddenProfile, tools: ForeignHitterTools): ForeignHitterRecentStats {
  const average = clamp(0.205 + (tools.contact - 42) * 0.00225 + randomFloat(rng, -0.018, 0.02), 0.185, 0.348);
  const walkRate = clamp(0.045 + (tools.discipline - 40) * 0.00115 + randomFloat(rng, -0.009, 0.012), 0.035, 0.145);
  const slugging = clamp(average + 0.105 + (tools.power - 42) * 0.004 + randomFloat(rng, -0.025, 0.03), 0.29, 0.68);
  const obp = clamp(average + walkRate * 0.72 + randomFloat(rng, 0.005, 0.025), average + 0.025, 0.45);
  const games = randomInt(rng, 82, 142);
  const plateAppearances = Math.round(games * randomFloat(rng, 3.4, 4.35));
  const atBats = Math.round(plateAppearances * clamp(0.91 - walkRate, 0.78, 0.89));
  const hits = Math.round(atBats * average);
  const homeRuns = Math.max(1, Math.round((tools.power - 35) * 0.55 + games * 0.035 + randomFloat(rng, -4, 5)));
  return {
    kind: "hitter",
    games,
    plateAppearances,
    atBats,
    hits,
    doubles: Math.max(4, Math.round(hits * randomFloat(rng, 0.16, 0.25))),
    triples: Math.max(0, Math.round((tools.speed - 38) * 0.06 + randomFloat(rng, -1, 2))),
    runsBattedIn: Math.max(8, Math.round(homeRuns * 2.1 + hits * 0.22 + randomFloat(rng, -7, 9))),
    average: roundTo(average, 3),
    onBasePercentage: roundTo(obp, 3),
    sluggingPercentage: roundTo(slugging, 3),
    ops: roundTo(obp + slugging, 3),
    homeRuns,
    strikeoutRate: roundTo(clamp(0.31 - (tools.contact - 42) * 0.0022 - (tools.discipline - 45) * 0.001 + randomFloat(rng, -0.018, 0.022), 0.105, 0.34), 3),
    walkRate: roundTo(walkRate, 3),
    stolenBases: Math.max(0, Math.round((tools.speed - 45) * 0.32 + randomFloat(rng, -3, 5))),
  };
}

function createRiskTags(rng: Rng, group: ForeignPlayerGroup, hidden: ForeignHiddenProfile, stats: ForeignRecentStats, age: number): ForeignRiskTag[] {
  const tags: ForeignRiskTag[] = [];
  if (hidden.injuryRisk >= 0.62) tags.push("injury-history");
  if (hidden.kboAdaptation <= 43) tags.push("kbo-adjustment");
  if (hidden.volatility >= 0.72) tags.push("limited-sample");
  if (age >= 34 || hidden.declineRisk >= 0.64) tags.push("age-decline");
  if (group === "pitcher" && stats.kind === "pitcher") {
    if (stats.walksPerNine >= 4.3) tags.push("command-variance");
    if (age >= 32 && rng.next() < 0.38) tags.push("velocity-decline");
  }
  if (group === "hitter" && stats.kind === "hitter") {
    if (stats.strikeoutRate >= 0.255) tags.push("strikeout-heavy");
    if (rng.next() < 0.2) tags.push("breaking-ball-adjustment");
    if (rng.next() < 0.16) tags.push("defensive-limit");
  }
  return tags.slice(0, 4);
}

function createStrengths(group: ForeignPlayerGroup, pitcher: ForeignPitcherTools | undefined, hitter: ForeignHitterTools | undefined, hidden: ForeignHiddenProfile): string[] {
  if (group === "pitcher" && pitcher) {
    return [
      ["구위", pitcher.stuff], ["구속", pitcher.velocity], ["제구", pitcher.command], ["이닝 소화력", pitcher.stamina], ["마운드 운영", pitcher.mentality],
    ].sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 2).map(([label]) => String(label));
  }
  const values: [string, number][] = [["컨택", hitter!.contact], ["장타력", hitter!.power], ["선구안", hitter!.discipline], ["주루", hitter!.speed], ["수비", hitter!.defense]];
  if (hidden.kboAdaptation >= 76) values.push(["리그 적응 기대", hidden.kboAdaptation]);
  return values.sort((a, b) => b[1] - a[1]).slice(0, 2).map(([label]) => label);
}

function createWeaknesses(group: ForeignPlayerGroup, pitcher: ForeignPitcherTools | undefined, hitter: ForeignHitterTools | undefined, hidden: ForeignHiddenProfile, risks: ForeignRiskTag[]): string[] {
  const values: [string, number][] = group === "pitcher" && pitcher
    ? [["제구 안정성", pitcher.command], ["구위 유지", pitcher.stuff], ["체력", pitcher.stamina], ["환경 적응", hidden.kboAdaptation]]
    : [["변화구 대응", hitter!.contact], ["존 관리", hitter!.discipline], ["수비 활용도", hitter!.defense], ["환경 적응", hidden.kboAdaptation]];
  const result = values.sort((a, b) => a[1] - b[1]).slice(0, 2).map(([label]) => label);
  if (risks.includes("injury-history")) result[1] = "부상 이력";
  return result;
}

function createRiskLevel(hidden: ForeignHiddenProfile, tags: ForeignRiskTag[]): RiskLevel {
  const score = hidden.injuryRisk * 42 + hidden.volatility * 28 + (1 - hidden.kboAdaptation / 100) * 30 + tags.length * 4;
  if (score >= 73) return "extreme";
  if (score >= 57) return "high";
  if (score >= 39) return "medium";
  return "low";
}

function createSummary(name: string, league: ForeignOriginLeague, group: ForeignPlayerGroup, strengths: string[], weaknesses: string[], adaptation: Range): string {
  return `${name}: ${league} ${group === "pitcher" ? "투수" : "야수"} 경력을 바탕으로 ${strengths.join("과 ")}에 강점이 있다. ${weaknesses.join("과 ")} 검증이 필요하며 KBO 적응 전망은 ${adaptationRangeLabel(adaptation)} 수준이다.`;
}

function adaptationRangeLabel(range: Range): string {
  const level = (value: number): string => {
    if (value >= 86) return "최상";
    if (value >= 73) return "상";
    if (value >= 61) return "중상";
    if (value >= 46) return "중";
    if (value >= 33) return "중하";
    if (value >= 19) return "하";
    return "최하";
  };
  const high = level(range.max);
  const low = level(range.min);
  return high === low ? high : `${high}~${low}`;
}

function createSalaryRange(overall: number, slotType: ForeignPlayerSlot, league: ForeignOriginLeague, age: number): Range {
  if (slotType === "asian-quota") {
    const center = clamp(90000 + (overall - 55) * 7500, 60000, 190000);
    return createRange(center, 20000, 40000, 200000);
  }
  const leaguePremium = league === "MLB" ? 130000 : league === "AAA" ? 70000 : 0;
  const ageDiscount = Math.max(0, age - 34) * 25000;
  const center = clamp(230000 + (overall - 52) * 27000 + leaguePremium - ageDiscount, 150000, 950000);
  return createRange(center, 70000, 100000, 1000000);
}

function createPosition(rng: Rng, group: ForeignPlayerGroup): Position {
  if (group === "pitcher") return weightedPick(rng, [{ value: "SP", weight: 78 }, { value: "RP", weight: 22 }]);
  return weightedPick(rng, [
    { value: "C", weight: 3 }, { value: "1B", weight: 23 }, { value: "2B", weight: 7 }, { value: "3B", weight: 15 },
    { value: "SS", weight: 5 }, { value: "LF", weight: 18 }, { value: "CF", weight: 12 }, { value: "RF", weight: 17 },
  ]);
}

function createSecondaryPositions(rng: Rng, primary: Position): Position[] {
  const options: Partial<Record<Position, Position[]>> = {
    SP: ["RP"], RP: ["SP"], C: ["1B"], "1B": ["LF", "RF"], "2B": ["SS", "3B"], "3B": ["1B", "2B"],
    SS: ["2B", "3B"], LF: ["RF", "1B"], CF: ["LF", "RF"], RF: ["LF", "1B"],
  };
  const pool = options[primary] ?? [];
  return pool.length > 0 && rng.next() < 0.68 ? [pickOne(rng, pool)] : [];
}

function createFormerLeague(rng: Rng, slotType: ForeignPlayerSlot, nationality: string): ForeignOriginLeague {
  if (slotType === "asian-quota") {
    if (nationality === "Japan") return weightedPick(rng, [
      { value: "NPB", weight: 20 },
      { value: "NPB Futures", weight: 50 },
      { value: "Japanese Industrial", weight: 30 },
    ]);
    if (nationality === "Taiwan") return weightedPick(rng, [{ value: "CPBL", weight: 78 }, { value: "Independent", weight: 22 }]);
    if (nationality === "Australia") return weightedPick(rng, [{ value: "ABL", weight: 72 }, { value: "Independent", weight: 28 }]);
    return weightedPick(rng, [{ value: "Independent", weight: 65 }, { value: "ABL", weight: 35 }]);
  }
  if (nationality === "Japan") return weightedPick(rng, [
    { value: "NPB", weight: 55 },
    { value: "NPB Futures", weight: 25 },
    { value: "Japanese Industrial", weight: 20 },
  ]);
  if (nationality === "Taiwan") return weightedPick(rng, [
    { value: "CPBL", weight: 85 },
    { value: "Independent", weight: 15 },
  ]);
  return weightedPick(rng, [
    { value: "MLB", weight: 5 }, { value: "AAA", weight: 48 }, { value: "AA", weight: 17 }, { value: "MiLB", weight: 8 },
    { value: "Mexican League", weight: 10 }, { value: "Independent", weight: 8 }, { value: "NPB", weight: 4 },
  ]);
}

function createAge(rng: Rng, league: ForeignOriginLeague, slotType: ForeignPlayerSlot): number {
  if (slotType === "asian-quota") return randomInt(rng, 23, 32);
  if (league === "MLB" || league === "NPB") return randomInt(rng, 29, 37);
  if (league === "AA" || league === "MiLB") return randomInt(rng, 24, 31);
  return randomInt(rng, 25, 35);
}

function createPitchMix(rng: Rng, tools: ForeignPitcherTools): string[] {
  const count = tools.stuff >= 72 ? 5 : tools.stuff >= 62 ? 4 : 3;
  const fastball = pickOne(rng, ["포심", "투심", "싱커"] as const);
  const others = PITCHES.filter((pitch) => pitch !== fastball);
  const result: string[] = [fastball];
  while (result.length < count && others.length > 0) {
    const pitch = pickOne(rng, others);
    if (!result.includes(pitch)) result.push(pitch);
  }
  return result;
}

function reportConfidence(rng: Rng, league: ForeignOriginLeague): number {
  const base = league === "MLB" || league === "AAA" || league === "NPB" || league === "CPBL" ? 0.78 : league === "AA" || league === "NPB Futures" ? 0.67 : league === "Japanese Industrial" ? 0.61 : 0.56;
  return roundTo(clamp(base + randomFloat(rng, -0.1, 0.1), 0.42, 0.92), 2);
}

function scoutGrade(overall: number): ScoutGrade {
  if (overall >= 80) return "S";
  if (overall >= 73) return "A";
  if (overall >= 66) return "B";
  if (overall >= 59) return "C";
  if (overall >= 52) return "D";
  return "E";
}

function formerClubLevel(league: ForeignOriginLeague): string {
  if (league === "MLB") return "메이저 40인 로스터 경력";
  if (league === "AAA") return "트리플A 주전급";
  if (league === "AA") return "더블A 상위 레벨";
  if (league === "MiLB") return "마이너리그 경력";
  if (league === "NPB") return "NPB 1군 경력";
  if (league === "NPB Futures") return "NPB 2군 경력";
  if (league === "Japanese Industrial") return "일본 실업리그 주전급";
  if (league === "CPBL") return "대만 프로야구 1군";
  if (league === "ABL") return "호주리그 주전급";
  return league === "Mexican League" ? "멕시칸리그 주전급" : "독립리그 주전급";
}

function uniqueForeignName(rng: Rng, nationality: string, used: Set<string>): string {
  const given = [...(GIVEN_NAMES[nationality] ?? GIVEN_NAMES.USA), ...(EXTRA_GIVEN_NAMES[nationality] ?? [])];
  const family = [...(FAMILY_NAMES[nationality] ?? FAMILY_NAMES.USA), ...(EXTRA_FAMILY_NAMES[nationality] ?? [])];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const name = `${pickOne(rng, given)} ${pickOne(rng, family)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${pickOne(rng, given)} ${pickOne(rng, family)} ${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

function toolValue(rng: Rng, center: number, spread: number): number {
  return Math.round(clamp(center + randomFloat(rng, -spread, spread), 30, 90));
}

function createRange(center: number, spread: number, min: number, max: number): Range {
  return {
    min: Math.round(clamp(center - spread, min, max)),
    max: Math.round(clamp(center + spread, min, max)),
  };
}

function slugName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
