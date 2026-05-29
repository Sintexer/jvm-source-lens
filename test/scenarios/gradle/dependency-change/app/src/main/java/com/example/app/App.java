package com.example.app;

import com.example.calc.Calculator;

public class App {
    public static void main(String[] args) {
        Calculator calc = new Calculator();
        System.out.println(calc.add(1, 2));
    }
}
