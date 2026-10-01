package com.iot.manager.ai;

import com.iot.manager.service.SiteAccessService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ContentDisposition;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Base64;
import java.nio.charset.StandardCharsets;
import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api/v1/sites/{siteId}/ai")
@ConditionalOnProperty(prefix = "iot.ai", name = "enabled", havingValue = "true")
public class AiController {
    public record ChatRequest(@NotBlank String question, String conversationId) { }
    public record KnowledgeBaseRequest(@NotBlank String name) { }
    public record PersonaRequest(@NotBlank String name, @NotBlank String instructions, int expectedVersion) { }
    public record ActivationRequest(Integer expectedActiveVersion) { }

    private final SiteAccessService siteAccess;
    private final AiRepository repository;
    private final AiManagementService management;
    private final AiIngestService ingestion;
    private final AiChatService chat;
    private final AiProperties properties;
    private final AiConversationStore conversations;

    public AiController(SiteAccessService siteAccess, AiRepository repository, AiManagementService management,
                        AiIngestService ingestion, AiChatService chat, AiProperties properties,
                        AiConversationStore conversations) {
        this.siteAccess = siteAccess;
        this.repository = repository;
        this.management = management;
        this.ingestion = ingestion;
        this.chat = chat;
        this.properties = properties;
        this.conversations = conversations;
    }

    @PostMapping("/chat")
    public ResponseEntity<?> chat(@PathVariable long siteId, @Valid @RequestBody ChatRequest request,
                                 @RequestHeader(name="Idempotency-Key", required=false) String key) {
        siteAccess.requireSiteAccess(siteId);
        if (key == null) return ResponseEntity.ok(chat.chat(siteId, actor(), request.question(), request.conversationId()));
        var result = chat.submit(siteId, actor(), request.question(), request.conversationId(), key);
        return result.pending() == null ? ResponseEntity.ok(result.reply())
                : ResponseEntity.accepted().header("Retry-After", "3").body(result.pending());
    }

    @GetMapping("/requests/{key}")
    public AiConversationStore.Status requestStatus(@PathVariable long siteId, @PathVariable String key) {
        siteAccess.requireSiteAccess(siteId);
        return conversations.status(siteId, actor(), AiConversationStore.key(key));
    }

    @GetMapping("/conversations")
    public AiConversationStore.Page<AiConversationStore.Summary> conversationList(@PathVariable long siteId,
            @RequestParam(required=false) String cursor, @RequestParam(defaultValue="20") int limit) {
        siteAccess.requireSiteAccess(siteId);
        return conversations.conversations(siteId, actor(), cursor, limit);
    }

    @GetMapping("/conversations/{id}/messages")
    public AiConversationStore.Page<AiConversationStore.StoredMessage> messageList(@PathVariable long siteId,
            @PathVariable String id, @RequestParam(required=false) String cursor, @RequestParam(defaultValue="20") int limit) {
        siteAccess.requireSiteAccess(siteId);
        return conversations.messages(siteId, actor(), id, cursor, limit);
    }

    @GetMapping("/conversations/{id}")
    public AiChatService.ConversationView conversation(@PathVariable long siteId, @PathVariable String id) {
        siteAccess.requireSiteAccess(siteId);
        return chat.conversation(siteId, id, actor());
    }

    @DeleteMapping("/conversations/{id}")
    public ResponseEntity<Void> deleteConversation(@PathVariable long siteId, @PathVariable String id) {
        siteAccess.requireSiteAccess(siteId);
        chat.deleteConversation(siteId, id, actor());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/knowledge-bases")
    public List<AiRepository.KnowledgeBase> knowledgeBases(@PathVariable long siteId) {
        siteAccess.requireSiteAccess(siteId);
        requireKnowledgeEnabled();
        return management.knowledgeBases(siteId);
    }

    @PostMapping("/knowledge-bases")
    public ResponseEntity<AiRepository.KnowledgeBase> createKnowledgeBase(
            @PathVariable long siteId, @Valid @RequestBody KnowledgeBaseRequest request) {
        siteAccess.requireSiteAccess(siteId);
        requireAdmin();
        requireKnowledgeEnabled();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(management.createKnowledgeBase(siteId, request.name(), actor()));
    }

    @GetMapping("/knowledge-bases/{id}/documents")
    public List<AiRepository.DocumentSummary> documents(@PathVariable long siteId, @PathVariable String id) {
        siteAccess.requireSiteAccess(siteId);
        requireAdmin();
        requireKnowledgeEnabled();
        return management.documents(siteId, id);
    }

    @PostMapping(value = "/knowledge-bases/{id}/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<AiRepository.Job> upload(
            @PathVariable long siteId, @PathVariable String id, @RequestPart("file") MultipartFile file) {
        siteAccess.requireSiteAccess(siteId);
        requireAdmin();
        requireKnowledgeEnabled();
        return ResponseEntity.accepted().body(ingestion.upload(siteId, id, file, actor()));
    }

    @GetMapping("/ingest-jobs/{id}")
    public AiRepository.Job job(@PathVariable long siteId, @PathVariable String id) {
        siteAccess.requireSiteAccess(siteId);
        requireAdmin();
        requireKnowledgeEnabled();
        return repository.job(siteId, id);
    }

    @PostMapping("/ingest-jobs/{id}/retry")
    public ResponseEntity<AiRepository.Job> retry(@PathVariable long siteId, @PathVariable String id) {
        siteAccess.requireSiteAccess(siteId);
        requireAdmin();
        requireKnowledgeEnabled();
        return ResponseEntity.accepted().body(ingestion.retry(siteId, id, actor()));
    }

    @DeleteMapping("/documents/{id}")
    public ResponseEntity<Void> deleteDocument(@PathVariable long siteId, @PathVariable String id) {
        siteAccess.requireSiteAccess(siteId);
        requireAdmin();
        requireKnowledgeEnabled();
        management.deleteDocument(siteId, id, actor());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/documents/{id}/activate")
    public AiRepository.DocumentSummary activateDocumentVersion(@PathVariable long siteId, @PathVariable String id) {
        siteAccess.requireSiteAccess(siteId);
        requireAdmin();
        requireKnowledgeEnabled();
        return management.activateDocumentVersion(siteId, id, actor());
    }

    @GetMapping("/documents/{id}/source")
    public ResponseEntity<byte[]> sourceDocument(@PathVariable long siteId, @PathVariable String id) {
        siteAccess.requireSiteAccess(siteId);
        requireKnowledgeEnabled();
        AiRepository.Document document = repository.document(siteId, id);
        if (!"PUBLISHED".equals(document.status())) throw new NoSuchElementException("AI document not found");
        byte[] body = Base64.getDecoder().decode(document.sourceBase64());
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(document.mimeType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(document.name(), StandardCharsets.UTF_8).build().toString())
                .body(body);
    }

    @GetMapping("/persona")
    public AiRepository.Persona activePersona(@PathVariable long siteId) {
        siteAccess.requireSiteAccess(siteId);
        return management.activePersona(siteId);
    }

    @GetMapping("/persona/versions")
    public List<AiRepository.Persona> personaVersions(@PathVariable long siteId) {
        siteAccess.requireSiteAccess(siteId);
        requireAdmin();
        return management.personas(siteId);
    }

    @PutMapping("/persona")
    public AiRepository.Persona savePersona(@PathVariable long siteId, @Valid @RequestBody PersonaRequest request) {
        siteAccess.requireSiteAccess(siteId);
        requireAdmin();
        return management.savePersona(siteId, request.name(), request.instructions(), request.expectedVersion(), actor());
    }

    @PostMapping("/persona/{version}/activate")
    public AiRepository.Persona activatePersona(@PathVariable long siteId, @PathVariable int version,
            @RequestBody(required=false) ActivationRequest request) {
        siteAccess.requireSiteAccess(siteId);
        requireAdmin();
        return management.activatePersona(siteId, version, actor(), request == null ? null : request.expectedActiveVersion());
    }

    private void requireAdmin() {
        if (!siteAccess.isScopeEnforced()) return;
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || authentication.getAuthorities().stream().noneMatch(authority ->
                "ROLE_OWNER".equals(authority.getAuthority()) || "ROLE_ADMIN".equals(authority.getAuthority()))) {
            throw new AccessDeniedException("AI administration requires OWNER or ADMIN");
        }
    }

    private void requireKnowledgeEnabled() {
        if (!properties.isKnowledgeEnabled()) {
            throw new AiException(HttpStatus.NOT_FOUND, "Knowledge base is disabled");
        }
    }

    private String actor() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken jwt) return jwt.getToken().getSubject();
        if (!siteAccess.isScopeEnforced()) return "local-development";
        throw new AccessDeniedException("Verified bearer token required");
    }
}
