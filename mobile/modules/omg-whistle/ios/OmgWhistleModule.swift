import CryptoKit
import ExpoModulesCore
import Foundation
@_implementationOnly import NeedleEngine

public class OmgWhistleModule: Module {
  // Needle has process-global state. Every engine call uses this one queue.
  private static let engineQueue = DispatchQueue(label: "dev.omg.whistle")
  private var model: Data?
  private static var streamID: String?
  private var streamLanguage = "auto"
  private let checksum = "b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb"

  public func definition() -> ModuleDefinition {
    Name("OmgWhistle")
    AsyncFunction("prepare") { try self.prepare() }.runOnQueue(Self.engineQueue)
    AsyncFunction("transcribe") { (uri: String, language: String) in
      return try self.transcribe(uri, language: language)
    }.runOnQueue(Self.engineQueue)
    AsyncFunction("startStream") { (language: String) in
      guard self.model != nil else { throw self.failure("On-device transcription is not ready") }
      guard Self.streamID == nil else { throw self.failure("A voice stream is already active") }
      guard ["auto", "en", "de", "fr", "es", "it", "nl", "pl"].contains(language) else {
        throw self.failure("This language needs cloud")
      }
      let id = UUID().uuidString
      Self.streamID = id
      self.streamLanguage = language
      return id
    }.runOnQueue(Self.engineQueue)
    AsyncFunction("processStream") { (id: String, pcm: String) in
      guard Self.streamID == id else { throw self.failure("Voice stream has ended") }
      guard let data = Data(base64Encoded: pcm), data.count % 2 == 0,
            data.count > 0, data.count <= 960_000 else { throw self.failure("Invalid PCM chunk") }
      let bytes = [UInt8](data)
      let samples = stride(from: 0, to: bytes.count, by: 2).map {
        Float(Int16(bitPattern: UInt16(bytes[$0]) | UInt16(bytes[$0 + 1]) << 8)) / 32768
      }
      return try self.streamResult(samples)
    }.runOnQueue(Self.engineQueue)
    AsyncFunction("stopStream") { (id: String) in
      guard Self.streamID == id else { throw self.failure("Voice stream has ended") }
      defer { Self.streamID = nil }
      return try self.streamResult(nil)
    }.runOnQueue(Self.engineQueue)
  }

  private func streamResult(_ samples: [Float]?) throws -> [String: String] {
    var output = [CChar](repeating: 0, count: 65_536)
    let result = output.withUnsafeMutableBufferPointer { out in
      guard let samples else { return needle_stream_transcribe_stop(out.baseAddress, Int32(out.count)) }
      return samples.withUnsafeBufferPointer { pcm in
        if streamLanguage == "auto" {
          return needle_stream_transcribe_process(pcm.baseAddress, Int32(pcm.count), nil, nil, out.baseAddress, Int32(out.count))
        }
        return streamLanguage.withCString { lang in
          needle_stream_transcribe_process(pcm.baseAddress, Int32(pcm.count), lang, nil, out.baseAddress, Int32(out.count))
        }
      }
    }
    guard result >= 0 else { throw failure(String(cString: needle_last_error())) }
    guard let body = try JSONSerialization.jsonObject(with: Data(String(cString: output).utf8)) as? [String: Any],
          let text = body["text"] as? String else { throw failure("Invalid streaming result") }
    return ["text": text, "pending": body["pending"] as? String ?? ""]
  }

  private func failure(_ message: String) -> NSError {
    NSError(domain: "OmgWhistle", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }

  private func prepare() throws {
    if model != nil { return }
    setenv("NEEDLE_TELEMETRY", "0", 1)
    setenv("DO_NOT_TRACK", "1", 1)
    let manager = FileManager.default
    let directory = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: true).appendingPathComponent("Whistle")
    try manager.createDirectory(at: directory, withIntermediateDirectories: true)
    var directoryURL = directory
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directoryURL.setResourceValues(values)
    let file = directory.appendingPathComponent("\(checksum).cact")
    func valid(_ data: Data) -> Bool {
      SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() == checksum
    }
    var bytes = try? Data(contentsOf: file, options: .mappedIfSafe)
    if bytes == nil || !valid(bytes!) {
      try? manager.removeItem(at: file)
      let url = URL(string: "https://huggingface.co/Cactus-Compute/whistle/resolve/b358ddadd89b7a713b5aa131f23032d3cca1b251/whistle.cact")!
      let config = URLSessionConfiguration.ephemeral
      config.timeoutIntervalForRequest = 30
      config.timeoutIntervalForResource = 120
      let session = URLSession(configuration: config)
      defer { session.invalidateAndCancel() }
      let done = DispatchSemaphore(value: 0)
      var downloadError: Error?
      let temporary = directory.appendingPathComponent(UUID().uuidString)
      defer { try? manager.removeItem(at: temporary) }
      session.downloadTask(with: url) { location, response, error in
        defer { done.signal() }
        do {
          if let error { throw error }
          guard let location, let response = response as? HTTPURLResponse,
                response.statusCode == 200 else { throw self.failure("Model download failed") }
          try manager.moveItem(at: location, to: temporary)
        } catch { downloadError = error }
      }.resume()
      done.wait()
      if let downloadError { throw downloadError }
      let downloaded = try Data(contentsOf: temporary, options: .mappedIfSafe)
      guard valid(downloaded) else { throw failure("Model checksum failed") }
      try manager.moveItem(at: temporary, to: file)
      bytes = downloaded
    }
    guard let bytes else { throw failure("Model is unavailable") }
    let result = bytes.withUnsafeBytes { raw in
      needle_load(raw.bindMemory(to: UInt8.self).baseAddress, UInt64(bytes.count))
    }
    guard result >= 0 else { throw failure(String(cString: needle_last_error())) }
    model = bytes
  }

  private func transcribe(_ uri: String, language: String) throws -> String {
    guard model != nil else { throw failure("On-device transcription is not ready") }
    guard Self.streamID == nil else { throw failure("A voice stream is already active") }
    guard ["auto", "en", "de", "fr", "es", "it", "nl", "pl"].contains(language) else {
      throw failure("This language needs cloud")
    }
    guard let file = URL(string: uri), file.isFileURL else { throw failure("A local audio file is required") }
    let audio = try Data(contentsOf: file, options: .mappedIfSafe)
    let samples = try wavSamples(audio)
    var text: [String] = []
    for start in stride(from: 0, to: samples.count, by: 480_000) {
      let count = min(480_000, samples.count - start)
      var output = [CChar](repeating: 0, count: 65_536)
      let result = samples.withUnsafeBufferPointer { pcm in
        output.withUnsafeMutableBufferPointer { out in
          if language == "auto" {
            return needle_transcribe(pcm.baseAddress! + start, Int32(count), nil, nil, 0, out.baseAddress, Int32(out.count))
          }
          return language.withCString { lang in
            needle_transcribe(pcm.baseAddress! + start, Int32(count), lang, nil, 0, out.baseAddress, Int32(out.count))
          }
        }
      }
      guard result >= 0 else { throw failure(String(cString: needle_last_error())) }
      let json = Data(String(cString: output).utf8)
      guard let body = try JSONSerialization.jsonObject(with: json) as? [String: Any],
            let transcript = body["text"] as? String else { throw failure("Invalid transcription result") }
      if !transcript.isEmpty { text.append(transcript) }
    }
    return text.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func wavSamples(_ audio: Data) throws -> [Float] {
    let bytes = [UInt8](audio)
    func tag(_ i: Int) -> String { String(bytes: bytes[i..<i + 4], encoding: .ascii) ?? "" }
    func u16(_ i: Int) -> Int { Int(bytes[i]) | Int(bytes[i + 1]) << 8 }
    func u32(_ i: Int) -> Int { u16(i) | u16(i + 2) << 16 }
    guard bytes.count >= 12, tag(0) == "RIFF", tag(8) == "WAVE" else { throw failure("Invalid WAV recording") }
    var offset = 12
    var formatOK = false
    var pcm: Range<Int>?
    while offset + 8 <= bytes.count {
      let size = u32(offset + 4)
      let start = offset + 8
      guard size <= bytes.count - start else { throw failure("Incomplete WAV recording") }
      if tag(offset) == "fmt ", size >= 16 {
        formatOK = u16(start) == 1 && u16(start + 2) == 1 && u32(start + 4) == 16_000 && u16(start + 14) == 16
      } else if tag(offset) == "data" { pcm = start..<start + size }
      offset = start + size + (size & 1)
    }
    guard formatOK, let pcm, pcm.count % 2 == 0 else { throw failure("Expected 16 kHz mono PCM16 WAV") }
    return stride(from: pcm.lowerBound, to: pcm.upperBound, by: 2).map {
      Float(Int16(bitPattern: UInt16(u16($0)))) / 32768
    }
  }
}
