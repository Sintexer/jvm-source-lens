package com.example.app;

import com.example.widget.Widget;
import com.example.adapter.WidgetAdapter;

public class App {
    public static void main(String[] args) {
        Widget w = new Widget();
        System.out.println(w.render());
        System.out.println(w.animate());
        System.out.println(new WidgetAdapter().adapt());
    }
}
