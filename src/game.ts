export interface ActiveGame {
  id: number;
  itemCount: number;
}

export async function getActiveGame(db: D1Database, channelId: string): Promise<ActiveGame | null> {
  const row = await db
    .prepare("SELECT id, item_count FROM games WHERE channel_id = ?1 AND status = 'active'")
    .bind(channelId)
    .first<{ id: number; item_count: number }>();
  return row ? { id: row.id, itemCount: row.item_count } : null;
}

export type StartResult = { ok: true; replaced: boolean } | { ok: false; reason: "conflict" };

/**
 * ゲームを開始する。replace=true なら既存のアクティブなゲームを終了してから開始する。
 * replace=false で既にアクティブなゲームがあれば conflict を返す。
 */
export async function startGame(
  db: D1Database,
  channelId: string,
  userId: string,
  choices: string[],
  replace: boolean,
): Promise<StartResult> {
  const now = Date.now();
  const finishExisting = db
    .prepare("UPDATE games SET status = 'finished', ended_at = ?2 WHERE channel_id = ?1 AND status = 'active'")
    .bind(channelId, now);
  const insertGame = db
    .prepare(
      "INSERT INTO games (channel_id, status, item_count, created_by, created_at) VALUES (?1, 'active', ?2, ?3, ?4)",
    )
    .bind(channelId, choices.length, userId, now);
  // 候補を JSON 配列で渡し、1文でまとめて INSERT する（D1 のクエリ数制限対策）
  const insertItems = db
    .prepare(
      `INSERT INTO items (game_id, idx, label)
       SELECT g.id, j.key, j.value FROM games g, json_each(?2) j
       WHERE g.channel_id = ?1 AND g.status = 'active'`,
    )
    .bind(channelId, JSON.stringify(choices));

  if (replace) {
    // batch はトランザクションとして実行される
    const [finished] = await db.batch([finishExisting, insertGame, insertItems]);
    return { ok: true, replaced: (finished?.meta.changes ?? 0) > 0 };
  }
  try {
    await db.batch([insertGame, insertItems]);
    return { ok: true, replaced: false };
  } catch (e) {
    if (String(e).includes("UNIQUE constraint failed")) return { ok: false, reason: "conflict" };
    throw e;
  }
}

export type DrawResult =
  | { kind: "no_game" }
  | { kind: "drawn"; label: string; order: number; total: number; finished: boolean }
  | { kind: "exhausted" };

/** 未発表の候補からランダムに1つ選んで発表済みにする。最後の1つを発表したらゲームを終了する。 */
export async function drawItem(db: D1Database, channelId: string): Promise<DrawResult> {
  const game = await getActiveGame(db, channelId);
  if (!game) return { kind: "no_game" };

  const now = Date.now();
  // 選択と更新を1文で行うので、同時に発表されても同じ候補が二重に選ばれない
  const row = await db
    .prepare(
      `UPDATE items
       SET drawn_order = (SELECT COUNT(*) FROM items WHERE game_id = ?1 AND drawn_order IS NOT NULL) + 1,
           drawn_at = ?2
       WHERE game_id = ?1
         AND idx = (SELECT idx FROM items WHERE game_id = ?1 AND drawn_order IS NULL ORDER BY RANDOM() LIMIT 1)
       RETURNING label, drawn_order`,
    )
    .bind(game.id, now)
    .first<{ label: string; drawn_order: number }>();

  if (!row) {
    await finishGame(db, game.id, now);
    return { kind: "exhausted" };
  }
  const finished = row.drawn_order >= game.itemCount;
  if (finished) await finishGame(db, game.id, now);
  return { kind: "drawn", label: row.label, order: row.drawn_order, total: game.itemCount, finished };
}

export type EndResult = { kind: "no_game" } | { kind: "ended"; drawn: number; total: number };

export async function endGame(db: D1Database, channelId: string): Promise<EndResult> {
  const game = await getActiveGame(db, channelId);
  if (!game) return { kind: "no_game" };
  const drawn = await db
    .prepare("SELECT COUNT(*) AS n FROM items WHERE game_id = ?1 AND drawn_order IS NOT NULL")
    .bind(game.id)
    .first<number>("n");
  await finishGame(db, game.id, Date.now());
  return { kind: "ended", drawn: drawn ?? 0, total: game.itemCount };
}

async function finishGame(db: D1Database, gameId: number, now: number): Promise<void> {
  await db
    .prepare("UPDATE games SET status = 'finished', ended_at = ?2 WHERE id = ?1 AND status = 'active'")
    .bind(gameId, now)
    .run();
}
