package com.iot.manager.ai;

import com.iot.manager.service.TimeProvider;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT, properties={
        "iot.ai.enabled=true", "iot.ai.knowledge-enabled=false", "iot.ai.allowed-hosts[0]=example.test",
        "spring.ai.openai.chat.base-url=https://example.test", "spring.ai.openai.chat.api-key=test-only-key",
        "spring.ai.openai.embedding.enabled=false"})
@ActiveProfiles("dev")
class AiRequestRecoveryIntegrationTest {
    @Autowired AiChatService chat;
    @Autowired AiConversationStore requests;
    @Autowired AiManagementService management;
    @Autowired AiProperties properties;
    @Autowired JdbcTemplate jdbc;
    @Autowired TestRestTemplate rest;
    @SpyBean AiRepository repository;
    @SpyBean TimeProvider time;
    @MockBean AiModelGateway models;
    long site;
    @BeforeEach void setUp() {
        Long org=jdbc.queryForObject("SELECT organization_id FROM sites ORDER BY id LIMIT 1",Long.class);
        String code="ai-"+UUID.randomUUID().toString().substring(0,12);
        jdbc.update("INSERT INTO sites(organization_id,code,name) VALUES(?,?,'AI recovery test')",org,code);
        site=jdbc.queryForObject("SELECT id FROM sites WHERE code=?",Long.class,code);
        when(models.answer(any(),any())).thenReturn(new AiModelGateway.Answer("通用说明","mock-chat",4,6));
    }
    @AfterEach void resetSpies() { reset(repository,time,models); }
    String key() { return UUID.randomUUID().toString(); }
    long count(String table) { return jdbc.queryForObject("SELECT COUNT(*) FROM "+table+" WHERE site_id=?",Long.class,site); }
    void code(Throwable error,String code) { assertThat(error).isInstanceOfSatisfying(AiException.class,ai->assertThat(ai.getCode()).isEqualTo(code)); }

    @Test void successfulReplayPreservesReplyAndConsumesQuotaAndProviderOnlyOnce() {
        String key=key();
        var first=chat.submit(site,"owner","解释 MQTT",null,key).reply();
        var replay=chat.submit(site,"owner"," 解释 MQTT ",null,key).reply();
        assertThat(replay).isEqualTo(first);
        assertThat(requests.status(site,"owner",key).result()).isEqualTo(first);
        assertThat(count("ai_messages")).isEqualTo(2);
        assertThat(count("ai_usage_events")).isEqualTo(2); // one attempt, one paid chat
        verify(models,times(1)).answer(any(),any());
        assertThatThrownBy(()->chat.submit(site,"owner","different input",null,key)).satisfies(e->code(e,"IDEMPOTENCY_CONFLICT"));
    }
    @Test void invalidOrForeignConversationDoesNotConsumeQuota() {
        String id=repository.createConversation(site,"other",null).id();
        assertThatThrownBy(()->chat.submit(site,"owner","question",id,key())).isInstanceOf(NoSuchElementException.class);
        assertThat(count("ai_usage_events")).isZero();
        verifyNoInteractions(models);
    }

    @Test void deletionByPreviousBackendCannotExposeAStoredResultAfterUpgrade() {
        String key=key();
        var result=chat.submit(site,"owner","explain MQTT",null,key).reply();
        repository.deleteConversation(site,result.conversationId(),"owner");
        assertThatThrownBy(()->requests.status(site,"owner",key)).satisfies(e->code(e,"DELETED"));
        assertThat(jdbc.queryForObject("SELECT question FROM ai_chat_requests WHERE site_id=? AND client_key=?",String.class,site,key)).isNull();
        assertThat(jdbc.queryForObject("SELECT result_json FROM ai_chat_requests WHERE site_id=? AND client_key=?",String.class,site,key)).isNull();
        assertThatThrownBy(()->chat.submit(site,"owner","explain MQTT",null,key)).satisfies(e->code(e,"DELETED"));
        verify(models,times(1)).answer(any(),any());
    }

    @Test void replayAtDailyLimitDoesNotConsumeAnotherAttempt() {
        int limit=properties.getMaxSiteChatsPerDay();
        properties.setMaxSiteChatsPerDay(1);
        try {
            String key=key();
            var first=chat.submit(site,"owner","explain MQTT",null,key).reply();
            assertThat(chat.submit(site,"owner","explain MQTT",null,key).reply()).isEqualTo(first);
            assertThatThrownBy(()->chat.submit(site,"owner","another question",null,key()))
                    .satisfies(e->code(e,"DAILY_BUDGET_EXHAUSTED"));
            verify(models,times(1)).answer(any(),any());
            assertThat(count("ai_usage_events")).isEqualTo(2);
        } finally { properties.setMaxSiteChatsPerDay(limit); }
    }
    @Test void localKnowledgeAnswerIsStoredAndRecoverableWithoutAnyProvider() {
        String key=key();
        var reply=chat.submit(site,"owner","查一下本站文档",null,key).reply();
        assertThat(reply.conversationId()).isNotBlank();
        assertThat(requests.messages(site,"owner",reply.conversationId(),null,20).items()).hasSize(2);
        assertThat(count("ai_usage_events")).isEqualTo(1);
        assertThat(requests.status(site,"owner",key).result()).isEqualTo(reply);
        verifyNoInteractions(models);
    }
    @Test void sameKeyReturnsProcessingAndOtherKeyOnSameConversationIsBusy() throws Exception {
        var first=chat.submit(site,"owner","first",null,key()).reply();
        CountDownLatch entered=new CountDownLatch(1), release=new CountDownLatch(1);
        when(models.answer(any(),any())).thenAnswer(invocation->{ entered.countDown(); if(!release.await(10,TimeUnit.SECONDS))throw new IllegalStateException("test timeout"); return new AiModelGateway.Answer("second","mock",1,1); });
        String key=key();
        ExecutorService executor=Executors.newSingleThreadExecutor();
        try {
            var future=executor.submit(()->chat.submit(site,"owner","second",first.conversationId(),key));
            assertThat(entered.await(10,TimeUnit.SECONDS)).isTrue();
            assertThat(chat.submit(site,"owner","second",first.conversationId(),key).pending().state()).isEqualTo("PROCESSING");
            assertThatThrownBy(()->chat.submit(site,"owner","third",first.conversationId(),key())).satisfies(e->code(e,"CONVERSATION_BUSY"));
            release.countDown(); future.get(10,TimeUnit.SECONDS);
            assertThat(count("ai_messages")).isEqualTo(4);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai_usage_events WHERE site_id=? AND operation='CHAT_ATTEMPT'",Long.class,site)).isEqualTo(2);
        } finally { release.countDown(); executor.shutdownNow(); }
    }
    @Test void failedFinalCommitNeverExposesHalfTurnOrPaidUsage() {
        doThrow(new IllegalStateException("simulated audit commit failure")).when(repository).audit(eq(site),eq("owner"),eq("CHAT"),anyString(),eq("SUCCEEDED"));
        String key=key();
        assertThatThrownBy(()->chat.submit(site,"owner","question",null,key)).hasMessageContaining("simulated audit");
        assertThat(count("ai_messages")).isZero();
        assertThat(count("ai_usage_events")).isEqualTo(1);
        assertThat(requests.status(site,"owner",key).state()).isEqualTo("UNKNOWN");
        assertThatThrownBy(()->chat.submit(site,"owner","question",null,key)).satisfies(e->code(e,"RESULT_UNKNOWN"));
        verify(models,times(1)).answer(any(),any());
    }
    @Test void deleteClearsRequestBodyAndRejectsReplayAndForeignLookup() {
        String key=key();
        var reply=chat.submit(site,"owner","question",null,key).reply();
        requests.delete(site,"owner",reply.conversationId());
        assertThatThrownBy(()->requests.status(site,"owner",key)).satisfies(e->code(e,"DELETED"));
        assertThatThrownBy(()->chat.submit(site,"owner","question",null,key)).satisfies(e->code(e,"DELETED"));
        assertThatThrownBy(()->requests.status(site,"other",key)).isInstanceOf(NoSuchElementException.class);
        assertThat(jdbc.queryForObject("SELECT question FROM ai_chat_requests WHERE site_id=? AND client_key=?",String.class,site,key)).isNull();
        assertThat(jdbc.queryForObject("SELECT result_json FROM ai_chat_requests WHERE site_id=? AND client_key=?",String.class,site,key)).isNull();
        assertThat(count("ai_messages")).isZero();
        verify(models,times(1)).answer(any(),any());
    }
    @Test void deletedInFlightConversationCannotBeRevivedByLateAnswer() throws Exception {
        CountDownLatch entered=new CountDownLatch(1), release=new CountDownLatch(1);
        when(models.answer(any(),any())).thenAnswer(invocation->{ entered.countDown(); release.await(10,TimeUnit.SECONDS); return new AiModelGateway.Answer("late","mock",1,1); });
        String key=key();
        ExecutorService executor=Executors.newSingleThreadExecutor();
        try {
            var future=executor.submit(()->chat.submit(site,"owner","question",null,key));
            assertThat(entered.await(10,TimeUnit.SECONDS)).isTrue();
            String id=requests.status(site,"owner",key).conversationId();
            requests.delete(site,"owner",id);
            release.countDown();
            assertThatThrownBy(()->future.get(10,TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class)
                    .cause().isInstanceOf(AiException.class);
            assertThat(count("ai_conversations")).isZero();
            assertThat(count("ai_messages")).isZero();
        } finally { release.countDown(); executor.shutdownNow(); }
    }
    @Test void expiredDispatchIsUnknownAndOldHolderCannotFinish() {
        Instant now=Instant.now().truncatedTo(ChronoUnit.SECONDS);
        doReturn(now).when(time).now();
        var claim=requests.claim(site,"owner",key(),"question",null,()->{});
        assertThat(requests.dispatched(claim.request())).isTrue();
        doReturn(now.plusSeconds(121)).when(time).now();
        assertThat(requests.status(site,"owner",claim.request().key()).state()).isEqualTo("UNKNOWN");
        assertThat(requests.finish(claim.request(),new AiChatService.Reply(claim.request().id(),claim.request().conversationId(),"late",List.of()),List.of(),"SUCCEEDED")).isFalse();
        assertThat(count("ai_messages")).isZero();
    }
    @Test void stablePaginationAndOldBackendWritesAreSupported() {
        var reply=chat.submit(site,"owner","one",null,key()).reply();
        repository.addMessage(site,reply.conversationId(),"USER","legacy question");
        repository.addMessage(site,reply.conversationId(),"ASSISTANT","legacy answer");
        var page=requests.messages(site,"owner",reply.conversationId(),null,2);
        chat.submit(site,"owner","new turn",reply.conversationId(),key());
        var older=requests.messages(site,"owner",reply.conversationId(),page.nextCursor(),2);
        assertThat(page.items()).extracting(AiConversationStore.StoredMessage::content).containsExactly("legacy question","legacy answer");
        assertThat(older.items()).hasSize(2);
        assertThat(older.nextCursor()).isNull();
        assertThat(requests.messages(site,"owner",reply.conversationId(),null,100).items()).hasSize(6);
        assertThatThrownBy(()->requests.messages(site,"other",reply.conversationId(),page.nextCursor(),2)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void personaActivationChecksActiveVersionAndPinnedDefaultIsStable() {
        var old=chat.submit(site,"owner","first",null,key()).reply();
        var one=management.savePersona(site,"one","warm",0,"owner");
        var two=management.savePersona(site,"two","brief",1,"owner");
        management.activatePersona(site,one.version(),"owner",0);
        assertThatThrownBy(()->management.activatePersona(site,two.version(),"owner",0)).satisfies(e->code(e,"PERSONA_VERSION_CONFLICT"));
        assertThat(chat.submit(site,"owner","second",old.conversationId(),key()).reply().personaVersion()).isNull();
        assertThat(chat.submit(site,"owner","new",null,key()).reply().personaVersion()).isEqualTo(one.version());
    }
    @Test void httpContractsPreserveLegacyAndReturnTypedRecoveryAndCapabilities() {
        String root="/api/v1/sites/"+site+"/ai";
        HttpHeaders headers=new HttpHeaders(); headers.set("Idempotency-Key",key());
        var first=rest.postForEntity(root+"/chat",new HttpEntity<>(Map.of("question","question"),headers),Map.class);
        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
        var restored=rest.getForEntity(root+"/requests/"+headers.getFirst("Idempotency-Key"),Map.class);
        assertThat(restored.getBody()).containsEntry("state","SUCCEEDED").containsKey("result");
        assertThat(rest.getForObject(root+"/capabilities",Map.class)).containsEntry("contractVersion",1);
        assertThat(rest.getForObject(root+"/conversations",Map.class)).containsKey("items");
        var legacy=rest.postForEntity(root+"/chat",Map.of("question","legacy"),Map.class);
        assertThat(legacy.getBody().keySet()).containsExactlyInAnyOrder("requestId","conversationId","answer","citations","personaVersion");
    }
}
