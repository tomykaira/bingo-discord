# bingo-discord

任意の選択肢でビンゴの「回答発表」を行う Discord アプリ。Cloudflare Workers + D1 で動く（常駐プロセス不要）。

## コマンド

| コマンド | 日本語表示 | 動作 |
| --- | --- | --- |
| `/bingo start` | `/bingo 開始` | モーダルで選択肢（1行1候補）を入力して開始。空行・重複行はスキップ。進行中のゲームがあれば「終了して新しく開始」するか確認する |
| `/bingo draw` | `/bingo 発表` | 未発表の選択肢をランダムに1つ発表する。最後の1つを発表するとゲームを終了する |
| `/bingo end` | `/bingo 終了` | ゲームを終了する |

- ゲームはチャンネルごとに1つ。誰でも操作できる。
- 選択肢は最大 4000 文字（Discord のテキスト入力の上限）。

## 構成

```
Discord ──(HTTPS, Ed25519 署名付き)──▶ Cloudflare Worker (src/index.ts) ──▶ D1 (games / items)
```

- `src/index.ts` … Interaction の受信・署名検証・応答
- `src/game.ts` … D1 上のゲーム操作。発表は「選択と更新」を1つの SQL 文で行い、同時に実行しても重複しない
- `src/parse.ts` … 選択肢の解析
- `migrations/` … D1 のスキーマ
- `scripts/register-commands.mjs` … スラッシュコマンドの登録

## デプロイ手順

1. **Discord アプリを作る**: <https://discord.com/developers/applications> で New Application を作成し、
   General Information の `APPLICATION ID` と `PUBLIC KEY`、Bot の `TOKEN` を控える。
2. **ローカル設定**: `cp .dev.vars.example .dev.vars` として、控えた値を書き込む。
3. **D1 を作る**:
   ```sh
   npm install
   npx wrangler login
   npx wrangler d1 create bingo        # 出力された database_id を wrangler.jsonc に書く
   npm run db:migrate:remote
   ```
4. **Worker をデプロイする**:
   ```sh
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npm run deploy                      # https://bingo-discord.<subdomain>.workers.dev が発行される
   ```
5. **Interactions Endpoint を設定する**: Developer Portal の General Information > `Interactions Endpoint URL` に
   Worker の URL を入れて保存する（Discord が PING を送って検証する）。
6. **コマンドを登録する**: `npm run register`
   （`.dev.vars` で `DISCORD_GUILD_ID` を指定すると、そのサーバーにだけ即時反映される。空ならグローバル登録になる）
7. **サーバーに招待する**: Installation > Guild Install でスコープ `applications.commands` だけを選び、
   表示されたインストールリンクを開く。Gateway を使わないので `bot` スコープは不要。

## 開発

```sh
npm run db:migrate:local
npm run dev        # http://localhost:8787
npm run typecheck
npm test
```

Discord から直接ローカルを叩かせる場合は `cloudflared tunnel --url http://localhost:8787` などで公開し、その URL を Interactions Endpoint に設定する。

`wrangler.jsonc` を変えたら `npm run cf-typegen` で `worker-configuration.d.ts` を作り直す。

## コスト

Workers Free（1日10万リクエスト）と D1 Free の範囲で十分に動く。
