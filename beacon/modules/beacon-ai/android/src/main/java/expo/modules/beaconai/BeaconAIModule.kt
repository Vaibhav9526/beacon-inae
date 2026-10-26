package expo.modules.beaconai

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BeaconAIModule : Module() {
  private var voice: VoiceEngine? = null

  private fun engine(): VoiceEngine? {
    val ctx = appContext.reactContext ?: return null
    if (voice == null) voice = VoiceEngine(ctx) { name, body -> sendEvent(name, body) }
    return voice
  }

  private var vosk: VoskEngine? = null

  private fun voskEngine(): VoskEngine? {
    val ctx = appContext.reactContext ?: return null
    if (vosk == null) vosk = VoskEngine(ctx) { name, body -> sendEvent(name, body) }
    return vosk
  }

  override fun definition() = ModuleDefinition {
    Name("BeaconAI")
    Events("onVoiceResult", "onVoiceState", "voskPartial", "voskFinal", "voskError", "voskDownloadProgress")

    // ---- Needle: on-device tool selection ----

    /** Loads Needle and registers the tool catalogue. Returns { ok, error }. */
    AsyncFunction("needleStart") { system: String, toolsJson: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction mapOf("ok" to false, "error" to "no context")
      val ok = NeedleBridge.start(ctx, system, toolsJson)
      mapOf("ok" to ok, "error" to NeedleBridge.lastError)
    }

    /** Raw Needle JSON for one request (function_calls, confidence, ...). */
    AsyncFunction("needleComplete") { text: String ->
      NeedleBridge.complete(text)
    }

    Function("needleReady") { NeedleBridge.ready }

    // ---- Voice: offline-first speech recognition ----

    Function("voiceStatus") {
      val e = engine()
      mapOf("available" to (e?.available() ?: false), "onDevice" to (e?.onDevice() ?: false))
    }

    AsyncFunction("voiceStart") { language: String, continuous: Boolean ->
      engine()?.start(language, continuous)
    }

    AsyncFunction("voiceStop") {
      engine()?.stop()
    }

    // ---- Vosk: our own offline recogniser (no Google services) ----

    Function("voskStatus") { lang: String ->
      voskEngine()?.status(lang) ?: mapOf("installed" to false, "sizeMb" to 0, "downloading" to false)
    }

    AsyncFunction("voskDownload") { lang: String, promise: Promise ->
      val e = voskEngine()
      if (e == null) promise.resolve(mapOf("ok" to false, "error" to "no context")) else e.download(lang, promise)
    }

    Function("voskCancelDownload") { voskEngine()?.abortDownload(); Unit }

    AsyncFunction("voskRemove") { lang: String, promise: Promise ->
      val e = voskEngine()
      if (e == null) promise.resolve(mapOf("ok" to false, "error" to "no context")) else e.remove(lang, promise)
    }

    AsyncFunction("voskStart") { lang: String, grammar: List<String>?, promise: Promise ->
      val e = voskEngine()
      if (e == null) promise.resolve(mapOf("ok" to false, "error" to "no context")) else e.start(lang, grammar, promise)
    }

    AsyncFunction("voskStop") { promise: Promise ->
      val e = voskEngine()
      if (e == null) promise.resolve(mapOf("text" to "")) else e.stop(promise)
    }

    Function("voskCancel") { voskEngine()?.cancel(); Unit }

    OnDestroy {
      voice?.stop()
      vosk?.destroy()
    }
  }
}
