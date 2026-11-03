CREATE TABLE games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('active', 'finished')),
  item_count  INTEGER NOT NULL,
  created_by  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  ended_at    INTEGER
);

-- 1チャンネルにアクティブなゲームは1つだけ
CREATE UNIQUE INDEX games_one_active_per_channel ON games (channel_id) WHERE status = 'active';

CREATE TABLE items (
  game_id     INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  label       TEXT    NOT NULL,
  drawn_order INTEGER,           -- 発表順 (1始まり)。未発表は NULL
  drawn_at    INTEGER,
  PRIMARY KEY (game_id, idx)
);
