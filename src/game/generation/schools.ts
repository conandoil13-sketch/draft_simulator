import type { Position } from "../types/common";
import type { SchoolDevelopmentBias, SchoolProfile, SchoolRegion, SchoolTier, SchoolTrait } from "../types/school";
import { clamp } from "../utils/math";
import { pickOne, randomInt, weightedPick, type Rng } from "./random";

const REGIONS: SchoolRegion[] = ["서울권", "경기·인천권", "강원권", "충청권", "대전·세종권", "전북권", "광주·전남권", "대구·경북권", "부산·울산·경남권", "제주권"];

const REAL_BASEBALL_SCHOOLS: Record<SchoolRegion, string[]> = {
  서울권: [
    "덕수고",
    "서울고",
    "경기고",
    "장충고",
    "휘문고",
    "충암고",
    "배명고",
    "신일고",
    "선린인터넷고",
    "성남고",
    "배재고",
    "청원고",
    "중앙고",
    "서울자동차고",
    "여의도고",
    "컨벤션고",
    "동대문상고",
    "대광고",
  ],
  "경기·인천권": [
    "유신고",
    "야탑고",
    "인천고",
    "동산고",
    "제물포고",
    "안산공고",
    "라온고",
    "율곡고",
    "수원장안고",
    "백송고",
    "청담고",
    "부천고",
    "부천진영정보공고",
    "소래고",
    "상우고",
    "충훈고",
    "비봉고",
    "경기항공고",
    "의정부공고",
    "인창고",
    "글로벌선진학교",
    "진영고",
    "인천동산고",
  ],
  강원권: ["강릉고", "원주고", "춘천고", "설악고", "강원고", "속초상고", "강릉중앙고", "영동고"],
  충청권: [
    "세광고",
    "청주고",
    "공주고",
    "천안북일고",
    "충주성심학교",
    "온양고",
    "서산공고",
    "당진정보고",
    "공주생명과학고",
    "청주공고",
    "제천산업고",
  ],
  "대전·세종권": ["북일고", "대전고", "대전제일고", "계룡디지텍고", "세종고", "한밭고", "대전생활과학고", "유성생명과학고"],
  전북권: ["군산상일고", "전주고", "인상고", "군산중앙고", "전주생명과학고", "익산고", "정읍고", "남성고"],
  "광주·전남권": [
    "광주제일고",
    "광주동성고",
    "광주진흥고",
    "화순고",
    "순천효천고",
    "여수정보과학고",
    "목포공고",
    "광남고",
    "나주광남고",
    "영산고",
  ],
  "대구·경북권": [
    "대구고",
    "경북고",
    "대구상원고",
    "포항제철고",
    "경주고",
    "도개고",
    "김천생명과학고",
    "구미전자공고",
    "안동고",
    "대구북구SC",
    "대구공고",
    "경산고",
  ],
  "부산·울산·경남권": [
    "부산고",
    "경남고",
    "개성고",
    "부산정보고",
    "부경고",
    "마산용마고",
    "마산고",
    "김해고",
    "물금고",
    "울산공고",
    "웅상고",
    "밀양고",
    "진해고",
    "창원공고",
    "부산공고",
    "동래고",
  ],
  제주권: ["제주고", "제주제일고", "오현고", "서귀포산업과학고", "남녕고", "제주중앙고"],
};

const ELITE_SCHOOL_NAMES = new Set([
  "덕수고",
  "서울고",
  "경기고",
  "장충고",
  "휘문고",
  "충암고",
  "신일고",
  "부산고",
  "경남고",
  "대구고",
  "경북고",
  "광주제일고",
  "군산상일고",
  "북일고",
  "유신고",
]);

const STRONG_SCHOOL_NAMES = new Set([
  "배명고",
  "선린인터넷고",
  "성남고",
  "야탑고",
  "인천고",
  "동산고",
  "제물포고",
  "라온고",
  "강릉고",
  "세광고",
  "청주고",
  "공주고",
  "대전고",
  "대전제일고",
  "전주고",
  "광주동성고",
  "광주진흥고",
  "화순고",
  "대구상원고",
  "포항제철고",
  "부산정보고",
  "개성고",
  "부경고",
  "마산용마고",
  "마산고",
  "김해고",
  "물금고",
  "울산공고",
  "제주고",
]);

const REGION_PREFIXES: Record<SchoolRegion, string[]> = {
  서울권: ["한강", "도성", "남산", "성북", "강서", "잠실", "서라벌", "백운", "청운", "문정"],
  "경기·인천권": ["수원", "부평", "송도", "안산", "고양", "성남", "평택", "의정부", "광명", "화성"],
  강원권: ["춘천", "강릉", "원주", "설악", "동해", "태백", "영월", "홍천"],
  충청권: ["청주", "천안", "아산", "서산", "공주", "충주", "당진", "예산"],
  "대전·세종권": ["대전", "세종", "유성", "한밭", "계룡", "금강", "둔산", "보문"],
  전북권: ["전주", "군산", "익산", "정읍", "완산", "새만금", "남원", "김제"],
  "광주·전남권": ["광주", "목포", "순천", "여수", "무등", "나주", "담양", "해남"],
  "대구·경북권": ["대구", "경산", "구미", "포항", "안동", "상주", "수성", "팔공"],
  "부산·울산·경남권": ["부산", "울산", "창원", "마산", "김해", "진주", "해운대", "낙동"],
  제주권: ["제주", "서귀포", "한라", "탐라", "오름", "성산"],
};

const SCHOOL_SUFFIXES = ["고", "상고", "공고", "중앙고", "제일고", "동산고", "미래고", "야구고"];

const BIAS_TRAIT_LABELS: Record<SchoolDevelopmentBias, SchoolTrait> = {
  pitching: "pitching",
  catcher: "catcher",
  "infield-defense": "infield-defense",
  power: "power",
  "speed-outfield": "speed-outfield",
  "two-way": "two-way",
  polished: "polished",
  raw: "raw",
};

export function generateSchoolPool(rng: Rng): SchoolProfile[] {
  const tierPlan: { tier: SchoolTier; count: number }[] = [
    { tier: "elite", count: 15 },
    { tier: "strong", count: 35 },
    { tier: "normal", count: 50 },
    { tier: "small", count: 20 },
  ];
  const usedNames = new Set<string>();
  const schools: SchoolProfile[] = [];

  for (const plan of tierPlan) {
    for (let index = 0; index < plan.count; index += 1) {
      const region = pickRegion(rng, plan.tier);
      const name = createSchoolName(rng, region, plan.tier, usedNames);
      const developmentBias = pickDevelopmentBias(rng, plan.tier);
      const traits = createTraits(rng, plan.tier, developmentBias);
      const annualProspectVolume = createAnnualVolume(rng, plan.tier);
      const leagueStrength = createLeagueStrength(rng, plan.tier, region);
      const reportReliabilityBase = createReportReliability(rng, plan.tier, traits);

      schools.push({
        id: `school-${schools.length + 1}`,
        name,
        region,
        tier: plan.tier,
        leagueStrength,
        annualProspectVolume,
        developmentBias,
        reportReliabilityBase,
        traits,
        positionBias: createPositionBias(developmentBias),
      });
    }
  }

  return schools;
}

export function createSchoolAssignments(rng: Rng, schools: SchoolProfile[], count: number): SchoolProfile[] {
  const pool = schools.flatMap((school) => Array.from({ length: school.annualProspectVolume }, () => school));
  const assignments: SchoolProfile[] = [];

  for (let rank = 1; rank <= count; rank += 1) {
    const candidates = pool.length > 0 ? pool : schools;
    const school = weightedPick(
      rng,
      candidates.map((candidate) => ({ value: candidate, weight: schoolRankWeight(candidate, rank) })),
    );
    assignments.push(school);
    const removeIndex = pool.findIndex((candidate) => candidate.id === school.id);
    if (removeIndex >= 0) pool.splice(removeIndex, 1);
  }

  return assignments;
}

function pickRegion(rng: Rng, tier: SchoolTier): SchoolRegion {
  const base = REGIONS.map((region) => ({
    value: region,
    weight: region === "서울권" || region === "경기·인천권" || region === "부산·울산·경남권" ? 5 : region === "제주권" ? 1 : 3,
  }));
  if (tier === "elite") {
    return weightedPick(rng, base.map((item) => ({ ...item, weight: item.weight + (item.value === "서울권" || item.value === "부산·울산·경남권" ? 3 : 0) })));
  }
  return weightedPick(rng, base);
}

function createSchoolName(rng: Rng, region: SchoolRegion, tier: SchoolTier, used: Set<string>): string {
  const regionalPool = REAL_BASEBALL_SCHOOLS[region].filter((name) => !used.has(name));
  const tierPool = regionalPool.filter((name) =>
    tier === "elite"
      ? ELITE_SCHOOL_NAMES.has(name)
      : tier === "strong"
        ? STRONG_SCHOOL_NAMES.has(name)
        : tier === "normal"
          ? !ELITE_SCHOOL_NAMES.has(name)
          : !ELITE_SCHOOL_NAMES.has(name) && !STRONG_SCHOOL_NAMES.has(name),
  );
  const selected = tierPool.length > 0 ? pickOne(rng, tierPool) : regionalPool.length > 0 ? pickOne(rng, regionalPool) : undefined;
  if (selected) {
    used.add(selected);
    return selected;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const name = `${pickOne(rng, REGION_PREFIXES[region])}${pickOne(rng, SCHOOL_SUFFIXES)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${pickOne(rng, REGION_PREFIXES[region])}${used.size + 1}고`;
  used.add(fallback);
  return fallback;
}

function pickDevelopmentBias(rng: Rng, tier: SchoolTier): SchoolDevelopmentBias {
  return weightedPick(rng, [
    { value: "pitching", weight: tier === "elite" ? 5 : 4 },
    { value: "catcher", weight: 2 },
    { value: "infield-defense", weight: 3 },
    { value: "power", weight: 3 },
    { value: "speed-outfield", weight: 3 },
    { value: "two-way", weight: tier === "small" ? 3 : 1 },
    { value: "polished", weight: tier === "elite" || tier === "strong" ? 4 : 2 },
    { value: "raw", weight: tier === "small" ? 5 : 2 },
  ]);
}

function createTraits(rng: Rng, tier: SchoolTier, bias: SchoolDevelopmentBias): SchoolTrait[] {
  const traits: SchoolTrait[] = [BIAS_TRAIT_LABELS[bias]];
  if ((tier === "elite" || tier === "strong") && rng.next() < 0.7) traits.push("high-data");
  if (tier === "small" && rng.next() < 0.62) traits.push("low-report");
  if (tier === "normal" && rng.next() < 0.18) traits.push("low-report");
  return traits;
}

function createAnnualVolume(rng: Rng, tier: SchoolTier): number {
  if (tier === "elite") return randomInt(rng, 4, 7);
  if (tier === "strong") return randomInt(rng, 2, 5);
  if (tier === "normal") return randomInt(rng, 1, 3);
  return randomInt(rng, 0, 2);
}

function createLeagueStrength(rng: Rng, tier: SchoolTier, region: SchoolRegion): number {
  const tierBase = tier === "elite" ? randomInt(rng, 82, 96) : tier === "strong" ? randomInt(rng, 68, 84) : tier === "normal" ? randomInt(rng, 45, 70) : randomInt(rng, 28, 58);
  const regionBoost = region === "서울권" || region === "경기·인천권" || region === "부산·울산·경남권" ? 4 : region === "제주권" ? -5 : 0;
  return Math.round(clamp(tierBase + regionBoost, 20, 99));
}

function createReportReliability(rng: Rng, tier: SchoolTier, traits: SchoolTrait[]): number {
  const base = tier === "elite" ? randomInt(rng, 78, 94) : tier === "strong" ? randomInt(rng, 62, 82) : tier === "normal" ? randomInt(rng, 42, 66) : randomInt(rng, 22, 48);
  const modifier = traits.includes("high-data") ? 8 : traits.includes("low-report") ? -10 : 0;
  return Math.round(clamp(base + modifier, 10, 98));
}

function createPositionBias(bias: SchoolDevelopmentBias): Partial<Record<Position, number>> {
  if (bias === "pitching") return { SP: 18, RP: 8 };
  if (bias === "catcher") return { C: 18 };
  if (bias === "infield-defense") return { SS: 12, "2B": 8, "3B": 6 };
  if (bias === "power") return { "1B": 10, LF: 8, RF: 8, "3B": 4 };
  if (bias === "speed-outfield") return { CF: 12, LF: 6, RF: 4, SS: 3 };
  if (bias === "two-way") return { SP: 8, RF: 6, "1B": 4 };
  return {};
}

function schoolRankWeight(school: SchoolProfile, rank: number): number {
  const tierWeight = school.tier === "elite" ? 7 : school.tier === "strong" ? 4.4 : school.tier === "normal" ? 2.1 : 1;
  const rankMultiplier = rank <= 40 ? (school.tier === "elite" ? 4 : school.tier === "strong" ? 2 : 0.5) : rank <= 100 ? (school.tier === "elite" ? 2.5 : school.tier === "strong" ? 2 : 1) : rank <= 180 ? (school.tier === "small" ? 1.2 : 1) : school.tier === "small" ? 2.2 : 1;
  return Math.max(0.2, tierWeight * rankMultiplier + school.leagueStrength / 35);
}
