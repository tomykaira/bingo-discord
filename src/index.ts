import { drawItem, endGame, getActiveGame, startGame } from "./game";
import { parseChoices } from "./parse";
import { verifyDiscordRequest } from "./verify";

// https://discord.com/developers/docs/interactions/receiving-and-responding
const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, MODAL_SUBMIT: 5 } as const;
const ResponseType = { PONG: 1, CHANNEL_MESSAGE: 4, UPDATE_MESSAGE: 7, MODAL: 9 } as const;
const EPHEMERAL = 1 << 6;

const CUSTOM_ID = {
  replaceConfirm: "bingo:replace",
  replaceCancel: "bingo:cancel",
  modalNew: "bingo:start:new",
  modalReplace: "bingo:start:replace",
  choicesInput: "choices",
} as const;

const MAX_LABEL_DISPLAY = 1500;

interface Interaction {
  type: number;
  channel_id?: string;
  channel?: { id: string };
  member?: { user: { id: string } };
  user?: { id: string };
  data?: {
    name?: string;
    options?: { name: string }[];
    custom_id?: string;
    components?: ModalComponent[];
  };
}

interface ModalComponent {
  custom_id?: string;
  value?: string;
  components?: ModalComponent[];
  component?: ModalComponent;
}

type InteractionResponse = { type: number; data?: Record<string, unknown> };

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method !== "POST") return new Response("Not Found", { status: 404 });

    const body = await request.text();
    const valid = await verifyDiscordRequest(
      request.headers.get("X-Signature-Ed25519"),
      request.headers.get("X-Signature-Timestamp"),
      body,
      env.DISCORD_PUBLIC_KEY,
    );
    if (!valid) return new Response("Bad request signature", { status: 401 });

    const interaction = JSON.parse(body) as Interaction;
    try {
      return Response.json(await handleInteraction(interaction, env));
    } catch (e) {
      console.error(e);
      return Response.json(ephemeral("エラーが発生しました。しばらくしてからもう一度お試しください。"));
    }
  },
} satisfies ExportedHandler<Env>;

async function handleInteraction(interaction: Interaction, env: Env): Promise<InteractionResponse> {
  if (interaction.type === InteractionType.PING) return { type: ResponseType.PONG };

  const channelId = interaction.channel?.id ?? interaction.channel_id;
  const userId = interaction.member?.user.id ?? interaction.user?.id;
  if (!channelId || !userId) return ephemeral("このコマンドはここでは使えません。");

  switch (interaction.type) {
    case InteractionType.APPLICATION_COMMAND: {
      if (interaction.data?.name !== "bingo") break;
      switch (interaction.data.options?.[0]?.name) {
        case "start":
          return handleStartCommand(env.DB, channelId);
        case "draw":
          return handleDraw(env.DB, channelId);
        case "end":
          return handleEnd(env.DB, channelId);
      }
      break;
    }
    case InteractionType.MESSAGE_COMPONENT: {
      switch (interaction.data?.custom_id) {
        case CUSTOM_ID.replaceConfirm:
          return choicesModal(true);
        case CUSTOM_ID.replaceCancel:
          return {
            type: ResponseType.UPDATE_MESSAGE,
            data: { content: "新しいゲームの開始をキャンセルしました。", components: [] },
          };
      }
      break;
    }
    case InteractionType.MODAL_SUBMIT: {
      const customId = interaction.data?.custom_id;
      if (customId === CUSTOM_ID.modalNew || customId === CUSTOM_ID.modalReplace) {
        const text = findInputValue(interaction.data?.components ?? [], CUSTOM_ID.choicesInput) ?? "";
        return handleStartSubmit(env.DB, channelId, userId, text, customId === CUSTOM_ID.modalReplace);
      }
      break;
    }
  }
  return ephemeral("不明な操作です。");
}

async function handleStartCommand(db: D1Database, channelId: string): Promise<InteractionResponse> {
  const active = await getActiveGame(db, channelId);
  if (!active) return choicesModal(false);
  return {
    type: ResponseType.CHANNEL_MESSAGE,
    data: {
      flags: EPHEMERAL,
      content: "このチャンネルではすでにビンゴが進行中です。終了して新しいゲームを開始しますか？",
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 4, custom_id: CUSTOM_ID.replaceConfirm, label: "終了して新しく開始" },
            { type: 2, style: 2, custom_id: CUSTOM_ID.replaceCancel, label: "キャンセル" },
          ],
        },
      ],
    },
  };
}

function choicesModal(replace: boolean): InteractionResponse {
  return {
    type: ResponseType.MODAL,
    data: {
      custom_id: replace ? CUSTOM_ID.modalReplace : CUSTOM_ID.modalNew,
      title: "ビンゴを開始",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4, // Text Input
              style: 2, // Paragraph
              custom_id: CUSTOM_ID.choicesInput,
              label: "選択肢（1行に1つ）",
              placeholder: "りんご\nみかん\nぶどう",
              required: true,
              min_length: 1,
              max_length: 4000,
            },
          ],
        },
      ],
    },
  };
}

async function handleStartSubmit(
  db: D1Database,
  channelId: string,
  userId: string,
  text: string,
  replace: boolean,
): Promise<InteractionResponse> {
  const { choices, duplicates } = parseChoices(text);
  if (choices.length === 0) return ephemeral("選択肢が1つもありません。1行に1つずつ入力してください。");

  const result = await startGame(db, channelId, userId, choices, replace);
  if (!result.ok) {
    return ephemeral(
      "入力中に別のゲームが開始されました。新しく始める場合はもう一度 `/bingo start` を実行してください。",
    );
  }

  const lines = [
    (result.replaced ? "前のゲームを終了し、新しいビンゴを開始しました！" : "ビンゴを開始しました！") +
      `（開始: <@${userId}>）`,
    `選択肢: ${choices.length} 件` + (duplicates > 0 ? `（重複 ${duplicates} 件をスキップ）` : ""),
    "`/bingo draw` で回答を発表します。",
  ];
  return publicMessage(lines.join("\n"));
}

async function handleDraw(db: D1Database, channelId: string): Promise<InteractionResponse> {
  const result = await drawItem(db, channelId);
  switch (result.kind) {
    case "no_game":
      return ephemeral("進行中のビンゴはありません。`/bingo start` で開始してください。");
    case "exhausted":
      return publicMessage("すべての選択肢を発表済みのため、ビンゴを終了しました。");
    case "drawn": {
      let content = `🎱 **${escapeMarkdown(truncate(result.label))}**\n（${result.order} / ${result.total} 発表済み）`;
      if (result.finished) content += "\nすべての選択肢を発表しました。ビンゴを終了します。";
      return publicMessage(content);
    }
  }
}

async function handleEnd(db: D1Database, channelId: string): Promise<InteractionResponse> {
  const result = await endGame(db, channelId);
  if (result.kind === "no_game") return ephemeral("進行中のビンゴはありません。");
  return publicMessage(`ビンゴを終了しました。（${result.drawn} / ${result.total} 発表済み）`);
}

/** モーダルの入力値を探す。旧形式 (Action Row) と新形式 (Label) の両方に対応する */
function findInputValue(components: ModalComponent[], customId: string): string | undefined {
  for (const c of components) {
    if (c.custom_id === customId && typeof c.value === "string") return c.value;
    const nested = [...(c.components ?? []), ...(c.component ? [c.component] : [])];
    const found = findInputValue(nested, customId);
    if (found !== undefined) return found;
  }
  return undefined;
}

function truncate(s: string): string {
  return s.length > MAX_LABEL_DISPLAY ? s.slice(0, MAX_LABEL_DISPLAY) + "…" : s;
}

function escapeMarkdown(s: string): string {
  return s.replace(/([\\*_~`|>])/g, "\\$1");
}

// 選択肢に @everyone などが含まれていても通知が飛ばないよう、メンションは常に無効化する
function publicMessage(content: string): InteractionResponse {
  return { type: ResponseType.CHANNEL_MESSAGE, data: { content, allowed_mentions: { parse: [] } } };
}

function ephemeral(content: string): InteractionResponse {
  return { type: ResponseType.CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } };
}
