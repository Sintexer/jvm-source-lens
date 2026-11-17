package com.acme.worker;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.collect.ImmutableList;
import java.util.List;

public class BatchWorker {
  private final ObjectMapper mapper = new ObjectMapper();

  public List<String> sampleBatch() {
    return mapper != null ? ImmutableList.of("a", "b") : ImmutableList.of();
  }
}
