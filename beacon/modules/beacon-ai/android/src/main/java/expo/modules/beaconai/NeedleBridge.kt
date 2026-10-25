package expo.modules.beaconai

import android.content.Context
import java.io.File

/** JNI bridge to Cactus Needle's native engine (libneedle.a, arm64 only). */
object NeedleBridge {
  private const val ASSET = "needle3.cact"
  private var libraryLoaded = false
  @Volatile var ready = false
  @Volatile var lastError: String? = null

  @JvmStatic private external fun nativeLoad(path: String): Int
  @JvmStatic private external fun nativeInit(system: String, toolsJson: String): Int
  @JvmStatic private external fun nativeComplete(input: String, maxNew: Int): String
  @JvmStatic private external fun nativeLastError(): String

  private fun ensureLibrary() {
    if (libraryLoaded) return
    System.loadLibrary("c++_shared")
    System.loadLibrary("beaconai")
    libraryLoaded = true
  }

  /** The engine memory-maps its weights, so the asset is copied to app storage once. */
  private fun weightsFile(ctx: Context): File {
    val out = File(ctx.filesDir, ASSET)
    val size = ctx.assets.openFd(ASSET).use { it.length }
    if (!out.exists() || out.length() != size) {
      val tmp = File(ctx.filesDir, "$ASSET.tmp")
      ctx.assets.open(ASSET).use { input -> tmp.outputStream().use { input.copyTo(it) } }
      tmp.renameTo(out)
    }
    return out
  }

  @Synchronized
  fun start(ctx: Context, system: String, toolsJson: String): Boolean {
    if (ready) return true
    return try {
      ensureLibrary()
      val rc = nativeLoad(weightsFile(ctx).absolutePath)
      if (rc < 0) {
        lastError = "load failed ($rc): ${nativeLastError()}"
        return false
      }
      val init = nativeInit(system, toolsJson)
      if (init < 0) {
        lastError = "init failed ($init): ${nativeLastError()}"
        return false
      }
      ready = true
      lastError = null
      true
    } catch (e: Throwable) {
      lastError = e.message ?: e.javaClass.simpleName
      false
    }
  }

  fun complete(text: String, maxNew: Int = 256): String {
    check(ready) { "Needle is not started" }
    return nativeComplete(text, maxNew)
  }
}
