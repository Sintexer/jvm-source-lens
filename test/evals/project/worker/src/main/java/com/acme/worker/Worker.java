package com.acme.worker;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.collect.Lists;
import java.util.List;

public class Worker {
    private final ObjectMapper mapper = new ObjectMapper();

    public List<String> names(String... raw) {
        return Lists.newArrayList(raw);
    }
}
