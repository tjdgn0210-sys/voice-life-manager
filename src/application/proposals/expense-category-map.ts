/** Small, explicit vocabulary for local expense categorization. */
const categoryKeywords: ReadonlyArray<readonly [string, string]> = [
  ['식비', '점심'], ['식비', '밥'], ['식비', '식사'], ['식비', '커피'], ['식비', '카페'],
  ['교통', '택시'], ['교통', '버스'], ['교통', '지하철'], ['교통', '교통비'],
  ['생활', '편의점'],
];

export function categoryForExpenseText(text: string): string | null {
  for (const [category, keyword] of categoryKeywords) {
    if (text.includes(keyword)) return category;
  }
  return null;
}
