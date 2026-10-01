-- A database administrator installs the pinned vector extension before
-- Flyway runs. The migration and application roles remain non-superusers.
CREATE TABLE ai_chunk_vectors (
    site_id BIGINT NOT NULL,
    chunk_id VARCHAR(36) PRIMARY KEY,
    model_name VARCHAR(120) NOT NULL,
    dimension INTEGER NOT NULL,
    embedding vector NOT NULL,
    CONSTRAINT fk_ai_vector_chunk FOREIGN KEY (site_id, chunk_id)
        REFERENCES ai_chunks (site_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_vectors_site_model ON ai_chunk_vectors (site_id, model_name, dimension);
