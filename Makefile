LIBUSBD_DIR ?= vendor/libusbd
SDK := $(shell xcrun --sdk macosx --show-sdk-path)
ARCH ?= arm64
CC := clang
CFLAGS := -std=c11 -D_POSIX_C_SOURCE=200809L -O2 -Wall -Wextra -arch $(ARCH) -isysroot $(SDK) -I$(LIBUSBD_DIR)/include
LDFLAGS := -arch $(ARCH) -L$(LIBUSBD_DIR) -lusbd -framework CoreFoundation -framework IOKit
.PHONY: all deps clean
all: usb-text-sender
usb-text-sender: sender.c $(LIBUSBD_DIR)/libusbd.dylib
	$(CC) $(CFLAGS) -o $@ sender.c $(LDFLAGS)
	codesign -s - $@
$(LIBUSBD_DIR)/libusbd.dylib:
	$(MAKE) -C $(LIBUSBD_DIR)
clean:
	rm -f usb-text-sender
