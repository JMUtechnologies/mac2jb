// USB HID text sender based on the libusbd keyboard example by shinyquagsire23.
// This program TYPES a file; it does not execute its contents.
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>
#include <libusbd.h>

typedef struct { uint8_t key, mods; } Stroke;
static volatile sig_atomic_t interrupted = 0;
static void on_interrupt(int signal_number) { (void)signal_number; interrupted = 1; }
static int encode(unsigned char c, Stroke *out) {
    out->mods = 0;
    if (c >= 'a' && c <= 'z') { out->key = 4 + c - 'a'; return 1; }
    if (c >= 'A' && c <= 'Z') { out->key = 4 + c - 'A'; out->mods = 2; return 1; }
    if (c >= '1' && c <= '9') { out->key = 30 + c - '1'; return 1; }
    if (c == '0') { out->key = 39; return 1; }
    if (c == '\n') { out->key = 40; return 1; }
    if (c == '\t') { out->key = 43; return 1; }
    if (c == ' ') { out->key = 44; return 1; }
    const char *unshifted = "-=[]\\;',./`";
    const char *shifted   = "_+{}|:\"<>?~";
    for (int i=0; unshifted[i]; i++) {
        if (c == (unsigned char)unshifted[i] || c == (unsigned char)shifted[i]) {
            static const uint8_t codes[] = {45,46,47,48,49,51,52,54,55,56,53};
            out->key=codes[i]; out->mods=(c == (unsigned char)shifted[i])?2:0; return 1;
        }
    }
    const char *shift_digits = "!@#$%^&*()";
    for (int i=0; i<10; i++) if(c == (unsigned char)shift_digits[i]) {
        out->key=(i==9)?39:(30+i); out->mods=2; return 1;
    }
    return 0;
}
static int write_report(libusbd_ctx_t *ctx, uint8_t iface, uint64_t endpoint, uint8_t mods, uint8_t key) {
    uint8_t report[8] = {mods,0,key,0,0,0,0,0};
    for (int retry=0; retry<5 && !interrupted; retry++) {
        int32_t r = libusbd_ep_write(ctx, iface, endpoint, report, sizeof(report), 1000);
        if (r >= 0) return 0;
        if (r == LIBUSBD_NOT_ENUMERATED || r == LIBUSBD_TIMEOUT) { sleep(1); continue; }
        fprintf(stderr, "USB write failed: 0x%08x\n", (unsigned)r);
        return -1;
    }
    return -1;
}
static unsigned char *read_text(const char *path, size_t *length) {
    FILE *f=fopen(path,"rb"); if(!f){perror(path);return NULL;}
    if(fseek(f,0,SEEK_END)!=0){fclose(f);return NULL;}
    long count=ftell(f); if(count<0 || count>10*1024*1024){fprintf(stderr,"File too large or unreadable\n");fclose(f);return NULL;}
    rewind(f);
    unsigned char *buf=malloc((size_t)count+1); if(!buf){fclose(f);return NULL;}
    if(fread(buf,1,(size_t)count,f)!=(size_t)count){fprintf(stderr,"Cannot read file\n");free(buf);fclose(f);return NULL;}
    fclose(f); *length=(size_t)count; return buf;
}
static void usage(const char *exe) { fprintf(stderr,"Usage: %s <file.bas> [--dry-run] [--delay-ms N]\n",exe); }
int main(int argc, char **argv) {
    if(argc < 2){usage(argv[0]);return 2;}
    int dry=0, delay_ms=35;
    for(int a=2;a<argc;a++) {
        if(strcmp(argv[a],"--dry-run")==0) dry=1;
        else if(strcmp(argv[a],"--delay-ms")==0 && a+1<argc) {
            char *end=NULL; long v=strtol(argv[++a],&end,10);
            if(!end || *end || v<5 || v>2000){fprintf(stderr,"Delay must be 5..2000 ms\n");return 2;}
            delay_ms=(int)v;
        } else {usage(argv[0]);return 2;}
    }
    size_t bytes=0; unsigned char *data=read_text(argv[1],&bytes); if(!data)return 1;
    size_t characters=0, lines=0;
    for(size_t i=0;i<bytes;i++) {
        if(data[i]=='\r' && i+1<bytes && data[i+1]=='\n')continue;
        Stroke stroke;
        if(!encode(data[i],&stroke)) {
            fprintf(stderr,"Unsupported byte 0x%02X at offset %zu (line %zu). ASCII US keyboard layout required.\n",data[i],i,lines+1);
            free(data);return 1;
        }
        characters++; if(data[i]=='\n')lines++;
    }
    printf("Verified %zu input bytes, %zu keystrokes, %zu newline(s).\n",bytes,characters,lines);
    if(dry){puts("Dry run complete; no USB device created and no keys sent.");free(data);return 0;}
    printf("This will TYPE the file into the connected device. It will NOT press RUN.\n");
    printf("Focus the intended EMPTY text editor on the target, then type SEND and Enter here: ");fflush(stdout);
    char approval[32]; if(!fgets(approval,sizeof(approval),stdin) || strcmp(approval,"SEND\n")!=0){free(data);puts("Cancelled.");return 1;}
    signal(SIGINT,on_interrupt);
    libusbd_ctx_t *ctx=NULL;
    int result=1;
    if(libusbd_init(&ctx)<0 || !ctx){fprintf(stderr,"libusbd_init failed; check usbgadget.kext.\n");goto done;}
    libusbd_set_pid(ctx,0x1234); libusbd_set_version(ctx,0x0100);
    libusbd_set_class(ctx,0);libusbd_set_subclass(ctx,0);libusbd_set_protocol(ctx,0);
    libusbd_set_manufacturer_str(ctx,"USB text sender");libusbd_set_product_str(ctx,"USB HID Keyboard");
    libusbd_set_serial_str(ctx,"TEXTSENDER01");
    uint8_t iface=0;uint64_t ep=0;
    if(libusbd_iface_alloc(ctx,&iface)<0 || libusbd_config_finalize(ctx)<0){fprintf(stderr,"USB configuration failed\n");goto done;}
    libusbd_iface_set_class(ctx,iface,3);libusbd_iface_set_subclass(ctx,iface,1);libusbd_iface_set_protocol(ctx,iface,1);
    uint8_t hid_desc[]={0x09,0x21,0x11,0x01,0x00,0x01,0x22,0x5D,0x00};
    uint8_t hid_report_desc[]={
        0x05,0x01,0x09,0x06,0xA1,0x01,0x05,0x07,0x19,0xE0,0x29,0xE7,0x15,0x00,0x25,0x01,
        0x75,0x01,0x95,0x08,0x81,0x02,0x95,0x01,0x75,0x08,0x81,0x01,0x95,0x03,0x75,0x01,
        0x05,0x08,0x19,0x01,0x29,0x03,0x91,0x02,0x95,0x05,0x75,0x01,0x91,0x01,0x95,0x06,
        0x75,0x08,0x15,0x00,0x26,0xFF,0x00,0x05,0x07,0x19,0x00,0x2A,0xFF,0x00,0x81,0x00,0xC0
    };
    libusbd_iface_standard_desc(ctx,iface,0x21,0xF,hid_desc,sizeof(hid_desc));
    libusbd_iface_nonstandard_desc(ctx,iface,0x22,0xF,hid_report_desc,sizeof(hid_report_desc));
    if(libusbd_iface_add_endpoint(ctx,iface,USB_EPATTR_TTYPE_INTR,USB_EP_DIR_IN,8,10,0,&ep)<0 || libusbd_iface_finalize(ctx,iface)<0){fprintf(stderr,"USB interface setup failed\n");goto done;}
    puts("Waiting for USB host enumeration...");
    uint8_t empty[8]={0};int ready=0;
    for(int attempt=0;attempt<30 && !interrupted;attempt++){
        int32_t r=libusbd_ep_write(ctx,iface,ep,empty,sizeof(empty),500);
        if(r>=0){ready=1;break;}
        if(r!=LIBUSBD_NOT_ENUMERATED && r!=LIBUSBD_TIMEOUT){fprintf(stderr,"USB enumeration error: 0x%08x\n",(unsigned)r);break;}
        sleep(1);
    }
    if(!ready){fprintf(stderr,"USB host did not enumerate a keyboard.\n");goto done;}
    puts("Keyboard enumerated. Sending...");fflush(stdout);
    size_t sent_lines=0;
    for(size_t i=0;i<bytes && !interrupted;i++) {
        if(data[i]=='\r' && i+1<bytes && data[i+1]=='\n')continue;
        Stroke s;encode(data[i],&s);
        if(write_report(ctx,iface,ep,s.mods,s.key)<0 || write_report(ctx,iface,ep,0,0)<0){fprintf(stderr,"Transfer stopped at input offset %zu; target content may be partial.\n",i);goto done;}
        struct timespec pause_time = {delay_ms/1000, (long)(delay_ms%1000)*1000000L};
        nanosleep(&pause_time, NULL);
        if(data[i]=='\n') {printf("\rSent line %zu", ++sent_lines);fflush(stdout);}
    }
    if(interrupted){fprintf(stderr,"\nInterrupted; target content may be partial.\n");goto done;}
    puts("\nFinished sending. Verify the text on the target before saving it."); result=0;
done:
    if(ctx)libusbd_free(ctx);
    free(data);return result;
}
