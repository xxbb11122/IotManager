ALTER TABLE ai_conversations ADD COLUMN title VARCHAR(80);
ALTER TABLE ai_conversations ADD COLUMN active_request_id VARCHAR(36);
ALTER TABLE ai_messages ADD COLUMN message_sequence BIGINT;
ALTER TABLE ai_messages ADD COLUMN turn_id VARCHAR(36);
CREATE UNIQUE INDEX uk_ai_message_sequence ON ai_messages (site_id, conversation_id, message_sequence);

-- Nullable additions let a previous backend continue writing during rollback.
-- Missing sequences are repaired under the site lock before reads or new turns.
CREATE TABLE ai_chat_requests (
    id VARCHAR(36) PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES sites (id),
    actor_subject VARCHAR(255) NOT NULL,
    client_key VARCHAR(36) NOT NULL,
    input_hash VARCHAR(64) NOT NULL,
    input_conversation_id VARCHAR(36),
    conversation_id VARCHAR(36) NOT NULL,
    question TEXT,
    state VARCHAR(16) NOT NULL,
    dispatched BOOLEAN NOT NULL DEFAULT false,
    holder VARCHAR(36),
    result_json TEXT,
    error_code VARCHAR(80),
    error_status INTEGER,
    created_at TIMESTAMP NOT NULL,
    deadline_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    tombstone_until TIMESTAMP NOT NULL,
    CONSTRAINT uk_ai_chat_request_key UNIQUE (site_id, actor_subject, client_key)
);
CREATE INDEX idx_ai_requests_deadline ON ai_chat_requests (site_id, state, deadline_at);
CREATE INDEX idx_ai_requests_conversation ON ai_chat_requests (site_id, conversation_id);
CREATE INDEX idx_ai_requests_expiry ON ai_chat_requests (expires_at, tombstone_until);
