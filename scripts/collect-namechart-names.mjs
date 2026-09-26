import { mkdir, writeFile } from "node:fs/promises";

const YEAR = 2024;
const GENDER = "m";
const MAX_PAGES = 70;
const MIN_HANGUL_LENGTH = 2;
const MAX_HANGUL_LENGTH = 2;
const UI_WORDS = new Set(["한국인", "네임차트", "통계", "문의하기", "이전", "다음", "남자", "여자", "전체", "순위", "이름", "출생아"]);

function extractNames(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, "\n")
    .replace(/<style[\s\S]*?<\/style>/g, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ");
  const tokens = text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.filter((token) => {
    if (!/^[가-힣]+$/.test(token)) return false;
    if (token.length < MIN_HANGUL_LENGTH || token.length > MAX_HANGUL_LENGTH) return false;
    if (UI_WORDS.has(token)) return false;
    return true;
  });
}

function unique(values) {
  return Array.from(new Set(values));
}

async function main() {
  const names = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `https://www.namechart.kr/chart/${YEAR}?gender=${GENDER}&page=${page}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "draft-sm local static name dataset collector",
      },
    });

    if (!response.ok) {
      console.warn(`skip page ${page}: ${response.status}`);
      continue;
    }

    const pageNames = extractNames(await response.text());
    names.push(...pageNames);
    console.log(`page ${page}: ${pageNames.length} names`);
  }

  const uniqueNames = unique(names);
  await mkdir("src/game/data", { recursive: true });
  await writeFile(
    "src/game/data/koreanGivenNames.ts",
    [
      "// Generated from publicly visible NameChart ranking pages for local static gameplay data.",
      "// Source: https://www.namechart.kr/chart/2024?gender=m",
      "// Cleaned to two-syllable Hangul given names for fictional player generation.",
      `export const KOREAN_GIVEN_NAMES = ${JSON.stringify(uniqueNames, null, 2)} as const;`,
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`saved ${uniqueNames.length} unique names`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
