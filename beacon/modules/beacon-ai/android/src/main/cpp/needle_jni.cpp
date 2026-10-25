#include <jni.h>
#include <android/log.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <mutex>
#include <string>
#include <vector>

#include "needle.h"

#define TAG "BeaconNeedle"

#ifdef NEEDLE_STUB
// Non-arm64 builds (emulators): the engine is unavailable and every call reports it.
extern "C" {
int needle_load(const unsigned char*, unsigned long long) { return -1; }
const char* needle_last_error(void) { return "Needle engine is only available on arm64 devices"; }
int needle_init(const char*, const char*, const char*) { return -1; }
int needle_complete(const char*, const float*, int, int, char*, int) { return -1; }
void needle_reset(void) {}
}
#endif

// The engine keeps one process-global, non-thread-safe model: serialise every call.
static std::mutex g_mutex;
static bool g_loaded = false;

static std::string jstr(JNIEnv* env, jstring s) {
  if (!s) return std::string();
  const char* c = env->GetStringUTFChars(s, nullptr);
  std::string out(c ? c : "");
  if (c) env->ReleaseStringUTFChars(s, c);
  return out;
}

extern "C" {

// Memory-maps the .cact file read-only (the engine reads it in place) and loads it. Returns >= 0 on success.
JNIEXPORT jint JNICALL
Java_expo_modules_beaconai_NeedleBridge_nativeLoad(JNIEnv* env, jclass, jstring path) {
  std::lock_guard<std::mutex> lock(g_mutex);
  if (g_loaded) return 0;
  std::string p = jstr(env, path);
  int fd = open(p.c_str(), O_RDONLY);
  if (fd < 0) return -100;
  struct stat st;
  if (fstat(fd, &st) != 0 || st.st_size <= 0) {
    close(fd);
    return -101;
  }
  void* mem = mmap(nullptr, (size_t)st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
  close(fd);  // the mapping stays valid
  if (mem == MAP_FAILED) return -102;
  int rc = needle_load(static_cast<const unsigned char*>(mem), (unsigned long long)st.st_size);
  if (rc < 0) {
    munmap(mem, (size_t)st.st_size);
    return rc;
  }
  g_loaded = true;  // the mapping is intentionally kept for the life of the process
  return rc;
}

JNIEXPORT jint JNICALL
Java_expo_modules_beaconai_NeedleBridge_nativeInit(JNIEnv* env, jclass, jstring system, jstring tools) {
  std::lock_guard<std::mutex> lock(g_mutex);
  std::string s = jstr(env, system);
  std::string t = jstr(env, tools);
  return needle_init(s.c_str(), t.c_str(), nullptr);
}

JNIEXPORT jstring JNICALL
Java_expo_modules_beaconai_NeedleBridge_nativeComplete(JNIEnv* env, jclass, jstring input, jint maxNew) {
  std::lock_guard<std::mutex> lock(g_mutex);
  std::string in = jstr(env, input);
  std::vector<char> out(64 * 1024, 0);
  needle_reset();  // every request is independent
  int rc = needle_complete(in.c_str(), nullptr, 0, maxNew, out.data(), (int)out.size());
  if (rc < 0) {
    std::string err = std::string("{\"success\":false,\"error\":\"") + (needle_last_error() ? needle_last_error() : "unknown") + "\"}";
    for (auto& ch : err) if (ch == '\n' || ch == '\r') ch = ' ';
    return env->NewStringUTF(err.c_str());
  }
  return env->NewStringUTF(out.data());
}

JNIEXPORT jstring JNICALL
Java_expo_modules_beaconai_NeedleBridge_nativeLastError(JNIEnv* env, jclass) {
  const char* e = needle_last_error();
  return env->NewStringUTF(e ? e : "");
}

}  // extern "C"
