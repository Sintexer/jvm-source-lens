package com.acme.core;

public class CoreGreeter extends BaseGreeter {
  public String greet(String name) {
    return basePrefix() + name;
  }
}
