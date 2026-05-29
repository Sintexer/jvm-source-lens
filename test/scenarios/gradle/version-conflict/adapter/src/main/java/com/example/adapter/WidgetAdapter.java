package com.example.adapter;

import com.example.widget.Widget;

public class WidgetAdapter {
    private final Widget widget;

    public WidgetAdapter() {
        this.widget = new Widget();
    }

    public String adapt() {
        return "adapted: " + widget.render();
    }
}
