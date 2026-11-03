// スラッシュコマンドを Discord に登録する。
// 使い方: npm run register   （.dev.vars から環境変数を読む）
const { DISCORD_APPLICATION_ID, DISCORD_TOKEN, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_APPLICATION_ID || !DISCORD_TOKEN) {
  console.error("DISCORD_APPLICATION_ID と DISCORD_TOKEN を設定してください");
  process.exit(1);
}

const commands = [
  {
    name: "bingo",
    description: "Bingo game",
    description_localizations: { ja: "ビンゴゲーム" },
    contexts: [0], // サーバー内のみ
    integration_types: [0], // サーバーにインストールして使う
    options: [
      {
        type: 1,
        name: "start",
        name_localizations: { ja: "開始" },
        description: "Start a new game with your own choices",
        description_localizations: { ja: "選択肢を入力してゲームを開始する" },
      },
      {
        type: 1,
        name: "draw",
        name_localizations: { ja: "発表" },
        description: "Announce a random choice that has not been drawn yet",
        description_localizations: { ja: "未発表の選択肢をランダムに1つ発表する" },
      },
      {
        type: 1,
        name: "end",
        name_localizations: { ja: "終了" },
        description: "End the current game",
        description_localizations: { ja: "ゲームを終了する" },
      },
    ],
  },
];

const base = `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}`;
const url = DISCORD_GUILD_ID ? `${base}/guilds/${DISCORD_GUILD_ID}/commands` : `${base}/commands`;

const res = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${DISCORD_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
if (!res.ok) {
  console.error(`登録に失敗しました: ${res.status}`, await res.text());
  process.exit(1);
}
console.log(`登録しました (${DISCORD_GUILD_ID ? `guild ${DISCORD_GUILD_ID}` : "global"})`);
