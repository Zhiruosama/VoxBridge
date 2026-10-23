import AudioToolbox
import CoreAudio
// Explicit virtual-device-only diagnostics. Never opens a physical microphone.
import Foundation

func addr(
  _ selector: AudioObjectPropertySelector,
  _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(
    mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}
func check(_ status: OSStatus) { if status != 0 { fatalError("CoreAudio status \(status)") } }
func str(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String {
  var a = addr(selector)
  var s = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  var v: Unmanaged<CFString>?
  check(AudioObjectGetPropertyData(id, &a, 0, nil, &s, &v))
  return v!.takeRetainedValue() as String
}
var a = addr(kAudioHardwarePropertyDevices)
var size: UInt32 = 0
check(AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size))
var devices = [AudioObjectID](repeating: 0, count: Int(size) / 4)
check(
  AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &devices))
var target: AudioObjectID = 0
for id in devices {
  let uid = str(id, kAudioDevicePropertyDeviceUID)
  print("\(id) \(str(id,kAudioObjectPropertyName)) \(uid)")
  if uid == "com.voxbridge.audio.device" { target = id }
}
guard target != 0 else { fatalError("VoxBridge missing") }
let tone = CommandLine.arguments.contains("--tone")
if !tone && !CommandLine.arguments.contains("--listen") { exit(0) }
var rate = 0.0
a = addr(kAudioDevicePropertyNominalSampleRate)
size = 8
check(AudioObjectGetPropertyData(target, &a, 0, nil, &size, &rate))
final class State: @unchecked Sendable {
  let lock = NSLock()
  var written = 0
  var read = 0
  var nonzero = 0
  var peak: Float = 0
  var energy: Double = 0
  var capture = [Float](
    repeating: 0, count: CommandLine.arguments.contains("--record") ? 48000 * 2 * 16 : 0)
  var firstIn: Double = 0
  var firstOut: Double = 0
  func io(
    _ input: UnsafePointer<AudioBufferList>, _ inputTime: UnsafePointer<AudioTimeStamp>,
    _ output: UnsafeMutablePointer<AudioBufferList>, _ outputTime: UnsafePointer<AudioTimeStamp>,
    _ rate: Double
  ) {
    guard lock.try() else { return }
    defer { lock.unlock() }
    if read == 0 { firstIn = inputTime.pointee.mSampleTime }
    if written == 0 { firstOut = outputTime.pointee.mSampleTime }
    for b in UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input)) {
      guard let d = b.mData else { continue }
      let p = d.assumingMemoryBound(to: Float.self)
      for i in 0..<Int(b.mDataByteSize) / 4 {
        let v = p[i]
        if v.isFinite {
          if read < capture.count { capture[read] = v }
          read += 1
          energy += Double(v * v)
          peak = max(peak, abs(v))
          if abs(v) > 0.001 { nonzero += 1 }
        }
      }
    }
    for b in UnsafeMutableAudioBufferListPointer(output) {
      guard let d = b.mData else { continue }
      let p = d.assumingMemoryBound(to: Float.self)
      let channels = max(1, Int(b.mNumberChannels))
      let frames = Int(b.mDataByteSize) / 4 / channels
      for f in 0..<frames {
        let v: Float =
          tone
          ? Float(sin(2 * Double.pi * 440 * (outputTime.pointee.mSampleTime + Double(f)) / rate))
            * 0.1 : 0
        for c in 0..<channels { p[f * channels + c] = v }
      }
      written += frames
    }
  }
}
let state = State()
var proc: AudioDeviceIOProcID?
check(
  AudioDeviceCreateIOProcIDWithBlock(&proc, target, DispatchQueue(label: "voxbridge.virtual.probe"))
  { _, input, tIn, output, tOut in state.io(input, tIn, output, tOut, rate) })
check(AudioDeviceStart(target, proc))
Thread.sleep(forTimeInterval: tone ? 3 : 15)
check(AudioDeviceStop(target, proc))
check(AudioDeviceDestroyIOProcID(target, proc!))
print(
  "rate=\(rate) written=\(state.written) read=\(state.read) nonzero=\(state.nonzero) peak=\(state.peak) rms=\(sqrt(state.energy/Double(max(1,state.read)))) firstInput=\(state.firstIn) firstOutput=\(state.firstOut)"
)
if state.nonzero == 0 { exit(2) }

if CommandLine.arguments.contains("--record") {
  // Only this device's synthetic loopback; write after IO has stopped.
  var wav = Data()
  func text(_ value: String) { wav.append(contentsOf: value.utf8) }
  func u16(_ value: UInt16) {
    var v = value.littleEndian
    withUnsafeBytes(of: &v) { wav.append(contentsOf: $0) }
  }
  func u32(_ value: UInt32) {
    var v = value.littleEndian
    withUnsafeBytes(of: &v) { wav.append(contentsOf: $0) }
  }
  let samples = Array(state.capture.prefix(min(state.read, state.capture.count)))
  text("RIFF")
  u32(UInt32(36 + samples.count * 4))
  text("WAVEfmt ")
  u32(16)
  u16(3)
  u16(2)
  u32(UInt32(rate))
  u32(UInt32(rate) * 8)
  u16(8)
  u16(32)
  text("data")
  u32(UInt32(samples.count * 4))
  samples.withUnsafeBytes { wav.append(contentsOf: $0) }
  try wav.write(to: URL(fileURLWithPath: "native/macos/.build/mic-speech-capture.wav"))
}
