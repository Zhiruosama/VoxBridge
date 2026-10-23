// Isolated macOS feasibility probe. Not wired to the production audio pipeline.
// Build and permission behavior must be checked on a real Mac; see README.md.
import Foundation
import CoreAudio
import AudioToolbox

enum ProbeError: Error, CustomStringConvertible {
    case message(String)
    var description: String { switch self { case .message(let text): return text } }
}

func check(_ status: OSStatus, _ operation: String) throws {
    guard status == noErr else { throw ProbeError.message("\(operation) failed (OSStatus \(status))") }
}

func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

func processObjects() throws -> [AudioObjectID] {
    var property = address(kAudioHardwarePropertyProcessObjectList)
    var size: UInt32 = 0
    try check(AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &property, 0, nil, &size), "Read process count")
    var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard !objects.isEmpty else { return [] }
    try objects.withUnsafeMutableBytes { buffer in
        try check(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &property, 0, nil, &size, buffer.baseAddress!), "Read process objects")
    }
    return objects
}

func processPID(_ object: AudioObjectID) throws -> pid_t {
    var property = address(kAudioProcessPropertyPID)
    var pid: pid_t = 0
    var size = UInt32(MemoryLayout<pid_t>.size)
    try check(AudioObjectGetPropertyData(object, &property, 0, nil, &size, &pid), "Read process PID")
    return pid
}

func bundleID(_ object: AudioObjectID) -> String {
    var property = address(kAudioProcessPropertyBundleID)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value) == noErr,
          let value else { return "unknown" }
    return value.takeRetainedValue() as String
}

func defaultOutputUID() throws -> String {
    var outputProperty = address(kAudioHardwarePropertyDefaultOutputDevice)
    var output = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    try check(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &outputProperty, 0, nil, &size, &output), "Read default output")
    guard output != kAudioObjectUnknown else { throw ProbeError.message("No default output device") }
    var uidProperty = address(kAudioDevicePropertyDeviceUID)
    var uid: Unmanaged<CFString>?
    size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    try check(AudioObjectGetPropertyData(output, &uidProperty, 0, nil, &size, &uid), "Read output UID")
    guard let uid else { throw ProbeError.message("Output device UID is missing") }
    return uid.takeRetainedValue() as String
}

final class Meter: @unchecked Sendable {
    private let lock = NSLock()
    private var energy: Double = 0
    private var samples: Int = 0

    // No waiting, logging, allocation, network or file I/O in the callback.
    func consume(_ input: UnsafePointer<AudioBufferList>) {
        guard lock.try() else { return }
        defer { lock.unlock() }
        for buffer in UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input)) {
            guard let data = buffer.mData else { continue }
            let count = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
            let values = data.assumingMemoryBound(to: Float.self)
            for index in 0..<count { let value = Double(values[index]); energy += value * value }
            samples += count
        }
    }

    func snapshot() -> (Double, Int) {
        lock.lock(); defer { lock.unlock() }
        let result = (samples == 0 ? 0 : sqrt(energy / Double(samples)), samples)
        energy = 0; samples = 0
        return result
    }
}

@available(macOS 14.2, *)
func capture(pid: pid_t, seconds: Double) throws {
    let objects = try processObjects().filter { (try? processPID($0)) == pid }
    guard !objects.isEmpty else { throw ProbeError.message("No Core Audio process for this PID. Play audio and list processes again; a child process may own the stream.") }
    let description = CATapDescription(stereoMixdownOfProcesses: objects)
    description.uuid = UUID()
    description.name = "VoxBridge audio probe"
    description.muteBehavior = .unmuted
    var tap: AudioObjectID = kAudioObjectUnknown
    try check(AudioHardwareCreateProcessTap(description, &tap), "Create process tap (check system audio permission)")
    defer { AudioHardwareDestroyProcessTap(tap) }

    var format = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    var formatProperty = address(kAudioTapPropertyFormat)
    try check(AudioObjectGetPropertyData(tap, &formatProperty, 0, nil, &size, &format), "Read tap format")
    guard format.mFormatID == kAudioFormatLinearPCM,
          format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
          format.mBitsPerChannel == 32 else {
        throw ProbeError.message("Probe supports Float32 PCM only; observed format must be handled before production integration.")
    }

    let outputUID = try defaultOutputUID()
    let configuration: [String: Any] = [
        kAudioAggregateDeviceNameKey: "VoxBridge probe aggregate",
        kAudioAggregateDeviceUIDKey: UUID().uuidString,
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceMainSubDeviceKey: outputUID,
        kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
        kAudioAggregateDeviceTapAutoStartKey: true,
        kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]],
    ]
    var device: AudioObjectID = kAudioObjectUnknown
    try check(AudioHardwareCreateAggregateDevice(configuration as CFDictionary, &device), "Create aggregate device")
    defer { AudioHardwareDestroyAggregateDevice(device) }
    let meter = Meter()
    var ioProc: AudioDeviceIOProcID?
    let queue = DispatchQueue(label: "com.voxbridge.probe.audio", qos: .userInteractive)
    try check(AudioDeviceCreateIOProcIDWithBlock(&ioProc, device, queue) { _, input, _, _, _ in
        meter.consume(input)
    }, "Create audio callback")
    guard let ioProc else { throw ProbeError.message("Audio callback ID is missing") }
    defer { AudioDeviceDestroyIOProcID(device, ioProc) }
    try check(AudioDeviceStart(device, ioProc), "Start capture")
    defer { AudioDeviceStop(device, ioProc) }
    print("Capturing PID \(pid), \(format.mSampleRate) Hz, \(format.mChannelsPerFrame) channels for \(seconds)s. No audio is saved or uploaded.")
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        Thread.sleep(forTimeInterval: 0.25)
        let (rms, count) = meter.snapshot()
        print(String(format: "rms=%.6f samples=%d", rms, count))
    }
}

@main struct AudioProbe {
    static func main() {
        guard #available(macOS 14.2, *) else { fputs("Requires macOS 14.2 or later.\n", stderr); exit(1) }
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            if arguments.first == "list" || arguments.isEmpty {
                print("PID\tCoreAudioID\tBundleID")
                for object in try processObjects() {
                    if let pid = try? processPID(object) { print("\(pid)\t\(object)\t\(bundleID(object))") }
                }
            } else if arguments.first == "capture", arguments.count >= 2, let pid = pid_t(arguments[1]), pid > 0 {
                let seconds = arguments.count > 2 ? Double(arguments[2]) ?? 10 : 10
                guard seconds.isFinite && seconds >= 1 && seconds <= 60 else { throw ProbeError.message("Duration must be between 1 and 60 seconds.") }
                try capture(pid: pid, seconds: seconds)
            } else { throw ProbeError.message("Usage: AudioProbe list | capture <PID> [seconds: 1...60]") }
        } catch { fputs("\(error)\n", stderr); exit(1) }
    }
}
