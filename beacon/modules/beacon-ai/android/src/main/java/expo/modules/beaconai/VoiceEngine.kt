package expo.modules.beaconai

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Offline-first speech recognition on top of Android's SpeechRecognizer.
 *
 * On Android 13+ it asks for the on-device recognizer, which never touches the network. On older versions it sets
 * EXTRA_PREFER_OFFLINE, which uses the downloaded language pack when one exists (Settings > Google > Voice).
 * Hindi and English both work offline once their packs are installed.
 *
 * In `continuous` mode it restarts after every utterance or timeout, which is how "Hey Beacon" is heard.
 */
class VoiceEngine(private val ctx: Context, private val emit: (String, Map<String, Any?>) -> Unit) {
  private val main = Handler(Looper.getMainLooper())
  private var rec: SpeechRecognizer? = null
  private var language = "en-IN"
  private var continuous = false
  private var active = false
  private var failures = 0

  fun available(): Boolean = SpeechRecognizer.isRecognitionAvailable(ctx)

  fun onDevice(): Boolean = Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)

  fun start(lang: String, continuous: Boolean) {
    main.post {
      stopNow()
      language = lang
      this.continuous = continuous
      active = true
      failures = 0
      create()
      listen()
    }
  }

  fun stop() = main.post { stopNow() }

  private fun stopNow() {
    active = false
    runCatching { rec?.cancel() }
    runCatching { rec?.destroy() }
    rec = null
    emit("onVoiceState", mapOf("state" to "stopped"))
  }

  private fun create() {
    rec = if (Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)) {
      SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx)
    } else {
      SpeechRecognizer.createSpeechRecognizer(ctx)
    }
    rec?.setRecognitionListener(listener)
  }

  private fun listen() {
    if (!active) return
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
    }
    runCatching { rec?.startListening(intent) }.onFailure { emit("onVoiceState", mapOf("state" to "error", "message" to (it.message ?: "start failed"))) }
  }

  private fun again(delay: Long) {
    if (!active || !continuous) {
      if (active) stopNow()
      return
    }
    main.postDelayed({ if (active) listen() }, delay)
  }

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) { emit("onVoiceState", mapOf("state" to "listening")) }
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onEvent(eventType: Int, params: Bundle?) {}

    override fun onPartialResults(partialResults: Bundle?) {
      val t = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
      emit("onVoiceResult", mapOf("text" to t, "final" to false))
    }

    override fun onResults(results: Bundle?) {
      failures = 0
      val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: emptyList<String>()
      if (list.isNotEmpty()) emit("onVoiceResult", mapOf("text" to list[0], "final" to true, "alternatives" to list))
      again(250)
    }

    override fun onError(error: Int) {
      when (error) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> { again(200) } // silence is normal while waiting for the wake phrase
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> { failures++; again(800) }
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
          emit("onVoiceState", mapOf("state" to "error", "message" to "microphone permission needed"))
          stopNow()
        }
        else -> {
          failures++
          emit("onVoiceState", mapOf("state" to "error", "message" to "recognizer error $error"))
          if (failures >= 5) stopNow() else again(1000L * failures)
        }
      }
    }
  }
}
