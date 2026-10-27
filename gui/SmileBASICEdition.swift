import Foundation

// Demo SAVE collects every program line before writing TXT:NS2.
enum SmileBASICEdition: String, CaseIterable {
    case full, demo
    var saveCommands: [String] {
        self == .demo ? ["PRGEDIT 0:C$=\"\":FOR I=0 TO PRGSIZE(0)-1:C$=C$+PRGGET$() :NEXT:SAVEV \"TXT:NS2\",C$"] : ["SAVE \"NS2\""]
    }
    var loadCommand: String {
        self == .demo ? "PRGEDIT 0:LOADV \"TXT:NS2\" OUT C$:PRGSET C$" : "LOAD \"TXT:NS2\""
    }
    var commandArguments: [String] { self == .demo ? ["--demo"] : [] }
    var requiresLoadConfirmation: Bool { true }
    var saveInstructions: String {
        "The bootstrap has finished typing. Press X on the Switch controller to return to Direct mode. Confirm that the command prompt is empty, then choose Type save command. Overwrite the existing NS2 file if prompted."
    }
    var savedConfirmation: String { "NS2 is saved in slot 0 and I have entered Direct mode" }
}

// Only these known profiles can reach the Stremio helper. Invalid saved values
// fall back to 720p instead of becoming command-line arguments.
enum StremioQuality: String, CaseIterable, Identifiable {
    case p720 = "720p", p540 = "540p", p360 = "360p", p180 = "180p"
    static let preferenceKey = "stremioQuality"
    var id: String { rawValue }
    var label: String { rawValue }
    static func saved(defaults: UserDefaults = .standard) -> Self {
        defaults.string(forKey: preferenceKey).flatMap(Self.init(rawValue:)) ?? .p720
    }
}
