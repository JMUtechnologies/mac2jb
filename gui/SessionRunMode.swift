import Foundation

struct SessionPostRunAction: Equatable {
    let keepRPC: Bool
    let dumpFirmware: Bool
    var control: [String: Any] {
        ["action": "post-run", "keepRPC": keepRPC, "dumpFirmware": dumpFirmware]
    }
}

enum SessionRunMode: String, CaseIterable, Identifiable {
    case bootstrapOnly, exploitOnly, heldRPC, systemCodeDump
    var id: String { rawValue }
    var number: Int { Self.allCases.firstIndex(of: self)! + 1 }
    var requiresHost: Bool { self != .bootstrapOnly }
    var title: String {
        switch self {
        case .bootstrapOnly: return "Type bootstrap only"
        case .exploitOnly: return "NS2JB exploit only"
        case .heldRPC: return "Held RPC"
        case .systemCodeDump: return "System-code dump"
        }
    }
    var caption: String {
        switch self {
        case .bootstrapOnly: return "Type bootstrap.bas into the editor, then save it as NS2."
        case .exploitOnly: return "Run the exploit and finish after verification."
        case .heldRPC: return "Run the exploit, then keep RPC open."
        case .systemCodeDump: return "Run the exploit, save system code, then finish."
        }
    }
    var icon: String {
        switch self {
        case .bootstrapOnly: return "keyboard"
        case .exploitOnly: return "bolt"
        case .heldRPC: return "cable.connector"
        case .systemCodeDump: return "externaldrive"
        }
    }
    var startTitle: String {
        switch self {
        case .bootstrapOnly: return "Type bootstrap"
        case .exploitOnly: return "Start exploit"
        case .heldRPC: return "Start held RPC"
        case .systemCodeDump: return "Start system-code dump"
        }
    }
    var postRunAction: SessionPostRunAction? {
        switch self {
        case .bootstrapOnly, .exploitOnly: return nil
        case .heldRPC: return SessionPostRunAction(keepRPC: true, dumpFirmware: false)
        case .systemCodeDump: return SessionPostRunAction(keepRPC: false, dumpFirmware: true)
        }
    }
    func hostArguments(address: String) -> [String]? {
        guard requiresHost else { return nil }
        return ["host", address] + (postRunAction == nil ? [] : ["--post-run-options"])
    }
}
