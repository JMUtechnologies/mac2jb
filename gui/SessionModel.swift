import AppKit
import Combine
import Darwin
import Foundation

struct NetworkAddress: Identifiable, Hashable {
    let address: String
    let interface: String
    var id: String { "\(interface):\(address)" }
    var label: String { "\(address) · \(interface)" }
}

private struct GUIEvent: Decodable {
    let type: String
    let message: String?
    let kind: String?
    let path: String?
    let rpcCommand: String?
    let completed: Double?
    let total: Double?
    let partial: Bool?
    let step: Int?
    let line: Int?
    let label: String?
    let remainingMs: Double?
    let durationMs: Double?
    let watchProgress: StremioWatchProgress?
}

@MainActor final class SessionModel: ObservableObject {
    @Published var phase: SessionPhase = .preparing
    @Published private(set) var workflowProgress = WorkflowProgress()
    @Published var status = "Preparing the bundled tools"
    @Published var detail = "No system tools or downloads are needed."
    @Published var log = ""
    @Published private(set) var hostLog = ""
    @Published private(set) var usbLog = ""
    @Published var progress: Double?
    @Published var progressLabel = ""
    @Published private(set) var bootstrapElapsedSeconds: Double = 0
    @Published private(set) var bootstrapEstimatedRemainingSeconds: Double?
    @Published var isEnumerating = false
    @Published var addresses: [NetworkAddress] = []
    @Published var selectedAddress = ""
    @Published var controller = "auto"
    @Published private(set) var runMode: SessionRunMode = .exploitOnly
    @Published private(set) var activeRunMode: SessionRunMode = .exploitOnly
    var fullInstall: Bool { runMode == .bootstrapOnly }
    @Published var keyDelayMs = 50
    @Published var enumerationTimeoutSeconds = 4
    @Published var loadWaitMs = 3000
    @Published var runWaitMs = 3000
    @Published var removeWaitMs = 3000
    @Published var loadConfirmWaitMs = 1000
    @Published var driverStatus = "Checking the USB gadget driver…"
    @Published var driverInstalled = false
    @Published var driverLoaded = false
    @Published var driverSetupRunning = false
    @Published var error: String?
    @Published private(set) var diagnosticLogURL: URL?
    @Published private(set) var postRun = PostRunSessionState()
    @Published private(set) var rpcCommand = ""
    @Published private(set) var rpcStatus = ""
    @Published private(set) var dumpFolder: URL?
    @Published private(set) var homebrewMessage = ""
    @Published private(set) var homebrewFolder: URL?
    @Published private(set) var homebrewTitle = "HBLauncher v0.2.0"
    @Published var stremioAddonURL = ""
    var accountProgressHandler: ((StremioWatchProgress) -> Void)?
    var stremioToolsAvailable: Bool {
        FileManager.default.isExecutableFile(atPath: "/Applications/Stremio.app/Contents/MacOS/ffmpeg") &&
        FileManager.default.isExecutableFile(atPath: "/Applications/Stremio.app/Contents/MacOS/ffprobe")
    }
    private(set) var runtime: BundledRuntime?
    @Published private var hostProcess: Process?
    private var hostInput: Pipe?
    @Published private var hidProcess: Process?
    private var preparing = false
    private var hostCompleted = false
    private var generation = UUID()
    private var runFolder: URL?
    private var sessionLog: FileHandle?
    private var hostSessionLog: FileHandle?
    private var usbSessionLog: FileHandle?
    private var sessionActivity: NSObjectProtocol?
    private var hostStageLabel = "Waiting for the Switch to connect over the local network"
    private var hostStageProgress: Double?
    private var bootstrapStartedAt: Date?
    private var bootstrapTimer: Timer?
    private var hasEnumeratedSuccessfully = false

    var isBusy: Bool {
        [.preparing, .bootstrap, .hostStarting, .commands, .waitingForConsole,
         .rpcHeld, .dumpingFirmware, .rpcFinishing, .launchingHomebrew, .homebrewRunning, .homebrewStopped].contains(phase)
    }

    var hasLiveWorkers: Bool { hostProcess != nil || hidProcess != nil }
    var canLaunchHomebrew: Bool {
        phase == .rpcHeld && activeRunMode == .heldRPC && postRun.canLaunchHomebrew &&
        hostProcess?.isRunning == true && hostInput != nil && runFolder != nil
    }
    var canReturnToStart: Bool { phase == .verified && !hasLiveWorkers && !driverSetupRunning }

    func returnToStart() {
        guard canReturnToStart else { return }
        endSessionActivity()
        phase = .ready; status = "Ready for a fresh session"
        detail = "Restart the console before another exploit attempt, then choose your next run mode."
        progress = nil; progressLabel = ""; error = nil
    }

    func selectRunMode(_ mode: SessionRunMode) {
        guard !isBusy, phase != .awaitingSave, !hasLiveWorkers, !driverSetupRunning else { return }
        runMode = mode
        workflowProgress.selectMode(fullInstall: mode == .bootstrapOnly)
    }

    var canRestartForUpdate: Bool {
        !isBusy && phase != .awaitingSave && !driverSetupRunning && hostProcess == nil && hidProcess == nil
    }

    var shouldShowFirstTimeFooter: Bool {
        !hasEnumeratedSuccessfully && [.preparing, .ready, .failed, .cancelled].contains(phase)
    }

    func prepare() {
        guard !preparing, runtime == nil else { return }
        preparing = true
        refreshChecks()
        Task {
            defer { preparing = false }
            do {
                let override = ProcessInfo.processInfo.environment["MAC2JB_SESSION_PARENT"].flatMap {
                    $0.isEmpty ? nil : URL(fileURLWithPath: $0, isDirectory: true)
                }
                let prepared = try await Task.detached(priority: .userInitiated) {
                    try BundledRuntime.prepare(sessionParent: override)
                }.value
                runtime = prepared
                openSessionLog(in: prepared.root)
                append("Offline runtime prepared. Session files are private to your account.")
                // Keep a successfully prepared runtime available for retry,
                // but never undo a cancellation while extraction was running.
                guard phase == .preparing else { return }
                phase = .ready
                status = "Ready when you are"
                detail = "Choose your Mac’s address on the same network as the Switch."
            } catch {
                let message = "Could not prepare the bundled runtime: \(error.localizedDescription)"
                if phase == .preparing { fail(message) }
                else { append(message) }
            }
        }
    }

    func refreshChecks() {
        addresses = Self.localAddresses()
        if !addresses.contains(where: { $0.address == selectedAddress }) {
            selectedAddress = addresses.first?.address ?? ""
        }
        driverInstalled = FileManager.default.fileExists(atPath: "/Library/Extensions/usbgadget.kext")
        driverStatus = driverInstalled ? "Driver installed; checking loaded status…" : "Driver not found in /Library/Extensions"
        Task {
            let installed = driverInstalled
            let result = await Task.detached { Self.capture("/usr/bin/kmutil", ["showloaded", "--list-only"]) }.value
            if result.0 == 0 {
                driverLoaded = result.1.contains("gay.bowser.usbgadget") || result.1.contains("usbgadget")
                driverStatus = driverLoaded
                    ? "USB gadget driver is loaded"
                    : (installed ? "Driver installed; not reported as loaded" : "USB gadget driver not reported as loaded")
            } else {
                driverLoaded = false
                driverStatus = installed ? "Driver installed; loaded status could not be verified" : "Driver installation and loaded status need checking"
            }
            let marker = "/Library/Extensions/.mac2jb-usbgadget-restart-required"
            if let attributes = try? FileManager.default.attributesOfItem(atPath: marker),
               let modified = attributes[.modificationDate] as? Date,
               modified > Date().addingTimeInterval(-ProcessInfo.processInfo.systemUptime) {
                driverLoaded = false
                driverStatus = "Driver installed — restart this Mac before starting a session"
            }
        }
    }

    func start() {
        guard !driverSetupRunning else { return }
        guard !isBusy, phase != .awaitingSave, hostProcess == nil, hidProcess == nil, let runtime else { return }
        guard driverLoaded else { fail("Install/load the USB driver, complete any required restart, then refresh the driver check."); return }
        if runMode.requiresHost {
            guard Self.isIPv4(selectedAddress), addresses.contains(where: { $0.address == selectedAddress }) else {
                fail("Choose a current LAN IPv4 address for this Mac, then refresh checks.")
                return
            }
        }
        guard (1...2000).contains(keyDelayMs), (1...120).contains(enumerationTimeoutSeconds),
              [loadWaitMs, runWaitMs, removeWaitMs, loadConfirmWaitMs].allSatisfy({ (0...120000).contains($0) }) else {
            fail("Use 1–2000 ms per key, 1–120 seconds for enumeration, and 0–120000 ms for each command wait.")
            return
        }
        activeRunMode = runMode
        workflowProgress.begin(fullInstall: activeRunMode == .bootstrapOnly)
        // Keep the Mac awake through typing, the save checkpoint, and host
        // verification. This assertion is scoped to this session only.
        endSessionActivity()
        sessionActivity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .idleSystemSleepDisabled],
            reason: "Completing the mac2jb USB and console session")
        generation = UUID()
        error = nil; progress = nil; progressLabel = ""; isEnumerating = false; hostCompleted = false; runFolder = nil
        postRun = PostRunSessionState(); rpcCommand = ""; rpcStatus = ""; dumpFolder = nil
        homebrewMessage = ""; homebrewFolder = nil; homebrewTitle = "HBLauncher v0.2.0"
        hasEnumeratedSuccessfully = false
        resetBootstrapTiming()
        hostStageLabel = "Waiting for the Switch to connect over the local network"
        hostStageProgress = nil
        append("\(AppBuildIdentity.diagnosticLabel); mode=\(activeRunMode.rawValue); controller=\(controller); address=\(selectedAddress); keyDelayMs=\(keyDelayMs); enumerationTimeoutSeconds=\(enumerationTimeoutSeconds); loadConfirmWaitMs=\(loadConfirmWaitMs); loadWaitMs=\(loadWaitMs); runWaitMs=\(runWaitMs); removeWaitMs=\(removeWaitMs). Starting \(activeRunMode.title).")
        if activeRunMode == .bootstrapOnly { startHID("bootstrap", root: runtime.root) }
        else { startHost(root: runtime.root) }
    }

    func finishBootstrapOnly() {
        guard phase == .awaitingSave, activeRunMode == .bootstrapOnly, !hasLiveWorkers else { return }
        workflowProgress.bootstrapOnlySaved()
        endSessionActivity()
        phase = .ready; status = "Bootstrap saved"
        detail = "NS2 is saved in slot 0. Choose an exploit mode when you are ready to start a fresh console session."
        progress = nil; progressLabel = ""
        append("Bootstrap-only workflow finished after the save checkpoint. No host was started.")
    }

    func cancel() {
        // Quit also calls cancel, so release the assertion even if the phase
        // has already moved to a terminal state.
        if hostProcess == nil { endSessionActivity() }
        guard isBusy || phase == .awaitingSave else { return }
        // Remember the active step before replacing its phase with cancelled.
        let recovery = SessionRecovery.message("Session stopped.", interruptedPhase: phase)
        workflowProgress.cancel()
        detail = recovery
        phase = .cancelled; progress = nil; progressLabel = ""; isEnumerating = false
        status = "Session stopped"
        error = nil
        postRun.stop()
        append("Stop requested. Only this app’s worker processes are being stopped.")
        appendBootstrapDuration(outcome: "cancelled")
        stopWorkers()
    }

    func revealSessionFolder() {
        guard let folder = runtime?.root ?? diagnosticLogURL?.deletingLastPathComponent() else { return }
        NSWorkspace.shared.open(folder)
    }

    func revealRunFolder() {
        if let folder = runFolder ?? runtime?.root { NSWorkspace.shared.open(folder) }
    }

    func revealDumpFolder() { if let dumpFolder { NSWorkspace.shared.open(dumpFolder) } }

    func revealHomebrewLogs() {
        if let folder = homebrewFolder ?? runFolder { NSWorkspace.shared.open(folder) }
    }

    func launchHomebrew(stremio: Bool = false,
                        accountAddons: [String] = [], libraryItems: [[String: Any]] = []) {
        guard canLaunchHomebrew, !stremio || stremioToolsAvailable else { return }
        var control: [String: Any] = ["action": stremio ? "launch-stremio" : "launch-hblauncher"]
        if stremio {
            let value = stremioAddonURL.trimmingCharacters(in: .whitespacesAndNewlines)
            guard accountAddons.count <= 32, libraryItems.count <= 500 else { return }
            control["addonUrls"] = value.isEmpty ? accountAddons : [value]
            control["libraryItems"] = libraryItems
        }
        guard sendHostControl(control) else { return }
        homebrewTitle = stremio ? "Stremio · experimental" : "HBLauncher v0.2.0"
        postRun.launchHomebrew()
        homebrewMessage = "Starting \(homebrewTitle) in the current held session…"
        presentPostRunState()
    }

    func copyRPCCommand() {
        guard !rpcCommand.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(rpcCommand, forType: .string)
    }

    func finishPostRun() {
        guard postRun.canFinish, sendHostControl(["action": "finish"]) else { return }
        postRun.finish()
        presentPostRunState()
    }

    func checkRPCStatus() {
        guard postRun.canCheckStatus, sendHostControl(["action": "rpc-status"]) else { return }
        postRun.checkStatus(); rpcStatus = "Checking RPC…"
    }

    private func sendHostControl(_ value: [String: Any]) -> Bool {
        guard let hostProcess, hostProcess.isRunning, let hostInput else {
            fail("The live host is no longer available. Keep the logs and restart the console before another attempt.")
            return false
        }
        do {
            var data = try JSONSerialization.data(withJSONObject: value)
            guard data.count <= 4 * 1024 * 1024 else {
                fail("The player configuration is too large. Reduce the imported library or add-on configuration.")
                return false
            }
            data.append(10)
            try hostInput.fileHandleForWriting.write(contentsOf: data)
            return true
        } catch {
            fail("Could not send the session action to the host: \(error.localizedDescription)")
            return false
        }
    }

    private func presentPostRunState() {
        isEnumerating = false
        switch postRun.stage {
        case .held:
            switch postRun.homebrewStage {
            case .idle:
                phase = .rpcHeld; status = "RPC is open"
                detail = "Keep SmileBASIC open and the computer awake. Finish the session to release the live endpoint and verify cleanup."
                progress = 1; progressLabel = "4/4 verified · original instructions restored · RPC held"
            case .launching:
                phase = .launchingHomebrew; status = "Starting \(homebrewTitle)"
                detail = "This app uses the current verified held RPC session. Keep SmileBASIC open while it starts."
                progress = nil; progressLabel = homebrewMessage
            case .running:
                phase = .homebrewRunning; status = "\(homebrewTitle) is running"
                detail = "Finish session stops the homebrew video, audio and services before releasing the held endpoint and verifying cleanup."
                progress = nil; progressLabel = homebrewMessage
            case .stopped, .failed:
                phase = .homebrewStopped; status = postRun.homebrewStage == .failed ? "\(homebrewTitle) needs attention" : "\(homebrewTitle) stopped"
                detail = "Keep the logs, finish this session, then restart the console before another attempt. The homebrew app cannot be retried in this session."
                progress = nil; progressLabel = homebrewMessage
            }
        case .dumping:
            phase = .dumpingFirmware; status = "Dumping system code"
            detail = "Keep SmileBASIC open. The live session is reading installed system code; stopping may leave a partial dump."
            progress = nil; progressLabel = "System-code dump in progress"
        case .finishing:
            phase = .rpcFinishing; status = "Finishing the session"
            detail = "Wait while the host releases the endpoint and verifies final cleanup. Keep SmileBASIC open."
            progress = nil; progressLabel = "Waiting for final cleanup verification"
        default: break
        }
    }

    private func sessionURL(_ path: String?) -> URL? {
        guard let path, let runtime else { return nil }
        let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        guard url.path.hasPrefix(runtime.root.resolvingSymlinksInPath().path + "/") else { return nil }
        return url
    }

    func clearLog() { log = "" }

    func recordDiagnostic(_ message: String) { append(message) }

    private func startHost(root: URL) {
        guard let arguments = activeRunMode.hostArguments(address: selectedAddress) else {
            fail("Choose an exploit mode to start a host session.")
            return
        }
        phase = .hostStarting; status = "Starting a fresh ns2jb host"
        detail = "The Mac and Switch must be on the same local network. Allow incoming connections if macOS asks."
        progress = nil
        progressLabel = "Starting the host on \(selectedAddress)"; isEnumerating = false
        launch(arguments: arguments, role: "host", root: root)
    }

    private func startHID(_ kind: String, root: URL) {
        phase = kind == "bootstrap" ? .bootstrap : .commands
        status = kind == "bootstrap" ? "Connecting the USB keyboard" : "Sending the four commands"
        detail = kind == "bootstrap" ? "Keep Make a Program open until the entire bootstrap has finished typing. Using \(keyDelayMs) ms per key." : "Keep Direct mode focused. Using \(keyDelayMs) ms per key. The expected Out of memory message after REMOVE is normal."
        progress = 0; progressLabel = "Waiting for the USB keyboard"; isEnumerating = true
        launch(arguments: ["hid", kind, controller, String(keyDelayMs),
            "--enumeration-timeout", String(enumerationTimeoutSeconds),
            "--load-wait-ms", String(loadWaitMs), "--run-wait-ms", String(runWaitMs),
            "--remove-wait-ms", String(removeWaitMs), "--load-confirm-wait-ms", String(loadConfirmWaitMs)], role: "hid", root: root)
    }

    private func launch(arguments: [String], role: String, root: URL) {
        let process = Process()
        process.executableURL = root.appendingPathComponent("node")
        process.arguments = [root.appendingPathComponent("scripts/gui-host.cjs").path] + arguments
        process.currentDirectoryURL = root
        if role == "host" {
            let input = Pipe()
            _ = fcntl(input.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1)
            hostInput = input; process.standardInput = input
        } else { process.standardInput = FileHandle.nullDevice }
        let output = Pipe(); let stderr = Pipe()
        process.standardOutput = output; process.standardError = stderr
        let currentGeneration = generation
        if role == "host" { hostProcess = process } else { hidProcess = process }
        do { try process.run() }
        catch {
            if role == "host" { hostProcess = nil; hostInput = nil } else { hidProcess = nil }
            fail("Could not launch the bundled tool: \(error.localizedDescription)")
            return
        }
        // Read until EOF before processing termination: buffered enumeration or
        // failure messages must not be overtaken by the child-exit callback.
        Task.detached(priority: .userInitiated) { [weak self] in
            let stderrTask = Task.detached { stderr.fileHandleForReading.readDataToEndOfFile() }
            var pending = Data()
            while true {
                let chunk = output.fileHandleForReading.availableData
                if chunk.isEmpty { break }
                pending.append(chunk)
                while let newline = pending.firstIndex(of: 10) {
                    let line = pending[..<newline]
                    pending.removeSubrange(...newline)
                    if let event = try? JSONDecoder().decode(GUIEvent.self, from: Data(line)) {
                        await self?.receive(event, role: role, generation: currentGeneration)
                    }
                }
                if pending.count > 131072 { pending.removeAll() }
            }
            if !pending.isEmpty, let event = try? JSONDecoder().decode(GUIEvent.self, from: pending) {
                await self?.receive(event, role: role, generation: currentGeneration)
            }
            process.waitUntilExit()
            let diagnostic = await stderrTask.value
            await self?.workerExited(role: role, process: process, diagnostic: diagnostic, generation: currentGeneration)
        }
    }

    private func receive(_ event: GUIEvent, role: String, generation expected: UUID) {
        guard expected == generation else { return }
        if event.type == "account-progress" {
            guard role == "host", postRun.homebrewAttempted, homebrewTitle.contains("Stremio"),
                  let update = event.watchProgress else { return }
            accountProgressHandler?(update)
            return
        }
        if event.type != "host-stage", let message = event.message { append(message, channel: role == "host" ? .host : .usb) }
        if phase == .cancelled || phase == .failed || phase == .verified { return }
        switch event.type {
        case "host-ready":
            guard role == "host", phase == .hostStarting, let runtime else { return }
            startHID("commands", root: runtime.root)
        case "run-folder":
            if let path = event.path { runFolder = URL(fileURLWithPath: path) }
        case "post-run-ready":
            guard role == "host" else { return }
            guard let action = activeRunMode.postRunAction,
                  let command = event.rpcCommand, !command.isEmpty else {
                fail("The host offered a live endpoint that does not match the selected run mode.")
                return
            }
            guard postRun.ready() else { return }
            if let folder = sessionURL(event.path) { runFolder = folder }
            rpcCommand = command
            guard sendHostControl(action.control) else { return }
            postRun.choose(keepRPC: action.keepRPC, dumpFirmware: action.dumpFirmware)
            presentPostRunState()
        case "rpc-held":
            guard role == "host", let folder = sessionURL(event.path), postRun.receive(event.type) else { return }
            if let command = event.rpcCommand { rpcCommand = command }
            runFolder = folder
            presentPostRunState()
        case "homebrew-started", "homebrew-running", "homebrew-stopped", "homebrew-failed":
            let preserveFailure = postRun.homebrewStage == .failed && event.type == "homebrew-stopped"
            guard role == "host", postRun.receive(event.type) else { return }
            if let folder = sessionURL(event.path) { homebrewFolder = folder }
            if !preserveFailure { homebrewMessage = event.message ?? "\(homebrewTitle) session changed." }
            presentPostRunState()
        case "homebrew-progress":
            guard role == "host", phase == .launchingHomebrew || phase == .homebrewRunning else { return }
            homebrewMessage = event.message ?? "\(homebrewTitle) is working…"
            progressLabel = homebrewMessage
        case "action-rejected":
            if role == "host", postRun.homebrewStage == .launching {
                postRun.receive("homebrew-failed")
                homebrewMessage = event.message ?? "The host could not start \(homebrewTitle) in this session."
                presentPostRunState()
            }
        case "dump-started", "dump-complete":
            guard role == "host", postRun.receive(event.type) else { return }
            if let folder = sessionURL(event.path) { dumpFolder = folder }
            presentPostRunState()
        case "dump-progress":
            guard role == "host", phase == .dumpingFirmware else { return }
            progressLabel = event.message ?? "Reading system code…"
        case "rpc-finishing":
            guard role == "host", postRun.receive(event.type) else { return }
            presentPostRunState()
        case "rpc-status-started", "rpc-status":
            guard role == "host", postRun.receive(event.type) else { return }
            rpcStatus = event.message ?? (event.type == "rpc-status-started" ? "Checking RPC…" : "RPC check finished.")
        case "controller":
            if role == "hid" {
                status = event.message ?? "Connecting the USB keyboard"
                isEnumerating = true; progress = 0
            }
        case "enumeration-progress":
            if role == "hid" {
                isEnumerating = true
                if let done = event.completed, let total = event.total, total > 0 { progress = min(1, max(0, done / total)) }
                if let remaining = event.remainingMs {
                    progressLabel = String(format: "USB enumeration · %.1f seconds remaining", max(0, remaining) / 1000)
                }
            }
        case "typing":
            isEnumerating = false; progress = 0
            if phase == .bootstrap {
                hasEnumeratedSuccessfully = true
                startBootstrapTimingIfNeeded()
            }
            if phase == .bootstrap { status = "Typing the SmileBASIC bootstrap"; progressLabel = "Typing bootstrap lines" }
            else if phase == .commands { status = "Sending the post-bootstrap commands"; progressLabel = "0 of 4 commands sent" }
        case "progress":
            guard role == "hid", phase == .bootstrap,
                  let lineProgress = BootstrapLineProgress(type: event.type, line: event.line,
                    completed: event.completed, total: event.total) else { return }
            progress = lineProgress.fraction
            progressLabel = lineProgress.label
            updateBootstrapEstimate(completed: Double(lineProgress.completed), total: Double(lineProgress.total))
        case "line-start", "line-complete":
            guard role == "hid", phase == .bootstrap,
                  let lineProgress = BootstrapLineProgress(type: event.type, line: event.line,
                    completed: event.completed, total: event.total) else { return }
            isEnumerating = false
            progress = lineProgress.fraction
            progressLabel = lineProgress.label
            updateBootstrapEstimate(completed: Double(lineProgress.completed), total: Double(lineProgress.total))
        case "command-start":
            isEnumerating = false
            if let done = event.completed { progress = min(1, max(0, done / 4)) }
            let step = event.step ?? 1, label = event.label ?? "command"
            status = "Typing \(label) · command \(step) of 4"
            progressLabel = "\(max(0, step - 1)) of 4 commands sent"
        case "command-complete":
            isEnumerating = false
            if let done = event.completed { progress = min(1, max(0, done / 4)) }
            let step = event.step ?? 1
            progressLabel = "\(step) of 4 commands sent"
            status = "\(event.label ?? "Command") sent"
        case "wait":
            isEnumerating = false
            if let done = event.completed { progress = min(1, max(0, done / 4)) }
            let label = event.label ?? "command"
            status = label == "LOAD confirmation" ? "Waiting for the LOAD confirmation dialog" : "Waiting after \(label)"
            if let remaining = event.remainingMs {
                progressLabel = String(format: "%.1f seconds remaining · %d of 4 commands sent", max(0, remaining) / 1000, Int(event.completed ?? 0))
            }
        case "host-stage":
            hostStageLabel = event.message ?? hostStageLabel
            // Stage events update the status only. The adapter also emits the
            // original line as a log event, which owns the activity/log entry.
            if let done = event.completed, let total = event.total, total > 0 { hostStageProgress = min(1, max(0, done / total)) }
            else { hostStageProgress = nil }
            if phase == .waitingForConsole || phase == .hostStarting {
                status = hostStageLabel; progressLabel = hostStageLabel; progress = hostStageProgress
            }
        case "transfer-complete":
            isEnumerating = false
            if event.kind == "bootstrap" {
                appendBootstrapDuration(outcome: "completed")
                workflowProgress.bootstrapTransferred()
                phase = .awaitingSave; status = "Save NS2 in slot 0"
                detail = "The bootstrap has finished typing. Enter Direct mode, type SAVE \"NS2\", and save it in slot 0. Then return to the start screen."
                progress = 1; progressLabel = "Bootstrap transfer complete"
            } else if !hostCompleted && !postRun.isActive {
                phase = .waitingForConsole; status = hostStageLabel
                detail = "Keyboard delivery is complete. The host must independently verify FS execution and cleanup."
                progress = hostStageProgress; progressLabel = hostStageLabel
            }
        case "verified":
            guard role == "host" else { return }
            postRun.receive(event.type)
            endSessionActivity()
            workflowProgress.complete()
            hostCompleted = true
            phase = .verified; status = "FS execution verified"
            detail = "The host verified execution, restored the original instructions, and cleaned up scratch space. Restart the console when finished."
            progress = 1; progressLabel = "Execution, restoration and cleanup verified"; isEnumerating = false
        case "failed":
            fail(event.message ?? "The session did not finish. Inspect the Switch before retrying.")
        case "cancelled":
            if hostProcess == nil { endSessionActivity() }
            detail = SessionRecovery.message(event.message ?? "Session stopped.", interruptedPhase: phase)
            postRun.stop()
            workflowProgress.cancel()
            phase = .cancelled; status = "Session stopped"; progress = nil; progressLabel = ""; isEnumerating = false
        default: break
        }
    }

    private func workerExited(role: String, process: Process, diagnostic: Data, generation expected: UUID) {
        guard expected == generation else { return }
        if role == "host", hostProcess === process {
            try? hostInput?.fileHandleForWriting.close()
            hostInput = nil; hostProcess = nil
            if phase == .cancelled || phase == .failed { endSessionActivity() }
        }
        if role == "hid", hidProcess === process { hidProcess = nil }
        if !diagnostic.isEmpty, let text = String(data: diagnostic, encoding: .utf8) { append(text, channel: role == "host" ? .host : .usb) }
        guard phase != .cancelled, phase != .failed, phase != .verified else { return }
        if process.terminationStatus != 0 {
            fail("The \(role == "host" ? "host" : "USB transfer") stopped unexpectedly. Inspect the Switch before retrying.")
        } else if role == "host" && !hostCompleted {
            fail("The host ended without final cleanup verification. Keep the logs and restart the console before another attempt.")
        }
    }

    private func stopWorkers() {
        for worker in [hostProcess, hidProcess].compactMap({ $0 }) where worker.isRunning { worker.terminate() }
    }

    private func fail(_ message: String) {
        // Capture the failed stage atomically on the model's main actor. A
        // later cancellation/exit callback must not infer it from .failed.
        let recovery = SessionRecovery.message(message, interruptedPhase: phase)
        workflowProgress.fail()
        if hostProcess == nil { endSessionActivity() }
        ensureFallbackLog()
        postRun.stop()
        error = recovery; detail = recovery
        phase = .failed; status = "The session needs attention"
        progress = nil; progressLabel = ""; isEnumerating = false
        append(recovery)
        appendBootstrapDuration(outcome: "failed")
        stopWorkers()
    }

    private func resetBootstrapTiming() {
        bootstrapTimer?.invalidate(); bootstrapTimer = nil
        bootstrapStartedAt = nil
        bootstrapElapsedSeconds = 0
        bootstrapEstimatedRemainingSeconds = nil
    }

    private func startBootstrapTimingIfNeeded() {
        guard bootstrapStartedAt == nil else { return }
        bootstrapStartedAt = Date()
        bootstrapTimer?.invalidate()
        bootstrapTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, let started = self.bootstrapStartedAt else { return }
                self.bootstrapElapsedSeconds = Date().timeIntervalSince(started)
            }
        }
    }

    private func updateBootstrapEstimate(completed: Double, total: Double) {
        guard total > 0, let started = bootstrapStartedAt else { return }
        let elapsed = Date().timeIntervalSince(started)
        bootstrapElapsedSeconds = elapsed
        let fraction = min(1, max(0, completed / total))
        if fraction > 0.01 { bootstrapEstimatedRemainingSeconds = max(0, elapsed / fraction - elapsed) }
    }

    private func appendBootstrapDuration(outcome: String) {
        guard let started = bootstrapStartedAt else { return }
        let elapsed = Date().timeIntervalSince(started)
        bootstrapElapsedSeconds = elapsed
        bootstrapTimer?.invalidate(); bootstrapTimer = nil
        bootstrapEstimatedRemainingSeconds = outcome == "completed" ? 0 : bootstrapEstimatedRemainingSeconds
        append(String(format: "Bootstrap typing %@ after %.1f seconds.", outcome, elapsed))
        bootstrapStartedAt = nil
    }

    private func endSessionActivity() {
        if let activity = sessionActivity {
            ProcessInfo.processInfo.endActivity(activity)
            sessionActivity = nil
        }
    }

    private enum LogChannel { case host, usb }

    private func append(_ message: String, channel: LogChannel? = nil) {
        let line = message + "\n"
        log += line
        if let bytes = line.data(using: .utf8) { try? sessionLog?.write(contentsOf: bytes) }
        if let channel {
            switch channel {
            case .host:
                hostLog += line; try? hostSessionLog?.write(contentsOf: line.data(using: .utf8)!)
            case .usb:
                usbLog += line; try? usbSessionLog?.write(contentsOf: line.data(using: .utf8)!)
            }
        }
        if log.utf8.count > 50000 { log = String(log.suffix(40000)) }
    }

    private func openSessionLog(in root: URL) {
        let file = root.appendingPathComponent("gui-session.log")
        let descriptor = open(file.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        if descriptor >= 0 {
            sessionLog = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
            diagnosticLogURL = file
            hostSessionLog = makeChannelLog(in: root, name: "host-session.log")
            usbSessionLog = makeChannelLog(in: root, name: "usb-session.log")
            if let history = log.data(using: .utf8), !history.isEmpty { try? sessionLog?.write(contentsOf: history) }
        }
        else { error = "The private diagnostic log could not be created. Session logs may be incomplete." }
    }

    private func makeChannelLog(in root: URL, name: String) -> FileHandle? {
        let file = root.appendingPathComponent(name)
        let descriptor = open(file.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        return descriptor >= 0 ? FileHandle(fileDescriptor: descriptor, closeOnDealloc: true) : nil
    }

    private func ensureFallbackLog() {
        guard sessionLog == nil else { return }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("mac2jb-gui-error-" + UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false,
                                                    attributes: [.posixPermissions: 0o700])
            openSessionLog(in: folder)
            append("\(AppBuildIdentity.diagnosticLabel): runtime preparation diagnostic log.")
        } catch { diagnosticLogURL = nil }
    }

    nonisolated static func isIPv4(_ address: String) -> Bool {
        var value = in_addr()
        return address.withCString { inet_pton(AF_INET, $0, &value) } == 1
    }

    nonisolated private static func localAddresses() -> [NetworkAddress] {
        var first: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&first) == 0, let initial = first else { return [] }
        defer { freeifaddrs(first) }
        var values: [NetworkAddress] = []
        var item: UnsafeMutablePointer<ifaddrs>? = initial
        while let current = item {
            defer { item = current.pointee.ifa_next }
            let info = current.pointee
            guard let address = info.ifa_addr, address.pointee.sa_family == UInt8(AF_INET),
                  (info.ifa_flags & UInt32(IFF_UP)) != 0, (info.ifa_flags & UInt32(IFF_LOOPBACK)) == 0 else { continue }
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(address, socklen_t(address.pointee.sa_len), &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 {
                let string = String(cString: buffer)
                if !string.hasPrefix("169.254.") { values.append(NetworkAddress(address: string, interface: String(cString: info.ifa_name))) }
            }
        }
        // Physical interfaces precede virtual/VPN interfaces, without guessing
        // that the first address necessarily reaches the user's console.
        return values.sorted { a, b in
            let physicalA = a.interface.hasPrefix("en"), physicalB = b.interface.hasPrefix("en")
            if physicalA != physicalB { return physicalA }
            return a.label < b.label
        }
    }

    nonisolated private static func capture(_ executable: String, _ arguments: [String]) -> (Int32, String) {
        let process = Process(); let output = Pipe()
        process.executableURL = URL(fileURLWithPath: executable); process.arguments = arguments
        process.standardOutput = output; process.standardError = output; process.standardInput = FileHandle.nullDevice
        do { try process.run() } catch { return (1, error.localizedDescription) }
        let data = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }
}
