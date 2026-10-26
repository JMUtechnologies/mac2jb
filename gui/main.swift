import AppKit
import SwiftUI
import Foundation

// The detached installer must run before constructing the GUI or session.
if CommandLine.arguments.dropFirst().first == "--finish-update" {
    guard CommandLine.arguments.count == 3 else { exit(2) }
    exit(UpdateInstaller.finish(planURL: URL(fileURLWithPath: CommandLine.arguments[2])))
}

// Hardware-free verification is also available from the single executable.
if CommandLine.arguments.contains("--self-test") {
    do {
        let testParent = FileManager.default.temporaryDirectory.appendingPathComponent("mac2jb-selftest-" + UUID().uuidString)
        let runtime = try BundledRuntime.prepare(sessionParent: testParent)
        defer { try? FileManager.default.removeItem(at: testParent) }
        let checks: [(String, [String])] = [
            ("scripts/install-driver.sh", ["--verify"]),
            ("node", ["--version"]),
            ("mac2jb-send", ["assets/bootstrap.bas", "--dry-run"]),
            ("mac2jb-commands", ["--dry-run"]),
            ("mac2jb-commands", ["--dry-run", "--gui-events", "--load-confirm-wait-ms", "1000",
                                 "--load-wait-ms", "3000", "--run-wait-ms", "3000", "--remove-wait-ms", "3000"]),
            ("mac2jb-commands", ["--gui-timing-test", "--gui-events", "--load-confirm-wait-ms", "10",
                                 "--load-wait-ms", "10", "--run-wait-ms", "10", "--remove-wait-ms", "10"]),
            ("node", ["--check", "scripts/gui-session.cjs"]),
            ("node", ["--check", "scripts/gui-dump.cjs"]),
            ("node", ["--check", "scripts/gui-homebrew.cjs"]),
            ("node", ["scripts/check-homebrew-runtime.cjs"]),
            ("node", ["--check", "scripts/gui-stremio.cjs"]),
            ("node", ["scripts/check-stremio-runtime.cjs"]),
            ("node", ["scripts/gui-host.cjs", "--self-test"])
        ]
        for (tool, arguments) in checks {
            let task = Process()
            task.executableURL = tool.hasSuffix(".sh") ? URL(fileURLWithPath: "/bin/bash") : runtime.root.appendingPathComponent(tool)
            task.arguments = tool.hasSuffix(".sh") ? [runtime.root.appendingPathComponent(tool).path] + arguments : arguments
            task.currentDirectoryURL = runtime.root
            try task.run()
            task.waitUntilExit()
            guard task.terminationStatus == 0 else {
                throw NSError(domain: "mac2jb.selftest", code: Int(task.terminationStatus),
                              userInfo: [NSLocalizedDescriptionKey: "Check failed: \(tool)"])
            }
        }
        print("\(AppBuildIdentity.diagnosticLabel): embedded runtime and dry-run checks passed; no USB input sent.")
        try? FileManager.default.removeItem(at: testParent)
        exit(0)
    } catch {
        fputs("mac2jb self-test failed: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

struct Mac2jbApp: App {
    @StateObject private var model = SessionModel()
    @StateObject private var updater = AppUpdater()
    var body: some Scene {
        WindowGroup(AppBuildIdentity.isTestBuild ? "mac2jb Kurumuz Test" : "mac2jb") {
            ContentView(model: model, updater: updater)
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
                    model.cancel()
                }
        }
        .defaultSize(width: 1110, height: 800)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") { updater.check() }.disabled(updater.isWorking)
                Toggle("Check for Updates Automatically", isOn: $updater.checksAutomatically)
                    .disabled(AppBuildIdentity.isTestBuild)
            }
        }
    }
}

NSApplication.shared.setActivationPolicy(.regular)
Mac2jbApp.main()
