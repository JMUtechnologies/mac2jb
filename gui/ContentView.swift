import SwiftUI
import AppKit

private let ink = Color(red: 0.08, green: 0.15, blue: 0.18)
private let teal = Color(red: 0.00, green: 0.48, blue: 0.43)
private let mist = Color(red: 0.95, green: 0.97, blue: 0.96)

struct ContentView: View {
    @ObservedObject var model: SessionModel
    @ObservedObject var updater: AppUpdater
    @StateObject private var account = StremioAccount()
    @State private var readyConfirmed = false
    @State private var savedConfirmed = false
    @State private var showLogs = false
    @State private var activityTab = 0
    @State private var driverMessage: String?
    @State private var confirmUpdate = false
    @State private var showFailure = false
    @State private var failureText = ""
    @State private var showUpdateFailure = false
    private var canConfigure: Bool {
        [.ready, .failed, .cancelled].contains(model.phase)
    }
    private var timingSettingsValid: Bool {
        (1...2000).contains(model.keyDelayMs) && (1...120).contains(model.enumerationTimeoutSeconds) &&
        [model.loadConfirmWaitMs, model.loadWaitMs, model.runWaitMs, model.removeWaitMs]
            .allSatisfy { (0...120000).contains($0) }
    }
    private var headline: String {
        switch model.phase {
        case .preparing: return "Getting everything ready."
        case .ready: return "Get started"
        case .bootstrap: return "Your Mac is doing the typing."
        case .awaitingSave: return "Save the bootstrap on your Switch."
        case .hostStarting: return "Starting a fresh session."
        case .commands: return "Sending post-bootstrap commands."
        case .waitingForConsole: return "Following the console session."
        case .rpcHeld: return "Your RPC session is open."
        case .dumpingFirmware: return "Saving system code."
        case .rpcFinishing: return "Finishing the session."
        case .launchingHomebrew: return "Starting \(model.homebrewTitle)."
        case .homebrewRunning: return "\(model.homebrewTitle) is running."
        case .homebrewStopped: return "Finish the homebrew session."
        case .verified: return "FS execution verified."
        case .failed: return "Let’s check what happened."
        case .cancelled: return "Session stopped."
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    if updater.state != .idle { updateStatus }
                    if canConfigure { setup }
                    else { activeSession }
                    activity
                    footer
                }
                .padding(34)
            }
            .background(mist)
        }
        .frame(minWidth: 1020, minHeight: 740)
        .preferredColorScheme(.light)
        .tint(teal)
        .onAppear {
            model.accountProgressHandler = { [weak account] update in account?.handleProgress(update) }
            model.prepare()
            updater.start()
            NSApp.activate(ignoringOtherApps: true)
        }
        .onDisappear {
            model.accountProgressHandler = nil
            account.cancelSignIn()
        }
        .onChange(of: model.phase) { _, phase in
            readyConfirmed = false
            savedConfirmed = false
            if phase == .failed {
                showLogs = true
                let location = model.diagnosticLogURL.map { "Log saved at:\n" + $0.path }
                    ?? "A diagnostic log could not be created. The session activity remains visible in this window."
                failureText = (model.error ?? model.detail) + "\n\n" + location
                showFailure = true
            }
        }
        .onChange(of: model.runMode) { _, _ in readyConfirmed = false }
        .onChange(of: updater.state) { _, state in if state == .failed { showUpdateFailure = true } }
        .alert("The session needs attention", isPresented: $showFailure) {
            if model.diagnosticLogURL != nil {
                Button("Open logs") { model.revealSessionFolder() }
            }
            Button("Close", role: .cancel) {}
        } message: { Text(failureText) }
        .alert("USB driver", isPresented: Binding(get: { driverMessage != nil }, set: { if !$0 { driverMessage = nil } })) {
            Button("OK") { driverMessage = nil }
        } message: { Text(driverMessage ?? "") }
        .alert("The update needs attention", isPresented: $showUpdateFailure) {
            if updater.diagnosticURL != nil { Button("Open update log") { updater.revealLog() } }
            Button("Close", role: .cancel) {}
        } message: {
            Text(updater.message + (updater.diagnosticURL.map { "\n\nLog saved at:\n" + $0.path } ?? ""))
        }
        .confirmationDialog("Restart and update mac2jb?", isPresented: $confirmUpdate) {
            Button("Restart & update") {
                updater.install(canRestart: model.canRestartForUpdate) {
                    model.recordDiagnostic("Restarting mac2jb to install the verified update.")
                }
            }
        } message: {
            Text("The app will close, install the verified release, and reopen. Your logs and driver are kept. The previous app is saved as a backup.")
        }
    }

    private var updateStatus: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(updater.message).font(.system(size: 12, weight: .medium)).foregroundStyle(ink)
            if updater.state == .downloading { ProgressView(value: updater.progress).tint(teal) }
            HStack {
                if updater.state == .available {
                    Button("Download update") { updater.download() }.buttonStyle(.borderedProminent)
                }
                if updater.state == .ready {
                    Button("Restart & update") { confirmUpdate = true }
                        .buttonStyle(.borderedProminent).disabled(!model.canRestartForUpdate)
                    if !model.canRestartForUpdate {
                        Text("Available after the current session or driver setup finishes.")
                            .font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                }
                if let release = updater.candidate?.releaseURL {
                    Link("Release notes ↗", destination: release)
                }
                if updater.state == .failed {
                    Button("Try again") { updater.dismiss(); updater.check() }
                    Link("Open releases ↗", destination: URL(string: "https://github.com/cpypwn/mac2jb/releases/latest")!)
                    if updater.hasDownloadedApp { Button("Show downloaded app") { updater.revealDownloadedApp() } }
                    if let log = updater.diagnosticURL {
                        Button("Open update log") { updater.revealLog() }
                        Text(log.path).font(.system(size: 9)).textSelection(.enabled)
                    }
                }
                Spacer(minLength: 0)
                if updater.state == .current || updater.state == .failed {
                    Button("Dismiss") { updater.dismiss() }.buttonStyle(.plain)
                }
            }.font(.system(size: 11))
        }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(teal.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Text("mac2jb").font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(.white)
            }
            .padding(.top, 48)
            VStack(spacing: 26) {
                step(0, "Prepare", "Mac, network & console")
                step(1, "Type bootstrap", model.fullInstall ? "Type first, then save" : "Use your saved NS2")
                step(2, "Run & verify", model.fullInstall ? "Choose a separate run mode" : "Host and commands")
            }.padding(.top, 55)
            Spacer(minLength: 40)
            Text(AppBuildIdentity.versionLabel)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.35))
        }
        .padding(.horizontal, 25).padding(.bottom, 30)
        .frame(width: 225)
        .background(ink)
    }

    private func step(_ number: Int, _ title: String, _ subtitle: String) -> some View {
        let state = model.workflowProgress.state(for: number)
        let failedColor = Color(red: 1, green: 0.58, blue: 0.58)
        let active = state == .active
        let stateLabel: String
        switch state {
        case .pending: stateLabel = "Not started"
        case .active: stateLabel = "Current step"
        case .complete: stateLabel = "Completed"
        case .failed: stateLabel = "Failed or cancelled"
        }
        return HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(active ? Color.mint : state == .failed ? failedColor.opacity(0.14) : .white.opacity(0.08))
                    .frame(width: 29, height: 29)
                if state == .complete {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Color.mint)
                } else if state == .failed {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(failedColor)
                } else {
                    Text(String(format: "%02d", number + 1)).font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(active ? ink : .white.opacity(0.45))
                }
            }
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(state == .failed ? failedColor : .white.opacity(active ? 1 : 0.65))
                Text(subtitle).font(.system(size: 10)).foregroundStyle(.white.opacity(0.35))
            }.padding(.top, 2)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(number + 1): \(title)")
        .accessibilityValue(stateLabel)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text(headline).font(.system(size: 31, weight: .bold, design: .rounded)).tracking(-0.9).foregroundStyle(ink)
            Text(canConfigure ? "Choose your starting point. mac2jb handles the Mac side in this window." : model.detail)
                .font(.system(size: 13)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var setup: some View {
        VStack(spacing: 18) {
            if model.phase == .failed || model.phase == .cancelled {
                note(model.detail, icon: "exclamationmark.circle", color: .orange)
                if model.hasLiveWorkers {
                    Text("Waiting for the previous host to finish cleanup before another session can start.")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
                if model.dumpFolder != nil {
                    Button("Open dump folder") { model.revealDumpFolder() }
                }
            }
            panel {
                VStack(alignment: .leading, spacing: 16) {
                    eyebrow("01 / STARTING POINT")
                    modeCard(.bootstrapOnly)
                    Divider()
                    Text("Already have bootstrap.bas saved to slot 0 as NS2?")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(ink)
                    HStack(alignment: .top, spacing: 10) {
                        modeCard(.exploitOnly)
                        modeCard(.heldRPC)
                        modeCard(.systemCodeDump)
                    }
                    Text("For any of these three runs, restart the Switch, open SmileBASIC and enter Direct mode. Each starts a fresh exploit using your saved NS2.")
                        .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    homebrewSection
                    Divider()
                    if model.runMode.requiresHost { HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Mac address on the Switch’s network").font(.system(size: 12, weight: .semibold))
                            if model.addresses.isEmpty {
                                Text("Connect this Mac to your local network, then refresh.").font(.system(size: 11)).foregroundStyle(.secondary)
                            } else {
                                Picker("Network address", selection: $model.selectedAddress) {
                                    ForEach(model.addresses) { address in
                                        Text(address.label).tag(address.address)
                                    }
                                }.labelsHidden().frame(maxWidth: .infinity)
                            }
                        }
                        Button { model.refreshChecks() } label: { Image(systemName: "arrow.clockwise") }
                            .help("Refresh network and driver checks").padding(.top, 22)
                    } }
                    DisclosureGroup("USB controller & timing options") {
                        VStack(alignment: .leading, spacing: 14) {
                            Picker("Controller", selection: $model.controller) {
                                Text("Automatic · 0, 1, 3").tag("auto")
                                ForEach(0..<16) { Text("usb-drd\($0)").tag("usb-drd\($0)") }
                            }
                            Divider()
                            timingField("Delay per key", units: "ms", value: $model.keyDelayMs, range: 1...2000)
                            timingField("Enumeration timeout per controller", units: "s", value: $model.enumerationTimeoutSeconds, range: 1...120)
                            Divider()
                            Text("Post-bootstrap waits").font(.system(size: 11, weight: .semibold)).foregroundStyle(ink)
                            timingField("Before confirming LOAD (YES)", units: "ms", value: $model.loadConfirmWaitMs, range: 0...120000)
                            timingField("After LOAD → before RUN", units: "ms", value: $model.loadWaitMs, range: 0...120000)
                            timingField("After RUN → before REMOVE", units: "ms", value: $model.runWaitMs, range: 0...120000)
                            timingField("After REMOVE → before START", units: "ms", value: $model.removeWaitMs, range: 0...120000)
                            HStack {
                                Text("Defaults: 50 ms/key · 4 s enumeration · 1 s LOAD confirmation · 3 s between commands.")
                                    .font(.system(size: 10)).fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 8)
                                Button("Reset defaults") {
                                    model.keyDelayMs = 50; model.enumerationTimeoutSeconds = 4
                                    model.loadConfirmWaitMs = 1000; model.loadWaitMs = 3000
                                    model.runWaitMs = 3000; model.removeWaitMs = 3000
                                }.font(.system(size: 10))
                            }
                            if !timingSettingsValid {
                                Text("Enter values within the ranges shown before starting.")
                                    .font(.system(size: 11)).foregroundStyle(.orange)
                            }
                        }.padding(.top, 10)
                    }.font(.system(size: 11)).foregroundStyle(.secondary)
                }.disabled(model.hasLiveWorkers || model.driverSetupRunning)
            }
            panel {
                VStack(alignment: .leading, spacing: 15) {
                    eyebrow("02 / READY CHECK")
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: model.driverLoaded ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                            .foregroundStyle(model.driverLoaded ? teal : .orange)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("USB gadget driver").font(.system(size: 12, weight: .semibold))
                            Text(model.driverStatus).font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        Button(model.driverSetupRunning ? "Installing…" : "Install & load driver…") { loadDriver() }
                            .font(.system(size: 11)).disabled(model.driverSetupRunning || model.runtime == nil || model.hasLiveWorkers)
                    }
                    Group {
                        if model.fullInstall {
                            Text("On the Switch: open SmileBASIC, then **Make a Program** with an empty editor. Leave the editor open while the bootstrap is typed.")
                        } else {
                            Text("On the Switch: **restart the console → open SmileBASIC → enter Direct mode**. The fork’s five-argument bootstrap must already be saved as **NS2 in slot 0**. mac2jb loads it automatically.")
                        }
                    }
                        .font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    powerDirectionNotice
                    Toggle("The Switch is ready on the screen described above", isOn: $readyConfirmed)
                        .toggleStyle(.checkbox).font(.system(size: 12, weight: .medium))
                    HStack {
                        Text(model.fullInstall ? "Types the bootstrap at your selected key delay, then stops for saving." : model.runMode.caption)
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                        Spacer()
                        Button { showLogs = true; model.start() } label: {
                            HStack(spacing: 10) { Text(model.runMode.startTitle); Image(systemName: "arrow.right") }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                        }
                        .buttonStyle(PrimaryActionStyle()).fixedSize()
                        .disabled(!readyConfirmed || model.runMode.requiresHost && model.selectedAddress.isEmpty || model.runtime == nil || !model.driverLoaded || !timingSettingsValid || model.driverSetupRunning || model.hasLiveWorkers || updater.blocksNewSession)
                    }
                }
            }
        }
    }

    private var activeSession: some View {
        panel {
            VStack(alignment: .leading, spacing: 20) {
                eyebrow("SESSION / \(model.phase == .verified ? "COMPLETE" : "IN PROGRESS")")
                HStack(alignment: .center, spacing: 18) {
                    Image(systemName: model.phase == .verified ? "checkmark.seal.fill" : "cable.connector")
                        .font(.system(size: 34)).foregroundStyle(teal).frame(width: 56, height: 56)
                        .background(teal.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(model.status).font(.system(size: 17, weight: .semibold)).foregroundStyle(ink)
                        Text(model.activeRunMode == .bootstrapOnly ? "Bootstrap only · \(model.controller == "auto" ? "Automatic controller" : model.controller)" : model.selectedAddress.isEmpty ? "Preparing the embedded runtime" : "\(model.selectedAddress) · \(model.controller == "auto" ? "Automatic controller" : model.controller)")
                            .font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                    }
                }
                if model.isBusy {
                    if let progress = model.progress { ProgressView(value: progress).tint(teal) }
                    else { ProgressView().progressViewStyle(.linear).tint(teal) }
                    if !model.progressLabel.isEmpty {
                        Text(model.progressLabel).font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary).monospacedDigit()
                    }
                    if model.phase == .bootstrap {
                        HStack(spacing: 14) {
                            Text(String(format: "Elapsed %.1f s", model.bootstrapElapsedSeconds))
                            if let remaining = model.bootstrapEstimatedRemainingSeconds {
                                Text(String(format: "Estimated completion in %.1f s", max(0, remaining)))
                            } else {
                                Text("Estimating completion…")
                            }
                        }
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                    }
                }
                if model.isEnumerating { powerDirectionNotice }
                if model.phase == .awaitingSave {
                    Divider()
                    Text("The bootstrap has finished typing. Enter **Direct mode**, type `SAVE \"NS2\"`, and save it in **slot 0**. Return to the start screen after saving; then choose an exploit mode for a separate run.")
                        .font(.system(size: 13)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Toggle("NS2 is saved in slot 0 and I have entered Direct mode", isOn: $savedConfirmed)
                        .toggleStyle(.checkbox).font(.system(size: 12, weight: .medium))
                    Button("NS2 saved — back to start") { model.finishBootstrapOnly() }
                        .buttonStyle(PrimaryActionStyle()).fixedSize().disabled(!savedConfirmed || model.hasLiveWorkers)
                } else if model.phase == .verified {
                    Text("The host confirmed execution, restoration, and cleanup. Restart the console when finished.")
                        .font(.system(size: 13)).foregroundStyle(.secondary)
                    HStack {
                        Button("Back to start") { model.returnToStart() }
                            .buttonStyle(PrimaryActionStyle()).fixedSize().disabled(!model.canReturnToStart)
                        if model.hasLiveWorkers {
                            Text("Waiting for the session workers to close…")
                                .font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                    }
                } else if model.phase == .waitingForConsole {
                    Text("Keyboard transmission is complete. Keep SmileBASIC open and both devices awake while the host checks the result.")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
                if model.postRun.isActive { postRunControls }
                if model.activeRunMode == .heldRPC && (model.postRun.isActive || model.postRun.homebrewAttempted) {
                    homebrewSection
                }
                if model.postRun.dumpCompleted, model.dumpFolder != nil {
                    Button("Open dump folder") { model.revealDumpFolder() }
                        .font(.system(size: 12))
                }
                if model.isBusy || model.phase == .awaitingSave {
                    HStack {
                        Label("Only this app’s session will be stopped", systemImage: "lock")
                            .font(.system(size: 10)).foregroundStyle(.secondary)
                        Spacer()
                        Button("Stop session", role: .destructive) { model.cancel() }
                    }
                }
            }
        }
    }

    private var homebrewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Already got the ns2jb exploit running?")
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(ink)
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "gamecontroller").font(.system(size: 22)).foregroundStyle(teal)
                VStack(alignment: .leading, spacing: 5) {
                    Text("HBLauncher v0.2.0").font(.system(size: 13, weight: .semibold)).foregroundStyle(ink)
                    Text(homebrewCaption).font(.system(size: 11)).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Button(model.postRun.homebrewAttempted && model.homebrewTitle.contains("HBLauncher") ? homebrewActionTitle : "Launch HBLauncher") { model.launchHomebrew() }
                    .font(.system(size: 11, weight: .medium)).disabled(!model.canLaunchHomebrew)
            }
            Text("Includes ftpd-sb v0.1.0 in HBLauncher’s app menu.")
                .font(.system(size: 10)).foregroundStyle(.secondary)
            Divider()
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "play.rectangle").font(.system(size: 22)).foregroundStyle(teal)
                VStack(alignment: .leading, spacing: 5) {
                    Text("Stremio · experimental").font(.system(size: 13, weight: .semibold)).foregroundStyle(ink)
                    Text("Mac-assisted HTTP and HLS player. Stremio must be installed on this Mac.")
                        .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    if !model.postRun.homebrewAttempted {
                        TextField("Optional Stremio add-on manifest URL", text: $model.stremioAddonURL)
                            .textFieldStyle(.roundedBorder).font(.system(size: 11))
                            .disabled(!canConfigure && !model.canLaunchHomebrew)
                        Text("Leave empty to use your account add-ons, or the bundled 30-second movie test. Library and watch progress sync with your account; torrents and subtitles are unsupported.")
                            .font(.system(size: 10)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                Button(model.postRun.homebrewAttempted && model.homebrewTitle.contains("Stremio") ? homebrewActionTitle : "Launch Stremio") {
                    model.launchHomebrew(stremio: true, accountAddons: account.addonURLs,
                                         libraryItems: account.libraryPayload())
                }
                .font(.system(size: 11, weight: .medium))
                .disabled(!model.canLaunchHomebrew || !model.stremioToolsAvailable || account.signingIn)
            }
            stremioAccountControls
            if !model.stremioToolsAvailable {
                Text("Install Stremio on this Mac to enable the experimental player.").font(.system(size: 10)).foregroundStyle(.secondary)
            }
            if model.homebrewFolder != nil {
                Button("Open homebrew logs") { model.revealHomebrewLogs() }.font(.system(size: 11))
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(teal.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
    }

    private var homebrewCaption: String {
        if canConfigure { return "Start Held RPC above and wait for 4/4 verification in this app." }
        if model.postRun.homebrewAttempted {
            return model.homebrewTitle.contains("HBLauncher")
                ? "HBLauncher uses this app’s verified held RPC session. Keep SmileBASIC open until you finish."
                : "Start a fresh Held RPC session after restarting the console to launch HBLauncher."
        }
        if model.canLaunchHomebrew { return "Launch using this app’s current verified held RPC session." }
        return "Waiting for this app’s held RPC session to be confirmed and idle."
    }

    private var stremioAccountControls: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 10) {
                if account.signingIn {
                    ProgressView().controlSize(.small)
                    Button("Cancel sign-in") { account.cancelSignIn() }
                } else if account.signedIn {
                    Text(account.displayName.map { "Stremio: \($0)" } ?? "Signed in to Stremio")
                    Text("\(account.libraryCount) library items").foregroundStyle(.secondary)
                    Button("Refresh") { account.refresh() }
                    Button("Sign out") { account.signOut() }
                } else {
                    Button("Sign in to Stremio") { account.signIn() }
                    Text("Optional · account stays on this Mac").foregroundStyle(.secondary)
                }
            }
            .disabled(model.postRun.homebrewAttempted && model.hasLiveWorkers)
            Text(account.status).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if !account.watchProgressStatus.isEmpty {
                Text(account.watchProgressStatus).foregroundStyle(.secondary)
            }
        }
        .font(.system(size: 10))
    }

    private var homebrewActionTitle: String {
        switch model.postRun.homebrewStage {
        case .idle: return "Launch HBLauncher"
        case .launching: return "Starting…"
        case .running: return "Running"
        case .stopped, .failed: return "Launch unavailable"
        }
    }

    private var postRunControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
            Text("4/4 verified · original instructions restored")
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(teal)
            Text(model.phase == .dumpingFirmware
                 ? "Keep SmileBASIC open until the dump finishes. Stop session may leave a partial dump."
                 : "Keep SmileBASIC open until the host has finished final cleanup.")
                .font(.system(size: 12)).foregroundStyle(.secondary)
            if !model.rpcCommand.isEmpty {
                Text(model.rpcCommand).font(.system(size: 10, design: .monospaced))
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            }
            if !model.rpcStatus.isEmpty {
                Text(model.rpcStatus).font(.system(size: 11)).foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            HStack(spacing: 12) {
                Button(model.postRun.statusInFlight ? "Checking RPC…" : "Check RPC") { model.checkRPCStatus() }
                    .disabled(!model.postRun.canCheckStatus)
                Button("Copy RPC command") { model.copyRPCCommand() }.disabled(model.rpcCommand.isEmpty)
                Button("Open run logs") { model.revealRunFolder() }
                Spacer()
                Button("Finish session") { model.finishPostRun() }.disabled(!model.postRun.canFinish)
            }.font(.system(size: 11))
        }
    }

    private var activity: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Button { showLogs.toggle() } label: {
                    Label("Session activity", systemImage: showLogs ? "chevron.down" : "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                }.buttonStyle(.plain)
                Spacer()
                Button("Open session logs") { model.revealSessionFolder() }
                    .font(.system(size: 11)).disabled(model.runtime == nil && model.diagnosticLogURL == nil)
            }.foregroundStyle(.secondary)
            if showLogs {
                Picker("Activity log", selection: $activityTab) {
                    Text("All activity").tag(0)
                    Text("Host").tag(1)
                    Text("USB & typing").tag(2)
                }.pickerStyle(.segmented)
                ScrollViewReader { proxy in
                    ScrollView {
                        let selectedLog = activityTab == 1 ? model.hostLog : activityTab == 2 ? model.usbLog : model.log
                        Text(selectedLog.isEmpty ? "Ready when you are. Session activity will appear here." : selectedLog)
                            .font(.system(size: 10, design: .monospaced)).foregroundStyle(ink.opacity(0.8))
                            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(14)
                        Color.clear.frame(height: 1).id("end")
                    }
                    .frame(height: 140)
                    .background(.white, in: RoundedRectangle(cornerRadius: 10))
                    .onChange(of: model.log) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
                }
            }
        }
    }

    private var footer: some View {
        if !model.shouldShowFirstTimeFooter { return AnyView(EmptyView()) }
        return AnyView(HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle").padding(.top, 1)
            Text("First time? Configure macOS to allow the unsigned driver, then use Install & load driver. Compatible custom SIP configurations are accepted. Approve and restart when prompted. No Xcode needed. The CLI remains available.")
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button("Setup guide ↗") {
                NSWorkspace.shared.open(URL(string: "https://github.com/cpypwn/mac2jb#prerequisites-and-important-security-notes")!)
            }.buttonStyle(.plain).foregroundStyle(teal)
        }.font(.system(size: 10)).foregroundStyle(.secondary))
    }

    private func modeCard(_ mode: SessionRunMode) -> some View {
        Button { model.selectRunMode(mode) } label: {
            HStack(alignment: .top, spacing: 10) {
                Text("\(mode.number)").font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .frame(width: 23, height: 23).background(teal.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
                VStack(alignment: .leading, spacing: 5) {
                    Label(mode.title, systemImage: mode.icon).font(.system(size: 12, weight: .semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(mode.caption).font(.system(size: 11)).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: model.runMode == mode ? "largecircle.fill.circle" : "circle").font(.system(size: 13))
            }
            .foregroundStyle(model.runMode == mode ? teal : ink)
            .padding(15).frame(maxWidth: .infinity, alignment: .leading)
            .background(model.runMode == mode ? teal.opacity(0.06) : .white, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(model.runMode == mode ? teal.opacity(0.6) : .gray.opacity(0.18), lineWidth: 1))
        }.buttonStyle(.plain)
    }
    private var powerDirectionNotice: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "cable.connector").foregroundStyle(teal).padding(.top, 2)
            VStack(alignment: .leading, spacing: 5) {
                Text("USB enumeration requires the correct power direction.")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(ink)
                Text("The Mac must NOT be supplying power to the Switch. Unplug the cable from the Mac and plug it back in to renegotiate power toward the Mac. If the Switch is still charging from the Mac, reconnect and check again before retrying.")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(teal.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
    }
    private func timingField(_ title: String, units: String, value: Binding<Int>, range: ClosedRange<Int>) -> some View {
        HStack(spacing: 8) {
            Text(title).font(.system(size: 11)).foregroundStyle(ink)
            Spacer(minLength: 10)
            TextField(title, value: value, format: .number.grouping(.never))
                .labelsHidden().accessibilityLabel(title)
                .textFieldStyle(.roundedBorder).multilineTextAlignment(.trailing)
                .frame(width: 78)
            Stepper(title, value: value, in: range).labelsHidden().accessibilityLabel(title)
                .frame(width: 20)
            Text(units).font(.system(size: 10)).frame(width: 21, alignment: .leading)
            Text("\(range.lowerBound)–\(range.upperBound)")
                .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                .frame(width: 80, alignment: .trailing)
        }
    }
    private func eyebrow(_ text: String) -> some View {
        Text(text).font(.system(size: 9, weight: .semibold, design: .monospaced)).tracking(1).foregroundStyle(.secondary)
    }
    private func panel<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content().padding(22).frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(ink.opacity(0.07), lineWidth: 1))
    }
    private func note(_ text: String, icon: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 10) { Image(systemName: icon); Text(text).fixedSize(horizontal: false, vertical: true) }
            .font(.system(size: 12)).foregroundStyle(color).padding(16)
            .frame(maxWidth: .infinity, alignment: .leading).background(color.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }
    private func loadDriver() {
        guard let runtime = model.runtime else { return }
        model.driverSetupRunning = true
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        let script = runtime.root.appendingPathComponent("scripts/install-driver.sh").path
        let command = "/bin/bash '" + script.replacingOccurrences(of: "'", with: "'\\''") + "'"
        let appleString = command.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        task.arguments = ["-e", "do shell script \"" + appleString + "\" with administrator privileges"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe
        task.terminationHandler = { task in
            let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            DispatchQueue.main.async {
                model.driverSetupRunning = false
                model.refreshChecks()
                model.recordDiagnostic("Driver installer:\n" + output)
                driverMessage = task.terminationStatus == 0
                    ? "The bundled unsigned driver is installed. Approve it in System Settings → Privacy & Security if requested, then restart before starting mac2jb. Any previous driver was backed up; its path is in session activity.\n\n\(output.prefix(1400))"
                    : "Driver setup needs attention. Review the installer error below and macOS kernel-extension policy. Compatible custom SIP configurations are accepted; complete any approval/restart prompts.\n\n\(output.prefix(1400))\n\nLog: \(model.diagnosticLogURL?.path ?? "Log unavailable")"
            }
        }
        do { try task.run() }
        catch { model.driverSetupRunning = false; driverMessage = error.localizedDescription }
    }
}

private struct PrimaryActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(enabled ? Color.white : ink.opacity(0.4))
            .frame(minWidth: 145, minHeight: 38)
            .padding(.horizontal, 12)
            .background(enabled ? teal.opacity(configuration.isPressed ? 0.8 : 1) : ink.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }
}
