import java.util.Properties

plugins {
    id("com.android.application")
}

// The Play upload key, kept out of git: android/keystore.properties (storeFile, storePassword, keyAlias, keyPassword).
val keystoreProps = rootProject.file("keystore.properties").takeIf { it.exists() }?.let { f ->
    Properties().apply { f.inputStream().use { load(it) } }
}

/*
 * AddStock for Android is a Trusted Web Activity: it opens the web app,
 * https://optionbuilder.adddots.com/, full screen in Chrome (or another browser
 * that supports it), so the phone app always has whatever the website has.
 * The site proves this app may show it without a URL bar through
 * frontend/public/.well-known/assetlinks.json.
 */
val siteHost = "optionbuilder.adddots.com"

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

        manifestPlaceholders["siteHost"] = siteHost
        manifestPlaceholders["siteUrl"] = "https://$siteHost/"
        resValue(
            "string", "asset_statements",
            // Quotes escaped: Android drops bare " from string resources, which would break the JSON.
            """[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"web","site":"https://$siteHost"}}]""".replace("\"", "\\\"")
        )
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
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
