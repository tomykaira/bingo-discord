import { describe, expect, it } from "vitest";
import { parseChoices } from "../src/parse";

describe("parseChoices", () => {
  it("1行1候補で、空行と前後の空白を無視する", () => {
    expect(parseChoices("  りんご \n\nみかん\r\n  \nぶどう")).toEqual({
      choices: ["りんご", "みかん", "ぶどう"],
      duplicates: 0,
    });
  });

  it("重複行は読み飛ばし、件数を数える", () => {
    expect(parseChoices("A\nB\nA\n A \nB\nC")).toEqual({ choices: ["A", "B", "C"], duplicates: 3 });
  });

  it("空入力なら候補なし", () => {
    expect(parseChoices("\n  \n")).toEqual({ choices: [], duplicates: 0 });
  });
});
