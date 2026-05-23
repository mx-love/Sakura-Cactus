-- Friend links V1.

CREATE TABLE IF NOT EXISTS friend_links (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  avatar_url TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'hidden')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_friend_links_status ON friend_links(status);
CREATE INDEX IF NOT EXISTS idx_friend_links_sort_order ON friend_links(sort_order);
CREATE INDEX IF NOT EXISTS idx_friend_links_created_at ON friend_links(created_at);
