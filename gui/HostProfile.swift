import Foundation

enum HostProfile: String, CaseIterable, Identifiable, Codable {
    case pepsipu, kurumuz
    case bermTheSequel = "BermTheSequel"

    var id: String { rawValue }
    var label: String { rawValue }
    var supportsHeldRPC: Bool { self != .pepsipu }
    // The pinned kurumuz source still rejects the demo application title at 4/4.
    var supportsDemo: Bool { self == .bermTheSequel }
    var startArgumentCount: Int { self == .pepsipu ? 9 : 5 }
    static let preferenceKey = "developerHostProfile"
    static func saved(defaults: UserDefaults = .standard) -> Self {
        defaults.string(forKey: preferenceKey).flatMap(Self.init(rawValue:)) ?? .bermTheSequel
    }
}
