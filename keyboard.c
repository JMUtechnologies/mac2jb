// Focused keyboard forwarding. The parent supplies bounded eight-byte HID
// reports; EOF, a signal or an invalid report always releases held keys.
#define main mac2jb_text_sender_main
#include "sender.c"
#undef main

static bool keyboard_report_valid(const uint8_t report[8]) {
    if (report[1]) return false;
    bool empty = false;
    for (int i=2; i<8; i++) {
        uint8_t key=report[i];
        if (!key) { empty=true; continue; }
        if (empty || key<4 || key>0x73) return false;
        for (int j=2; j<i; j++) if (report[j]==key) return false;
    }
    return true;
}

static int keyboard_stream(libusbd_ctx_t *ctx, uint8_t iface, uint64_t ep, bool validate) {
    uint8_t report[8]; size_t used=0, count=0;
    while (!interrupted) {
        struct pollfd input={.fd=STDIN_FILENO,.events=POLLIN|POLLHUP};
        int state=poll(&input,1,100);
        if (state<0) { if (errno==EINTR) continue; return 1; }
        if (!state) continue;
        if (input.revents&(POLLERR|POLLNVAL)) return 1;
        ssize_t received=read(STDIN_FILENO,report+used,sizeof(report)-used);
        if (received<0) { if (errno==EINTR) continue; return 1; }
        if (!received) {
            if (used) { fputs("Incomplete keyboard report.\n",stderr); return 1; }
            break;
        }
        used+=(size_t)received;
        if (used<sizeof(report)) continue;
        if (!keyboard_report_valid(report)) { fputs("Invalid keyboard report.\n",stderr); return 1; }
        if (!validate && libusbd_ep_write(ctx,iface,ep,report,sizeof(report),250)!=(int)sizeof(report)) {
            fputs("Keyboard connection stopped; input was not retried.\n",stderr); return 1;
        }
        used=0; count++;
        // Counts confirm delivery without exposing keys or pasted text.
        if (!validate) { printf("MAC2JB_KEYBOARD_SENT %zu\n",count); fflush(stdout); }
    }
    if (validate) printf("Validated %zu keyboard reports; no USB initialized.\n",count);
    return interrupted ? 130 : 0;
}

int main(int argc,char **argv) {
    bool validate=false;
    if (argc>2) { fputs("Unsupported keyboard options.\n",stderr); return 2; }
    if (argc==2) {
        if (!strcmp(argv[1],"--validate")) validate=true;
        else if (!strcmp(argv[1],"--help") || !strcmp(argv[1],"--self-test")) {
            puts("mac2jb-keyboard: bounded HID reports on stdin; --validate never initializes USB."); return 0;
        } else { fputs("Unsupported keyboard option.\n",stderr); return 2; }
    }
    signal(SIGINT,on_interrupt); signal(SIGTERM,on_interrupt); signal(SIGPIPE,SIG_IGN);
    if (validate) return keyboard_stream(NULL,0,0,true);
    const char *controller=getenv("MAC2JB_CONTROLLER");
    if (!controller || strncmp(controller,"usb-drd",7) || !controller[7] ||
        strlen(controller+7)>2 || (controller[7]=='0' && controller[8]) ||
        strspn(controller+7,"0123456789")!=strlen(controller+7) || atoi(controller+7)>15) {
        fputs("Choose a controller through the app before opening the keyboard.\n",stderr); return 2;
    }
    int timeout=4;
#ifdef MAC2JB_GUI
    timeout=mac2jb_gui_enumeration_timeout();
    if (timeout<0) return 2;
#endif
    libusbd_ctx_t *ctx=NULL; uint8_t iface=0; uint64_t ep=0;
    bool endpoint_ready=false; int result=1;
    if (libusbd_init(&ctx)<0 || !ctx) { fputs("Could not open USB keyboard.\n",stderr); goto done; }
    libusbd_set_pid(ctx,0x1234); libusbd_set_version(ctx,0x0100);
    libusbd_set_class(ctx,0); libusbd_set_subclass(ctx,0); libusbd_set_protocol(ctx,0);
    libusbd_set_manufacturer_str(ctx,"mac2jb"); libusbd_set_product_str(ctx,"USB HID Keyboard");
    libusbd_set_serial_str(ctx,"MAC2JBKEYBOARD");
    if (libusbd_iface_alloc(ctx,&iface)<0 || libusbd_config_finalize(ctx)<0) goto done;
    libusbd_iface_set_class(ctx,iface,3); libusbd_iface_set_subclass(ctx,iface,1); libusbd_iface_set_protocol(ctx,iface,1);
    uint8_t hid_desc[]={9,0x21,0x11,1,0,1,0x22,0,0};
    uint8_t report_desc[]={
        0x05,0x01,0x09,0x06,0xA1,0x01,0x05,0x07,0x19,0xE0,0x29,0xE7,0x15,0x00,0x25,0x01,
        0x75,0x01,0x95,0x08,0x81,0x02,0x95,0x01,0x75,0x08,0x81,0x01,0x95,0x03,0x75,0x01,
        0x05,0x08,0x19,0x01,0x29,0x03,0x91,0x02,0x95,0x05,0x75,0x01,0x91,0x01,0x95,0x06,
        0x75,0x08,0x15,0x00,0x26,0xFF,0x00,0x05,0x07,0x19,0x00,0x2A,0xFF,0x00,0x81,0x00,0xC0};
    hid_desc[7]=(uint8_t)sizeof(report_desc);
    libusbd_iface_standard_desc(ctx,iface,0x21,0xF,hid_desc,sizeof(hid_desc));
    libusbd_iface_nonstandard_desc(ctx,iface,0x22,0xF,report_desc,sizeof(report_desc));
    if (libusbd_iface_add_endpoint(ctx,iface,USB_EPATTR_TTYPE_INTR,USB_EP_DIR_IN,8,10,0,&ep)<0 ||
        libusbd_iface_finalize(ctx,iface)<0) goto done;
    endpoint_ready=true;
    double deadline=seconds_now()+timeout; bool ready=false; uint8_t released[8]={0};
    while (!interrupted && seconds_now()<deadline) {
        int32_t status=libusbd_ep_write(ctx,iface,ep,released,sizeof(released),250);
        if (status==(int)sizeof(released)) { ready=true; break; }
        if (status!=LIBUSBD_NOT_ENUMERATED && status!=LIBUSBD_TIMEOUT) {
            fputs("USB keyboard enumeration failed; no input sent.\n",stderr); goto done;
        }
        struct timespec delay={0,100000000L}; nanosleep(&delay,NULL);
    }
    if (interrupted) { result=130; goto done; }
    if (!ready) { fputs("USB host did not enumerate a keyboard.\n",stderr); goto done; }
    puts("MAC2JB_KEYBOARD_READY"); fflush(stdout);
    result=keyboard_stream(ctx,iface,ep,false);
done:
    if (ctx) {
        bool released=false;
        if (endpoint_ready) {
            uint8_t empty[8]={0};
            for (int attempt=0;attempt<3;attempt++) {
                if (libusbd_ep_write(ctx,iface,ep,empty,sizeof(empty),250)==(int)sizeof(empty)) { released=true; break; }
            }
        }
        libusbd_free(ctx);
        if (released) { puts("MAC2JB_KEYBOARD_RELEASED"); fflush(stdout); }
        else if (endpoint_ready) { fputs("Could not confirm key release; reconnect the USB cable if a key repeats.\n",stderr); result=1; }
    }
    return result;
}
