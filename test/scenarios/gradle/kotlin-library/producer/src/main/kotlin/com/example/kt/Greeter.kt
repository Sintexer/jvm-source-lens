package com.example.kt

/** Builds greetings. */
class Greeter {
    /** Says hello to [name]. */
    fun greet(name: String): String = "Hello, $name"

    fun farewell(name: String): String = "Bye, $name"

    /** The tone of the greeting. */
    var tone: String = "friendly"
}
