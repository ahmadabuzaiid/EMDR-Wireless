# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# react-native-config reads .env values (e.g. OTP_SECRET) off BuildConfig via reflection
# at runtime (RNCConfigModuleImpl.getConfig()) - R8 can't see that reference statically,
# so without this it strips/renames BuildConfig's fields and Config.OTP_SECRET silently
# comes back undefined in JS. Keep this one class unobfuscated; everything else still
# gets minified normally.
-keep class com.emdrwirelessapp.BuildConfig { *; }
