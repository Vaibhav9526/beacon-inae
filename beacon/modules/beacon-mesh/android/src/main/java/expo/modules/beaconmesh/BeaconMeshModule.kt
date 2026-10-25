package expo.modules.beaconmesh

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
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Base64
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
 */
@SuppressLint("MissingPermission")
class BeaconMeshModule : Module() {
  companion object {
    val SERVICE_UUID: UUID = UUID.fromString("6e1f2c40-5b7a-4d3e-9a18-2c0bea0c0001")
    val CHAR_UUID: UUID = UUID.fromString("6e1f2c40-5b7a-4d3e-9a18-2c0bea0c0002")
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    const val MAX_LINKS = 6
    const val RECONNECT_COOLDOWN_MS = 10_000L
    const val MAX_FRAME = 65_535
  }

  private val main = Handler(Looper.getMainLooper())
  private val ctx: Context get() = appContext.reactContext ?: throw IllegalStateException("no context")

  private var manager: BluetoothManager? = null
  private var adapter: BluetoothAdapter? = null
  private var server: BluetoothGattServer? = null
  private var running = false
  private var scanning = false
  private var advertising = false

  private val links = HashMap<String, Link>()
  private val connecting = HashSet<String>()
  private val lastAttempt = HashMap<String, Long>()

  private inner class Link(val id: String) {
    var gatt: BluetoothGatt? = null
    var gattChar: BluetoothGattCharacteristic? = null
    var gattReady = false
    var serverDevice: BluetoothDevice? = null
    var serverSubscribed = false
    var mtu = 23
    val rx = ByteArrayOutputStream()
    var rxNeed = -1
    val txQueue = ArrayDeque<ByteArray>()
    var busy = false
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
      main.post { startRadio() }
    }

    AsyncFunction("stop") {
      main.post { stopRadio() }
    }

    AsyncFunction("send") { linkId: String, base64: String ->
      val data = Base64.decode(base64, Base64.NO_WRAP)
      main.post { enqueue(links[linkId], data) }
    }

    AsyncFunction("broadcast") { base64: String, exceptLink: String? ->
      val data = Base64.decode(base64, Base64.NO_WRAP)
      main.post {
        for (l in links.values) if (l.id != exceptLink && l.ready) enqueue(l, data)
      }
    }

    Function("getLinks") {
      return@Function links.values.filter { it.ready }.map { it.id }
    }

    OnDestroy { main.post { stopRadio() } }
  }

  // ---------- lifecycle ----------

  private fun state(s: String) = sendEvent("onState", mapOf("state" to s))

  private fun startRadio() {
    if (running) return
    manager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    adapter = manager?.adapter
    val a = adapter
    if (a == null || !a.isEnabled) {
      state("bluetooth-off")
      return
    }
    running = true
    runCatching { MeshService.start(ctx) } // keep relaying with the screen off
    openServer()
    startAdvertising()
    startScanning()
    state("running")
  }

  private fun stopRadio() {
    if (!running) return
    running = false
    runCatching { adapter?.bluetoothLeScanner?.stopScan(scanCallback) }
    runCatching { adapter?.bluetoothLeAdvertiser?.stopAdvertising(advCallback) }
    scanning = false
    advertising = false
    for (l in links.values.toList()) {
      runCatching { l.gatt?.disconnect(); l.gatt?.close() }
    }
    links.clear()
    connecting.clear()
    runCatching { server?.close() }
    server = null
    runCatching { MeshService.stop(ctx) }
    state("stopped")
  }

  // ---------- peripheral (server) role ----------

  private fun openServer() {
    val srv = manager?.openGattServer(ctx, serverCallback) ?: return
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
    srv.addService(svc)
    server = srv
  }

  private fun startAdvertising() {
    val adv = adapter?.bluetoothLeAdvertiser ?: return
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
      .setConnectable(true)
      .setTimeout(0)
      .build()
    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .addServiceUuid(ParcelUuid(SERVICE_UUID))
      .build()
    adv.startAdvertising(settings, data, advCallback)
  }

  private val advCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) { advertising = true }
    override fun onStartFailure(errorCode: Int) { advertising = false; main.post { state("adv-failed:$errorCode") } }
  }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      main.post {
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          val l = links.getOrPut(device.address) { Link(device.address) }
          l.serverDevice = device
        } else {
          val l = links[device.address] ?: return@post
          l.serverDevice = null
          l.serverSubscribed = false
          maybeDrop(l)
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
      if (responseNeeded) server?.sendResponse(device, requestId, android.bluetooth.BluetoothGatt.GATT_SUCCESS, 0, null)
      main.post {
        val l = links.getOrPut(device.address) { Link(device.address) }
        l.serverDevice = device
        l.serverSubscribed = value.isNotEmpty() && value[0].toInt() != 0
        if (l.ready) announceUp(l) else maybeDrop(l)
      }
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray
    ) {
      if (responseNeeded) server?.sendResponse(device, requestId, android.bluetooth.BluetoothGatt.GATT_SUCCESS, 0, null)
      main.post {
        val l = links.getOrPut(device.address) { Link(device.address) }
        if (l.serverDevice == null) l.serverDevice = device
        receive(l, value)
      }
    }

    override fun onNotificationSent(device: BluetoothDevice, status: Int) {
      main.post { links[device.address]?.let { it.busy = false; pump(it) } }
    }
  }

  // ---------- central (client) role ----------

  private fun startScanning() {
    val scanner = adapter?.bluetoothLeScanner ?: return
    val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED).build()
    scanner.startScan(listOf(filter), settings, scanCallback)
    scanning = true
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val dev = result.device
      main.post {
        if (!running) return@post
        val addr = dev.address
        if (links[addr]?.let { it.gatt != null || it.serverDevice != null } == true) return@post
        if (connecting.contains(addr) || links.size + connecting.size >= MAX_LINKS) return@post
        val now = System.currentTimeMillis()
        if (now - (lastAttempt[addr] ?: 0L) < RECONNECT_COOLDOWN_MS) return@post
        lastAttempt[addr] = now
        connecting.add(addr)
        dev.connectGatt(ctx, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
      }
    }

    override fun onScanFailed(errorCode: Int) { main.post { state("scan-failed:$errorCode") } }
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      main.post {
        val addr = g.device.address
        if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
          val l = links.getOrPut(addr) { Link(addr) }
          l.gatt = g
          g.requestMtu(517)
        } else {
          connecting.remove(addr)
          runCatching { g.close() }
          val l = links[addr]
          if (l != null && l.gatt === g) {
            l.gatt = null
            l.gattChar = null
            l.gattReady = false
            maybeDrop(l)
          }
        }
      }
    }

    override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
      main.post {
        links[g.device.address]?.let { if (status == BluetoothGatt.GATT_SUCCESS) it.mtu = mtu }
        g.discoverServices()
      }
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      main.post {
        val ch = g.getService(SERVICE_UUID)?.getCharacteristic(CHAR_UUID)
        val l = links[g.device.address]
        if (ch == null || l == null) { g.disconnect(); return@post }
        l.gattChar = ch
        g.setCharacteristicNotification(ch, true)
        val cccd = ch.getDescriptor(CCCD_UUID)
        if (cccd == null) { g.disconnect(); return@post }
        if (Build.VERSION.SDK_INT >= 33) {
          g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
        } else {
          @Suppress("DEPRECATION")
          run {
            cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            g.writeDescriptor(cccd)
          }
        }
      }
    }

    override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
      main.post {
        connecting.remove(g.device.address)
        val l = links[g.device.address] ?: return@post
        if (status == BluetoothGatt.GATT_SUCCESS) {
          l.gattReady = true
          announceUp(l)
        } else g.disconnect()
      }
    }

    // API 33+
    override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
      main.post { links[g.device.address]?.let { receive(it, value) } }
    }

    // < API 33
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= 33) return
      val v = c.value ?: return
      main.post { links[g.device.address]?.let { receive(it, v) } }
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
      main.post { links[g.device.address]?.let { it.busy = false; pump(it) } }
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
    links.remove(l.id)
    if (l.announcedUp) sendEvent("onLink", mapOf("link" to l.id, "up" to false))
  }

  // ---------- framing, tx, rx ----------

  private fun receive(l: Link, chunk: ByteArray) {
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
          sendEvent("onPacket", mapOf("link" to l.id, "data" to Base64.encodeToString(frame, Base64.NO_WRAP)))
        }
      }
    }
  }

  private fun enqueue(l: Link?, data: ByteArray) {
    if (l == null || !l.ready || data.isEmpty() || data.size > MAX_FRAME) return
    val framed = ByteArray(data.size + 2)
    framed[0] = (data.size shr 8).toByte()
    framed[1] = (data.size and 0xff).toByte()
    System.arraycopy(data, 0, framed, 2, data.size)
    var off = 0
    while (off < framed.size) {
      val end = minOf(off + l.chunk, framed.size)
      l.txQueue.addLast(framed.copyOfRange(off, end))
      off = end
    }
    pump(l)
  }

  private fun pump(l: Link) {
    if (l.busy) return
    val next = l.txQueue.removeFirstOrNull() ?: return
    l.busy = true
    val ok = writeChunk(l, next)
    if (!ok) {
      // drop this link's backlog; the mesh layer retries via store-and-forward
      l.busy = false
      l.txQueue.clear()
    }
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
}
