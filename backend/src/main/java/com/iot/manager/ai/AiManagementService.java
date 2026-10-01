package com.iot.manager.ai;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@ConditionalOnProperty(prefix = "iot.ai", name = "enabled", havingValue = "true")
public class AiManagementService {
    private final AiRepository repository;

    public AiManagementService(AiRepository repository) {
        this.repository = repository;
    }

    public List<AiRepository.KnowledgeBase> knowledgeBases(long siteId) {
        return repository.knowledgeBases(siteId);
    }

    public AiRepository.KnowledgeBase createKnowledgeBase(long siteId, String name, String actor) {
        if (name == null || name.isBlank() || name.length() > 120) {
            throw new IllegalArgumentException("Knowledge base name is required and must be at most 120 characters");
        }
        AiRepository.KnowledgeBase result = repository.createKnowledgeBase(siteId, name.trim(), actor);
        repository.audit(siteId, actor, "KNOWLEDGE_BASE_CREATE", result.id(), "SUCCEEDED");
        return result;
    }

    public List<AiRepository.DocumentSummary> documents(long siteId, String kbId) {
        return repository.documents(siteId, kbId);
    }

    @Transactional
    public void deleteDocument(long siteId, String documentId, String actor) {
        AiRepository.Document document = repository.document(siteId, documentId);
        if ("DELETED".equals(document.status())) return;
        repository.documentStatus(siteId, documentId, "DELETED");
        repository.cancelJobsForDocument(siteId, documentId);
        repository.deleteVectorsAndChunks(siteId, documentId);
        repository.clearDocumentSource(siteId, documentId);
        repository.audit(siteId, actor, "DOCUMENT_DELETE", documentId, "SUCCEEDED");
    }

    @Transactional
    public AiRepository.DocumentSummary activateDocumentVersion(long siteId, String documentId, String actor) {
        AiRepository.Document document = repository.activateDocumentVersion(siteId, documentId);
        repository.audit(siteId, actor, "DOCUMENT_ACTIVATE", documentId, "SUCCEEDED");
        return new AiRepository.DocumentSummary(document.id(), document.knowledgeBaseId(), document.name(),
                document.status(), document.versionNumber());
    }

    public AiRepository.Persona activePersona(long siteId) {
        return repository.activePersona(siteId);
    }

    public List<AiRepository.Persona> personas(long siteId) {
        return repository.personas(siteId);
    }

    @Transactional
    public AiRepository.Persona savePersona(long siteId, String name, String instructions,
                                            int expectedVersion, String actor) {
        if (name == null || name.isBlank() || name.length() > 80
                || instructions == null || instructions.isBlank() || instructions.length() > 4_000) {
            throw new IllegalArgumentException("Persona name or instructions are invalid");
        }
        repository.lockSiteForPersonaChange(siteId);
        int latest = repository.personas(siteId).stream().mapToInt(AiRepository.Persona::version).max().orElse(0);
        if (latest != expectedVersion) throw new AiException(HttpStatus.CONFLICT, "PERSONA_VERSION_CONFLICT", "Persona version has changed", 0);
        AiRepository.Persona persona = repository.savePersona(siteId, name.trim(), instructions.trim(), actor);
        repository.audit(siteId, actor, "PERSONA_CREATE", null, "SUCCEEDED");
        return persona;
    }

    @Transactional
    public AiRepository.Persona activatePersona(long siteId, int version, String actor) {
        return activatePersona(siteId, version, actor, null);
    }

    @Transactional
    public AiRepository.Persona activatePersona(long siteId, int version, String actor, Integer expectedActiveVersion) {
        repository.lockSiteForPersonaChange(siteId);
        AiRepository.Persona active = repository.activePersona(siteId);
        int current = active == null ? 0 : active.version();
        if (expectedActiveVersion != null && current != expectedActiveVersion)
            throw new AiException(HttpStatus.CONFLICT, "PERSONA_VERSION_CONFLICT", "Active persona has changed", 0);
        AiRepository.Persona persona = repository.activatePersona(siteId, version);
        repository.audit(siteId, actor, "PERSONA_ACTIVATE", null, "SUCCEEDED");
        return persona;
    }
}
