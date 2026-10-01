CREATE TABLE ai_knowledge_bases (
    id VARCHAR(36) PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES sites (id),
    name VARCHAR(120) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    CONSTRAINT uk_ai_kb_site_id UNIQUE (site_id, id),
    CONSTRAINT uk_ai_kb_site_name UNIQUE (site_id, name)
);

CREATE TABLE ai_documents (
    id VARCHAR(36) PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES sites (id),
    knowledge_base_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    source_base64 TEXT NOT NULL,
    content_sha256 VARCHAR(64) NOT NULL,
    byte_size BIGINT NOT NULL,
    version_number INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    published_at TIMESTAMP,
    CONSTRAINT uk_ai_doc_site_id UNIQUE (site_id, id),
    CONSTRAINT fk_ai_doc_kb FOREIGN KEY (site_id, knowledge_base_id)
        REFERENCES ai_knowledge_bases (site_id, id)
);
CREATE INDEX idx_ai_documents_site_status ON ai_documents (site_id, status);
CREATE INDEX idx_ai_documents_kb_hash ON ai_documents (site_id, knowledge_base_id, content_sha256);

CREATE TABLE ai_chunks (
    id VARCHAR(36) PRIMARY KEY,
    site_id BIGINT NOT NULL,
    document_id VARCHAR(36) NOT NULL,
    ordinal INTEGER NOT NULL,
    content TEXT NOT NULL,
    heading VARCHAR(255),
    page_number INTEGER,
    CONSTRAINT uk_ai_chunk_site_id UNIQUE (site_id, id),
    CONSTRAINT uk_ai_chunk_document_ordinal UNIQUE (document_id, ordinal),
    CONSTRAINT fk_ai_chunk_doc FOREIGN KEY (site_id, document_id)
        REFERENCES ai_documents (site_id, id) ON DELETE CASCADE
);

CREATE TABLE ai_ingest_jobs (
    id VARCHAR(36) PRIMARY KEY,
    site_id BIGINT NOT NULL,
    document_id VARCHAR(36) NOT NULL,
    status VARCHAR(20) NOT NULL,
    error_code VARCHAR(80),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT fk_ai_job_doc FOREIGN KEY (site_id, document_id)
        REFERENCES ai_documents (site_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_jobs_site_status ON ai_ingest_jobs (site_id, status);

CREATE TABLE ai_personas (
    id VARCHAR(36) PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES sites (id),
    version_number INTEGER NOT NULL,
    name VARCHAR(80) NOT NULL,
    instructions VARCHAR(4000) NOT NULL,
    active BOOLEAN NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    CONSTRAINT uk_ai_persona_site_version UNIQUE (site_id, version_number)
);
CREATE INDEX idx_ai_personas_active ON ai_personas (site_id, active);

CREATE TABLE ai_conversations (
    id VARCHAR(36) PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES sites (id),
    owner_subject VARCHAR(255) NOT NULL,
    persona_version INTEGER,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT uk_ai_conversation_site_id UNIQUE (site_id, id)
);
CREATE INDEX idx_ai_conversations_owner ON ai_conversations (site_id, owner_subject, updated_at);

CREATE TABLE ai_messages (
    id VARCHAR(36) PRIMARY KEY,
    site_id BIGINT NOT NULL,
    conversation_id VARCHAR(36) NOT NULL,
    role VARCHAR(12) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    CONSTRAINT fk_ai_message_conversation FOREIGN KEY (site_id, conversation_id)
        REFERENCES ai_conversations (site_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_messages_conversation ON ai_messages (site_id, conversation_id, created_at);

CREATE TABLE ai_usage_events (
    id VARCHAR(36) PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES sites (id),
    actor_subject VARCHAR(255) NOT NULL,
    operation VARCHAR(24) NOT NULL,
    model_name VARCHAR(120) NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_ai_usage_site_time ON ai_usage_events (site_id, created_at);

CREATE TABLE ai_audit_events (
    id VARCHAR(36) PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES sites (id),
    actor_subject VARCHAR(255) NOT NULL,
    action VARCHAR(40) NOT NULL,
    resource_id VARCHAR(36),
    outcome VARCHAR(24) NOT NULL,
    occurred_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_ai_audit_site_time ON ai_audit_events (site_id, occurred_at);
