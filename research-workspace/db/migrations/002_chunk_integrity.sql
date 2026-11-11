-- Provenance for the Citation Inspector, plus tamper protection for chunks.

ALTER TABLE chunks  ADD COLUMN line_refs  JSONB;       -- [{page, line, bbox}, ...]
ALTER TABLE sources ADD COLUMN page_count INT;

ALTER TABLE chunks
    ADD CONSTRAINT chunks_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$');

-- A chunk is the source of truth. Its text and hash must never change after
-- insert; to change content, delete the source and re-ingest.
CREATE FUNCTION chunks_immutable() RETURNS trigger AS $$
BEGIN
    IF NEW.text IS DISTINCT FROM OLD.text
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.chunk_index IS DISTINCT FROM OLD.chunk_index THEN
        RAISE EXCEPTION 'chunks are immutable (chunk %)', OLD.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chunks_immutable
    BEFORE UPDATE ON chunks
    FOR EACH ROW EXECUTE FUNCTION chunks_immutable();
