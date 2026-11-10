// The darwin half of the Computer: the Mac's screen over RFB, with the Mac's
// own pointer and keyboard.
//
// Linux runs Xvfb + a window manager + x11vnc. macOS has no display server to
// attach to, so this helper replaces the capture and input half of that stack
// and speaks the same RFB protocol on the same loopback port. serve.ts bridges
// the websocket to it exactly as it bridges to x11vnc, so noVNC, the kiosk
// crop and the clipboard stay unchanged.
//
//   ScreenCaptureKit  captures the main display, scaled into the desktop's box
//   CGEvent           injects pointer, wheel and keyboard from RFB events
//   RFB 3.8           Raw encoding, damage-limited 64x64 tiles
//
// Security: it listens on 127.0.0.1 only and has no password, matching
// x11vnc's -localhost -nopw. The only authenticated path in is serve's
// /api/computer websocket. Screen Recording and Accessibility are granted to
// this process once, in System Settings, the first time it needs them.
//
// Output: one JSON line on stdout when ready:
//   READY {"width":1280,"height":720,"screenWidth":2560,"screenHeight":1440,"accessible":true}
// and ERROR lines before a non-zero exit.

import Cocoa
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

let TILE = 64
let VERSION = "RFB 003.008\n"

// ---- arguments ----

struct Options {
  var port: Int = 5900
  var maxWidth: Int = 1280
  var maxHeight: Int = 800
  var fps: Int = 12
}

func parseOptions() -> Options {
  var o = Options()
  var args = CommandLine.arguments.dropFirst().makeIterator()
  while let a = args.next() {
    switch a {
    case "--port": if let v = args.next(), let n = Int(v) { o.port = n }
    case "--max-width": if let v = args.next(), let n = Int(v) { o.maxWidth = n }
    case "--max-height": if let v = args.next(), let n = Int(v) { o.maxHeight = n }
    case "--fps": if let v = args.next(), let n = Int(v) { o.fps = n }
    default: break
    }
  }
  return o
}

func stderrLine(_ s: String) {
  FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

func fail(_ message: String, code: Int32 = 1) -> Never {
  print("ERROR \(message)")
  fflush(stdout)
  stderrLine("[computer-mac] \(message)")
  exit(code)
}

// ---- capture ----

final class FrameStore {
  private let condition = NSCondition()
  private var buffer: [UInt8] = []
  private var generation = 0

  func publish(_ bytes: [UInt8]) {
    condition.lock()
    buffer = bytes
    generation += 1
    condition.broadcast()
    condition.unlock()
  }

  func latest() -> ([UInt8], Int) {
    condition.lock()
    defer { condition.unlock() }
    return (buffer, generation)
  }

  func wait(after: Int, timeout: TimeInterval) -> ([UInt8], Int) {
    condition.lock()
    defer { condition.unlock() }
    if generation > after { return (buffer, generation) }
    let deadline = Date().addingTimeInterval(timeout)
    while generation <= after && Date() < deadline {
      condition.wait(until: deadline)
    }
    return (buffer, generation)
  }
}

final class ScreenSource: NSObject, SCStreamOutput, SCStreamDelegate {
  let width: Int
  let height: Int
  let screenWidth: Int
  let screenHeight: Int
  let store = FrameStore()
  private var stream: SCStream?

  init(width: Int, height: Int, screenWidth: Int, screenHeight: Int) {
    self.width = width
    self.height = height
    self.screenWidth = screenWidth
    self.screenHeight = screenHeight
  }

  static func start(maxWidth: Int, maxHeight: Int, fps: Int) async throws -> ScreenSource {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let main = CGMainDisplayID()
    guard let display = content.displays.first(where: { $0.displayID == main }) ?? content.displays.first else {
      throw NSError(domain: "omg", code: 1, userInfo: [NSLocalizedDescriptionKey: "no display to capture"])
    }
    let bounds = CGDisplayBounds(display.displayID)
    let aspect = bounds.height > 0 ? bounds.width / bounds.height : 16.0 / 9.0
    var width = maxWidth
    var height = Int((Double(maxWidth) / aspect).rounded())
    if height > maxHeight {
      height = maxHeight
      width = Int((Double(maxHeight) * aspect).rounded())
    }
    width = max(2, width - width % 2)
    height = max(2, height - height % 2)

    let source = ScreenSource(
      width: width,
      height: height,
      screenWidth: max(1, Int(bounds.width.rounded())),
      screenHeight: max(1, Int(bounds.height.rounded()))
    )

    let filter = SCContentFilter(display: display, excludingWindows: [])
    let config = SCStreamConfiguration()
    config.width = width
    config.height = height
    config.pixelFormat = kCVPixelFormatType_32BGRA
    config.showsCursor = true
    config.queueDepth = 3
    config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(max(1, fps)))

    let stream = SCStream(filter: filter, configuration: config, delegate: source)
    try stream.addStreamOutput(source, type: .screen, sampleHandlerQueue: DispatchQueue(label: "omg.computer.capture"))
    try await stream.startCapture()
    source.stream = stream
    return source
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
    guard outputType == .screen, sampleBuffer.isValid,
      let image = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    CVPixelBufferLockBaseAddress(image, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(image) else { return }
    let w = CVPixelBufferGetWidth(image)
    let h = CVPixelBufferGetHeight(image)
    let stride = CVPixelBufferGetBytesPerRow(image)
    guard w > 0, h > 0 else { return }
    var out = [UInt8](repeating: 0, count: w * h * 4)
    out.withUnsafeMutableBytes { dst in
      guard let d = dst.baseAddress else { return }
      for y in 0..<h {
        memcpy(d + y * w * 4, base + y * stride, w * 4)
      }
    }
    store.publish(out)
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    stderrLine("[computer-mac] capture stopped: \(error.localizedDescription)")
    exit(1)
  }
}

// ---- input ----

final class Input {
  private let lock = NSLock()
  private var flags: CGEventFlags = []
  private var buttons: UInt8 = 0
  private var point = CGPoint.zero
  private var scaleX = 1.0
  private var scaleY = 1.0

  func setScale(framebufferWidth: Int, framebufferHeight: Int, screenWidth: Int, screenHeight: Int) {
    scaleX = Double(screenWidth) / Double(max(1, framebufferWidth))
    scaleY = Double(screenHeight) / Double(max(1, framebufferHeight))
  }

  private func post(_ event: CGEvent?) {
    guard let event else { return }
    event.flags = flags
    event.post(tap: .cghidEventTap)
  }

  func pointer(mask: UInt8, x: Int, y: Int) {
    lock.lock()
    defer { lock.unlock() }
    let next = CGPoint(x: Double(x) * scaleX, y: Double(y) * scaleY)
    let moved = next != point
    point = next

    // Wheel bits are momentary: one notch per press, nothing on release.
    if mask & 8 != 0 && buttons & 8 == 0 { scroll(1) }
    if mask & 16 != 0 && buttons & 16 == 0 { scroll(-1) }

    let changed = mask ^ buttons
    if moved || changed == 0 {
      post(CGEvent(
        mouseEventSource: nil,
        mouseType: dragType(for: buttons & 7, moved: moved),
        mouseCursorPosition: next,
        mouseButton: button(for: buttons & 7)
      ))
    }
    if changed & 1 != 0 { postButton(1, down: mask & 1 != 0, at: next) }
    if changed & 2 != 0 { postButton(2, down: mask & 2 != 0, at: next) }
    if changed & 4 != 0 { postButton(4, down: mask & 4 != 0, at: next) }
    buttons = mask & 7
  }

  private func button(for mask: UInt8) -> CGMouseButton {
    if mask & 1 != 0 { return .left }
    if mask & 2 != 0 { return .center }
    return .right
  }

  private func dragType(for mask: UInt8, moved: Bool) -> CGEventType {
    if mask & 1 != 0 { return moved ? .leftMouseDragged : .leftMouseUp }
    if mask & 2 != 0 { return moved ? .otherMouseDragged : .otherMouseUp }
    if mask & 4 != 0 { return moved ? .rightMouseDragged : .rightMouseUp }
    return .mouseMoved
  }

  private func postButton(_ bit: UInt8, down: Bool, at point: CGPoint) {
    let type: CGEventType
    let button: CGMouseButton
    switch bit {
    case 1: type = down ? .leftMouseDown : .leftMouseUp; button = .left
    case 2: type = down ? .otherMouseDown : .otherMouseUp; button = .center
    default: type = down ? .rightMouseDown : .rightMouseUp; button = .right
    }
    post(CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button))
  }

  private func scroll(_ amount: Int32) {
    guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: amount, wheel2: 0, wheel3: 0) else { return }
    event.flags = flags
    event.post(tap: .cghidEventTap)
  }

  // X11 keysyms for the modifier keys.
  func key(keysym: UInt32, down: Bool) {
    lock.lock()
    defer { lock.unlock() }
    switch keysym {
    case 0xffe1, 0xffe2: // Shift
      flags = down ? flags.union(.maskShift) : flags.subtracting(.maskShift)
      sendKeyCode(down ? 56 : 56, down: down)
    case 0xffe3, 0xffe4: // Control
      flags = down ? flags.union(.maskControl) : flags.subtracting(.maskControl)
      sendKeyCode(59, down: down)
    case 0xffe9, 0xffea: // Alt / Option
      flags = down ? flags.union(.maskAlternate) : flags.subtracting(.maskAlternate)
      sendKeyCode(58, down: down)
    case 0xffeb, 0xffec: // Super / Command
      flags = down ? flags.union(.maskCommand) : flags.subtracting(.maskCommand)
      sendKeyCode(55, down: down)
    case 0xffe5: // Caps Lock
      if down { sendKeyCode(57, down: true); sendKeyCode(57, down: false) }
    default:
      if let (code, shift) = keyCode(for: keysym) {
        let saved = flags
        if shift { flags.insert(.maskShift) }
        sendKeyCode(code, down: down)
        flags = saved
      } else if let scalar = unicode(for: keysym) {
        sendUnicode(scalar, down: down)
      }
    }
  }

  private func sendKeyCode(_ code: CGKeyCode, down: Bool) {
    post(CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down))
  }

  private func sendUnicode(_ scalar: UInt16, down: Bool) {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down) else { return }
    var value = scalar
    event.keyboardSetUnicodeString(stringLength: 1, unicodeString: &value)
    post(event)
  }

  /// The US-layout key code for a keysym, and whether Shift is part of it.
  private func keyCode(for keysym: UInt32) -> (CGKeyCode, Bool)? {
    if keysym >= 0x20 && keysym <= 0x7e, let scalar = UnicodeScalar(keysym) {
      let ch = Character(scalar)
      if let code = baseKeys[ch] { return (code, false) }
      if let base = shiftedKeys[ch], let code = baseKeys[base] { return (code, true) }
      let lower = String(ch).lowercased()
      if lower != String(ch), let base = lower.first, let code = baseKeys[base] { return (code, true) }
    }
    if let code = specialKeys[keysym] { return (code, false) }
    return nil
  }

  private func unicode(for keysym: UInt32) -> UInt16? {
    let point = keysym & 0x00ff_ffff
    if keysym >= 0x0100_0000, point > 0, let scalar = UnicodeScalar(point), scalar.value <= 0xffff {
      return UInt16(scalar.value)
    }
    return nil
  }

  /// Every modifier and button up, for when the last viewer goes away.
  func releaseAll() {
    lock.lock()
    defer { lock.unlock() }
    for (flag, code) in [(CGEventFlags.maskShift, CGKeyCode(56)), (.maskControl, 59), (.maskAlternate, 58), (.maskCommand, 55)] {
      if flags.contains(flag) { sendKeyCode(code, down: false) }
    }
    if buttons & 1 != 0 { postButton(1, down: false, at: point) }
    if buttons & 2 != 0 { postButton(2, down: false, at: point) }
    if buttons & 4 != 0 { postButton(4, down: false, at: point) }
    flags = []
    buttons = 0
  }
}

let baseKeys: [Character: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
  "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
  "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26,
  "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35,
  "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45,
  "m": 46, ".": 47, "`": 50, " ": 49,
]

let shiftedKeys: [Character: Character] = [
  "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8",
  "(": "9", ")": "0", "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";",
  "\"": "'", "<": ",", ">": ".", "?": "/", "~": "`",
]

let specialKeys: [UInt32: CGKeyCode] = [
  0xff0d: 36, 0xff8d: 76, 0xff09: 48, 0xff08: 51, 0xff1b: 53, 0xffff: 117, 0xff63: 114,
  0xff51: 123, 0xff52: 126, 0xff53: 124, 0xff54: 125,
  0xff50: 115, 0xff57: 119, 0xff55: 116, 0xff56: 121,
  0xffbe: 122, 0xffbf: 120, 0xffc0: 99, 0xffc1: 118, 0xffc2: 96, 0xffc3: 97,
  0xffc4: 98, 0xffc5: 100, 0xffc6: 101, 0xffc7: 109, 0xffc8: 103, 0xffc9: 111,
]

// ---- RFB ----

struct PixelFormat {
  var bpp: UInt8 = 32
  var depth: UInt8 = 24
  var bigEndian: Bool = false
  var trueColor: Bool = true
  var redMax: UInt16 = 255
  var greenMax: UInt16 = 255
  var blueMax: UInt16 = 255
  var redShift: UInt8 = 16
  var greenShift: UInt8 = 8
  var blueShift: UInt8 = 0

  var isBGRA32: Bool {
    bpp == 32 && depth == 24 && !bigEndian && trueColor &&
      redMax == 255 && greenMax == 255 && blueMax == 255 &&
      redShift == 16 && greenShift == 8 && blueShift == 0
  }

  static func parse(_ bytes: [UInt8]) -> PixelFormat {
    var p = PixelFormat()
    guard bytes.count >= 16 else { return p }
    p.bpp = bytes[0]
    p.depth = bytes[1]
    p.bigEndian = bytes[2] != 0
    p.trueColor = bytes[3] != 0
    p.redMax = be16(bytes, 4)
    p.greenMax = be16(bytes, 6)
    p.blueMax = be16(bytes, 8)
    p.redShift = bytes[10]
    p.greenShift = bytes[11]
    p.blueShift = bytes[12]
    return p
  }
}

func be16(_ bytes: [UInt8], _ at: Int) -> UInt16 {
  (UInt16(bytes[at]) << 8) | UInt16(bytes[at + 1])
}

func be32(_ bytes: [UInt8], _ at: Int) -> UInt32 {
  (UInt32(bytes[at]) << 24) | (UInt32(bytes[at + 1]) << 16) | (UInt32(bytes[at + 2]) << 8) | UInt32(bytes[at + 3])
}

func appendBE16(_ out: inout [UInt8], _ value: Int) {
  out.append(UInt8((value >> 8) & 0xff))
  out.append(UInt8(value & 0xff))
}

func appendBE32(_ out: inout [UInt8], _ value: UInt32) {
  out.append(UInt8((value >> 24) & 0xff))
  out.append(UInt8((value >> 16) & 0xff))
  out.append(UInt8((value >> 8) & 0xff))
  out.append(UInt8(value & 0xff))
}

func readExact(_ fd: Int32, _ count: Int) -> [UInt8]? {
  guard count > 0 else { return [] }
  var buffer = [UInt8](repeating: 0, count: count)
  var offset = 0
  while offset < count {
    let got = buffer.withUnsafeMutableBytes { raw -> Int in
      guard let base = raw.baseAddress else { return -1 }
      return recv(fd, base + offset, count - offset, 0)
    }
    if got <= 0 { return nil }
    offset += got
  }
  return buffer
}

func writeAll(_ fd: Int32, _ bytes: [UInt8]) -> Bool {
  var offset = 0
  while offset < bytes.count {
    let sent = bytes.withUnsafeBytes { raw -> Int in
      guard let base = raw.baseAddress else { return -1 }
      return send(fd, base + offset, bytes.count - offset, 0)
    }
    if sent <= 0 { return false }
    offset += sent
  }
  return true
}

func writeData(_ fd: Int32, _ bytes: inout [UInt8]) -> Bool {
  writeAll(fd, bytes)
}

final class Client {
  let fd: Int32
  let source: ScreenSource
  let input: Input
  var format = PixelFormat()
  var last: [UInt8]?
  var lastGeneration = 0

  init(fd: Int32, source: ScreenSource, input: Input) {
    self.fd = fd
    self.source = source
    self.input = input
  }

  func serve() {
    guard sendVersion() else { closeClient(); return }
    guard let clientVersion = readExact(fd, 12).flatMap({ String(bytes: $0, encoding: .ascii) }) else {
      closeClient(); return
    }
    if clientVersion.hasPrefix("RFB 003.003") {
      if !writeAll(fd, [0, 0, 0, 1]) { closeClient(); return }
    } else {
      if !writeAll(fd, [1, 1]) { closeClient(); return }
      guard let chosen = readExact(fd, 1), chosen[0] == 1 else { closeClient(); return }
      if !writeAll(fd, [0, 0, 0, 0]) { closeClient(); return }
    }
    guard readExact(fd, 1) != nil else { closeClient(); return }  // ClientInit, shared

    var init76: [UInt8] = []
    appendBE16(&init76, source.width)
    appendBE16(&init76, source.height)
    init76 += [32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]
    let name = Array("omg Computer".utf8)
    appendBE32(&init76, UInt32(name.count))
    init76 += name
    guard writeData(fd, &init76) else { closeClient(); return }

    loop()
    closeClient()
  }

  private func sendVersion() -> Bool {
    writeAll(fd, Array(VERSION.utf8))
  }

  private func loop() {
    while true {
      guard let header = readExact(fd, 1) else { return }
      switch header[0] {
      case 0:  // SetPixelFormat
        guard readExact(fd, 3) != nil, let pf = readExact(fd, 16) else { return }
        let parsed = PixelFormat.parse(pf)
        if parsed.trueColor && (parsed.bpp == 32 || parsed.bpp == 16) { format = parsed }
      case 2:  // SetEncodings
        guard let pad = readExact(fd, 1), let countBytes = readExact(fd, 2) else { return }
        _ = pad
        let count = Int(be16(countBytes, 0))
        if count > 0 { guard readExact(fd, count * 4) != nil else { return } }
      case 3:  // FramebufferUpdateRequest
        guard let body = readExact(fd, 9) else { return }
        update(incremental: body[0] != 0, x: Int(be16(body, 1)), y: Int(be16(body, 3)), w: Int(be16(body, 5)), h: Int(be16(body, 7)))
      case 4:  // KeyEvent
        guard let body = readExact(fd, 7) else { return }
        input.key(keysym: be32(body, 3), down: body[0] != 0)
      case 5:  // PointerEvent
        guard let body = readExact(fd, 5) else { return }
        input.pointer(mask: body[0], x: Int(be16(body, 1)), y: Int(be16(body, 3)))
      case 6:  // ClientCutText
        guard let body = readExact(fd, 7) else { return }
        let length = Int(be32(body, 3))
        if length > 0 && length < 4 * 1024 * 1024 {
          guard let text = readExact(fd, length) else { return }
          if let string = String(bytes: text, encoding: .utf8) {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(string, forType: .string)
          }
        }
      default:
        return
      }
    }
  }

  private func update(incremental: Bool, x: Int, y: Int, w: Int, h: Int) {
    var (frame, generation) = source.store.latest()
    if frame.isEmpty || !incremental {
      (frame, generation) = source.store.wait(after: -1, timeout: 2.0)
    } else if generation == lastGeneration {
      (frame, generation) = source.store.wait(after: lastGeneration, timeout: 0.15)
    }
    guard !frame.isEmpty else { sendEmptyUpdate(); return }

    let width = source.width
    let height = source.height
    let regionX = max(0, min(width, x))
    let regionY = max(0, min(height, y))
    let regionW = max(0, min(width, x + w) - regionX)
    let regionH = max(0, min(height, y + h) - regionY)
    if regionW == 0 || regionH == 0 { sendEmptyUpdate(); return }

    var rects: [(Int, Int, Int, Int)] = []
    if incremental && last != nil && generation == lastGeneration {
      sendEmptyUpdate()
      return
    } else if last == nil || !incremental {
      rects = [(regionX, regionY, regionW, regionH)]
    } else if let previous = last {
      rects = dirtyRects(previous, frame, regionX, regionY, regionW, regionH)
    }

    if rects.isEmpty { sendEmptyUpdate(); return }

    var out: [UInt8] = [0, 0]
    appendBE16(&out, rects.count)
    for rect in rects {
      appendBE16(&out, rect.0)
      appendBE16(&out, rect.1)
      appendBE16(&out, rect.2)
      appendBE16(&out, rect.3)
      appendBE32(&out, 0)  // Raw
      out.reserveCapacity(out.count + rect.2 * rect.3 * 4)
      encodeRaw(frame, into: &out, x: rect.0, y: rect.1, w: rect.2, h: rect.3, width: width)
    }
    if !writeData(fd, &out) { return }
    last = frame
    lastGeneration = generation
  }

  private func sendEmptyUpdate() {
    var out: [UInt8] = [0, 0, 0, 0]
    _ = writeData(fd, &out)
  }

  /// Merge dirty tiles along each row so an update is at most one rect per row.
  private func dirtyRects(_ old: [UInt8], _ new: [UInt8], _ rx: Int, _ ry: Int, _ rw: Int, _ rh: Int) -> [(Int, Int, Int, Int)] {
    let width = source.width
    let height = source.height
    let tilesX = (width + TILE - 1) / TILE
    let tilesY = (height + TILE - 1) / TILE
    var rects: [(Int, Int, Int, Int)] = []

    old.withUnsafeBytes { oldRaw in
      new.withUnsafeBytes { newRaw in
        guard let oldBase = oldRaw.baseAddress, let newBase = newRaw.baseAddress else { return }
        for ty in 0..<tilesY {
          let y0 = ty * TILE
          let th = min(TILE, height - y0)
          if y0 + th <= ry || y0 >= ry + rh { continue }
          var run = -1
          for tx in 0...tilesX {
            var dirty = false
            if tx < tilesX {
              let x0 = tx * TILE
              let tw = min(TILE, width - x0)
              if x0 + tw > rx && x0 < rx + rw {
                dirty = !tilesEqual(oldBase, newBase, x0, y0, tw, th, width)
              }
            }
            if dirty && run < 0 {
              run = tx
            } else if !dirty && run >= 0 {
              let x0 = run * TILE
              let x1 = min(width, tx * TILE)
              if x1 > x0 { rects.append((x0, y0, x1 - x0, th)) }
              run = -1
            }
          }
        }
      }
    }
    return rects
  }

  private func tilesEqual(_ old: UnsafeRawPointer, _ new: UnsafeRawPointer, _ x: Int, _ y: Int, _ w: Int, _ h: Int, _ width: Int) -> Bool {
    let rowBytes = w * 4
    for row in y..<(y + h) {
      let offset = (row * width + x) * 4
      if memcmp(old + offset, new + offset, rowBytes) != 0 { return false }
    }
    return true
  }

  private func encodeRaw(_ frame: [UInt8], into out: inout [UInt8], x: Int, y: Int, w: Int, h: Int, width: Int) {
    if format.isBGRA32 {
      frame.withUnsafeBytes { raw in
        guard let base = raw.baseAddress else { return }
        for row in y..<(y + h) {
          let offset = (row * width + x) * 4
          out.append(contentsOf: UnsafeBufferPointer(start: base.assumingMemoryBound(to: UInt8.self) + offset, count: w * 4))
        }
      }
      return
    }
    for row in y..<(y + h) {
      for column in x..<(x + w) {
        let offset = (row * width + column) * 4
        let b = UInt16(frame[offset])
        let g = UInt16(frame[offset + 1])
        let r = UInt16(frame[offset + 2])
        let rv = UInt32((r * format.redMax) / 255) << UInt32(format.redShift)
        let gv = UInt32((g * format.greenMax) / 255) << UInt32(format.greenShift)
        let bv = UInt32((b * format.blueMax) / 255) << UInt32(format.blueShift)
        let pixel = rv | gv | bv
        if format.bpp == 16 {
          let value = UInt16(truncatingIfNeeded: pixel)
          out.append(UInt8((value >> 8) & 0xff))
          out.append(UInt8(value & 0xff))
        } else if format.bigEndian {
          out.append(UInt8((pixel >> 24) & 0xff))
          out.append(UInt8((pixel >> 16) & 0xff))
          out.append(UInt8((pixel >> 8) & 0xff))
          out.append(UInt8(pixel & 0xff))
        } else {
          out.append(UInt8(pixel & 0xff))
          out.append(UInt8((pixel >> 8) & 0xff))
          out.append(UInt8((pixel >> 16) & 0xff))
          out.append(UInt8((pixel >> 24) & 0xff))
        }
      }
    }
  }

  private func closeClient() {
    close(fd)
  }
}

// ---- main ----

let options = parseOptions()

// A remote desktop that dims or sleeps is not usable. Hold the display (and
// the machine) awake for as long as this helper serves a screen. The token
// must stay referenced, so it lives for the whole process.
let powerAssertion = ProcessInfo.processInfo.beginActivity(
  options: [.idleDisplaySleepDisabled, .userInitiated],
  reason: "omg Computer is streaming this Mac's screen"
)
_ = powerAssertion

if #available(macOS 10.15, *), !CGPreflightScreenCaptureAccess() {
  fail("Screen Recording permission is required for omg Computer. Grant it in System Settings > Privacy & Security > Screen Recording, then start the Computer again.", code: 3)
}

if !AXIsProcessTrusted() {
  stderrLine("[computer-mac] Accessibility permission missing; the screen will stream but input will be refused")
}

let source: ScreenSource
do {
  source = try awaitBlocking { try await ScreenSource.start(maxWidth: options.maxWidth, maxHeight: options.maxHeight, fps: options.fps) }
} catch {
  let message = error.localizedDescription
  if message.lowercased().contains("permission") || message.lowercased().contains("denied") {
    fail("Screen Recording permission is required for omg Computer. Grant it in System Settings > Privacy & Security > Screen Recording, then start the Computer again.", code: 3)
  }
  fail("cannot capture the display: \(message)", code: 4)
}

let input = Input()
input.setScale(
  framebufferWidth: source.width,
  framebufferHeight: source.height,
  screenWidth: source.screenWidth,
  screenHeight: source.screenHeight
)

signal(SIGUSR1, SIG_IGN)
let release = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
release.setEventHandler { input.releaseAll() }
release.resume()

signal(SIGPIPE, SIG_IGN)

let listenFD = socket(AF_INET, SOCK_STREAM, 0)
if listenFD < 0 { fail("cannot create the RFB socket") }
var reuse: Int32 = 1
setsockopt(listenFD, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
var address = sockaddr_in()
address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
address.sin_family = sa_family_t(AF_INET)
address.sin_port = in_port_t(UInt16(options.port).bigEndian)
address.sin_addr.s_addr = inet_addr("127.0.0.1")
let bound = withUnsafePointer(to: &address) { pointer in
  pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(listenFD, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
}
if bound != 0 { fail("cannot bind 127.0.0.1:\(options.port)") }
if listen(listenFD, 16) != 0 { fail("cannot listen on 127.0.0.1:\(options.port)") }

let ready = "READY {\"width\":\(source.width),\"height\":\(source.height),\"screenWidth\":\(source.screenWidth),\"screenHeight\":\(source.screenHeight),\"accessible\":\(AXIsProcessTrusted())}"
print(ready)
fflush(stdout)
stderrLine("[computer-mac] streaming \(source.width)x\(source.height) from \(source.screenWidth)x\(source.screenHeight) on 127.0.0.1:\(options.port)")

Thread {
  while true {
    let client = accept(listenFD, nil, nil)
    if client < 0 {
      if errno == EINTR { continue }
      break
    }
    var noDelay: Int32 = 1
    setsockopt(client, IPPROTO_TCP, TCP_NODELAY, &noDelay, socklen_t(MemoryLayout<Int32>.size))
    let handler = Client(fd: client, source: source, input: input)
    let thread = Thread { handler.serve() }
    thread.stackSize = 1 << 20
    thread.start()
  }
}.start()

dispatchMain()

func awaitBlocking<T>(_ work: @escaping () async throws -> T) throws -> T {
  let semaphore = DispatchSemaphore(value: 0)
  var result: Result<T, Error>!
  Task {
    do { result = .success(try await work()) } catch { result = .failure(error) }
    semaphore.signal()
  }
  semaphore.wait()
  return try result.get()
}
