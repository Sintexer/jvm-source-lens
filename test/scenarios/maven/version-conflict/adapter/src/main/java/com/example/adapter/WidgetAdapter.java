package com.example.adapter;

import com.example.widget.Widget;

public class WidgetAdapter {
  public String adapt(Widget w) {
    return w.render();
  }
}
