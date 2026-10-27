import Foundation
import Combine
import Darwin

// Link the real model without an embedded runtime or any USB/RPC executable.
@_cdecl("mac2jb_payload_bytes") func attachmentPayloadBytes() -> UnsafePointer<UInt8>? { nil }
@_cdecl("mac2jb_payload_size") func attachmentPayloadSize() -> UInt { 0 }
enum EmbeddedPayloadMetadata { static let sha256 = "unused-fixture" }

@MainActor final class AttachmentFixture {
    let base: URL
    let root: URL
    let source: URL
    let model: SessionModel
    init(host: HostProfile = .bermTheSequel, edition: SmileBASICEdition = .full, addressProvider: @escaping () -> [NetworkAddress] = { [] }) throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("mac2jb-attachment-fixture-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        guard let canonical = realpath(temporary.path, nil) else {throw POSIXError(.EIO)}
        base = URL(fileURLWithPath: String(cString: canonical), isDirectory: true)
        free(canonical)
        root = base.appendingPathComponent("runtime")
        source = base.appendingPathComponent("original-host/runs/switch2-fixture")
        for url in [root, source] { try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        try Data("{\"id\":\"\(host.rawValue)\"}".utf8).write(to: root.appendingPathComponent("selected-host.json"))
        let worker = #"""
        #!/bin/sh
        case "$1" in */scripts/gui-attach.cjs) ;; *) exit 88 ;; esac
        printf '%s\n' "$*" >> invocations
        printf '%s\n' "$$" > fixture-pid
        emit_events() { if [ -f "$1" ]; then while IFS= read -r line; do printf '%s\n' "$line"; done < "$1"; fi; }
        gate() {
          n=0
          while [ ! -f "$1" ] && [ "$n" -lt 500 ]; do /bin/sleep 0.01; n=$((n + 1)); done
          [ -f "$1" ] || exit 9
        }
        trap 'exit 143' TERM
        IFS= read -r control || exit 7
        printf '%s\n' "$control" >> controls
        emit_events pre-events
        : > pre-events-sent
        gate release-attach
        if [ -f unproven ]; then printf '%s\n' '{"type":"verified"}'; exit 0; fi
        emit_events attached-event
        while IFS= read -r control; do
          printf '%s\n' "$control" >> controls
          case "$control" in
            *'"action":"rpc-status"'*) printf '%s\n' '{"type":"rpc-status","ready":true,"message":"Fixture RPC connected."}' ;;
            *'"action":"launch-gpubrewlauncher"'*|*'"action":"launch-hblauncher"'*|*'"action":"launch-izlauncher"'*)
              printf '%s\n' '{"type":"homebrew-started"}' '{"type":"homebrew-running","message":"Inert app running."}' ;;
            *'"action":"finish"'*)
              printf '%s\n' '{"type":"homebrew-stopped"}' '{"type":"verified"}' '{"type":"rpc-finishing"}'
              emit_events premature-detach
              : > finish-received
              gate release-detach
              emit_events detached-event
              : > detached-event-sent
              gate release-exit
              code=0
              if [ -f exit-code ]; then read -r code < exit-code; fi
              exit "$code" ;;
            *) printf '%s\n' '{"type":"action-rejected"}' ;;
          esac
        done
        exit 8
        """#
        let executable = root.appendingPathComponent("node")
        try Data(worker.utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        model = SessionModel(addressProvider: addressProvider, runtime: BundledRuntime(root: root), edition: edition)
        model.phase = .ready; model.driverLoaded = false
        model.existingRPCRunPath = source.path
        try eventFile("attached-event", type: "rpc-attached")
        try eventFile("detached-event", type: "rpc-detached")
    }
    func put(_ file: String, _ value: String = "") throws {try Data(value.utf8).write(to: root.appendingPathComponent(file))}
    func eventFile(_ file: String, type: String, path: String? = nil, session: String? = nil) throws {
        let event: [String: Any] = ["type": type, "path": path ?? source.path, "sourceSession": session ?? source.lastPathComponent]
        let data = try JSONSerialization.data(withJSONObject: event)
        try put(file, String(decoding: data, as: UTF8.self) + "\n")
    }
    func exists(_ file: String) -> Bool {FileManager.default.fileExists(atPath: root.appendingPathComponent(file).path)}
    var controls: [[String: Any]] {
        let text = (try? String(contentsOf: root.appendingPathComponent("controls"), encoding: .utf8)) ?? ""
        return text.split(separator: "\n").compactMap {try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]}
    }
    var invocations: [String] {
        ((try? String(contentsOf: root.appendingPathComponent("invocations"), encoding: .utf8)) ?? "").split(separator: "\n").map(String.init)
    }
    func dispose() {
        if model.hasLiveWorkers, let text = try? String(contentsOf: root.appendingPathComponent("fixture-pid"), encoding: .utf8),
           let pid = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)), pid > 1 { _ = kill(pid, SIGKILL) }
        if let log = model.diagnosticLogURL, log.deletingLastPathComponent().lastPathComponent.hasPrefix("mac2jb-gui-error-") {
            try? FileManager.default.removeItem(at: log.deletingLastPathComponent())
        }
        try? FileManager.default.removeItem(at: base)
    }
}

@main @MainActor struct ExistingRPCModelTests {
    static var checks = 0
    static func check(_ condition: @autoclosure () -> Bool, _ message: String) {precondition(condition(), message); checks += 1}
    static func until(_ message: String, _ predicate: @escaping @MainActor () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(5)
        while !predicate() && Date() < deadline {try await Task.sleep(nanoseconds: 10_000_000)}
        check(predicate(), "Timed out: " + message)
    }
    static func main() async throws {
        check(!HostProfile.pepsipu.supportsHeldRPC && !HostProfile.pepsipu.supportsDemo && HostProfile.pepsipu.startArgumentCount == 9,
              "pepsipu capabilities preserve its nine-argument bootstrap and no held endpoint")
        check(HostProfile.kurumuz.supportsHeldRPC && !HostProfile.kurumuz.supportsDemo && HostProfile.kurumuz.startArgumentCount == 5,
              "kurumuz exposes held RPC but not unsupported demo mode")
        check(HostProfile.bermTheSequel.supportsHeldRPC && HostProfile.bermTheSequel.supportsDemo && HostProfile.bermTheSequel.startArgumentCount == 5,
              "BermTheSequel retains held RPC and demo support")
        let five = "V=START(39380,192,0,2,42)", nine = "V=START(39380,192,0,2,42,1,2,3,281474976710655)"
        check(PostBootstrapCommandSelection.validStartCommand(nine, host: .pepsipu) && !PostBootstrapCommandSelection.validStartCommand(five, host: .pepsipu),
              "pepsipu validates the exact nine-value START including token values")
        for host in [HostProfile.kurumuz, .bermTheSequel] {
            check(PostBootstrapCommandSelection.validStartCommand(five, host: host) && !PostBootstrapCommandSelection.validStartCommand(nine, host: host),
                  "five-value hosts reject a different bootstrap command shape")
        }
        for command in ["V=START(39380,192,0,2,42,1,2,3,281474976710656)", "V=START(39380,192,0,2,256,1,2,3,4)",
                        "V=START(39380,192,0,2,42,01,2,3,4)", "V=START(39380,192,0,2,42,1,2,3,4);RUN"] {
            check(!PostBootstrapCommandSelection.validStartCommand(command, host: .pepsipu), "nine-value START remains bounded and canonical")
        }
        let unsupported = try AttachmentFixture(host: .pepsipu)
        defer {unsupported.dispose()}
        check(unsupported.model.selectedHost == .pepsipu && unsupported.model.runMode == .exploitOnly && !unsupported.model.canAttachExistingRPC,
              "runtime profile capability prevents unsupported attachment")
        unsupported.model.attachExistingRPC(); unsupported.model.startHostOnly(keepRPC: true); unsupported.model.selectRunMode(.existingRPC)
        check(!unsupported.model.hasLiveWorkers && unsupported.invocations.isEmpty && unsupported.model.runMode == .exploitOnly,
              "unsupported held workflows never spawn a worker")

        for (launcher, action, edition) in [("GPUBrewLauncher", "launch-gpubrewlauncher", SmileBASICEdition.full), ("HBLauncher", "launch-hblauncher", .full), ("IZlauncher", "launch-izlauncher", .full), ("IZlauncher", "launch-izlauncher", .demo)] {
        var addressReads = 0
        let fixture = try AttachmentFixture(edition: edition, addressProvider: {addressReads += 1; return []})
        defer {fixture.dispose()}
        let model = fixture.model
        for bad in ["", "relative/run", "/run\nother", "/run\0other"] {
            model.existingRPCRunPath = bad; check(!model.canAttachExistingRPC, "invalid local selection disables attach")
            model.attachExistingRPC(); check(!model.hasLiveWorkers, "invalid local selection launches nothing")
        }
        model.existingRPCRunPath = fixture.source.path; model.keyDelayMs = 0
        check(model.canAttachExistingRPC && !model.driverLoaded, "existing RPC does not require USB driver or typing settings")
        model.selectRunMode(.existingRPC); model.start()
        check(!model.hasLiveWorkers && fixture.invocations.isEmpty, "ordinary Start never launches an exploit for existing RPC")
        try fixture.eventFile("pre-events", type: "rpc-attached", path: fixture.source.deletingLastPathComponent().path, session: fixture.source.lastPathComponent)
        let wrongPath = try String(contentsOf: fixture.root.appendingPathComponent("pre-events"), encoding: .utf8)
        try fixture.eventFile("pre-events", type: "rpc-attached", session: "wrong-session")
        let wrongSession = try String(contentsOf: fixture.root.appendingPathComponent("pre-events"), encoding: .utf8)
        try fixture.put("pre-events", wrongPath + wrongSession + "{\"type\":\"verified\"}\n")
        model.attachExistingRPC()
        check(model.phase == .rpcAttaching && model.isAttachedRPCSession && model.hasLiveWorkers && !model.canLaunchHomebrew,
              "attach starts only the verification supervisor and keeps homebrew gated")
        try await until("inert attachment received input") {fixture.exists("pre-events-sent")}
        try await Task.sleep(nanoseconds: 30_000_000)
        check(model.phase == .rpcAttaching && !model.canLaunchHomebrew && !model.canChangeHost,
              "wrong source path, wrong session and verified cannot authorize attachment")
        check(addressReads == 0 && model.activeAddress.isEmpty && fixture.invocations.count == 1 && fixture.invocations[0].hasSuffix("scripts/gui-attach.cjs"),
              "existing RPC never discovers network addresses or invokes a USB/exploit host")
        let attach = fixture.controls.first!
        let connection = attach["connection"] as! [String: Any]
        check(attach["action"] as? String == "attach" && connection["kind"] as? String == "local" && connection["runDirectory"] as? String == fixture.source.path,
              "the supervisor receives only the explicit local source selection")
        try fixture.put("release-attach")
        try await until("verified attachment enables homebrew") {model.phase == .rpcHeld && model.canLaunchHomebrew}
        check(model.postRun.heldConfirmed && model.activeSessionSupportsHomebrew && !model.canStartKeyboard,
              "a live verified attachment enters held homebrew state without keyboard ownership")
        model.checkRPCStatus()
        try await until("local status response") {!model.postRun.statusInFlight && model.rpcStatus.contains("connected")}
        if action == "launch-hblauncher" { model.launchHBLauncher() } else if action == "launch-izlauncher" { model.launchIZlauncher() } else { model.launchGPUBrewLauncher() }
        try await until("attached GPU launcher runs") {model.phase == .homebrewRunning}
        check(model.homebrewTitle == launcher,
              "attached RPC forwards the selected launcher identity")
        if action == "launch-izlauncher" {
            check(fixture.controls.first { $0["action"] as? String == action }?.count == 1 && model.activeEdition == edition && model.activeHost == .bermTheSequel,
                  "attached IZlauncher preserves the current Berm host and full or demo edition")
        }
        model.launchGPUBrewLauncher(); model.launchHBLauncher(); model.launchIZlauncher(); model.attachExistingRPC()
        check(!model.canLaunchHomebrew && fixture.invocations.count == 1, "one live supervisor owns the sole app attempt")
        try fixture.eventFile("premature-detach", type: "rpc-detached", session: "wrong-session")
        model.finishPostRun()
        try await until("local finish request") {fixture.exists("finish-received")}
        try await Task.sleep(nanoseconds: 30_000_000)
        check(model.phase == .rpcFinishing && model.hasLiveWorkers && !model.canReturnToStart,
              "verified and wrong-session detach cannot replace owned-worker shutdown")
        try fixture.put("release-detach")
        try await until("correct detach proof") {fixture.exists("detached-event-sent")}
        try await Task.sleep(nanoseconds: 30_000_000)
        check(model.hasLiveWorkers && !model.canReturnToStart, "correct detach proof cannot permit a new session while the supervisor still drains")
        try fixture.put("release-exit")
        try await until("detached supervisor exit") {!model.hasLiveWorkers}
        check(model.phase == .rpcDetached && model.canReturnToStart && model.postRun.stage != .complete && model.workflowProgress.state(for: 2) != .complete,
              "drained local attachment becomes detached without claiming original exploit cleanup")
        check(fixture.controls.filter {$0["action"] as? String == action}.count == 1 &&
              fixture.controls.filter {($0["action"] as? String)?.hasPrefix("launch-") == true}.count == 1 &&
              fixture.controls.filter {$0["action"] as? String == "finish"}.count == 1,
              "duplicate app and finish operations are never replayed")
        model.returnToStart(); check(model.phase == .ready && !model.hasLiveWorkers, "detachment returns to the start screen after drain")
        }

        for badExit in [false, true] {
            let bad = try AttachmentFixture(); defer {bad.dispose()}
            if !badExit {try bad.put("unproven")}
            bad.model.attachExistingRPC(); try bad.put("release-attach")
            if badExit {
                try await until("attach for failed detach") {bad.model.phase == .rpcHeld}
                try bad.put("exit-code", "1\n"); try bad.put("release-detach"); try bad.put("release-exit")
                bad.model.finishPostRun()
            }
            try await until("unproven or failed supervisor exit") {!bad.model.hasLiveWorkers}
            check(bad.model.phase == .failed && !bad.model.canReturnToStart && !bad.model.canLaunchHomebrew,
                  "verified-only or nonzero detach exit cannot become successful detachment")
        }
        print("Existing local RPC attachment and host-profile model checks passed: \(checks). No USB, RPC, driver or account operations ran.")
    }
}
