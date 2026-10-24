import Foundation
import AppKit

@main struct UpdaterTests {
    static var passed = 0
    static let manager = FileManager.default
    static func expect(_ condition: @autoclosure () throws -> Bool, _ name: String) throws {
        guard try condition() else { throw UpdateFailure("FAIL: " + name) }
        passed += 1; print("PASS " + name)
    }
    static func rejects(_ name: String, _ action: () throws -> Void) throws {
        do { try action() } catch { passed += 1; print("PASS " + name); return }
        throw UpdateFailure("FAIL: " + name)
    }
    static func release(_ change: (inout [String: Any]) -> Void = { _ in }) throws -> UpdateRelease {
        let tag = "v1.2.3"
        var row: [String: Any] = ["tag_name": tag, "draft": false, "prerelease": false,
            "html_url": "https://github.com/cpypwn/mac2jb/releases/tag/\(tag)",
            "assets": ["mac2jb-\(tag)-macos-arm64.zip", "mac2jb-\(tag)-sha256sums"].map {
                ["name": $0, "size": 100, "digest": "sha256:" + String(repeating: "a", count: 64),
                 "browser_download_url": "https://github.com/cpypwn/mac2jb/releases/download/\(tag)/\($0)"] as [String: Any]
            }]
        change(&row)
        return try JSONDecoder().decode(UpdateRelease.self, from: JSONSerialization.data(withJSONObject: row))
    }
    static func app(_ url: URL, version: String, fixture: URL) throws {
        try manager.createDirectory(at: url.appendingPathComponent("Contents/MacOS"), withIntermediateDirectories: true)
        let metadata: [String: Any] = ["CFBundleIdentifier": UpdatePackage.bundleID, "CFBundleExecutable": "mac2jb",
                                      "CFBundleVersion": "1", "CFBundleShortVersionString": version,
                                      "CFBundlePackageType": "APPL", "LSMinimumSystemVersion": "14.0"]
        try PropertyListSerialization.data(fromPropertyList: metadata, format: .xml, options: 0)
            .write(to: url.appendingPathComponent("Contents/Info.plist"))
        try manager.copyItem(at: fixture, to: url.appendingPathComponent("Contents/MacOS/mac2jb"))
        _ = try UpdatePackage.run("/usr/bin/codesign", ["--force", "--sign", "-", url.path])
    }
    static func plan(_ root: URL, fixture: URL) throws -> UpdateInstallPlan {
        let directory = root.appendingPathComponent(UUID().uuidString)
        let destination = root.appendingPathComponent("installed-" + UUID().uuidString).appendingPathComponent("mac2jb.app")
        let candidate = directory.appendingPathComponent("unpacked/mac2jb.app")
        try app(destination, version: "1.0.0", fixture: fixture)
        try app(candidate, version: "1.1.0", fixture: fixture)
        return UpdateInstallPlan(directory: directory, destination: destination, version: "1.1.0",
            originalSHA256: try UpdatePackage.sha256(destination.appendingPathComponent("Contents/MacOS/mac2jb")),
            updateSHA256: try UpdatePackage.sha256(candidate.appendingPathComponent("Contents/MacOS/mac2jb")), parentPID: getpid())
    }
    static func main() throws {
        let root = manager.temporaryDirectory.appendingPathComponent("mac2jb-offline-updater-" + UUID().uuidString)
        try manager.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? manager.removeItem(at: root) }
        let fixture = URL(fileURLWithPath: CommandLine.arguments[1])
        try expect(UpdateVersion("0.3.10") > UpdateVersion("0.3.2"), "numeric version ordering")
        try expect(!(UpdateVersion("0.3.1") > UpdateVersion("0.3.2")), "older releases cannot trigger an update")
        for version in ["0.3", "0.3.2-beta", "01.2.3", "1.2.3.4", "../1.2.3"] {
            try rejects("invalid version \(version)") { _ = try UpdateVersion(version) }
        }
        try expect(try release().validated().version.text == "1.2.3", "stable release metadata accepted")
        try rejects("prerelease rejected") { _ = try release { $0["prerelease"] = true }.validated() }
        try rejects("draft rejected") { _ = try release { $0["draft"] = true }.validated() }
        try rejects("missing assets rejected") { _ = try release { $0["assets"] = [] }.validated() }
        try rejects("foreign repository rejected") {
            _ = try release { row in
                var assets = row["assets"] as! [[String: Any]]
                assets[0]["browser_download_url"] = "https://github.com/other/app/releases/download/v1.2.3/mac2jb-v1.2.3-macos-arm64.zip"
                row["assets"] = assets
            }.validated()
        }
        try rejects("oversized archive rejected") {
            _ = try release { row in
                var assets = row["assets"] as! [[String: Any]]; assets[0]["size"] = 300 * 1024 * 1024; row["assets"] = assets
            }.validated()
        }
        try rejects("missing digest rejected") { _ = try UpdateRelease.digest(nil) }
        let digest = String(repeating: "a", count: 64), filename = "mac2jb-v1.2.3-macos-arm64.zip"
        try expect(UpdatePackage.checksum(in: Data("\(digest)  \(filename)\n".utf8), filename: filename) == digest, "checksum entry parsed")
        try rejects("duplicate checksum rejected") {
            _ = try UpdatePackage.checksum(in: Data(String(repeating: "\(digest)  \(filename)\n", count: 2).utf8), filename: filename)
        }
        let setup = try plan(root, fixture: fixture)
        try UpdatePackage.validateApp(setup.candidate, version: setup.version)
        passed += 1; print("PASS real ad-hoc signed fixture validates")
        try rejects("wrong app version rejected") { try UpdatePackage.validateApp(setup.candidate, version: "9.9.9") }
        let archive = root.appendingPathComponent("good.zip")
        _ = try UpdatePackage.run("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--keepParent", setup.candidate.path, archive.path])
        try UpdatePackage.validateArchive(archive)
        passed += 1; print("PASS real single-app ZIP validates")
        let bad = root.appendingPathComponent("bad.zip")
        let bytes = try Data(contentsOf: archive)
        try bytes.prefix(40).write(to: bad)
        try rejects("truncated archive rejected") { try UpdatePackage.validateArchive(bad) }
        var traversal = bytes
        let from = Data("mac2jb.app/Contents/Info.plist".utf8)
        let to = Data("mac2jb.app/../other/Info.plist".utf8)
        precondition(from.count == to.count)
        while let range = traversal.range(of: from) { traversal.replaceSubrange(range, with: to) }
        try traversal.write(to: bad)
        try rejects("archive traversal rejected before extraction") { try UpdatePackage.validateArchive(bad) }
        let link = setup.candidate.appendingPathComponent("Contents/link")
        try manager.createSymbolicLink(at: link, withDestinationURL: fixture)
        _ = try UpdatePackage.run("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--keepParent", setup.candidate.path, bad.path])
        try rejects("archive symlink rejected before extraction") { try UpdatePackage.validateArchive(bad) }
        try manager.removeItem(at: link)
        try UpdateInstaller.install(setup)
        try UpdatePackage.validateApp(setup.destination, version: "1.1.0")
        try UpdatePackage.validateApp(setup.backup, version: "1.0.0")
        passed += 1; print("PASS disposable app replaced with recoverable old-version backup")
        let rollback = try plan(root, fixture: fixture)
        try rejects("injected install failure triggers rollback") {
            try UpdateInstaller.install(rollback) { throw UpdateFailure("injected failure") }
        }
        try UpdatePackage.validateApp(rollback.destination, version: "1.0.0")
        try expect(!manager.fileExists(atPath: rollback.backup.path), "original restored after failed replacement")
        let changed = try plan(root, fixture: fixture)
        let binary = changed.candidate.appendingPathComponent("Contents/MacOS/mac2jb")
        let handle = try FileHandle(forWritingTo: binary); try handle.seekToEnd(); try handle.write(contentsOf: Data([1])); try handle.close()
        try rejects("tampered update cannot replace original") { try UpdateInstaller.install(changed) }
        try UpdatePackage.validateApp(changed.destination, version: "1.0.0")
        try expect(!manager.fileExists(atPath: changed.backup.path), "failed validation leaves original untouched")
        let downgrade = try plan(root, fixture: fixture)
        let older = UpdateInstallPlan(directory: downgrade.directory, destination: downgrade.destination,
            version: "0.9.0", originalSHA256: downgrade.originalSHA256, updateSHA256: downgrade.updateSHA256, parentPID: getpid())
        try rejects("installer independently refuses a downgrade") { try UpdateInstaller.install(older) }
        try UpdatePackage.validateApp(downgrade.destination, version: "1.0.0")
        let afterMove = try plan(root, fixture: fixture)
        try rejects("post-copy validation failure rolls back the original") {
            try UpdateInstaller.install(afterMove) {
                let incoming = afterMove.destination.deletingLastPathComponent()
                    .appendingPathComponent(".mac2jb-incoming-" + afterMove.directory.lastPathComponent + ".app")
                try Data("invalid plist".utf8).write(to: incoming.appendingPathComponent("Contents/Info.plist"))
            }
        }
        try UpdatePackage.validateApp(afterMove.destination, version: "1.0.0")
        try expect(manager.fileExists(atPath: afterMove.directory.appendingPathComponent("failed-update.app").path), "failed replacement retained for diagnosis after restoring original")
        let collision = try plan(root, fixture: fixture)
        try manager.createDirectory(at: collision.backup, withIntermediateDirectories: false)
        try rejects("an existing backup is never overwritten") { try UpdateInstaller.install(collision) }
        try UpdatePackage.validateApp(collision.destination, version: "1.0.0")
        let sleeper = Process()
        sleeper.executableURL = URL(fileURLWithPath: "/bin/sleep"); sleeper.arguments = ["2"]
        try sleeper.run()
        try rejects("helper wait has a deadline and does not stop the parent") {
            try UpdateInstaller.waitForExit(sleeper.processIdentifier, timeout: 0.01)
        }
        try expect(sleeper.isRunning, "timeout leaves the running parent alone")
        sleeper.terminate(); sleeper.waitUntilExit()
        try UpdateInstaller.waitForExit(sleeper.processIdentifier, timeout: 0.01)
        passed += 1; print("PASS helper proceeds only after parent exits")
        print("\(passed) offline updater checks passed; no installed app, driver, or session changed.")
    }
}
