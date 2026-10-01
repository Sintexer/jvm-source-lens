package com.acme.app;

import com.acme.core.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.retry.support.RetryTemplate;

public class App {
    private final ObjectMapper mapper = new ObjectMapper();
    private final RetryTemplate retry = RetryTemplate.builder().maxAttempts(3).build();
    private final UserService users = new UserService();

    public String greet(String json) throws Exception {
        return retry.execute(ctx -> users.normalizeName(mapper.readTree(json).get("name").asText()));
    }
}
