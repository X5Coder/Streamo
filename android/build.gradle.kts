// Streamo - Android (Kotlin + Jetpack Compose). Carbon copy of streamo_win.
// AGP 9.5.1 + Gradle 9.9.1 + Kotlin 2.4.21 (built-in Kotlin, upgraded via buildscript classpath).
plugins {
    id("com.android.application") version "9.5.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.4.21" apply false
}

buildscript {
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}
