package com.iot.manager.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iot.manager.service.TimeProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;

/** Short database transactions; no provider call or network wait belongs here. */
@Component
@ConditionalOnProperty(prefix = "iot.ai", name = "enabled", havingValue = "true")
public class AiConversationStore {
    public record Request(String id, long siteId, String actor, String key, String hash,
                          String conversationId, String question, String state, boolean dispatched,
                          String holder, AiChatService.Reply result, String errorCode, Integer errorStatus,
                          Instant deadline, Instant expiresAt) { }
    public record Status(String clientRequestId, String requestId, String conversationId, String question,
                         String state, AiChatService.Reply result, String errorCode, Integer errorStatus,
                         Instant expiresAt, int retryAfterSeconds) { }
    public record StoredMessage(String id, String role, String content, Instant createdAt, long sequence,
                                String turnId) { }
    public record Summary(String id, String title, Instant updatedAt, Integer personaVersion) { }
    public record Page<T>(List<T> items, String nextCursor) { }
    public record Claim(Request request, boolean fresh, AiRepository.Conversation conversation,
                        AiRepository.Persona persona, List<StoredMessage> history) { }
    public record Usage(String operation, String model, Integer inputTokens, Integer outputTokens) { }
    private record Cursor(long siteId, String actor, String conversationId, Instant time, String id,
                          long before, long upper) { }

    private final JdbcTemplate jdbc;
    private final AiRepository repository;
    private final TimeProvider time;
    private final AiProperties properties;
    private final ObjectMapper json;
    private final TransactionTemplate tx;

    public AiConversationStore(JdbcTemplate jdbc, AiRepository repository, TimeProvider time,
                               AiProperties properties, ObjectMapper json, PlatformTransactionManager manager) {
        this.jdbc = jdbc;
        this.repository = repository;
        this.time = time;
        this.properties = properties;
        this.json = json;
        this.tx = new TransactionTemplate(manager);
    }

    public Claim claim(long siteId, String actor, String key, String question, String conversationId,
                       Runnable acquireCapacity) {
        String digest = hash(question.trim(), conversationId);
        return tx.execute(transaction -> {
            repository.lockSite(siteId);
            expireLocked(siteId);
            Request previous = find(siteId, actor, key);
            if (previous != null) {
                if (!previous.hash().equals(digest)) throw conflict("IDEMPOTENCY_CONFLICT", "Request key has different input");
                return new Claim(previous, false, null, null, List.of());
            }
            AiRepository.Conversation conversation = conversationId == null ? null
                    : repository.conversation(siteId, conversationId, actor);
            if (conversation != null) {
                String active = jdbc.queryForObject("SELECT active_request_id FROM ai_conversations WHERE site_id=? AND id=?",
                        String.class, siteId, conversation.id());
                if (active != null) throw conflict("CONVERSATION_BUSY", "This conversation is processing another request");
            }
            if (!repository.reserveChatAttempt(siteId, actor, properties.getMaxSiteChatsPerDay(),
                    time.now().truncatedTo(ChronoUnit.DAYS))) {
                throw new AiException(HttpStatus.TOO_MANY_REQUESTS, "DAILY_BUDGET_EXHAUSTED", "Daily site AI budget exhausted", 3600);
            }
            acquireCapacity.run(); // Failure rolls back the quota reservation too.
            AiRepository.Persona persona = conversation == null ? repository.activePersona(siteId)
                    : conversation.personaVersion() == null ? null : repository.persona(siteId, conversation.personaVersion());
            if (conversation == null) conversation = repository.createConversation(siteId, actor, persona == null ? null : persona.version());
            repairSequences(siteId, conversation.id());
            List<StoredMessage> history = jdbc.query("SELECT * FROM ai_messages WHERE site_id=? AND conversation_id=? ORDER BY message_sequence DESC LIMIT 12",
                    this::message, siteId, conversation.id());
            Collections.reverse(history);
            String id = UUID.randomUUID().toString();
            String holder = UUID.randomUUID().toString();
            Instant now = time.now();
            Instant expiry = now.plus(30, ChronoUnit.DAYS);
            jdbc.update("""
                    INSERT INTO ai_chat_requests (id,site_id,actor_subject,client_key,input_hash,input_conversation_id,
                    conversation_id,question,state,dispatched,holder,created_at,deadline_at,expires_at,tombstone_until)
                    VALUES (?,?,?,?,?,?,?,?,'PROCESSING',false,?,?,?,?,?)
                    """, id, siteId, actor, key, digest, conversationId, conversation.id(), question.trim(), holder,
                    stamp(now), stamp(now.plusSeconds(properties.getRequestTimeoutSeconds())), stamp(expiry), stamp(expiry));
            jdbc.update("UPDATE ai_conversations SET active_request_id=?, title=COALESCE(title,?) WHERE site_id=? AND id=?",
                    id, title(question), siteId, conversation.id());
            return new Claim(find(siteId, actor, key), true, conversation, persona, history);
        });
    }

    public boolean dispatched(Request request) {
        return Boolean.TRUE.equals(tx.execute(transaction -> {
            repository.lockSite(request.siteId());
            expireLocked(request.siteId());
            return jdbc.update("UPDATE ai_chat_requests SET dispatched=true WHERE id=? AND holder=? AND state='PROCESSING'",
                    request.id(), request.holder()) == 1;
        }));
    }

    public boolean finish(Request request, AiChatService.Reply reply, List<Usage> usages, String outcome) {
        return Boolean.TRUE.equals(tx.execute(transaction -> {
            repository.lockSite(request.siteId());
            expireLocked(request.siteId());
            Request current = find(request.siteId(), request.actor(), request.key());
            if (current == null || !"PROCESSING".equals(current.state()) || !Objects.equals(current.holder(), request.holder())) return false;
            String active = jdbc.queryForObject("SELECT active_request_id FROM ai_conversations WHERE site_id=? AND id=?",
                    String.class, request.siteId(), request.conversationId());
            if (!request.id().equals(active)) return false;
            Long last = jdbc.queryForObject("SELECT COALESCE(MAX(message_sequence),0) FROM ai_messages WHERE site_id=? AND conversation_id=?",
                    Long.class, request.siteId(), request.conversationId());
            long sequence = last == null ? 0 : last;
            insertMessage(request, "USER", request.question(), ++sequence);
            insertMessage(request, "ASSISTANT", reply.answer(), ++sequence);
            for (Usage usage : usages) repository.usage(request.siteId(), request.actor(), usage.operation(),
                    usage.model(), usage.inputTokens(), usage.outputTokens());
            repository.audit(request.siteId(), request.actor(), "CHAT", request.conversationId(), outcome);
            jdbc.update("UPDATE ai_chat_requests SET state='SUCCEEDED',result_json=?,holder=NULL WHERE id=?",
                    encode(reply), request.id());
            release(request);
            jdbc.update("UPDATE ai_conversations SET updated_at=? WHERE site_id=? AND id=?",
                    stamp(time.now()), request.siteId(), request.conversationId());
            return true;
        }));
    }

    public void fail(Request request, RuntimeException error) {
        tx.executeWithoutResult(transaction -> {
            repository.lockSite(request.siteId());
            Request current = find(request.siteId(), request.actor(), request.key());
            if (current == null || !"PROCESSING".equals(current.state()) || !Objects.equals(current.holder(), request.holder())) return;
            String state = current.dispatched() ? "UNKNOWN" : "FAILED";
            String code = current.dispatched() ? "RESULT_UNKNOWN" : error instanceof AiException ai ? ai.getCode() : "REQUEST_FAILED";
            int status = error instanceof AiException ai ? ai.getStatus().value() : 502;
            jdbc.update("UPDATE ai_chat_requests SET state=?,error_code=?,error_status=?,holder=NULL WHERE id=?",
                    state, code, status, request.id());
            repository.audit(request.siteId(), request.actor(), "CHAT", request.conversationId(), state);
            release(request);
        });
    }

    public Status status(long siteId, String actor, String key) {
        Request found = tx.execute(transaction -> {
            repository.lockSite(siteId);
            expireLocked(siteId);
            Request request = find(siteId, actor, key);
            return request;
        });
        if (found == null) throw new NoSuchElementException("AI request not found");
        return view(found);
    }

    public Status view(Request request) {
        ensureReadable(request);
        return new Status(request.key(), request.id(), request.conversationId(), request.question(), request.state(),
                request.result(), request.errorCode(), request.errorStatus(), request.expiresAt(), "PROCESSING".equals(request.state()) ? 3 : 0);
    }

    public Page<Summary> conversations(long siteId, String actor, String cursor, int limit) {
        checkLimit(limit);
        Cursor position = cursor == null ? null : decodeCursor(cursor, siteId, actor, null);
        String condition = position == null ? "" : " AND (updated_at < ? OR (updated_at = ? AND id < ?))";
        List<Object> args = new ArrayList<>(List.of(siteId, actor));
        if (position != null) {
            if (position.time() == null || position.id() == null) throw new IllegalArgumentException("Invalid conversation cursor");
            args.add(stamp(position.time())); args.add(stamp(position.time())); args.add(position.id());
        }
        args.add(limit + 1);
        List<Summary> rows = jdbc.query("SELECT id,title,updated_at,persona_version FROM ai_conversations WHERE site_id=? AND owner_subject=?"
                        + condition + " ORDER BY updated_at DESC,id DESC LIMIT ?",
                (rs, row) -> new Summary(rs.getString(1), Objects.requireNonNullElse(rs.getString(2), "新会话"),
                        rs.getTimestamp(3).toInstant(), (Integer)rs.getObject(4)), args.toArray());
        boolean more = rows.size() > limit;
        List<Summary> items = List.copyOf(rows.subList(0, Math.min(rows.size(), limit)));
        Summary last = items.isEmpty() ? null : items.get(items.size() - 1);
        return new Page<>(items, more ? cursor(new Cursor(siteId, actor, null, last.updatedAt(), last.id(), 0, 0)) : null);
    }

    public Page<StoredMessage> messages(long siteId, String actor, String id, String cursor, int limit) {
        checkLimit(limit);
        Cursor position = cursor == null ? null : decodeCursor(cursor, siteId, actor, id);
        return tx.execute(transaction -> {
            repository.lockSite(siteId);
            repository.conversation(siteId, id, actor);
            repairSequences(siteId, id);
            long upper = position == null ? jdbc.queryForObject("SELECT COALESCE(MAX(message_sequence),0) FROM ai_messages WHERE site_id=? AND conversation_id=?",
                    Long.class, siteId, id) : position.upper();
            long before = position == null ? Long.MAX_VALUE : position.before();
            List<StoredMessage> rows = jdbc.query("SELECT * FROM ai_messages WHERE site_id=? AND conversation_id=? AND message_sequence<=? AND message_sequence<? ORDER BY message_sequence DESC LIMIT ?",
                    this::message, siteId, id, upper, before, limit + 1);
            boolean more = rows.size() > limit;
            List<StoredMessage> items = new ArrayList<>(rows.subList(0, Math.min(rows.size(), limit)));
            String next = more ? cursor(new Cursor(siteId, actor, id, null, null, items.get(items.size() - 1).sequence(), upper)) : null;
            Collections.reverse(items);
            return new Page<>(List.copyOf(items), next);
        });
    }

    public void delete(long siteId, String actor, String id) {
        tx.executeWithoutResult(transaction -> {
            repository.lockSite(siteId);
            repository.conversation(siteId, id, actor);
            eraseLocked(siteId, id, "DELETED");
            repository.deleteConversation(siteId, id, actor);
            repository.audit(siteId, actor, "CONVERSATION_DELETE", id, "SUCCEEDED");
        });
    }

    public void sweep() {
        List<Long> sites = jdbc.query("SELECT id FROM sites ORDER BY id", (rs, row) -> rs.getLong(1));
        for (long siteId : sites) tx.executeWithoutResult(transaction -> {
            repository.lockSite(siteId);
            expireLocked(siteId);
            Instant cutoff = time.now().minus(properties.getConversationRetentionDays(), ChronoUnit.DAYS);
            List<String> ids = jdbc.query("SELECT id FROM ai_conversations WHERE site_id=? AND updated_at<?",
                    (rs, row) -> rs.getString(1), siteId, stamp(cutoff));
            for (String id : ids) {
                eraseLocked(siteId, id, "EXPIRED");
                jdbc.update("DELETE FROM ai_messages WHERE site_id=? AND conversation_id=?", siteId, id);
                jdbc.update("DELETE FROM ai_conversations WHERE site_id=? AND id=?", siteId, id);
            }
            jdbc.update("DELETE FROM ai_chat_requests WHERE site_id=? AND state IN ('DELETED','EXPIRED') AND tombstone_until<?", siteId, stamp(time.now()));
        });
    }

    private void expireLocked(long siteId) {
        // A rolled-back backend can delete conversations without knowing the
        // request table. Reconcile orphaned results before replay or recovery.
        jdbc.update("""
                UPDATE ai_chat_requests r SET state='DELETED',question=NULL,result_json=NULL,holder=NULL,
                error_code=NULL,error_status=NULL,expires_at=?,tombstone_until=?
                WHERE site_id=? AND state NOT IN ('DELETED','EXPIRED')
                AND NOT EXISTS (SELECT 1 FROM ai_conversations c WHERE c.site_id=r.site_id AND c.id=r.conversation_id)
                """, stamp(time.now()), stamp(time.now().plus(30, ChronoUnit.DAYS)), siteId);
        List<Request> due = jdbc.query("SELECT * FROM ai_chat_requests WHERE site_id=? AND state='PROCESSING' AND deadline_at<=?",
                this::request, siteId, stamp(time.now()));
        for (Request request : due) {
            jdbc.update("UPDATE ai_chat_requests SET state=?,error_code=?,error_status=504,holder=NULL WHERE id=?",
                    request.dispatched() ? "UNKNOWN" : "FAILED", request.dispatched() ? "RESULT_UNKNOWN" : "REQUEST_TIMEOUT", request.id());
            release(request);
        }
        jdbc.update("""
                UPDATE ai_chat_requests SET state='EXPIRED',question=NULL,result_json=NULL,holder=NULL,tombstone_until=?
                WHERE site_id=? AND state NOT IN ('DELETED','EXPIRED') AND expires_at<=?
                """, stamp(time.now().plus(30, ChronoUnit.DAYS)), siteId, stamp(time.now()));
    }

    private void eraseLocked(long siteId, String id, String state) {
        jdbc.update("UPDATE ai_chat_requests SET state=?,question=NULL,result_json=NULL,holder=NULL,error_code=NULL,error_status=NULL,expires_at=?,tombstone_until=? WHERE site_id=? AND conversation_id=?",
                state, stamp(time.now()), stamp(time.now().plus(30, ChronoUnit.DAYS)), siteId, id);
        jdbc.update("UPDATE ai_conversations SET active_request_id=NULL WHERE site_id=? AND id=?", siteId, id);
    }

    private void release(Request request) {
        jdbc.update("UPDATE ai_conversations SET active_request_id=NULL WHERE site_id=? AND id=? AND active_request_id=?",
                request.siteId(), request.conversationId(), request.id());
    }

    private void insertMessage(Request request, String role, String content, long sequence) {
        jdbc.update("INSERT INTO ai_messages (id,site_id,conversation_id,role,content,created_at,message_sequence,turn_id) VALUES (?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(), request.siteId(), request.conversationId(), role, content,
                stamp(time.now()), sequence, request.id());
    }

    private void repairSequences(long siteId, String id) {
        Long last = jdbc.queryForObject("SELECT COALESCE(MAX(message_sequence),0) FROM ai_messages WHERE site_id=? AND conversation_id=?", Long.class, siteId, id);
        long next = last == null ? 0 : last;
        List<String> missing = jdbc.query("SELECT id FROM ai_messages WHERE site_id=? AND conversation_id=? AND message_sequence IS NULL ORDER BY created_at,id",
                (rs, row) -> rs.getString(1), siteId, id);
        for (String messageId : missing) jdbc.update("UPDATE ai_messages SET message_sequence=? WHERE id=? AND message_sequence IS NULL", ++next, messageId);
    }

    private Request find(long siteId, String actor, String key) {
        List<Request> rows = jdbc.query("SELECT * FROM ai_chat_requests WHERE site_id=? AND actor_subject=? AND client_key=?", this::request, siteId, actor, key);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private Request request(ResultSet rs, int row) throws SQLException {
        String result = rs.getString("result_json");
        return new Request(rs.getString("id"), rs.getLong("site_id"), rs.getString("actor_subject"), rs.getString("client_key"),
                rs.getString("input_hash"), rs.getString("conversation_id"), rs.getString("question"), rs.getString("state"),
                rs.getBoolean("dispatched"), rs.getString("holder"), result == null ? null : decode(result, AiChatService.Reply.class),
                rs.getString("error_code"), (Integer)rs.getObject("error_status"), rs.getTimestamp("deadline_at").toInstant(), rs.getTimestamp("expires_at").toInstant());
    }

    private StoredMessage message(ResultSet rs, int row) throws SQLException {
        return new StoredMessage(rs.getString("id"), rs.getString("role"), rs.getString("content"),
                rs.getTimestamp("created_at").toInstant(), rs.getLong("message_sequence"), rs.getString("turn_id"));
    }

    private void ensureReadable(Request request) {
        if ("DELETED".equals(request.state()) || "EXPIRED".equals(request.state()))
            throw new AiException(HttpStatus.GONE, request.state(), "AI request has been deleted or expired", 0);
    }
    private static AiException conflict(String code, String message) { return new AiException(HttpStatus.CONFLICT, code, message, 0); }
    private static Timestamp stamp(Instant value) { return Timestamp.from(value); }
    private static void checkLimit(int limit) { if (limit < 1 || limit > 100) throw new IllegalArgumentException("Page limit must be 1 to 100"); }
    public static String key(String value) {
        try { if (value == null || value.length() != 36) throw new IllegalArgumentException(); return UUID.fromString(value).toString(); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("Request key must be a UUID"); }
    }
    private static String hash(String question, String id) {
        try {
            // Length prefix and explicit null prevent ambiguous concatenations.
            String input = question.length() + ":" + question + ":" + (id == null ? "null" : id.length() + ":" + id);
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
    private static String title(String question) {
        String text = question.trim().replaceAll("\\s+", " ");
        int end = Math.min(80, text.length());
        if (end < text.length() && Character.isHighSurrogate(text.charAt(end - 1))) end--;
        return text.substring(0, end);
    }
    private String encode(Object value) { try { return json.writeValueAsString(value); } catch (Exception error) { throw new IllegalStateException("Cannot persist AI result", error); } }
    private <T> T decode(String value, Class<T> type) { try { return json.readValue(value, type); } catch (Exception error) { throw new IllegalStateException("Cannot read AI result", error); } }
    private String cursor(Cursor value) { return Base64.getUrlEncoder().withoutPadding().encodeToString(encode(value).getBytes(StandardCharsets.UTF_8)); }
    private Cursor decodeCursor(String value, long siteId, String actor, String conversationId) {
        try {
            if (value.length() > 2048) throw new IllegalArgumentException();
            Cursor cursor = json.readValue(Base64.getUrlDecoder().decode(value), Cursor.class);
            if (cursor.siteId() != siteId || !actor.equals(cursor.actor()) || !Objects.equals(conversationId, cursor.conversationId())
                    || cursor.before() < 0 || cursor.upper() < 0) throw new IllegalArgumentException();
            return cursor;
        } catch (Exception error) { throw new IllegalArgumentException("Invalid AI pagination cursor"); }
    }
}
