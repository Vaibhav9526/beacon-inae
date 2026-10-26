# Testing the Bluetooth mesh between two phones

The mesh (chat, SOS, relay) was only tested in software before. Use this procedure with two real Android phones. One phone can only check that the radio starts (everything green except "Phones connected"); chat needs two.

## Before you start

1. Build and install the **same** debug or release APK on both phones (the Kotlin module changed, so a new native build is required, not just a JS reload).
2. Both phones: Bluetooth on. Android 11 or older: also switch Location on.
3. Both phones: open Beacon, Chat tab, tap **Mesh status**. This opens `/meshtest`.
4. Allow "Nearby devices" (Android 12+) or "Location" (Android 11 and older). Also allow Notifications.
5. Set Beacon to "Unrestricted" / "Don't optimise" battery, and enable Auto-start on vivo, Xiaomi, Oppo, Realme (the "Keep Beacon running" card on the same screen opens the settings).

## The test

1. Put the phones within 2 m, screens on, `/meshtest` open on both.
2. Within about 30 seconds, on both phones the rows Bluetooth, Nearby devices, Keep-alive service, Advertising, Scanning must be green, and "Phones connected" turns green with `1 link up`. Under "Phones" you see the other phone with a signal in dBm.
   - Only one phone of the pair opens the connection (the one with the lower random id, shown at the top of the card). The other shows the link with role `server`. This is expected.
3. Phone A: **Send test message**. Phone B: Chat tab. The message `test hh:mm:ss` appears with A's nickname. On A the bubble says "Sent to 1 phone nearby".
4. Phone B replies from the Chat tab. It appears on A.
5. Late delivery: walk apart until the link drops (the dot turns amber), send from A (it says "No phones nearby yet: it will be delivered when someone comes in range"), come back. The mesh keeps recent public messages and swaps them when a link forms, so B receives it within about 15 to 30 seconds.
6. Lock A's screen for 2 minutes, send from B, unlock A. If it is missing the phone killed the background service: see OEM notes below.
7. Toggle Bluetooth off then on on one phone: the checklist shows red, then recovers on its own and re-links within about a minute.

Expected counters after one message each way: sent and received packets both above 0 (announce and sync packets flow even before chat).

## What each red or amber row means

| Row | Fix |
| --- | --- |
| Bluetooth is on | Switch it on (Open button). The mesh restarts by itself. |
| Nearby devices permission | Grant. If Android says "will not ask again", open App settings > Permissions > Nearby devices. |
| Location permission | Optional on Android 12+ (only picks the neighbourhood channel). Required on Android 11 and older. |
| Location services on | Android 11 and older return **no scan results** while the Location switch is off. |
| Keep-alive service running | Needs the Nearby devices permission on Android 14 (a foreground service of type connectedDevice is refused without it). The reason is printed in the row. |
| Advertising | Error 2 "too many advertisers": close other Bluetooth apps. Error 5: the phone cannot advertise (rare, some cheap chips), it can still find others but cannot be found. |
| Scanning | Error 6 or silent: Android allows 5 scan starts per 30 s; the app keeps to 4 and waits. Error 2 or 5: restart Bluetooth. |
| Phones connected | See "Heard, not linked" under Phones: it lists failed connection attempts. |

## adb logcat

```
adb devices
adb -s <serial> logcat -c
adb -s <serial> logcat -v time ReactNativeJS:V BluetoothGatt:D BtGatt.GattService:D BluetoothAdapter:D AndroidRuntime:E ActivityManager:I *:S
```

Useful single filters:

- Crashes: `adb logcat AndroidRuntime:E *:S`
- Foreground service: `adb logcat -s ActivityManager ForegroundServiceTypeLoggerModule`
- GATT status codes: `adb logcat -s BluetoothGatt` (status 133 = generic connection failure, 8 = timeout, 19 = remote closed, 22 = local closed)
- Beacon JS logs: `adb logcat -s ReactNativeJS`
- Dump the Bluetooth stack: `adb shell dumpsys bluetooth_manager`
- Check what Android granted: `adb shell dumpsys package app.beacon.community | grep -i bluetooth`
- Check the merged manifest flags: `adb shell dumpsys package app.beacon.community | grep -i "BLUETOOTH_SCAN"`

## Common failure causes

By Android version:

- **Android 12+ (API 31+)**: runtime permission BLUETOOTH_SCAN, BLUETOOTH_ADVERTISE, BLUETOOTH_CONNECT is mandatory; without them scanning and advertising throw SecurityException. Location is not needed for scanning (BLUETOOTH_SCAN is declared `neverForLocation`).
- **Android 13 (API 33)**: Notifications is a runtime permission. Denying it hides the keep-alive notice but the service still runs; some OEMs then kill it sooner.
- **Android 14 (API 34)**: a foreground service of type connectedDevice needs a granted Bluetooth permission, else the start is refused; the self-test shows "startForeground: SecurityException".
- **Android 11 and older**: needs Location permission **and** the Location switch on for scan results; BLUETOOTH and BLUETOOTH_ADMIN are install-time permissions (declared up to API 30).
- **Android 7+ (all)**: more than 5 scan starts in 30 s are silently ignored. Symptom: no phones heard although both advertise. The app restarts a scan at most 4 times per 30 s.

By vendor:

- **vivo / iQOO (Funtouch, OriginOS), Oppo / Realme (ColorOS), Xiaomi / Redmi / POCO (MIUI, HyperOS)**: aggressive background killers. Enable Auto-start, set Battery to "No restrictions" / "Don't optimise", lock Beacon in the recent-apps list. Without this the mesh works only while the app is on screen.
- **Samsung (One UI)**: add Beacon to Settings > Battery > Background usage limits > Never sleeping apps, and remove it from "Sleeping apps".
- **Huawei / Honor**: Settings > Battery > App launch > Beacon > Manage manually, allow all three switches.
- **OnePlus / Nothing / Pixel**: usually fine; set battery to Unrestricted.
- Cheap chips (some Unisoc/old MediaTek phones) may not support LE advertising: the Advertising row stays red with error 5. That phone can scan and connect to a phone that advertises, so it still joins a pair with a phone that can.

Other:

- Two phones both stuck on "CONNECTING" for 15 s then retrying (status 133): old paired entries or a busy chip. Turn Bluetooth off and on, then use Restart mesh. The app retries with a delay of 2, 4, 8, 16, 32 then 60 seconds.
- Linked but no chat: both phones must be on the same release (packet format). Check "Received" counters; if packets arrive but chat does not show, check the channel chips: without a GPS fix both phones use the shared `local` room.
- Message sent while alone: this is not an error. It says it will be delivered when someone comes in range.
