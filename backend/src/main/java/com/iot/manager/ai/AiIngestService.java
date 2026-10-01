package com.iot.manager.ai;

import com.iot.manager.service.PlatformMetricsService;
import com.iot.manager.service.TimeProvider;
import jakarta.annotation.PreDestroy;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.io.IOUtils;
import org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Service
@ConditionalOnProperty(prefix = "iot.ai", name = "enabled", havingValue = "true")
public class AiIngestService {
    private static final int MAX_EXTRACTED_CHARS = 80_000;
    private static final int CHUNK_CHARS = 1_000;
    private static final int CHUNK_OVERLAP = 120;
    private static final int MAX_CHUNKS = 100;
    private static final int MAX_PDF_PAGE_CHARS = 20_000;
    private static final Duration MAX_PDF_EXTRACT_TIME = Duration.ofSeconds(15);

    private final AiRepository repository;
    private final AiModelGateway models;
    private final AiProperties properties;
    private final PlatformMetricsService metrics;
    private final TimeProvider timeProvider;
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(
            2, 2, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(32),
            task -> {
                Thread thread = new Thread(task, "ai-ingest");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.AbortPolicy());

    public AiIngestService(AiRepository repository, AiModelGateway models, AiProperties properties,
                           PlatformMetricsService metrics, TimeProvider timeProvider) {
        this.repository = repository;
        this.models = models;
        this.properties = properties;
        this.metrics = metrics;
        this.timeProvider = timeProvider;
    }

    public synchronized AiRepository.Job upload(long siteId, String kbId, MultipartFile file, String actor) {
        repository.knowledgeBase(siteId, kbId);
        if (file == null || file.isEmpty() || file.getSize() > properties.getMaxFileBytes()) {
            throw new AiException(HttpStatus.PAYLOAD_TOO_LARGE, "Document is empty or exceeds the file size limit");
        }
        String originalName = file.getOriginalFilename();
        String name = originalName == null ? "" : originalName.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).trim();
        if (name.isBlank() || name.length() > 255 || name.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("A valid document name is required");
        }
        String extension = name.substring(Math.max(0, name.lastIndexOf('.') + 1)).toLowerCase(Locale.ROOT);
        String mime = switch (extension) {
            case "txt" -> "text/plain";
            case "md" -> "text/markdown";
            case "pdf" -> "application/pdf";
            default -> throw new IllegalArgumentException("Only TXT, Markdown and PDF documents are supported");
        };
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException exception) {
            throw new AiException(HttpStatus.BAD_REQUEST, "Document could not be read");
        }
        if (bytes.length == 0 || bytes.length > properties.getMaxFileBytes()) {
            throw new AiException(HttpStatus.PAYLOAD_TOO_LARGE, "Document is empty or exceeds the file size limit");
        }
        if ("application/pdf".equals(mime) && !new String(bytes, 0, Math.min(5, bytes.length), StandardCharsets.US_ASCII).startsWith("%PDF-")) {
            throw new IllegalArgumentException("Invalid PDF file");
        }
        String hash = sha256(bytes);
        AiRepository.UploadReservation reservation = repository.createUpload(siteId, kbId, name, mime,
                Base64.getEncoder().encodeToString(bytes), hash, bytes.length, actor,
                models.embeddingModelName(), properties.getMaxSiteBytes(), properties.getMaxSiteUploadsPerDay(),
                timeProvider.now().truncatedTo(ChronoUnit.DAYS));
        AiRepository.Job job = reservation.job();
        if (!reservation.created()) return job;
        schedule(siteId, job);
        repository.audit(siteId, actor, "DOCUMENT_UPLOAD", job.documentId(), "QUEUED");
        return job;
    }

    public synchronized AiRepository.Job retry(long siteId, String jobId, String actor) {
        AiRepository.Job job = repository.retryUpload(siteId, jobId, actor, models.embeddingModelName(),
                properties.getMaxSiteUploadsPerDay(), timeProvider.now().truncatedTo(ChronoUnit.DAYS));
        schedule(siteId, job);
        repository.audit(siteId, actor, "DOCUMENT_RETRY", job.documentId(), "QUEUED");
        return repository.job(siteId, jobId);
    }

    private void schedule(long siteId, AiRepository.Job job) {
        try {
            executor.execute(() -> process(siteId, job));
        } catch (RuntimeException exception) {
            repository.jobStatus(siteId, job.id(), "FAILED", "QUEUE_FULL");
            repository.documentStatus(siteId, job.documentId(), "FAILED");
            metrics.aiOperation("ingest", "queue_full", Duration.ZERO);
            throw new AiException(HttpStatus.TOO_MANY_REQUESTS, "AI document queue is full", 30);
        }
    }

    @EventListener(ApplicationReadyEvent.class)
    public void resumeAfterRestart() {
        if (!properties.isKnowledgeEnabled()) return;
        for (AiRepository.Job job : repository.unfinishedJobs()) {
            try {
                schedule(repository.jobSite(job.id()), job);
            } catch (AiException ignored) {
                // The job is marked FAILED with QUEUE_FULL and remains retryable.
            }
        }
    }

    private void process(long siteId, AiRepository.Job job) {
        long started = System.nanoTime();
        String outcome = "failed";
        try {
            repository.jobStatus(siteId, job.id(), "RUNNING", null);
            AiRepository.Document document = repository.document(siteId, job.documentId());
            repository.deleteVectorsAndChunks(siteId, document.id());
            byte[] bytes = Base64.getDecoder().decode(document.sourceBase64());
            List<PageText> pages = extract(document.mimeType(), bytes);
            List<ChunkText> chunks = split(pages);
            if (chunks.isEmpty()) throw new IllegalArgumentException("NO_EXTRACTABLE_TEXT");
            int ordinal = 0;
            for (ChunkText chunk : chunks) {
                if ("DELETED".equals(repository.document(siteId, document.id()).status())) {
                    repository.jobStatus(siteId, job.id(), "CANCELLED", null);
                    repository.deleteVectorsAndChunks(siteId, document.id());
                    outcome = "cancelled";
                    return;
                }
                AiModelGateway.VectorResult embedded = models.embed(chunk.content());
                repository.usage(siteId, "system", "EMBED", models.embeddingModelName(),
                        embedded.inputTokens(), null);
                repository.saveChunk(siteId, document.id(), ordinal++, chunk.content(), chunk.heading(),
                        chunk.pageNumber(), models.embeddingModelName(), embedded.vector());
            }
            if (!repository.publishDocument(siteId, document.id(), job.id())) {
                repository.deleteVectorsAndChunks(siteId, document.id());
                outcome = "cancelled";
                return;
            }
            outcome = "success";
        } catch (Exception exception) {
            try {
                repository.deleteVectorsAndChunks(siteId, job.documentId());
                if (!"DELETED".equals(repository.document(siteId, job.documentId()).status())) {
                    repository.documentStatus(siteId, job.documentId(), "FAILED");
                    String reason = exception instanceof IllegalArgumentException
                            ? exception.getMessage() : "INGEST_FAILED";
                    repository.jobStatus(siteId, job.id(), "FAILED",
                            reason != null && reason.matches("[A-Z_]{3,80}") ? reason : "INGEST_FAILED");
                    repository.audit(siteId, "system", "DOCUMENT_INGEST", job.documentId(), "FAILED");
                } else {
                    repository.jobStatus(siteId, job.id(), "CANCELLED", null);
                    outcome = "cancelled";
                }
            } catch (RuntimeException databaseFailure) {
                // Startup recovery requeues RUNNING jobs after a process/database restart.
            }
        } finally {
            metrics.aiOperation("ingest", outcome, Duration.ofNanos(System.nanoTime() - started));
        }
    }

    private static List<PageText> extract(String mime, byte[] bytes) throws IOException {
        if ("application/pdf".equals(mime)) {
            List<PageText> pages = new ArrayList<>();
            long deadline = System.nanoTime() + MAX_PDF_EXTRACT_TIME.toNanos();
            try (var pdf = Loader.loadPDF(bytes, "", null, null, IOUtils.createTempFileOnlyStreamCache())) {
                if (pdf.getNumberOfPages() > 200) throw new IllegalArgumentException("PDF_PAGE_LIMIT");
                int[] totalChars = {0};
                for (int page = 1; page <= pdf.getNumberOfPages(); page++) {
                    if (System.nanoTime() > deadline) throw new IllegalArgumentException("PDF_TIMEOUT");
                    PDFTextStripper stripper = new PDFTextStripper() {
                        private int pageChars;

                        @Override
                        protected void writeString(String text, List<TextPosition> positions) throws IOException {
                            if (System.nanoTime() > deadline) throw new IllegalArgumentException("PDF_TIMEOUT");
                            totalChars[0] += text.length();
                            pageChars += text.length();
                            if (totalChars[0] > MAX_EXTRACTED_CHARS || pageChars > MAX_PDF_PAGE_CHARS) {
                                throw new IllegalArgumentException("TEXT_LIMIT");
                            }
                            super.writeString(text, positions);
                        }
                    };
                    stripper.setStartPage(page);
                    stripper.setEndPage(page);
                    String text = stripper.getText(pdf).trim();
                    if (text.length() > MAX_PDF_PAGE_CHARS) throw new IllegalArgumentException("TEXT_LIMIT");
                    if (!text.isBlank()) pages.add(new PageText(text, page));
                }
            } catch (InvalidPasswordException exception) {
                throw new IllegalArgumentException("PDF_ENCRYPTED", exception);
            }
            return pages;
        }
        try {
            String text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
            return List.of(new PageText(text, null));
        } catch (CharacterCodingException exception) {
            throw new IllegalArgumentException("INVALID_UTF8", exception);
        }
    }

    private static List<ChunkText> split(List<PageText> pages) {
        List<ChunkText> chunks = new ArrayList<>();
        int total = 0;
        for (PageText page : pages) {
            String normalized = page.content().replace("\u0000", "").trim();
            total += normalized.length();
            if (total > MAX_EXTRACTED_CHARS) throw new IllegalArgumentException("TEXT_LIMIT");
            for (int start = 0; start < normalized.length(); start += CHUNK_CHARS - CHUNK_OVERLAP) {
                String part = normalized.substring(start, Math.min(normalized.length(), start + CHUNK_CHARS)).trim();
                if (!part.isBlank()) chunks.add(new ChunkText(part, null, page.pageNumber()));
                if (chunks.size() > MAX_CHUNKS) throw new IllegalArgumentException("CHUNK_LIMIT");
                if (start + CHUNK_CHARS >= normalized.length()) break;
            }
        }
        return chunks;
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    @PreDestroy
    public void shutdown() {
        executor.shutdownNow();
    }

    private record PageText(String content, Integer pageNumber) { }
    private record ChunkText(String content, String heading, Integer pageNumber) { }
}
