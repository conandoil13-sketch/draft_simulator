import { pickOne, weightedPick, type Rng } from "./random";
import { KOREAN_GIVEN_NAMES } from "../data/koreanGivenNames";

const FAMILY_NAME_WEIGHTS = [
  { value: "김", weight: 2150 },
  { value: "이", weight: 1460 },
  { value: "박", weight: 850 },
  { value: "최", weight: 470 },
  { value: "정", weight: 440 },
  { value: "강", weight: 250 },
  { value: "조", weight: 210 },
  { value: "윤", weight: 205 },
  { value: "장", weight: 200 },
  { value: "임", weight: 190 },
  { value: "한", weight: 185 },
  { value: "오", weight: 160 },
  { value: "서", weight: 150 },
  { value: "신", weight: 145 },
  { value: "권", weight: 140 },
  { value: "황", weight: 135 },
  { value: "안", weight: 130 },
  { value: "송", weight: 125 },
  { value: "류", weight: 118 },
  { value: "홍", weight: 112 },
  { value: "전", weight: 106 },
  { value: "고", weight: 96 },
  { value: "문", weight: 88 },
  { value: "양", weight: 84 },
  { value: "손", weight: 78 },
  { value: "배", weight: 70 },
  { value: "백", weight: 66 },
  { value: "허", weight: 62 },
  { value: "유", weight: 58 },
  { value: "남", weight: 54 },
  { value: "심", weight: 50 },
  { value: "노", weight: 48 },
  { value: "하", weight: 45 },
  { value: "곽", weight: 42 },
  { value: "성", weight: 39 },
  { value: "차", weight: 36 },
  { value: "주", weight: 34 },
  { value: "우", weight: 30 },
  { value: "구", weight: 28 },
  { value: "민", weight: 26 },
  { value: "진", weight: 24 },
  { value: "지", weight: 22 },
  { value: "엄", weight: 20 },
  { value: "채", weight: 19 },
  { value: "원", weight: 18 },
  { value: "천", weight: 17 },
  { value: "방", weight: 16 },
  { value: "공", weight: 15 },
  { value: "현", weight: 14 },
  { value: "여", weight: 13 },
  { value: "봉", weight: 12 },
  { value: "변", weight: 12 },
  { value: "석", weight: 11 },
  { value: "마", weight: 10 },
  { value: "길", weight: 10 },
  { value: "도", weight: 9 },
  { value: "명", weight: 9 },
  { value: "육", weight: 8 },
  { value: "표", weight: 8 },
  { value: "라", weight: 8 },
  { value: "은", weight: 7 },
  { value: "설", weight: 7 },
  { value: "기", weight: 7 },
  { value: "반", weight: 6 },
  { value: "왕", weight: 6 },
  { value: "금", weight: 6 },
  { value: "옥", weight: 5 },
  { value: "맹", weight: 5 },
  { value: "제", weight: 5 },
  { value: "모", weight: 5 },
  { value: "편", weight: 4 },
  { value: "경", weight: 4 },
  { value: "계", weight: 4 },
  { value: "연", weight: 4 },
  { value: "위", weight: 4 },
  { value: "탁", weight: 4 },
  { value: "팽", weight: 4 },
  { value: "형", weight: 4 },
  { value: "빈", weight: 3 },
  { value: "좌", weight: 3 },
  { value: "선", weight: 3 },
  { value: "소", weight: 3 },
  { value: "시", weight: 3 },
  { value: "가", weight: 3 },
  { value: "복", weight: 3 },
  { value: "상", weight: 3 },
  { value: "사", weight: 3 },
  { value: "부", weight: 3 },
  { value: "감", weight: 2 },
  { value: "내", weight: 2 },
  { value: "당", weight: 2 },
  { value: "동", weight: 2 },
  { value: "두", weight: 2 },
  { value: "묵", weight: 2 },
  { value: "미", weight: 2 },
  { value: "범", weight: 2 },
  { value: "보", weight: 2 },
  { value: "빙", weight: 2 },
  { value: "순", weight: 2 },
  { value: "승", weight: 2 },
  { value: "아", weight: 2 },
  { value: "애", weight: 2 },
  { value: "양", weight: 2 },
  { value: "어", weight: 2 },
  { value: "영", weight: 2 },
  { value: "예", weight: 2 },
  { value: "용", weight: 2 },
  { value: "장", weight: 2 },
  { value: "저", weight: 2 },
  { value: "점", weight: 2 },
  { value: "종", weight: 2 },
  { value: "창", weight: 2 },
  { value: "초", weight: 2 },
  { value: "추", weight: 2 },
  { value: "탁", weight: 2 },
  { value: "탄", weight: 2 },
  { value: "태", weight: 2 },
  { value: "판", weight: 2 },
  { value: "평", weight: 2 },
  { value: "피", weight: 2 },
  { value: "필", weight: 2 },
  { value: "학", weight: 2 },
  { value: "함", weight: 2 },
  { value: "호", weight: 2 },
  { value: "후", weight: 2 },
  { value: "남궁", weight: 6 },
  { value: "제갈", weight: 5 },
  { value: "선우", weight: 5 },
  { value: "황보", weight: 4 },
  { value: "사공", weight: 4 },
  { value: "독고", weight: 3 },
  { value: "동방", weight: 2 },
  { value: "서문", weight: 2 },
  { value: "어금", weight: 2 },
  { value: "망절", weight: 1 },
  { value: "무본", weight: 1 },
  { value: "등정", weight: 1 },
];

const GIVEN_FIRST = [
  "민", "서", "도", "준", "현", "지", "태", "우", "시", "건", "유", "하",
  "승", "재", "연", "찬", "윤", "수", "은", "율", "원", "경", "동", "성",
  "영", "진", "규", "상", "인", "해", "강", "범", "건", "리", "로", "이",
  "정", "호", "환", "겸", "주", "율", "예", "한", "담", "솔", "온", "찬",
  "태", "빈", "혁", "휘", "선", "형", "욱", "광", "동", "완", "기", "원",
  "명", "재", "아", "라", "린", "림", "가", "나", "다", "봄", "별", "찬",
];

const GIVEN_SECOND = [
  "준", "우", "현", "호", "율", "민", "재", "성", "원", "빈", "혁", "찬",
  "영", "수", "진", "석", "환", "규", "건", "후", "겸", "서", "윤", "하",
  "온", "율", "담", "솔", "결", "운", "범", "주", "혁", "재", "욱", "광",
  "민", "찬", "준", "호", "빈", "원", "우", "형", "완", "기", "선", "열",
  "림", "린", "아", "라", "나", "이", "봄", "별", "강", "겸", "겸", "도",
  "태", "성", "원", "현", "훈", "준", "완", "찬", "율", "겸", "솔", "후",
];

const SPECIAL_GIVEN_NAMES = [
  "요셉", "요한", "다윗", "이삭", "모세", "노아", "시온", "하온",
  "이준", "서준", "도윤", "하준", "시우", "지호", "예준", "주원",
  "유준", "도현", "지후", "준서", "현우", "건우", "우진", "선우",
  "민준", "민재", "서진", "연우", "정우", "승우", "지환", "태오",
  "이안", "로건", "리온", "로운", "하율", "서율", "지율", "은율",
  "하람", "가온", "라온", "해준", "해성", "찬우", "찬호", "준호",
  "태준", "태민", "현준", "규빈", "원준", "시현", "도겸", "유찬",
];

export function generateKoreanName(rng: Rng): string {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const roll = rng.next();
    const givenName =
      roll < 0.72
        ? pickOne(rng, KOREAN_GIVEN_NAMES)
        : roll < 0.86
          ? pickOne(rng, SPECIAL_GIVEN_NAMES)
          : `${pickOne(rng, GIVEN_FIRST)}${pickOne(rng, GIVEN_SECOND)}`;
    const name = `${weightedPick(rng, FAMILY_NAME_WEIGHTS)}${givenName}`;
    if (!hasRepeatedCharacter(name)) return name;
  }
  return "김도현";
}

function hasRepeatedCharacter(value: string): boolean {
  const seen = new Set<string>();
  for (const char of Array.from(value)) {
    if (seen.has(char)) return true;
    seen.add(char);
  }
  return false;
}
