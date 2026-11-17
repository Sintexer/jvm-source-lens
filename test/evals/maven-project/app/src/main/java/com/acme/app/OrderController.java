package com.acme.app;

import com.acme.core.OrderValidator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.retry.support.RetryTemplate;

public class OrderController {
  private final OrderValidator validator = new OrderValidator();
  private final ObjectMapper mapper = new ObjectMapper();
  private final RetryTemplate retry = new RetryTemplate();

  public boolean accept(String orderId) {
    return validator.isValidOrderId(orderId) && mapper != null && retry != null;
  }
}
