const ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: Array<[number, string]> = [
  [1_000_000_000, "billion"],
  [1_000_000, "million"],
  [1_000, "thousand"],
];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : (TENS[Math.floor(n / 10)] ?? ""));
  } else if (n > 0) parts.push(ONES[n] ?? "");
  return parts.join(" ");
}

function integerWords(n: number): string {
  if (n === 0) return "zero";
  const parts: string[] = [];
  for (const [value, name] of SCALES) {
    if (n >= value) {
      parts.push(`${below1000(Math.floor(n / value))} ${name}`);
      n %= value;
    }
  }
  if (n > 0) parts.push(below1000(n));
  return parts.join(" ");
}

/** Amount in words as written on Philippine receipts: "One thousand two hundred thirty-four pesos and 50/100". */
export function pesoWords(centavos: number): string {
  const pesos = Math.floor(Math.abs(centavos) / 100);
  const cents = Math.abs(centavos) % 100;
  const words = integerWords(pesos);
  const text = `${words} ${pesos === 1 ? "peso" : "pesos"}${cents ? ` and ${String(cents).padStart(2, "0")}/100` : " only"}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
