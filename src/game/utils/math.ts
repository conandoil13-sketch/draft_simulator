export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function roundGrade(value: number): 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 {
  return clamp(Math.round(value / 5) * 5, 20, 80) as 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80;
}

export function toRange(center: number, spread: number, min = 0, max = 100): { min: number; max: number } {
  return {
    min: clamp(Math.round(center - spread), min, max),
    max: clamp(Math.round(center + spread), min, max),
  };
}

// School report reliability uses percentage points (0-100).
// Older college/overseas saves stored a ratio (0-1).
export function reportReliabilityPercent(value: number): number {
  return clamp(value <= 1 ? value * 100 : value, 0, 100);
}
