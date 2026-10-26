# Vosk talks to libvosk.so through JNA, which looks classes and fields up by reflection. R8 must not rename or strip them.
-keep class org.vosk.** { *; }
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-dontwarn java.awt.**
-dontwarn com.sun.jna.**
