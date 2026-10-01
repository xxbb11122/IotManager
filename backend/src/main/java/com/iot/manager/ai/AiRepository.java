package com.iot.manager.ai;

import com.iot.manager.service.TimeProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.Duration;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;

@Repository
@ConditionalOnProperty(prefix = "iot.ai", name = "enabled", havingValue = "true")
public class AiRepository {
    public record KnowledgeBase(String id, long siteId, String name) { }
    public record Document(String id, long siteId, String knowledgeBaseId, String name,
                           String mimeType, String sourceBase64, String status, int versionNumber) { }
    public record DocumentSummary(String id, String knowledgeBaseId, String name, String status, int versionNumber) { }
    public record Job(String id, String documentId, String status, String errorCode) { }
    public record UploadReservation(Job job, boolean created) { }
    public record Persona(int version, String name, String instructions, boolean active) { }
    public record Conversation(String id, long siteId, String ownerSubject, Integer personaVersion) { }
    public record Message(String role, String content) { }
    public record Hit(String chunkId, String documentId, String documentName, int version,
                      String content, String heading, Integer pageNumber, double similarity) { }

    private final JdbcTemplate jdbc;
    private final TimeProvider timeProvider;

    public AiRepository(JdbcTemplate jdbc, TimeProvider timeProvider) {
        this.jdbc = jdbc;
        this.timeProvider = timeProvider;
    }

    public List<KnowledgeBase> knowledgeBases(long siteId) {
        return jdbc.query("SELECT id, site_id, name FROM ai_knowledge_bases WHERE site_id = ? ORDER BY name",
                (rs, row) -> new KnowledgeBase(rs.getString(1), rs.getLong(2), rs.getString(3)), siteId);
    }

    public KnowledgeBase knowledgeBase(long siteId, String id) {
        return first(jdbc.query("SELECT id, site_id, name FROM ai_knowledge_bases WHERE site_id = ? AND id = ?",
                (rs, row) -> new KnowledgeBase(rs.getString(1), rs.getLong(2), rs.getString(3)), siteId, id));
    }

    public KnowledgeBase createKnowledgeBase(long siteId, String name, String actor) {
        String id = uuid();
        jdbc.update("INSERT INTO ai_knowledge_bases (id, site_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
                id, siteId, name, actor, now());
        return new KnowledgeBase(id, siteId, name);
    }

    public long usedBytes(long siteId) {
        Long count = jdbc.queryForObject(
                "SELECT COALESCE(SUM(byte_size), 0) FROM ai_documents WHERE site_id = ? AND status <> 'DELETED'",
                Long.class, siteId);
        return count == null ? 0 : count;
    }

    public Job existingUpload(long siteId, String kbId, String hash) {
        List<Job> matches = jdbc.query("""
                SELECT j.id, j.document_id, j.status, j.error_code
                FROM ai_ingest_jobs j JOIN ai_documents d ON j.site_id = d.site_id AND j.document_id = d.id
                WHERE d.site_id = ? AND d.knowledge_base_id = ? AND d.content_sha256 = ?
                  AND d.status <> 'DELETED'
                ORDER BY j.created_at DESC
                """, AiRepository::mapJob, siteId, kbId, hash);
        return matches.isEmpty() ? null : matches.get(0);
    }

    public Job createDocument(long siteId, String kbId, String name, String mimeType, String sourceBase64,
                              String hash, long byteSize, String actor) {
        String docId = uuid();
        String jobId = uuid();
        Integer version = jdbc.queryForObject("""
                SELECT COALESCE(MAX(version_number), 0) + 1 FROM ai_documents
                WHERE site_id = ? AND knowledge_base_id = ? AND name = ?
                """, Integer.class, siteId, kbId, name);
        jdbc.update("""
                INSERT INTO ai_documents (id, site_id, knowledge_base_id, name, mime_type, source_base64,
                    content_sha256, byte_size, version_number, status, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
                """, docId, siteId, kbId, name, mimeType, sourceBase64, hash, byteSize,
                version == null ? 1 : version, actor, now());
        jdbc.update("""
                INSERT INTO ai_ingest_jobs (id, site_id, document_id, status, created_at, updated_at)
                VALUES (?, ?, ?, 'QUEUED', ?, ?)
                """, jobId, siteId, docId, now(), now());
        return new Job(jobId, docId, "QUEUED", null);
    }

    @Transactional
    public UploadReservation createUpload(long siteId, String kbId, String name, String mimeType, String sourceBase64,
                            String hash, long byteSize, String actor, String model,
                            long maxSiteBytes, int maxDailyUploads, Instant dayStart) {
        lockSite(siteId);
        knowledgeBase(siteId, kbId);
        Job existing = existingUpload(siteId, kbId, hash);
        if (existing != null) return new UploadReservation(existing, false);
        if (ingestAttemptCountSince(siteId, dayStart) >= maxDailyUploads) {
            throw new AiException(HttpStatus.TOO_MANY_REQUESTS, "Daily site document budget exhausted", 3600);
        }
        if (usedBytes(siteId) + byteSize > maxSiteBytes) {
            throw new AiException(HttpStatus.PAYLOAD_TOO_LARGE, "Site knowledge storage quota exceeded");
        }
        Job job = createDocument(siteId, kbId, name, mimeType, sourceBase64, hash, byteSize, actor);
        usage(siteId, actor, "INGEST_ATTEMPT", model, null, null);
        return new UploadReservation(job, true);
    }

    @Transactional
    public Job retryUpload(long siteId, String jobId, String actor, String model,
                           int maxDailyUploads, Instant dayStart) {
        lockSite(siteId);
        Job job = job(siteId, jobId);
        if (!"FAILED".equals(job.status())) throw new AiException(HttpStatus.CONFLICT, "Only failed jobs can be retried");
        if ("DELETED".equals(document(siteId, job.documentId()).status())) {
            throw new AiException(HttpStatus.CONFLICT, "Deleted documents cannot be retried");
        }
        if (ingestAttemptCountSince(siteId, dayStart) >= maxDailyUploads) {
            throw new AiException(HttpStatus.TOO_MANY_REQUESTS, "Daily site document budget exhausted", 3600);
        }
        documentStatus(siteId, job.documentId(), "PENDING");
        jobStatus(siteId, jobId, "QUEUED", null);
        usage(siteId, actor, "INGEST_ATTEMPT", model, null, null);
        return job(siteId, jobId);
    }

    public List<DocumentSummary> documents(long siteId, String kbId) {
        knowledgeBase(siteId, kbId);
        return jdbc.query("""
                SELECT id, knowledge_base_id, name, status, version_number FROM ai_documents
                WHERE site_id = ? AND knowledge_base_id = ? AND status <> 'DELETED'
                ORDER BY created_at DESC
                """, (rs, row) -> new DocumentSummary(rs.getString(1), rs.getString(2), rs.getString(3),
                rs.getString(4), rs.getInt(5)), siteId, kbId);
    }

    public Document document(long siteId, String docId) {
        return first(jdbc.query("""
                SELECT id, site_id, knowledge_base_id, name, mime_type, source_base64, status, version_number
                FROM ai_documents WHERE site_id = ? AND id = ?
                """, (rs, row) -> new Document(rs.getString(1), rs.getLong(2), rs.getString(3),
                rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getInt(8)), siteId, docId));
    }

    public Job job(long siteId, String jobId) {
        return first(jdbc.query("""
                SELECT id, document_id, status, error_code FROM ai_ingest_jobs
                WHERE site_id = ? AND id = ?
                """, AiRepository::mapJob, siteId, jobId));
    }

    public List<Job> unfinishedJobs() {
        return jdbc.query("""
                SELECT id, document_id, status, error_code FROM ai_ingest_jobs
                WHERE status IN ('QUEUED', 'RUNNING') ORDER BY created_at
                """, AiRepository::mapJob);
    }

    public long jobSite(String jobId) {
        Long siteId = jdbc.queryForObject("SELECT site_id FROM ai_ingest_jobs WHERE id = ?", Long.class, jobId);
        if (siteId == null) throw new NoSuchElementException("AI job not found");
        return siteId;
    }

    public void cancelJobsForDocument(long siteId, String documentId) {
        jdbc.update("""
                UPDATE ai_ingest_jobs SET status = 'CANCELLED', updated_at = ?
                WHERE site_id = ? AND document_id = ? AND status IN ('QUEUED', 'RUNNING')
                """, now(), siteId, documentId);
    }

    public void jobStatus(long siteId, String jobId, String status, String errorCode) {
        jdbc.update("UPDATE ai_ingest_jobs SET status = ?, error_code = ?, updated_at = ? WHERE site_id = ? AND id = ?",
                status, errorCode, now(), siteId, jobId);
    }

    public void documentStatus(long siteId, String docId, String status) {
        jdbc.update("UPDATE ai_documents SET status = ?, published_at = ? WHERE site_id = ? AND id = ?",
                status, "PUBLISHED".equals(status) ? now() : null, siteId, docId);
    }

    public void clearDocumentSource(long siteId, String docId) {
        jdbc.update("UPDATE ai_documents SET source_base64 = '' WHERE site_id = ? AND id = ?",
                siteId, docId);
    }

    @Transactional
    public boolean publishDocument(long siteId, String docId, String jobId) {
        lockSite(siteId);
        Document document = document(siteId, docId);
        if (!"PENDING".equals(document.status())) return false;
        jdbc.update("""
                UPDATE ai_documents SET status = 'SUPERSEDED'
                WHERE site_id = ? AND knowledge_base_id = ? AND name = ? AND status = 'PUBLISHED' AND id <> ?
                """, siteId, document.knowledgeBaseId(), document.name(), docId);
        int published = jdbc.update("""
                UPDATE ai_documents SET status = 'PUBLISHED', published_at = ?
                WHERE site_id = ? AND id = ? AND status = 'PENDING'
                """, now(), siteId, docId);
        int finished = jdbc.update("""
                UPDATE ai_ingest_jobs SET status = 'SUCCEEDED', error_code = NULL, updated_at = ?
                WHERE site_id = ? AND id = ? AND document_id = ? AND status = 'RUNNING'
                """, now(), siteId, jobId, docId);
        if (published != 1 || finished != 1) {
            throw new IllegalStateException("AI document publication lost its pending job");
        }
        return true;
    }

    @Transactional
    public Document activateDocumentVersion(long siteId, String docId) {
        lockSite(siteId);
        Document selected = document(siteId, docId);
        if (!"SUPERSEDED".equals(selected.status())) {
            throw new AiException(HttpStatus.CONFLICT, "Only a superseded document can be activated");
        }
        jdbc.update("""
                UPDATE ai_documents SET status = 'SUPERSEDED'
                WHERE site_id = ? AND knowledge_base_id = ? AND name = ? AND status = 'PUBLISHED'
                """, siteId, selected.knowledgeBaseId(), selected.name());
        jdbc.update("""
                UPDATE ai_documents SET status = 'PUBLISHED', published_at = ?
                WHERE site_id = ? AND id = ? AND status = 'SUPERSEDED'
                """, now(), siteId, docId);
        return document(siteId, docId);
    }

    public void deleteVectorsAndChunks(long siteId, String docId) {
        jdbc.update("""
                DELETE FROM ai_chunk_vectors WHERE site_id = ? AND chunk_id IN
                (SELECT id FROM ai_chunks WHERE site_id = ? AND document_id = ?)
                """, siteId, siteId, docId);
        jdbc.update("DELETE FROM ai_chunks WHERE site_id = ? AND document_id = ?", siteId, docId);
    }

    public void saveChunk(long siteId, String docId, int ordinal, String content, String heading,
                          Integer page, String model, float[] vector) {
        String chunkId = uuid();
        jdbc.update("""
                INSERT INTO ai_chunks (id, site_id, document_id, ordinal, content, heading, page_number)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, chunkId, siteId, docId, ordinal, content, heading, page);
        jdbc.update("""
                INSERT INTO ai_chunk_vectors (site_id, chunk_id, model_name, dimension, embedding)
                VALUES (?, ?, ?, ?, CAST(? AS vector))
                """, siteId, chunkId, model, vector.length, vectorLiteral(vector));
    }

    public List<Hit> search(long siteId, String model, float[] vector, int limit) {
        return jdbc.query("""
                WITH eligible AS MATERIALIZED (
                    SELECT site_id, chunk_id, embedding FROM ai_chunk_vectors
                    WHERE site_id = ? AND model_name = ? AND dimension = ?
                )
                SELECT c.id, d.id, d.name, d.version_number, c.content, c.heading, c.page_number,
                       1 - (v.embedding <=> CAST(? AS vector)) AS similarity
                FROM eligible v
                JOIN ai_chunks c ON c.site_id = v.site_id AND c.id = v.chunk_id
                JOIN ai_documents d ON d.site_id = c.site_id AND d.id = c.document_id
                WHERE d.status = 'PUBLISHED'
                ORDER BY v.embedding <=> CAST(? AS vector)
                LIMIT ?
                """, (rs, row) -> new Hit(rs.getString(1), rs.getString(2), rs.getString(3),
                rs.getInt(4), rs.getString(5), rs.getString(6), (Integer) rs.getObject(7),
                rs.getDouble(8)), siteId, model, vector.length, vectorLiteral(vector), vectorLiteral(vector), limit);
    }

    public List<Persona> personas(long siteId) {
        return jdbc.query("""
                SELECT version_number, name, instructions, active FROM ai_personas
                WHERE site_id = ? ORDER BY version_number DESC
                """, (rs, row) -> new Persona(rs.getInt(1), rs.getString(2), rs.getString(3), rs.getBoolean(4)), siteId);
    }

    public Persona activePersona(long siteId) {
        return personas(siteId).stream().filter(Persona::active).findFirst().orElse(null);
    }

    public Persona persona(long siteId, int version) {
        return first(jdbc.query("""
                SELECT version_number, name, instructions, active FROM ai_personas
                WHERE site_id = ? AND version_number = ?
                """, (rs, row) -> new Persona(rs.getInt(1), rs.getString(2), rs.getString(3), rs.getBoolean(4)),
                siteId, version));
    }

    public void lockSite(long siteId) {
        first(jdbc.query("SELECT id FROM sites WHERE id = ? FOR UPDATE",
                (rs, row) -> rs.getLong(1), siteId));
    }

    public void lockSiteForPersonaChange(long siteId) { lockSite(siteId); }

    public Persona savePersona(long siteId, String name, String instructions, String actor) {
        Integer next = jdbc.queryForObject(
                "SELECT COALESCE(MAX(version_number), 0) + 1 FROM ai_personas WHERE site_id = ?",
                Integer.class, siteId);
        int version = next == null ? 1 : next;
        jdbc.update("""
                INSERT INTO ai_personas (id, site_id, version_number, name, instructions, active, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, false, ?, ?)
                """, uuid(), siteId, version, name, instructions, actor, now());
        return new Persona(version, name, instructions, false);
    }

    public Persona activatePersona(long siteId, int version) {
        List<Persona> matches = personas(siteId).stream().filter(persona -> persona.version() == version).toList();
        Persona selected = first(matches);
        jdbc.update("UPDATE ai_personas SET active = false WHERE site_id = ?", siteId);
        jdbc.update("UPDATE ai_personas SET active = true WHERE site_id = ? AND version_number = ?", siteId, version);
        return new Persona(version, selected.name(), selected.instructions(), true);
    }

    public Conversation createConversation(long siteId, String actor, Integer personaVersion) {
        String id = uuid();
        jdbc.update("""
                INSERT INTO ai_conversations (id, site_id, owner_subject, persona_version, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, id, siteId, actor, personaVersion, now(), now());
        return new Conversation(id, siteId, actor, personaVersion);
    }

    public Conversation conversation(long siteId, String id, String actor) {
        return first(jdbc.query("""
                SELECT id, site_id, owner_subject, persona_version FROM ai_conversations
                WHERE site_id = ? AND id = ? AND owner_subject = ?
                """, (rs, row) -> new Conversation(rs.getString(1), rs.getLong(2), rs.getString(3),
                (Integer) rs.getObject(4)), siteId, id, actor));
    }

    public List<Message> messages(long siteId, String conversationId) {
        return jdbc.query("""
                SELECT role, content FROM ai_messages WHERE site_id = ? AND conversation_id = ?
                ORDER BY COALESCE(message_sequence,0) DESC, created_at DESC, id DESC LIMIT 12
                """, (rs, row) -> new Message(rs.getString(1), rs.getString(2)), siteId, conversationId);
    }

    public void addMessage(long siteId, String conversationId, String role, String content) {
        jdbc.update("""
                INSERT INTO ai_messages (id, site_id, conversation_id, role, content, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, uuid(), siteId, conversationId, role, content, now());
        jdbc.update("UPDATE ai_conversations SET updated_at = ? WHERE site_id = ? AND id = ?",
                now(), siteId, conversationId);
    }

    public void deleteConversation(long siteId, String id, String actor) {
        conversation(siteId, id, actor);
        jdbc.update("DELETE FROM ai_messages WHERE site_id = ? AND conversation_id = ?", siteId, id);
        jdbc.update("DELETE FROM ai_conversations WHERE site_id = ? AND id = ? AND owner_subject = ?", siteId, id, actor);
    }

    public void purgeConversationsBefore(Instant threshold) {
        jdbc.update("""
                DELETE FROM ai_messages WHERE conversation_id IN
                (SELECT id FROM ai_conversations WHERE updated_at < ?)
                """, Timestamp.from(threshold));
        jdbc.update("DELETE FROM ai_conversations WHERE updated_at < ?", Timestamp.from(threshold));
    }

    public void audit(long siteId, String actor, String action, String resourceId, String outcome) {
        jdbc.update("""
                INSERT INTO ai_audit_events (id, site_id, actor_subject, action, resource_id, outcome, occurred_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, uuid(), siteId, actor, action, resourceId, outcome, now());
    }

    public void usage(long siteId, String actor, String operation, String model, Integer inputTokens, Integer outputTokens) {
        jdbc.update("""
                INSERT INTO ai_usage_events (id, site_id, actor_subject, operation, model_name,
                    input_tokens, output_tokens, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, uuid(), siteId, actor, operation, model, inputTokens, outputTokens, now());
    }

    public long chatCountSince(long siteId, Instant since) {
        Long count = jdbc.queryForObject("""
                SELECT COUNT(*) FROM ai_usage_events
                WHERE site_id = ? AND operation = 'CHAT_ATTEMPT' AND created_at >= ?
                """, Long.class, siteId, Timestamp.from(since));
        return count == null ? 0 : count;
    }

    @Transactional
    public boolean reserveChatAttempt(long siteId, String actor, int maxDailyChats, Instant dayStart) {
        lockSite(siteId);
        if (chatCountSince(siteId, dayStart) >= maxDailyChats) return false;
        usage(siteId, actor, "CHAT_ATTEMPT", "configured-chat-model", null, null);
        return true;
    }

    public long ingestAttemptCountSince(long siteId, Instant since) {
        Long count = jdbc.queryForObject("""
                SELECT COUNT(*) FROM ai_usage_events
                WHERE site_id = ? AND operation = 'INGEST_ATTEMPT' AND created_at >= ?
                """, Long.class, siteId, Timestamp.from(since));
        return count == null ? 0 : count;
    }

    public List<String> deviceStatus(long siteId, String question) {
        return jdbc.query("""
                SELECT public_id, name, status, last_received_at FROM devices
                WHERE site_id = ? AND archived_at IS NULL
                  AND (POSITION(LOWER(public_id) IN LOWER(?)) > 0
                    OR (LENGTH(name) >= 3 AND POSITION(LOWER(name) IN LOWER(?)) > 0))
                ORDER BY id LIMIT 2
                """, (rs, row) -> {
                    Timestamp observed = rs.getTimestamp(4);
                    boolean stale = observed == null || observed.toInstant().isBefore(timeProvider.now().minus(Duration.ofMinutes(5)));
                    return "device id " + rs.getString(1) + " | name " + rs.getString(2)
                            + " | " + (stale ? "last reported status " : "reported status ") + rs.getString(3)
                            + " | observed " + (observed == null ? "unknown" : observed.toInstant())
                            + (stale ? " | STALE: current status unknown" : " | recent observation");
                }, siteId, question, question);
    }

    private static Job mapJob(ResultSet rs, int row) throws SQLException {
        return new Job(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4));
    }

    private static <T> T first(List<T> values) {
        if (values.isEmpty()) throw new NoSuchElementException("AI resource not found");
        return values.get(0);
    }

    private static String vectorLiteral(float[] vector) {
        StringBuilder builder = new StringBuilder("[");
        for (int i = 0; i < vector.length; i++) {
            if (i > 0) builder.append(',');
            builder.append(vector[i]);
        }
        return builder.append(']').toString();
    }

    private static String uuid() { return UUID.randomUUID().toString(); }
    private Timestamp now() { return Timestamp.from(timeProvider.now()); }
}
