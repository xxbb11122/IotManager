package com.iot.manager.ai;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import com.openai.core.Timeout;
import org.springframework.ai.openai.http.okhttp.OpenAiHttpClientBuilderCustomizer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import java.time.Duration;

@Configuration
public class AiHttpTimeoutConfig {
    // This customizer belongs only to Spring AI's SDK transport. Weather and
    // other application HTTP clients keep their own deadlines.
    @Bean
    @ConditionalOnProperty(prefix = "iot.ai", name = "enabled", havingValue = "true")
    OpenAiHttpClientBuilderCustomizer aiTransport(
            @Value("${iot.ai.chat-completions-path:/chat/completions}") String completionsPath) {
        if (completionsPath == null || !completionsPath.matches("/[A-Za-z0-9/_-]+")
                || completionsPath.contains("//") || completionsPath.contains("..")) {
            throw new IllegalStateException("AI chat completions path is invalid");
        }
        return builder -> builder.timeout(Timeout.builder()
                .connect(Duration.ofSeconds(5)).read(Duration.ofSeconds(30))
                .write(Duration.ofSeconds(30)).request(Duration.ofSeconds(30)).build())
                .interceptor(chain -> {
                    var request = chain.request();
                    String path = request.url().encodedPath();
                    String sdkPath = "/chat/completions";
                    if (path.endsWith(sdkPath) && !sdkPath.equals(completionsPath)) {
                        request = request.newBuilder().url(request.url().newBuilder()
                                .encodedPath(path.substring(0, path.length() - sdkPath.length()) + completionsPath)
                                .build()).build();
                    }
                    return chain.proceed(request);
                });
    }
}
