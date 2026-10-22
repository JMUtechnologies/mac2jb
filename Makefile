LIBUSBD_DIR := vendor/libusbd
ARCH ?= arm64
CC := clang
SDK := $(shell xcrun --sdk macosx --show-sdk-path)
CFLAGS := -std=c11 -D_POSIX_C_SOURCE=200809L -O2 -Wall -Wextra -arch $(ARCH) -isysroot $(SDK) -I$(LIBUSBD_DIR)/include
LDFLAGS := -arch $(ARCH) -L$(LIBUSBD_DIR) -lusbd -framework CoreFoundation -framework IOKit
.PHONY: all clean check-deps
all: check-deps mac2jb-send
check-deps:
	@test -f $(LIBUSBD_DIR)/Makefile || (echo 'Missing vendored libusbd. Repository owner: run ./scripts/freeze-upstream.sh ONCE, then commit vendor/ and assets/.'; exit 1)
mac2jb-send: sender.c $(LIBUSBD_DIR)/libusbd.dylib
	$(CC) $(CFLAGS) -o $@ sender.c $(LDFLAGS)
	codesign -s - $@
$(LIBUSBD_DIR)/libusbd.dylib:
	$(MAKE) -C $(LIBUSBD_DIR)
clean:
	rm -f mac2jb-send
