package com.example.app;

import com.example.kt.Greeter;
import com.example.kt.GreetKt;

public class App {
    public static void main(String[] args) {
        System.out.println(new Greeter().greet("World"));
        System.out.println(GreetKt.shout("hi"));
    }
}
