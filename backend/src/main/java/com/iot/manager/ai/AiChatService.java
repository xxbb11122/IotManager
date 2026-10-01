package com.iot.manager.ai;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.iot.manager.service.PlatformMetricsService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import java.time.Duration;
import java.util.Collections;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
@ConditionalOnProperty(prefix = "iot.ai", name = "enabled", havingValue = "true")
public class AiChatService {
    public record Citation(String documentId, String documentName, int version, Integer pageNumber,
                           String heading, String snippet, String sourcePath) { }
    public record Reply(String requestId, String conversationId, String answer, List<Citation> citations,
                        Integer personaVersion, @JsonInclude(JsonInclude.Include.NON_NULL) String contextNotice) {
        public Reply(String requestId, String conversationId, String answer, List<Citation> citations, Integer personaVersion) {
            this(requestId, conversationId, answer, citations, personaVersion, null);
        }
        public Reply(String requestId, String conversationId, String answer, List<Citation> citations) {
            this(requestId, conversationId, answer, citations, null, null);
        }
    }
    public record ConversationView(String id, List<AiRepository.Message> messages, Integer personaVersion) { }
    public record Submission(Reply reply, AiConversationStore.Status pending) { }
    private final AiRepository repository;
    private final AiConversationStore requests;
    private final AiReplyGenerator generator;
    private final AiProperties properties;
    private final PlatformMetricsService metrics;
    private final Semaphore concurrency;

    public AiChatService(AiRepository repository, AiConversationStore requests, AiReplyGenerator generator,
                         AiProperties properties, PlatformMetricsService metrics) {
        this.repository = repository; this.requests = requests; this.generator = generator;
        this.properties = properties; this.metrics = metrics;
        concurrency = new Semaphore(properties.getMaxConcurrentChats());
    }

    public Reply chat(long siteId, String actor, String question, String conversationId) {
        Reply result = submit(siteId, actor, question, conversationId, UUID.randomUUID().toString()).reply();
        return new Reply(result.requestId(), result.conversationId(), result.answer(), result.citations(), result.personaVersion());
    }

    public Submission submit(long siteId, String actor, String question, String conversationId, String key) {
        if (question == null || question.isBlank() || question.length() > properties.getMaxQuestionChars())
            throw new IllegalArgumentException("Question is empty or too long");
        key = AiConversationStore.key(key);
        conversationId = conversationId == null || conversationId.isBlank() ? null : conversationId.trim();
        if (conversationId != null && conversationId.length() > 36) throw new IllegalArgumentException("Invalid conversation ID");
        long started = System.nanoTime();
        AtomicBoolean acquired = new AtomicBoolean();
        AiConversationStore.Request request = null;
        String outcome = "failed";
        try {
            var claim = requests.claim(siteId, actor, key, question, conversationId, () -> {
                if (!concurrency.tryAcquire()) throw new AiException(HttpStatus.TOO_MANY_REQUESTS,
                        "CONCURRENCY_LIMITED", "AI chat concurrency limit reached", 10);
                acquired.set(true);
            });
            request = claim.request();
            if (!claim.fresh()) {
                var state = requests.view(request);
                outcome = "replayed";
                if ("SUCCEEDED".equals(state.state())) return new Submission(state.result(), null);
                if ("PROCESSING".equals(state.state())) return new Submission(null, state);
                throw new AiException("UNKNOWN".equals(state.state()) ? HttpStatus.SERVICE_UNAVAILABLE
                        : HttpStatus.valueOf(state.errorStatus() == null ? 502 : state.errorStatus()),
                        state.errorCode() == null ? "REQUEST_FAILED" : state.errorCode(),
                        "UNKNOWN".equals(state.state()) ? "AI result is uncertain; query this request before retrying" : "This request previously failed", 0);
            }
            var owned = request;
            var generated = generator.generate(claim, () -> {
                if (!requests.dispatched(owned)) throw new AiException(HttpStatus.GONE, "REQUEST_INACTIVE", "AI request is no longer active", 0);
            });
            if (!requests.finish(request, generated.reply(), generated.usages(), generated.outcome())) {
                requests.status(siteId, actor, key);
                throw new AiException(HttpStatus.SERVICE_UNAVAILABLE, "RESULT_UNKNOWN", "AI result could not be committed", 0);
            }
            outcome = generated.outcome();
            return new Submission(generated.reply(), null);
        } catch (RuntimeException error) {
            if (request != null && acquired.get()) {
                try { requests.fail(request, error); }
                catch (RuntimeException storageFailure) { error.addSuppressed(storageFailure); }
            }
            throw error;
        } finally {
            if (acquired.get()) concurrency.release();
            metrics.aiOperation("chat", outcome, Duration.ofNanos(System.nanoTime() - started));
        }
    }

    public ConversationView conversation(long siteId, String id, String actor) {
        var conversation = repository.conversation(siteId, id, actor);
        requests.messages(siteId, actor, id, null, 1);
        var messages = new ArrayList<>(repository.messages(siteId, id));
        Collections.reverse(messages);
        return new ConversationView(id, messages, conversation.personaVersion());
    }

    public void deleteConversation(long siteId, String id, String actor) { requests.delete(siteId, actor, id); }

    @Scheduled(fixedDelay = 60_000)
    public void purgeOldConversations() { requests.sweep(); }
}
