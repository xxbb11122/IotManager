package com.iot.manager.ai;

import com.iot.manager.config.TimeProperties;
import com.iot.manager.service.TimeProvider;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.NoSuchElementException;
import java.util.UUID;
import java.time.Clock;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AiRepositoryScopeTest {
    @Test
    void metadataAndConversationsStayWithinSiteAndOwner() {
        String url = "jdbc:h2:mem:ai-scope-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1";
        Flyway.configure().dataSource(url, "sa", "")
                .locations("classpath:db/migration", "classpath:db/migration-h2")
                .load().migrate();
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "sa", ""));
        jdbc.update("INSERT INTO organizations (code, name) VALUES ('ai-scope', 'AI scope')");
        Long org = jdbc.queryForObject("SELECT id FROM organizations WHERE code = 'ai-scope'", Long.class);
        jdbc.update("INSERT INTO sites (organization_id, code, name) VALUES (?, 'a', 'A')", org);
        jdbc.update("INSERT INTO sites (organization_id, code, name) VALUES (?, 'b', 'B')", org);
        long siteA = jdbc.queryForObject("SELECT id FROM sites WHERE organization_id = ? AND code = 'a'", Long.class, org);
        long siteB = jdbc.queryForObject("SELECT id FROM sites WHERE organization_id = ? AND code = 'b'", Long.class, org);
        AiRepository repository = new AiRepository(jdbc, new TimeProvider(Clock.systemUTC(), new TimeProperties()));

        var kb = repository.createKnowledgeBase(siteA, "Manuals", "owner");
        assertThat(repository.knowledgeBases(siteB)).isEmpty();
        assertThatThrownBy(() -> repository.knowledgeBase(siteB, kb.id()))
                .isInstanceOf(NoSuchElementException.class);
        assertThatThrownBy(() -> repository.createDocument(siteB, kb.id(), "x.txt", "text/plain",
                "eA==", "hash", 1, "owner")).isInstanceOf(DataIntegrityViolationException.class);

        var conversation = repository.createConversation(siteA, "user-a", null);
        repository.addMessage(siteA, conversation.id(), "USER", "hello");
        assertThat(repository.messages(siteA, conversation.id())).hasSize(1);
        assertThatThrownBy(() -> repository.conversation(siteB, conversation.id(), "user-a"))
                .isInstanceOf(NoSuchElementException.class);
        assertThatThrownBy(() -> repository.conversation(siteA, conversation.id(), "user-b"))
                .isInstanceOf(NoSuchElementException.class);
    }
}
