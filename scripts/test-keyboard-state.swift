import Foundation
import AppKit

@main @MainActor struct KeyboardStateTests {
    static func main() async throws {
        var count=0
        func check(_ value: Bool, _ message: String) { precondition(value,message); count+=1 }
        var state=KeyboardReportState()
        check(state.report==Array(repeating:0,count:8),"initial keys released")
        check(state.down(0,modifiers:0)==[0,0,4,0,0,0,0,0],"physical A maps to USB A")
        check(state.down(0,modifiers:0)==nil,"duplicate/auto-repeat cannot add a held key")
        check(state.down(19,modifiers:1)==[1,0,4,31,0,0,0,0],"Ctrl+2 uses control modifier and USB2")
        check(state.up(0,modifiers:1)==[1,0,31,0,0,0,0,0],"key-up releases only its key")
        check(state.flags(2)==[2,0,31,0,0,0,0,0],"modifier changes preserve held keys")
        check(state.up(19,modifiers:0)==Array(repeating:0,count:8),"final key-up neutral report")
        for code:UInt16 in [0,1,2,3,4,5] { check(state.down(code,modifiers:0) != nil,"six-key rollover") }
        let full=state.report
        check(state.down(6,modifiers:0)==nil && state.report==full,"seventh key never overflows an eight-byte report")
        check(state.down(255,modifiers:0)==nil && state.report==full,"unsupported key is ignored")
        check(state.release()==Array(repeating:0,count:8) && state.pressed.isEmpty && state.modifiers==0,"focus/stop release clears keys and modifiers")
        check(state.up(0,modifiers:0)==nil,"stale key-up is harmless")
        for (code,usage) in KeyboardReportState.usages {
            var one=KeyboardReportState()
            check(one.down(code,modifiers:7)==[7,0,usage,0,0,0,0,0],"supported keys produce canonical bounded reports")
        }
        let view=FocusedKeyboardView(frame:NSRect(x:0,y:0,width:300,height:100))
        var reports:[[UInt8]]=[]
        view.onReport={reports.append($0)}
        view.releaseKeys()
        check(reports==[Array(repeating:0,count:8)],"view release callback contains only neutral report")
        view.active=true
        let event=NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:0,windowNumber:0,context:nil,characters:"a",charactersIgnoringModifiers:"a",isARepeat:false,keyCode:0)!
        view.keyDown(with:event)
        check(reports.count==1,"unfocused capture view forwards no typing")
        let editor=KeyboardTextView(frame:NSRect(x:0,y:0,width:300,height:100))
        check(editor.textStorage != nil && editor.layoutManager != nil,"paste editor owns a working text layout system")
        check(editor.frame.width>0 && editor.textContainer?.widthTracksTextView==true &&
              editor.autoresizingMask.contains(.width) && editor.isVerticallyResizable && !editor.isHorizontallyResizable,
              "paste editor has a real initial width, wraps with its viewport and scrolls vertically")
        check(editor.isEditable && !editor.isRichText && !editor.importsGraphics,"paste editor accepts only editable plain text")
        check(!editor.isAutomaticQuoteSubstitutionEnabled && !editor.isAutomaticDashSubstitutionEnabled &&
              !editor.isAutomaticTextReplacementEnabled && !editor.isAutomaticSpellingCorrectionEnabled &&
              !editor.isAutomaticTextCompletionEnabled,"paste editor disables punctuation and text substitutions")
        let punctuation="PRINT \"quoted\" -- 'literal'\nNEXT\tLINE"
        editor.setSelectedRange(NSRange(location:0,length:0))
        editor.insertText(punctuation,replacementRange:NSRange(location:0,length:0))
        check(editor.string==punctuation,"AppKit editor preserves ASCII quotes, dashes, apostrophes, tabs and newlines: " + String(reflecting:editor.string))
        check(editor.responds(to:#selector(NSText.paste(_:))),"native paste action remains available")
        print("Keyboard state checks passed: \(count). No keyboard events sent to any app or USB device.")
        try await KeyboardTextModelTests.run()
    }
}
