-- 分页预检持久化模型（PostgreSQL）。
-- 核心原则：豁免绑定"排版指纹"而不是正文哈希；产物只允许指向完成快照。

CREATE TABLE IF NOT EXISTS preflight_issues (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id   TEXT NOT NULL,
  scan_id       TEXT NOT NULL,
  code          TEXT NOT NULL,           -- MISSING_GLYPH / IMAGE_TOO_TALL / ...
  severity      TEXT NOT NULL,
  node_id       TEXT,
  seq           INTEGER,
  page          INTEGER,
  line_start    INTEGER,
  line_end      INTEGER,
  message       TEXT NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedup_key     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',   -- open / exempted
  exemption_id  BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preflight_exemptions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id   TEXT NOT NULL,
  code          TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  fingerprint   TEXT NOT NULL,           -- 绑定排版指纹（正文+参数+字体度量+图片尺寸）
  body_hash     TEXT NOT NULL,           -- 仅用于展示，不得单独作为复用依据
  reason        TEXT NOT NULL DEFAULT '',
  state         TEXT NOT NULL DEFAULT 'active',   -- active / needs_review（重排后需复核）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, code, node_id)
);

CREATE TABLE IF NOT EXISTS preflight_scans (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL,
  status        TEXT NOT NULL,           -- running/completed/cancelled/failed/blocked
  mode          TEXT NOT NULL,           -- render-first / stream / compare
  fingerprint   TEXT NOT NULL,
  body_hash     TEXT NOT NULL,
  params        JSONB NOT NULL,
  font_version  TEXT NOT NULL,
  checkpoint    JSONB,                   -- 断点：已排节点序号、当前页状态
  error         JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preflight_artifacts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id   TEXT NOT NULL,
  scan_id       TEXT NOT NULL,
  version       INTEGER NOT NULL,
  kind          TEXT NOT NULL,           -- snapshot / pdf / diagnostic
  fingerprint   TEXT NOT NULL,
  body_hash     TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  status        TEXT NOT NULL,           -- sealed / superseded / retained
  page_count    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);
CREATE INDEX IF NOT EXISTS idx_issues_scan ON preflight_issues(scan_id);
CREATE INDEX IF NOT EXISTS idx_exemptions_doc ON preflight_exemptions(document_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_doc ON preflight_artifacts(document_id, status);
