import AppKit
import SwiftUI

final class KeyboardTextView: NSTextView {
    private let ownedTextStorage: NSTextStorage?
    override init(frame frameRect: NSRect, textContainer container: NSTextContainer? = nil) {
        let activeContainer: NSTextContainer
        if let container { activeContainer = container; ownedTextStorage = nil }
        else {
            let storage = NSTextStorage()
            let layout = NSLayoutManager()
            activeContainer = NSTextContainer(size: NSSize(width: frameRect.width, height: .greatestFiniteMagnitude))
            storage.addLayoutManager(layout); layout.addTextContainer(activeContainer)
            ownedTextStorage = storage
        }
        super.init(frame: frameRect, textContainer: activeContainer)
        isRichText = false; importsGraphics = false; drawsBackground = false
        isAutomaticQuoteSubstitutionEnabled = false
        isAutomaticDashSubstitutionEnabled = false
        isAutomaticTextReplacementEnabled = false
        isAutomaticSpellingCorrectionEnabled = false
        isAutomaticTextCompletionEnabled = false
        isAutomaticLinkDetectionEnabled = false
        isAutomaticDataDetectionEnabled = false
        isContinuousSpellCheckingEnabled = false
        isGrammarCheckingEnabled = false
        font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        textColor = .textColor
        isVerticallyResizable = true; isHorizontallyResizable = false
        minSize = NSSize(width: 0, height: frameRect.height)
        maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        autoresizingMask = [.width]
        textContainer?.widthTracksTextView = true
        textContainerInset = NSSize(width: 4, height: 4)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

struct KeyboardTextEditor: NSViewRepresentable {
    @Binding var text: String
    let isEditable: Bool
    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 400, height: 120))
        scroll.hasVerticalScroller = true; scroll.drawsBackground = false
        let editor = KeyboardTextView(frame: scroll.contentView.bounds)
        editor.delegate = context.coordinator
        editor.setAccessibilityLabel("Text to send to the Switch")
        scroll.documentView = editor
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let editor = scroll.documentView as? KeyboardTextView else { return }
        context.coordinator.text = $text
        if editor.string != text { editor.string = text }
        editor.isEditable = isEditable
    }
    final class Coordinator: NSObject, NSTextViewDelegate {
        var text: Binding<String>
        init(text: Binding<String>) { self.text = text }
        func textDidChange(_ notification: Notification) {
            guard let editor = notification.object as? NSTextView else { return }
            text.wrappedValue = editor.string
        }
    }
}

struct KeyboardReportState {
    private(set) var pressed: [UInt16] = []
    private(set) var modifiers: UInt8 = 0
    static let usages: [UInt16: UInt8] = [
        0:4,1:22,2:7,3:9,4:11,5:10,6:29,7:27,8:6,9:25,11:5,12:20,13:26,14:8,15:21,16:28,17:23,
        18:30,19:31,20:32,21:33,22:35,23:34,24:46,25:38,26:36,27:45,28:37,29:39,30:48,31:18,
        32:24,33:47,34:12,35:19,36:40,37:15,38:13,39:52,40:14,41:51,42:49,43:54,44:56,45:17,
        46:16,47:55,48:43,49:44,50:53,51:42,53:41,65:99,67:85,69:87,71:83,75:84,76:88,78:86,
        81:103,82:98,83:89,84:90,85:91,86:92,87:93,88:94,89:95,91:96,92:97,96:62,97:63,98:64,
        99:60,100:65,101:66,103:68,105:104,106:107,107:105,109:67,111:69,113:106,114:73,115:74,
        116:75,117:76,118:61,119:77,120:59,121:78,122:58,123:80,124:79,125:81,126:82]
    var report: [UInt8] {
        let keys = pressed.compactMap { Self.usages[$0] }
        return [modifiers,0] + keys + Array(repeating: 0, count: 6 - keys.count)
    }
    mutating func down(_ code: UInt16, modifiers: UInt8) -> [UInt8]? {
        guard Self.usages[code] != nil, !pressed.contains(code), pressed.count < 6 else { return nil }
        self.modifiers = modifiers; pressed.append(code); return report
    }
    mutating func up(_ code: UInt16, modifiers: UInt8) -> [UInt8]? {
        guard pressed.contains(code) else { return nil }
        self.modifiers = modifiers; pressed.removeAll { $0 == code }; return report
    }
    mutating func flags(_ modifiers: UInt8) -> [UInt8] { self.modifiers = modifiers; return report }
    mutating func release() -> [UInt8] { pressed = []; modifiers = 0; return report }
}

struct KeyboardCaptureView: NSViewRepresentable {
    let active: Bool
    let onReport: ([UInt8]) -> Void
    let onStop: () -> Void
    func makeNSView(context: Context) -> FocusedKeyboardView { FocusedKeyboardView() }
    func updateNSView(_ view: FocusedKeyboardView, context: Context) {
        view.onReport = onReport; view.onStop = onStop
        if view.active && !active { view.releaseKeys() }
        view.active = active; view.needsDisplay = true
    }
}

final class FocusedKeyboardView: NSView {
    var active = false
    var onReport: ([UInt8]) -> Void = { _ in }
    var onStop: () -> Void = {}
    private var state = KeyboardReportState()
    private var observers: [NSObjectProtocol] = []
    override var acceptsFirstResponder: Bool { active }
    override func mouseDown(with event: NSEvent) { if active { window?.makeFirstResponder(self); needsDisplay = true } }
    override func becomeFirstResponder() -> Bool { needsDisplay = true; return active }
    override func resignFirstResponder() -> Bool { releaseKeys(); needsDisplay = true; return true }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        observers.forEach { NotificationCenter.default.removeObserver($0) }; observers = []
        for name in [NSWindow.didResignKeyNotification, NSApplication.didResignActiveNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.releaseKeys(); self?.needsDisplay = true
            })
        }
    }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }
    func releaseKeys() { onReport(state.release()) }
    private var focused: Bool { active && window?.isKeyWindow == true && window?.firstResponder === self && NSApp.isActive }
    private func modifiers(_ flags: NSEvent.ModifierFlags) -> UInt8 {
        var result: UInt8 = 0
        if flags.contains(.control) { result |= 1 }
        if flags.contains(.shift) { result |= 2 }
        if flags.contains(.option) { result |= 4 }
        // Command shortcuts stay on the Mac; they are never sent to the Switch.
        return result
    }
    override func keyDown(with event: NSEvent) {
        guard focused else { return }
        if event.keyCode == 53 { releaseKeys(); onStop(); return }
        if event.modifierFlags.contains(.command) { releaseKeys(); super.keyDown(with: event); return }
        if !event.isARepeat, let report = state.down(event.keyCode, modifiers: modifiers(event.modifierFlags)) { onReport(report) }
    }
    override func keyUp(with event: NSEvent) {
        guard focused else { return }
        if let report = state.up(event.keyCode, modifiers: modifiers(event.modifierFlags)) { onReport(report) }
    }
    override func flagsChanged(with event: NSEvent) {
        guard focused else { return }
        if event.modifierFlags.contains(.command) { releaseKeys(); return }
        onReport(state.flags(modifiers(event.modifierFlags)))
    }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let box = bounds.insetBy(dx: 1, dy: 1)
        NSColor(calibratedRed: 0.03, green: 0.18, blue: 0.15, alpha: 0.65).setFill()
        let path = NSBezierPath(roundedRect: box, xRadius: 16, yRadius: 16); path.fill()
        NSColor(calibratedRed: 0.55, green: 0.98, blue: 0.78, alpha: focused ? 1 : 0.3).setStroke(); path.lineWidth = focused ? 2 : 1; path.stroke()
        let title = active ? (focused ? "Typing goes to your Switch · Esc stops" : "Click here, then type") : "Loading…"
        let attributes: [NSAttributedString.Key:Any] = [.font:NSFont.systemFont(ofSize:13, weight:.medium),.foregroundColor:NSColor.white]
        let text = NSAttributedString(string:title, attributes:attributes)
        text.draw(at: NSPoint(x:18, y:max(10,(bounds.height-text.size().height)/2)))
    }
}
