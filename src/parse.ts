export interface ParsedChoices {
  choices: string[];
  duplicates: number;
}

/** 1行1候補。前後の空白を除去し、空行と重複行は読み飛ばす（出現順を保持）。 */
export function parseChoices(text: string): ParsedChoices {
  const seen = new Set<string>();
  const choices: string[] = [];
  let duplicates = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (seen.has(line)) {
      duplicates++;
      continue;
    }
    seen.add(line);
    choices.push(line);
  }
  return { choices, duplicates };
}
