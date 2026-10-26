package expo.modules.beaconai

import android.content.Context
import expo.modules.kotlin.Promise
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipInputStream

/**
 * Offline speech recognition with Vosk (Apache-2.0). It does not use Google services at all.
 *
 * Models are downloaded once over HTTPS from alphacephei.com into app-private storage (filesDir/vosk/<name>), checked
 * against the published byte size, unzipped into a temp folder and renamed into place, so a half-finished download is
 * never mistaken for a model. Recognition runs on Vosk's own audio thread; everything else on one worker thread.
 * Nothing here throws into the app: every failure becomes a `voskError` event and an `ok: false` result.
 */
class VoskEngine(private val ctx: Context, private val emit: (String, Map<String, Any?>) -> Unit) {
  data class Spec(val dir: String, val url: String, val bytes: Long, val mb: Int)

  companion object {
    private const val SAMPLE_RATE = 16000f
    val SPECS: Map<String, Spec> = mapOf(
      "en" to Spec("vosk-model-small-en-in-0.4", "https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip", 37573330L, 36),
      "hi" to Spec("vosk-model-small-hi-0.22", "https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip", 44458845L, 42),
    )
  }

  private val root get() = File(ctx.filesDir, "vosk")
  private val exec = Executors.newSingleThreadExecutor()
  private val lock = Any()

  // downloads
  private val downloading = AtomicBoolean(false)
  @Volatile private var cancelDownload = false

  // recognition (touched on `exec`; `committed`/`finalText` also from the main-thread callbacks, under `lock`)
  private var model: Model? = null
  private var modelName: String? = null
  private var recognizer: Recognizer? = null
  private var service: SpeechService? = null
  @Volatile private var latch: CountDownLatch? = null
  private val committed = StringBuilder()
  private var finalText: String? = null
  private var lastPartial = ""

  private fun spec(lang: String): Spec = if (lang.lowercase().startsWith("hi")) SPECS.getValue("hi") else SPECS.getValue("en")
  private fun key(lang: String) = if (lang.lowercase().startsWith("hi")) "hi" else "en"

  private fun installed(s: Spec): Boolean {
    val d = File(root, s.dir)
    return File(d, ".ok").exists() && File(d, "am").isDirectory
  }

  private fun fail(code: String, message: String) {
    runCatching { emit("voskError", mapOf("code" to code, "message" to message)) }
  }

  fun status(lang: String): Map<String, Any?> {
    val s = spec(lang)
    return mapOf("installed" to installed(s), "sizeMb" to s.mb, "downloading" to downloading.get())
  }

  // ---- download ----

  fun download(lang: String, promise: Promise) {
    val s = spec(lang)
    val k = key(lang)
    if (installed(s)) {
      promise.resolve(mapOf("ok" to true, "error" to null))
      return
    }
    if (!downloading.compareAndSet(false, true)) {
      promise.resolve(mapOf("ok" to false, "error" to "a download is already running"))
      return
    }
    cancelDownload = false
    Thread({
      val zip = File(root, s.dir + ".zip.part")
      val tmp = File(root, s.dir + ".tmp")
      var error: String? = null
      try {
        root.mkdirs()
        zip.delete()
        tmp.deleteRecursively()
        fetch(s, k, zip)
        unzip(s, zip, tmp)
        File(tmp, ".ok").writeText("1")
        val target = File(root, s.dir)
        target.deleteRecursively()
        if (!tmp.renameTo(target)) throw IOException("could not move the model into place")
        emit("voskDownloadProgress", mapOf("lang" to k, "pct" to 100))
      } catch (t: Throwable) {
        error = if (cancelDownload) "cancelled" else (t.message ?: t.javaClass.simpleName)
        if (!cancelDownload) fail("download", error)
      } finally {
        runCatching { zip.delete() }
        runCatching { tmp.deleteRecursively() }
        downloading.set(false)
      }
      runCatching { promise.resolve(mapOf("ok" to (error == null), "error" to error)) }
    }, "vosk-download").start()
  }

  fun abortDownload() {
    cancelDownload = true
  }

  private fun fetch(s: Spec, k: String, dest: File) {
    val conn = URL(s.url).openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = 15000
      conn.readTimeout = 30000
      conn.setRequestProperty("User-Agent", "Beacon")
      if (conn.responseCode != 200) throw IOException("download failed (HTTP ${conn.responseCode})")
      val total = if (conn.contentLengthLong > 0) conn.contentLengthLong else s.bytes
      var got = 0L
      var lastPct = -1
      conn.inputStream.use { input ->
        FileOutputStream(dest).use { out ->
          val buf = ByteArray(64 * 1024)
          while (true) {
            if (cancelDownload) throw IOException("cancelled")
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            got += n
            // the unzip step is the last few percent
            val pct = (got * 99 / total).toInt().coerceIn(0, 99)
            if (pct != lastPct) {
              lastPct = pct
              emit("voskDownloadProgress", mapOf("lang" to k, "pct" to pct))
            }
          }
        }
      }
      if (got != s.bytes) throw IOException("download is incomplete or changed ($got of ${s.bytes} bytes)")
    } finally {
      conn.disconnect()
    }
  }

  /** Unzips into `into`, dropping the single top-level folder the archive carries, and refusing paths that escape. */
  private fun unzip(s: Spec, zip: File, into: File) {
    into.mkdirs()
    val base = into.canonicalPath + File.separator
    ZipInputStream(zip.inputStream().buffered()).use { zin ->
      while (true) {
        if (cancelDownload) throw IOException("cancelled")
        val e = zin.nextEntry ?: break
        var name = e.name.replace('\\', '/')
        if (name.startsWith(s.dir + "/")) name = name.substring(s.dir.length + 1)
        if (name.isEmpty()) continue
        val f = File(into, name)
        if (!f.canonicalPath.startsWith(base)) throw IOException("unsafe path in archive")
        if (e.isDirectory) {
          f.mkdirs()
        } else {
          f.parentFile?.mkdirs()
          FileOutputStream(f).use { out -> zin.copyTo(out) }
        }
      }
    }
    if (!File(into, "am").isDirectory) throw IOException("the model archive looks wrong")
  }

  fun remove(lang: String, promise: Promise) {
    exec.execute {
      try {
        val s = spec(lang)
        if (modelName == s.dir) closeModel()
        File(root, s.dir).deleteRecursively()
        promise.resolve(mapOf("ok" to true))
      } catch (t: Throwable) {
        promise.resolve(mapOf("ok" to false, "error" to (t.message ?: "remove failed")))
      }
    }
  }

  // ---- recognition ----

  private fun closeModel() {
    runCatching { model?.close() }
    model = null
    modelName = null
  }

  private fun loadModel(s: Spec): Model {
    if (modelName == s.dir) model?.let { return it }
    closeModel()
    runCatching { LibVosk.setLogLevel(LogLevel.WARNINGS) }
    val m = Model(File(root, s.dir).absolutePath)
    model = m
    modelName = s.dir
    return m
  }

  /** Frees the recogniser and the microphone. Safe to call twice. Runs on `exec`. */
  private fun release() {
    runCatching { service?.shutdown() }
    runCatching { recognizer?.close() }
    service = null
    recognizer = null
  }

  private fun textOf(json: String?, field: String): String =
    try {
      if (json.isNullOrEmpty()) "" else JSONObject(json).optString(field, "").trim()
    } catch (_: Throwable) {
      ""
    }

  private fun joined(extra: String): String =
    synchronized(lock) { (committed.toString() + " " + extra).trim() }

  private val listener = object : RecognitionListener {
    override fun onPartialResult(hypothesis: String?) {
      val t = joined(textOf(hypothesis, "partial"))
      if (t.isNotEmpty() && t != lastPartial) {
        lastPartial = t
        runCatching { emit("voskPartial", mapOf("text" to t)) }
      }
    }

    override fun onResult(hypothesis: String?) {
      val t = textOf(hypothesis, "text")
      if (t.isEmpty()) return
      synchronized(lock) {
        if (committed.isNotEmpty()) committed.append(' ')
        committed.append(t)
      }
      val all = joined("")
      lastPartial = all
      runCatching { emit("voskPartial", mapOf("text" to all)) }
    }

    override fun onFinalResult(hypothesis: String?) {
      val t = joined(textOf(hypothesis, "text"))
      synchronized(lock) { finalText = t }
      latch?.countDown()
    }

    override fun onError(exception: Exception?) {
      fail("recognizer", exception?.message ?: "recognition error")
      latch?.countDown()
    }

    override fun onTimeout() {
      latch?.countDown()
    }
  }

  /** Starts listening. Resolves { ok, error } once the microphone is open (or it failed). */
  fun start(lang: String, grammar: List<String>?, promise: Promise) {
    exec.execute {
      try {
        release()
        val s = spec(lang)
        if (!installed(s)) {
          promise.resolve(mapOf("ok" to false, "error" to "model not installed"))
          return@execute
        }
        val m = loadModel(s)
        val rec = if (grammar != null && grammar.isNotEmpty()) Recognizer(m, SAMPLE_RATE, JSONArray(grammar).toString()) else Recognizer(m, SAMPLE_RATE)
        recognizer = rec
        val svc = SpeechService(rec, SAMPLE_RATE)
        service = svc
        synchronized(lock) {
          committed.setLength(0)
          finalText = null
        }
        lastPartial = ""
        latch = CountDownLatch(1)
        if (!svc.startListening(listener)) throw IllegalStateException("could not start listening")
        promise.resolve(mapOf("ok" to true, "error" to null))
      } catch (t: Throwable) {
        release()
        val msg = t.message ?: t.javaClass.simpleName
        fail("start", msg)
        runCatching { promise.resolve(mapOf("ok" to false, "error" to msg)) }
      }
    }
  }

  /** Really stops: the recogniser flushes what it has heard, and that text is the result (no waiting for silence). */
  fun stop(promise: Promise) {
    exec.execute {
      var text = ""
      try {
        val svc = service
        if (svc != null) {
          svc.stop()
          latch?.await(1500, TimeUnit.MILLISECONDS)
          text = synchronized(lock) { finalText ?: committed.toString().trim() }
        }
      } catch (t: Throwable) {
        fail("stop", t.message ?: t.javaClass.simpleName)
        text = synchronized(lock) { committed.toString().trim() }
      } finally {
        release()
      }
      runCatching { emit("voskFinal", mapOf("text" to text)) }
      runCatching { promise.resolve(mapOf("text" to text)) }
    }
  }

  /** Stops and throws away what was heard. */
  fun cancel() {
    exec.execute {
      runCatching { service?.cancel() }
      release()
    }
  }

  fun destroy() {
    cancelDownload = true
    exec.execute {
      release()
      closeModel()
    }
    exec.shutdown()
  }
}
