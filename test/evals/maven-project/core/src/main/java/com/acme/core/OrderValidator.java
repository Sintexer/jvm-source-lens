package com.acme.core;

import org.apache.commons.lang3.StringUtils;

public class OrderValidator {
  public boolean isValidOrderId(String orderId) {
    return StringUtils.isNotBlank(orderId) && orderId.startsWith("ORD-");
  }
}
