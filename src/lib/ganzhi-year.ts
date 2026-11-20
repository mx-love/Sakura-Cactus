// First lunar-month dates verified against the Hong Kong Observatory tables:
// https://www.hko.gov.hk/en/gts/time/calendar/text/files/T2026e.txt
// Other years use the same T{year}e.txt endpoint. No runtime network request.
export const CHINESE_NEW_YEAR_DATES: Readonly<Record<number, string>> = {
  2024: '02-10', 2025: '01-29', 2026: '02-17', 2027: '02-06',
  2028: '01-26', 2029: '02-13', 2030: '02-03', 2031: '01-23',
  2032: '02-11', 2033: '01-31', 2034: '02-19', 2035: '02-08',
  2036: '01-28', 2037: '02-15', 2038: '02-04', 2039: '01-24', 2040: '02-12'
};

export function getGanzhiYear(date: { year: number; month: number; day: number }): string {
  const boundary = CHINESE_NEW_YEAR_DATES[date.year];
  const monthDay = `${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  // Outside the verified table, deliberately retain the Gregorian-year fallback.
  const year = boundary && monthDay < boundary ? date.year - 1 : date.year;
  const stems = '甲乙丙丁戊己庚辛壬癸';
  const branches = '子丑寅卯辰巳午未申酉戌亥';
  const animals = '鼠牛虎兔龙蛇马羊猴鸡狗猪';
  const index = (size: number) => ((year - 4) % size + size) % size;
  return `${stems[index(10)]}${branches[index(12)]}${animals[index(12)]}年`;
}
