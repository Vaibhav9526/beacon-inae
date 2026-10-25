cmake_minimum_required(VERSION 3.18.1)
project(beaconai)

add_library(beaconai SHARED needle_jni.cpp)
target_include_directories(beaconai PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

# Android 15+ devices may use 16 KB pages
target_link_options(beaconai PRIVATE -Wl,-z,max-page-size=16384)

if(ANDROID_ABI STREQUAL "arm64-v8a")
  add_library(needle STATIC IMPORTED)
  set_target_properties(needle PROPERTIES
    IMPORTED_LOCATION ${CMAKE_CURRENT_SOURCE_DIR}/lib/arm64-v8a/libneedle.a)
  target_link_libraries(beaconai needle log android)
else()
  target_compile_definitions(beaconai PRIVATE NEEDLE_STUB=1)
  target_link_libraries(beaconai log android)
endif()
