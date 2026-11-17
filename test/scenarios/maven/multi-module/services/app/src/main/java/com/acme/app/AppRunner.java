package com.acme.app;

import com.acme.core.CoreGreeter;

public class AppRunner {
  public String run(String user) {
    return new CoreGreeter().greet(user);
  }
}
