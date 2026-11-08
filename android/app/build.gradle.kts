import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The Play upload key, kept out of git: android/keystore.properties (storeFile, storePassword, keyAlias, keyPassword).
val keystoreProps = rootProject.file("keystore.properties").takeIf { it.exists() }?.let { f ->
    Properties().apply { f.inputStream().use { load(it) } }
}

android {
    namespace = "com.adddots.optionbuilder"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.optionbuilder"
        minSdk = 26
        targetSdk = 36
        // CI passes -PversionCode / -PversionName (see .github/workflows/android.yml); local builds use these defaults.
        versionCode = (findProperty("versionCode") as String?)?.toInt() ?: 4
        versionName = (findProperty("versionName") as String?) ?: "0.2.0"
    }

    signingConfigs {
        if (keystoreProps != null) {
            create("upload") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("upload")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        // Robolectric's hardware renderer, so screen captures include Compose's render layers.
        unitTests.all {
            it.systemProperty("robolectric.screenshot.hwrdr.native", "true")
            it.systemProperty("roborazzi.test.record", "true")
        }
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    // Renders screens on the JVM (Robolectric native graphics) to check layouts without a device.
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.30.1")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.30.1")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
