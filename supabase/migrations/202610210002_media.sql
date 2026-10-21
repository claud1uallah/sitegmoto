SET search_path TO gtune,pg_catalog;
CREATE TABLE IF NOT EXISTS media (
  key text PRIMARY KEY,
  content bytea NOT NULL,
  mime text NOT NULL,
  etag text NOT NULL,
  created_at text NOT NULL,
  CONSTRAINT media_size CHECK (octet_length(content) <= 5000000)
);
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON media FROM PUBLIC;
