package expo.modules.beaconai

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BeaconAIModule : Module() {
  private var voice: VoiceEngine? = null

  private fun engine(): VoiceEngine? {
    val ctx = appContext.reactContext ?: return null
    if (voice == null) voice = VoiceEngine(ctx) { name, body -> sendEvent(name, body) }
    return voice
  }

  override fun definition() = ModuleDefinition {
    Name("BeaconAI")
    Events("onVoiceResult", "onVoiceState")

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

    OnDestroy { voice?.stop() }
  }
}
