package expo.modules.beaconmesh

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.util.UUID

/**
 * Radio-only BLE transport for the Beacon mesh.
 *
 * Every phone is both a GATT server (peripheral, advertises the service) and a GATT client
 * (central, scans and connects). A "link" is one remote phone, keyed by its BLE address, and may be
 * reachable through either role. The module moves opaque, length-framed byte packets; all mesh
 * logic (relay, TTL, dedup, crypto) lives in TypeScript.
 *
 * Wire framing on each link: [len:u16 big-endian][payload], split into MTU-sized GATT chunks.
 *
 * Only ONE phone of a pair initiates the connection. Each phone advertises a random 4-byte token in the
 * scan response; the phone with the lower token connects, the other waits (and only connects itself if
 * the peer has stayed silent for FALLBACK_INITIATE_MS). The pure rules below are mirrored, and unit
 * tested, in src/mesh/radioPolicy.ts: keep both in sync.
 */
@SuppressLint("MissingPermission")
class BeaconMeshModule : Module() {
  companion object {
    val SERVICE_UUID: UUID = UUID.fromString("6e1f2c40-5b7a-4d3e-9a18-2c0bea0c0001")
    val CHAR_UUID: UUID = UUID.fromString("6e1f2c40-5b7a-4d3e-9a18-2c0bea0c0002")
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    const val COMPANY_ID = 0xFFFF // reserved "testing" id; the 4 data bytes are our tie-break token
    const val MAX_LINKS = 6
    const val CONNECT_TIMEOUT_MS = 15_000L
    const val FALLBACK_INITIATE_MS = 25_000L
    const val MAX_FRAME = 65_535
    const val MAX_QUEUED_CHUNKS = 400
    const val RX_IDLE_RESET_MS = 8_000L
    const val SCAN_MIN_GAP_MS = 7_000L // Android allows 5 scan starts per 30 s: stay well below
    const val SCAN_WINDOW_MS = 30_000L
    const val SCAN_MAX_STARTS = 4
    const val FAST_SCAN_MS = 45_000L
    const val WRITE_RETRIES = 8
    const val RSSI_EVERY_MS = 10_000L

    fun reconnectDelayMs(failures: Int): Long = minOf(2_000L shl minOf(failures, 5), 60_000L)

    fun shouldInitiate(myToken: Long, peerToken: Long?, firstSeenMs: Long, nowMs: Long, hasServerLinks: Boolean): Boolean {
      if (peerToken == null) return true
      if (myToken < peerToken) return true
      return nowMs - firstSeenMs >= FALLBACK_INITIATE_MS && !hasServerLinks
    }

    /** null: do not retry */
    fun scanRetryMs(code: Int): Long? = when (code) {
      1 -> null // already started: it is running
      4 -> null // feature unsupported
      3 -> 10_000L
      5 -> 15_000L
      2, 6 -> 35_000L // registration failed / too frequent: wait out the 30 s throttle window
      else -> 15_000L
    }

    fun advRetryMs(code: Int): Long? = when (code) {
      2, 4 -> 10_000L // too many advertisers / internal error
      else -> null // 1 data too large, 3 already started, 5 unsupported
    }
  }

  private val main = Handler(Looper.getMainLooper())
  private val ctx: Context get() = appContext.reactContext ?: throw IllegalStateException("no context")

  private var manager: BluetoothManager? = null
  private var adapter: BluetoothAdapter? = null
  private var server: BluetoothGattServer? = null
  private var serverReady = false
  private var wanted = false // JS asked for the radio (stays true while Bluetooth is switched off)
  private var running = false // the radio parts are up
  private var scanning = false
  private var advertising = false
  private var receiverRegistered = false
  private var myToken = 0L
  private var lastError: String? = null
  private var scanMode = ScanSettings.SCAN_MODE_LOW_LATENCY
  private var scanRetries = 0
  private var advRetries = 0
  private val scanStarts = ArrayDeque<Long>()

  private var txFrames = 0L
  private var txBytes = 0L
  private var rxFrames = 0L
  private var rxBytes = 0L

  private val links = HashMap<String, Link>()
  private val pending = HashMap<String, BluetoothGatt>()
  private val timeouts = HashMap<String, Runnable>()
  private val seenPeers = HashMap<String, Seen>()

  private class Seen(val key: String) {
    var addr = ""
    var token: Long? = null
    var rssi = 0
    var firstSeen = 0L
    var lastSeen = 0L
    var failures = 0
    var nextAttemptAt = 0L
  }

  private inner class Link(val id: String) {
    var gatt: BluetoothGatt? = null
    var gattChar: BluetoothGattCharacteristic? = null
    var gattReady = false
    var discovering = false
    var serverDevice: BluetoothDevice? = null
    var serverSubscribed = false
    var seenKey: String? = null
    var mtu = 23
    var rssi: Int? = null
    val rx = ByteArrayOutputStream()
    var rxNeed = -1
    var lastRx = 0L
    val txQueue = ArrayDeque<ByteArray>()
    var busy = false
    var retries = 0
    var retryScheduled = false
    var announcedUp = false

    val ready get() = (gatt != null && gattReady) || (serverDevice != null && serverSubscribed)
    val chunk get() = (mtu - 3).coerceAtLeast(20)
  }

  override fun definition() = ModuleDefinition {
    Name("BeaconMesh")
    Events("onPacket", "onLink", "onState")

    AsyncFunction("isSupported") {
      val bm = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      val a = bm?.adapter
      return@AsyncFunction a != null && ctx.packageManager.hasSystemFeature("android.hardware.bluetooth_le")
    }

    AsyncFunction("start") {
      main.post {
        wanted = true
        guarded("start") { startRadio() }
      }
    }

    AsyncFunction("stop") {
      main.post {
        wanted = false
        guarded("stop") { stopRadio() }
      }
    }

    AsyncFunction("send") { linkId: String, base64: String ->
      val data = Base64.decode(base64, Base64.NO_WRAP)
      main.post { guarded("send") { enqueue(links[linkId], data) } }
    }

    AsyncFunction("broadcast") { base64: String, exceptLink: String? ->
      val data = Base64.decode(base64, Base64.NO_WRAP)
      main.post {
        guarded("broadcast") {
          for (l in links.values.toList()) if (l.id != exceptLink && l.ready) enqueue(l, data)
        }
      }
    }

    // everything the on-device self-test screen shows, read on the main thread so the maps are consistent
    AsyncFunction("getDiagnostics") { promise: Promise ->
      main.post {
        try {
          promise.resolve(diagnostics())
        } catch (e: Throwable) {
          promise.reject("E_DIAG", e.message, e)
        }
      }
    }

    OnDestroy {
      main.post {
        wanted = false
        guarded("destroy") { stopRadio() }
      }
    }
  }

  // ---------- lifecycle ----------

  private fun state(s: String) {
    try {
      sendEvent("onState", mapOf("state" to s))
    } catch (_: Throwable) {
      // module torn down
    }
  }

  private fun fail(code: String, e: Throwable? = null) {
    val msg = if (e?.message != null) "$code: ${e.message}" else code
    lastError = msg
    state("error:$msg")
  }

  /** Nothing thrown inside a main-thread callback may reach Looper: that would crash the whole app. */
  private inline fun guarded(what: String, block: () -> Unit) {
    try {
      block()
    } catch (e: Throwable) {
      fail(what, e)
    }
  }

  private fun granted(p: String) = ctx.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

  private fun missingPermissions(): List<String> {
    val need = if (Build.VERSION.SDK_INT >= 31) {
      listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      listOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    return need.filter { !granted(it) }.map { it.substringAfterLast('.') }
  }

  private val btReceiver = object : BroadcastReceiver() {
    override fun onReceive(c: Context?, intent: Intent?) {
      if (intent?.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
      when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
        BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> main.post {
          guarded("bt-off") {
            if (running) teardown()
            state("bluetooth-off")
          }
        }
        BluetoothAdapter.STATE_ON -> main.post {
          guarded("bt-on") {
            if (wanted && !running) {
              state("bluetooth-on")
              startRadio()
            }
          }
        }
      }
    }
  }

  private fun registerBtReceiver() {
    if (receiverRegistered) return
    val f = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
    if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(btReceiver, f, Context.RECEIVER_NOT_EXPORTED)
    else ctx.registerReceiver(btReceiver, f)
    receiverRegistered = true
  }

  private fun startRadio() {
    registerBtReceiver()
    if (running) return
    val missing = missingPermissions()
    if (missing.isNotEmpty()) {
      lastError = "permission-denied: ${missing.joinToString(",")}"
      state("permission-denied:${missing.joinToString(",")}")
      return
    }
    manager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    adapter = manager?.adapter
    val a = adapter
    if (a == null) {
      lastError = "no Bluetooth adapter"
      state("unsupported")
      return
    }
    if (!a.isEnabled) {
      state("bluetooth-off") // the receiver restarts us when the user switches it on
      return
    }
    myToken = java.util.Random().nextInt().toLong() and 0xFFFFFFFFL
    running = true
    scanRetries = 0
    advRetries = 0
    scanMode = ScanSettings.SCAN_MODE_LOW_LATENCY
    lastError = null
    MeshService.start(ctx)?.let { err ->
      // not fatal: the radio works while Beacon is open, it just may be killed in the background
      lastError = err
      state("error:$err")
    }
    openServer() // advertising starts from onServiceAdded
    startScanning()
    main.removeCallbacks(rssiTick)
    main.postDelayed(rssiTick, RSSI_EVERY_MS)
    state("running")
  }

  private fun stopRadio() {
    if (running) teardown()
    if (receiverRegistered) {
      runCatching { ctx.unregisterReceiver(btReceiver) }
      receiverRegistered = false
    }
    MeshService.stop(ctx)
    state("stopped")
  }

  /** Closes every radio resource and reports every link as down. Safe to call twice. */
  private fun teardown() {
    running = false
    main.removeCallbacks(rssiTick)
    main.removeCallbacks(slowScan)
    main.removeCallbacks(scanRetry)
    main.removeCallbacks(advRetry)
    stopScanning()
    runCatching { adapter?.bluetoothLeAdvertiser?.stopAdvertising(advCallback) }
    advertising = false
    for (r in timeouts.values) main.removeCallbacks(r)
    timeouts.clear()
    for (g in pending.values) runCatching { g.close() }
    pending.clear()
    for (l in links.values.toList()) {
      runCatching { l.gatt?.disconnect() }
      runCatching { l.gatt?.close() }
      if (l.announcedUp) sendEvent("onLink", mapOf("link" to l.id, "up" to false))
    }
    links.clear()
    runCatching { server?.close() }
    server = null
    serverReady = false
  }

  // ---------- peripheral (server) role ----------

  private fun openServer() {
    val srv = manager?.openGattServer(ctx, serverCallback)
    if (srv == null) {
      fail("gatt-server-unavailable")
      return
    }
    server = srv
    serverReady = false
    val ch = BluetoothGattCharacteristic(
      CHAR_UUID,
      BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
      BluetoothGattCharacteristic.PERMISSION_WRITE
    )
    ch.addDescriptor(
      BluetoothGattDescriptor(CCCD_UUID, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE)
    )
    val svc = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    svc.addCharacteristic(ch)
    if (!srv.addService(svc)) fail("add-service-rejected")
  }

  private fun tokenBytes() = byteArrayOf(
    (myToken shr 24).toByte(), (myToken shr 16).toByte(), (myToken shr 8).toByte(), myToken.toByte()
  )

  /**
   * Legacy (31 byte) advertising on purpose: every phone supports it and every scanner sees it.
   * Advert = flags (3) + 128-bit service UUID (18) = 21 bytes; the scan response carries the 4-byte token
   * as manufacturer data (8 bytes). Connectable, medium-latency, high power for range.
   */
  private fun startAdvertising() {
    val adv = adapter?.bluetoothLeAdvertiser
    if (adv == null) {
      lastError = "advertising not supported (adv-failed:5)"
      state("adv-failed:5")
      return
    }
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .setTimeout(0)
      .build()
    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .addServiceUuid(ParcelUuid(SERVICE_UUID))
      .build()
    val scanResponse = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .addManufacturerData(COMPANY_ID, tokenBytes())
      .build()
    adv.startAdvertising(settings, data, scanResponse, advCallback)
  }

  private val advRetry = Runnable {
    if (running && serverReady && !advertising) guarded("adv-retry") { startAdvertising() }
  }

  private val advCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
      main.post {
        advertising = true
        advRetries = 0
        state("adv-ok")
      }
    }

    override fun onStartFailure(errorCode: Int) {
      main.post {
        if (errorCode == ADVERTISE_FAILED_ALREADY_STARTED) {
          advertising = true
          return@post
        }
        advertising = false
        lastError = "advertising failed (adv-failed:$errorCode)"
        state("adv-failed:$errorCode")
        val wait = advRetryMs(errorCode)
        if (wait != null && advRetries < 3 && running) {
          advRetries++
          main.removeCallbacks(advRetry)
          main.postDelayed(advRetry, wait * advRetries)
        }
      }
    }
  }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onServiceAdded(status: Int, service: BluetoothGattService?) {
      main.post {
        guarded("service-added") {
          if (!running) return@guarded
          if (status == BluetoothGatt.GATT_SUCCESS) {
            serverReady = true
            startAdvertising()
          } else fail("add-service-failed:$status")
        }
      }
    }

    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      main.post {
        guarded("server-conn") {
          if (newState == BluetoothProfile.STATE_CONNECTED) {
            val existing = links[device.address]
            if (!running || (existing == null && links.size >= MAX_LINKS + 2)) {
              server?.cancelConnection(device)
              return@guarded
            }
            val l = existing ?: Link(device.address).also { links[device.address] = it }
            l.serverDevice = device
          } else {
            val l = links[device.address] ?: return@guarded
            l.serverDevice = null
            l.serverSubscribed = false
            resetTx(l)
            maybeDrop(l)
          }
        }
      }
    }

    override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
      main.post { links[device.address]?.let { if (mtu > it.mtu) it.mtu = mtu } }
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
      preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray
    ) {
      if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
      main.post {
        guarded("cccd-write") {
          if (!running || descriptor.uuid != CCCD_UUID) return@guarded
          val l = links.getOrPut(device.address) { Link(device.address) }
          l.serverDevice = device
          l.serverSubscribed = value.isNotEmpty() && value[0].toInt() != 0
          if (l.ready) announceUp(l) else {
            resetTx(l)
            maybeDrop(l)
          }
        }
      }
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray
    ) {
      if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
      main.post {
        guarded("server-write") {
          if (!running) return@guarded
          val l = links.getOrPut(device.address) { Link(device.address) }
          if (l.serverDevice == null) l.serverDevice = device
          receive(l, value)
        }
      }
    }

    override fun onNotificationSent(device: BluetoothDevice, status: Int) {
      main.post {
        guarded("notif-sent") {
          val l = links[device.address] ?: return@guarded
          l.busy = false
          if (status != BluetoothGatt.GATT_SUCCESS) dropLink(l, "notify-status-$status") else pump(l)
        }
      }
    }
  }

  // ---------- central (client) role ----------

  private val scanRetry = Runnable { if (running && !scanning) guarded("scan-retry") { startScanning() } }

  private val slowScan = Runnable {
    if (running && scanMode == ScanSettings.SCAN_MODE_LOW_LATENCY) {
      stopScanning()
      scanMode = ScanSettings.SCAN_MODE_BALANCED
      guarded("slow-scan") { startScanning() }
    }
  }

  private fun stopScanning() {
    runCatching { adapter?.bluetoothLeScanner?.stopScan(scanCallback) }
    scanning = false
  }

  private fun startScanning() {
    val scanner = adapter?.bluetoothLeScanner
    if (scanner == null) {
      lastError = "scanner unavailable (scan-failed:4)"
      state("scan-failed:4")
      return
    }
    // never restart scans in a tight loop: Android silently stops delivering results after 5 starts in 30 s
    val now = SystemClock.elapsedRealtime()
    while (scanStarts.isNotEmpty() && now - scanStarts.first() > SCAN_WINDOW_MS) scanStarts.removeFirst()
    val last = scanStarts.lastOrNull()
    if (scanStarts.size >= SCAN_MAX_STARTS || (last != null && now - last < SCAN_MIN_GAP_MS)) {
      main.removeCallbacks(scanRetry)
      main.postDelayed(scanRetry, SCAN_MIN_GAP_MS + 1_000L)
      return
    }
    scanStarts.addLast(now)
    val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
    val settings = ScanSettings.Builder().setScanMode(scanMode).build()
    scanner.startScan(listOf(filter), settings, scanCallback)
    scanning = true
    main.removeCallbacks(slowScan)
    if (scanMode == ScanSettings.SCAN_MODE_LOW_LATENCY) main.postDelayed(slowScan, FAST_SCAN_MS)
  }

  private fun tokenOf(result: ScanResult): Long? {
    val d = result.scanRecord?.getManufacturerSpecificData(COMPANY_ID) ?: return null
    if (d.size != 4) return null
    var v = 0L
    for (b in d) v = (v shl 8) or (b.toLong() and 0xff)
    return v
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val dev = result.device
      val token = tokenOf(result)
      val rssi = result.rssi
      main.post { guarded("scan-result") { onSeen(dev, token, rssi) } }
    }

    override fun onScanFailed(errorCode: Int) {
      main.post {
        if (errorCode == SCAN_FAILED_ALREADY_STARTED) {
          scanning = true
          return@post
        }
        scanning = false
        lastError = "scan failed (scan-failed:$errorCode)"
        state("scan-failed:$errorCode")
        val wait = scanRetryMs(errorCode)
        if (wait != null && running && scanRetries < 5) {
          scanRetries++
          main.removeCallbacks(scanRetry)
          main.postDelayed(scanRetry, wait)
        }
      }
    }
  }

  private fun onSeen(dev: BluetoothDevice, token: Long?, rssi: Int) {
    if (!running) return
    val addr = dev.address
    val now = SystemClock.elapsedRealtime()
    val key = if (token != null) "t" + java.lang.Long.toHexString(token) else addr
    val seen = seenPeers.getOrPut(key) { Seen(key).also { it.firstSeen = now } }
    seen.addr = addr
    seen.token = token
    seen.rssi = rssi
    seen.lastSeen = now
    if (seenPeers.size > 64) seenPeers.entries.removeAll { now - it.value.lastSeen > 120_000L }

    val existing = links[addr]
    if (existing != null && (existing.gatt != null || existing.serverDevice != null)) return
    if (pending.containsKey(addr)) return
    if (links.values.any { it.seenKey == key }) return
    if (links.size + pending.size >= MAX_LINKS) return
    if (now < seen.nextAttemptAt) return
    val hasServerLinks = links.values.any { it.serverDevice != null }
    if (!shouldInitiate(myToken, token, seen.firstSeen, now, hasServerLinks)) return
    connectTo(dev, seen, key)
  }

  private fun connectTo(dev: BluetoothDevice, seen: Seen, key: String) {
    val addr = dev.address
    seen.nextAttemptAt = SystemClock.elapsedRealtime() + reconnectDelayMs(seen.failures)
    val g = try {
      dev.connectGatt(ctx, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    } catch (e: Throwable) {
      seen.failures++
      fail("connect", e)
      null
    } ?: return
    pending[addr] = g
    val link = links.getOrPut(addr) { Link(addr) }
    link.seenKey = key
    val timeout = Runnable {
      if (pending[addr] === g) {
        seen.failures++
        lastError = "connect timeout to $addr"
        releaseGatt(addr, g)
      }
    }
    timeouts[addr] = timeout
    main.postDelayed(timeout, CONNECT_TIMEOUT_MS)
  }

  /** Always close a BluetoothGatt we are done with: leaked clients are what makes later connects fail with status 133. */
  private fun releaseGatt(addr: String, g: BluetoothGatt) {
    if (pending[addr] === g) pending.remove(addr)
    timeouts.remove(addr)?.let { main.removeCallbacks(it) }
    runCatching { g.disconnect() }
    runCatching { g.close() }
    val l = links[addr] ?: return
    if (l.gatt === g || l.gatt == null) {
      l.gatt = null
      l.gattChar = null
      l.gattReady = false
      l.discovering = false
      resetTx(l)
      maybeDrop(l)
    }
  }

  private fun linkFor(g: BluetoothGatt): Link? = links[g.device.address]?.takeIf { it.gatt === g }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      main.post {
        guarded("gatt-conn") {
          val addr = g.device.address
          if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
            if (!running || pending[addr] !== g) {
              runCatching { g.close() }
              return@guarded
            }
            val l = links.getOrPut(addr) { Link(addr) }
            l.gatt = g
            if (!g.requestMtu(517)) startDiscovery(g, l)
          } else {
            val l = links[addr]
            val wasReady = l?.gattReady == true
            val key = l?.seenKey
            val s = key?.let { seenPeers[it] }
            if (s != null) {
              if (wasReady) {
                s.failures = 0
                s.nextAttemptAt = SystemClock.elapsedRealtime() + reconnectDelayMs(0)
              } else if (pending[addr] === g) {
                s.failures++
                lastError = "gatt connect failed, status $status"
              }
            }
            releaseGatt(addr, g)
          }
        }
      }
    }

    override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
      main.post {
        guarded("gatt-mtu") {
          val l = linkFor(g) ?: return@guarded
          if (status == BluetoothGatt.GATT_SUCCESS) l.mtu = mtu
          startDiscovery(g, l)
        }
      }
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      main.post {
        guarded("gatt-services") {
          val l = linkFor(g) ?: return@guarded
          val ch = g.getService(SERVICE_UUID)?.getCharacteristic(CHAR_UUID)
          val cccd = ch?.getDescriptor(CCCD_UUID)
          if (status != BluetoothGatt.GATT_SUCCESS || ch == null || cccd == null) {
            lastError = "Beacon service not found on ${g.device.address} (status $status)"
            seenPeers[l.seenKey ?: ""]?.let { it.failures++ }
            releaseGatt(g.device.address, g)
            return@guarded
          }
          l.gattChar = ch
          g.setCharacteristicNotification(ch, true)
          val ok = if (Build.VERSION.SDK_INT >= 33) {
            g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothGatt.GATT_SUCCESS
          } else {
            @Suppress("DEPRECATION")
            run {
              cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
              g.writeDescriptor(cccd)
            }
          }
          if (!ok) {
            lastError = "could not subscribe to ${g.device.address}"
            releaseGatt(g.device.address, g)
          }
        }
      }
    }

    override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
      main.post {
        guarded("gatt-cccd") {
          val addr = g.device.address
          val l = linkFor(g) ?: return@guarded
          if (status == BluetoothGatt.GATT_SUCCESS) {
            pending.remove(addr)
            timeouts.remove(addr)?.let { main.removeCallbacks(it) }
            seenPeers[l.seenKey ?: ""]?.let { it.failures = 0 }
            l.gattReady = true
            announceUp(l)
          } else {
            lastError = "subscribe failed, status $status"
            releaseGatt(addr, g)
          }
        }
      }
    }

    // API 33+
    override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
      main.post { guarded("gatt-rx") { linkFor(g)?.let { receive(it, value) } } }
    }

    // < API 33
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= 33) return
      val v = c.value ?: return
      main.post { guarded("gatt-rx") { linkFor(g)?.let { receive(it, v) } } }
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
      main.post {
        guarded("gatt-write") {
          val l = linkFor(g) ?: return@guarded
          l.busy = false
          if (status != BluetoothGatt.GATT_SUCCESS) dropLink(l, "write-status-$status") else pump(l)
        }
      }
    }

    override fun onReadRemoteRssi(g: BluetoothGatt, rssi: Int, status: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS) main.post { linkFor(g)?.rssi = rssi }
    }
  }

  private fun startDiscovery(g: BluetoothGatt, l: Link) {
    if (l.discovering) return
    l.discovering = true
    if (!g.discoverServices()) {
      lastError = "service discovery refused"
      releaseGatt(g.device.address, g)
    }
  }

  private val rssiTick = object : Runnable {
    override fun run() {
      if (!running) return
      for (l in links.values) if (l.gattReady) runCatching { l.gatt?.readRemoteRssi() }
      main.postDelayed(this, RSSI_EVERY_MS)
    }
  }

  // ---------- link bookkeeping ----------

  private fun announceUp(l: Link) {
    if (l.announcedUp || !l.ready) return
    l.announcedUp = true
    sendEvent("onLink", mapOf("link" to l.id, "up" to true))
  }

  private fun maybeDrop(l: Link) {
    if (l.gatt != null || l.serverDevice != null) {
      // one role is gone, the other may still be usable
      if (!l.ready && l.announcedUp) {
        l.announcedUp = false
        sendEvent("onLink", mapOf("link" to l.id, "up" to false))
      }
      return
    }
    if (pending.containsKey(l.id)) return // a connect attempt is still in flight for this address
    links.remove(l.id)
    if (l.announcedUp) {
      l.announcedUp = false
      sendEvent("onLink", mapOf("link" to l.id, "up" to false))
    }
  }

  private fun resetTx(l: Link) {
    l.txQueue.clear()
    l.busy = false
    l.retries = 0
    l.rx.reset()
    l.rxNeed = -1
  }

  /** A failed write leaves the peer with half a frame: the only safe recovery is a fresh connection. */
  private fun dropLink(l: Link, reason: String) {
    lastError = "link ${l.id} dropped: $reason"
    resetTx(l)
    val g = l.gatt
    if (g != null) releaseGatt(l.id, g)
    val d = l.serverDevice
    if (d != null) runCatching { server?.cancelConnection(d) }
  }

  // ---------- framing, tx, rx ----------

  private fun receive(l: Link, chunk: ByteArray) {
    val now = SystemClock.elapsedRealtime()
    // a frame that stopped part-way (peer dropped mid-write) must not glue itself to the next one
    if ((l.rxNeed >= 0 || l.rx.size() > 0) && now - l.lastRx > RX_IDLE_RESET_MS) {
      l.rx.reset()
      l.rxNeed = -1
    }
    l.lastRx = now
    var i = 0
    while (i < chunk.size) {
      if (l.rxNeed < 0) {
        // collect the 2-byte length prefix (may itself be split across chunks)
        l.rx.write(chunk[i].toInt())
        i++
        if (l.rx.size() == 2) {
          val b = l.rx.toByteArray()
          l.rxNeed = ((b[0].toInt() and 0xff) shl 8) or (b[1].toInt() and 0xff)
          l.rx.reset()
          if (l.rxNeed == 0) l.rxNeed = -1
        }
      } else {
        val take = minOf(l.rxNeed - l.rx.size(), chunk.size - i)
        l.rx.write(chunk, i, take)
        i += take
        if (l.rx.size() == l.rxNeed) {
          val frame = l.rx.toByteArray()
          l.rx.reset()
          l.rxNeed = -1
          rxFrames++
          rxBytes += frame.size
          sendEvent("onPacket", mapOf("link" to l.id, "data" to Base64.encodeToString(frame, Base64.NO_WRAP)))
        }
      }
    }
  }

  private fun enqueue(l: Link?, data: ByteArray) {
    if (l == null || !running || !l.ready || data.isEmpty() || data.size > MAX_FRAME) return
    val framed = ByteArray(data.size + 2)
    framed[0] = (data.size shr 8).toByte()
    framed[1] = (data.size and 0xff).toByte()
    System.arraycopy(data, 0, framed, 2, data.size)
    // whole frames only: a queue that is too long drops the new frame, never half of one
    val chunks = (framed.size + l.chunk - 1) / l.chunk
    if (l.txQueue.size + chunks > MAX_QUEUED_CHUNKS) {
      lastError = "send queue full for ${l.id}, frame dropped"
      return
    }
    txFrames++
    txBytes += data.size
    var off = 0
    while (off < framed.size) {
      val end = minOf(off + l.chunk, framed.size)
      l.txQueue.addLast(framed.copyOfRange(off, end))
      off = end
    }
    pump(l)
  }

  /** One GATT operation at a time per link. The head chunk stays queued until the stack accepts it. */
  private fun pump(l: Link) {
    if (l.busy || l.retryScheduled) return
    val next = l.txQueue.firstOrNull() ?: return
    if (!l.ready) {
      resetTx(l)
      return
    }
    l.busy = true
    val ok = try {
      writeChunk(l, next)
    } catch (e: Throwable) {
      false
    }
    if (ok) {
      l.txQueue.removeFirst()
      l.retries = 0
      return
    }
    l.busy = false
    l.retries++
    if (l.retries > WRITE_RETRIES) {
      dropLink(l, "write refused")
      return
    }
    // the stack is busy (another notification in flight on this server, for instance): try again shortly
    l.retryScheduled = true
    main.postDelayed({
      l.retryScheduled = false
      guarded("pump-retry") { pump(l) }
    }, 30L * l.retries)
  }

  private fun writeChunk(l: Link, bytes: ByteArray): Boolean {
    val g = l.gatt
    val ch = l.gattChar
    if (g != null && ch != null && l.gattReady) {
      return if (Build.VERSION.SDK_INT >= 33) {
        g.writeCharacteristic(ch, bytes, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
      } else {
        @Suppress("DEPRECATION")
        run {
          ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
          ch.value = bytes
          g.writeCharacteristic(ch)
        }
      }
    }
    val dev = l.serverDevice
    val srv = server
    if (dev != null && srv != null && l.serverSubscribed) {
      val ch2 = srv.getService(SERVICE_UUID)?.getCharacteristic(CHAR_UUID) ?: return false
      return if (Build.VERSION.SDK_INT >= 33) {
        srv.notifyCharacteristicChanged(dev, ch2, false, bytes) == BluetoothGatt.GATT_SUCCESS
      } else {
        @Suppress("DEPRECATION")
        run {
          ch2.value = bytes
          srv.notifyCharacteristicChanged(dev, ch2, false)
        }
      }
    }
    return false
  }

  // ---------- diagnostics for the self-test screen ----------

  private fun locationServicesOn(): Boolean = try {
    val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    if (Build.VERSION.SDK_INT >= 28) lm.isLocationEnabled
    else lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
  } catch (_: Throwable) {
    false
  }

  private fun diagnostics(): Map<String, Any?> {
    val now = SystemClock.elapsedRealtime()
    val a = adapter ?: (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    val legacy = Build.VERSION.SDK_INT < 31
    val perms = mapOf(
      "scan" to (legacy || granted(Manifest.permission.BLUETOOTH_SCAN)),
      "advertise" to (legacy || granted(Manifest.permission.BLUETOOTH_ADVERTISE)),
      "connect" to (legacy || granted(Manifest.permission.BLUETOOTH_CONNECT)),
      "location" to granted(Manifest.permission.ACCESS_FINE_LOCATION),
      "notifications" to (Build.VERSION.SDK_INT < 33 || granted("android.permission.POST_NOTIFICATIONS")),
    )
    val linkList = links.values.map {
      mapOf(
        "id" to it.id,
        "role" to when {
          it.gatt != null && it.serverDevice != null -> "both"
          it.gatt != null -> "client"
          else -> "server"
        },
        "ready" to it.ready,
        "mtu" to it.mtu,
        "rssi" to it.rssi,
        "queued" to it.txQueue.size,
      )
    }
    val nearby = seenPeers.values
      .filter { now - it.lastSeen < 60_000L }
      .sortedByDescending { it.rssi }
      .map {
        mapOf(
          "id" to it.key,
          "addr" to it.addr,
          "rssi" to it.rssi,
          "ageMs" to (now - it.lastSeen).toInt(),
          "linked" to links.values.any { l -> l.seenKey == it.key && l.ready },
          "failures" to it.failures,
        )
      }
    return mapOf(
      "apiLevel" to Build.VERSION.SDK_INT,
      "manufacturer" to Build.MANUFACTURER,
      "model" to Build.MODEL,
      "bleSupported" to ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE),
      "bluetoothOn" to (a?.isEnabled == true),
      "advertiserAvailable" to (a?.bluetoothLeAdvertiser != null),
      "permissions" to perms,
      "locationRequired" to legacy,
      "locationServicesOn" to locationServicesOn(),
      "wanted" to wanted,
      "running" to running,
      "serviceRunning" to MeshService.running,
      "serviceError" to MeshService.lastError,
      "serverReady" to serverReady,
      "advertising" to advertising,
      "scanning" to scanning,
      "scanFast" to (scanMode == ScanSettings.SCAN_MODE_LOW_LATENCY),
      "scanStartsLast30s" to scanStarts.count { now - it <= SCAN_WINDOW_MS },
      "token" to java.lang.Long.toHexString(myToken),
      "links" to linkList,
      "nearby" to nearby,
      "txFrames" to txFrames.toDouble(),
      "txBytes" to txBytes.toDouble(),
      "rxFrames" to rxFrames.toDouble(),
      "rxBytes" to rxBytes.toDouble(),
      "lastError" to lastError,
    )
  }
}
