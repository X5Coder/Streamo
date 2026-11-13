import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val keystoreProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) load(f.inputStream())
}

android {
    namespace = "com.streamo.link.android"
    compileSdk = 37

    signingConfigs {
        create("release") {
            storeFile = rootProject.file(keystoreProps.getProperty("RELEASE_STORE_FILE", "streamo-release.p12"))
            storeType = "PKCS12"
            storePassword = keystoreProps.getProperty("RELEASE_STORE_PASSWORD", "")
            keyAlias = keystoreProps.getProperty("RELEASE_KEY_ALIAS", "streamo")
            keyPassword = keystoreProps.getProperty("RELEASE_KEY_PASSWORD", "")
        }
    }

    defaultConfig {
        applicationId = "com.streamo.link.android"
        minSdk = 26
        targetSdk = 37
        versionCode = 14
        versionName = "2.0.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            // debug builds stay unminified for the fast dev loop
        }
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.core:core-splashscreen:1.2.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-process:2.11.0")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.13.0")

    // Media3 (ExoPlayer) — HLS/DASH/MP4 playback with custom request headers,
    // used by the internal player instead of the Windows shaka+loopback-proxy combo.
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.11.1")
    implementation("androidx.media3:media3-common:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")

    testImplementation("junit:junit:4.13.2")
}
