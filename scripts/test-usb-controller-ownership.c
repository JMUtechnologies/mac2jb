// Read-only ownership checks against the actual controller-wrapper source.
// Registry property writes are blocked even if a test accidentally requests one.
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <stdio.h>

static int allocations, successful_allocations, deallocations, retains, releases, property_writes;
static int fail_allocation, fail_retain, missing_service;
static CFAllocatorRef allocated_with, deallocated_with;

static void *tracked_allocate(CFAllocatorRef allocator, CFIndex size, CFOptionFlags hint) {
    allocations++;
    allocated_with = allocator;
    void *pointer = fail_allocation ? NULL : CFAllocatorAllocate(allocator, size, hint);
    if (pointer) successful_allocations++;
    return pointer;
}
static void tracked_deallocate(CFAllocatorRef allocator, void *pointer) {
    deallocations++;
    deallocated_with = allocator;
    CFAllocatorDeallocate(allocator, pointer);
}
static kern_return_t tracked_retain(io_object_t object) {
    retains++;
    if (fail_retain) return KERN_INVALID_ARGUMENT;
#ifdef MAC2JB_TEST_OMIT_CONTROLLER_RETAIN
    // Negative control reproduces the original omitted-retain behavior.
    return KERN_SUCCESS;
#else
    return IOObjectRetain(object);
#endif
}
static kern_return_t tracked_release(io_object_t object) {
    releases++;
    return IOObjectRelease(object);
}
static io_service_t discovered_root(mach_port_t port, CFDictionaryRef matching) {
    // This substitutes only discovery, never creates/configures a USB service.
    CFRelease(matching);
    return missing_service ? IO_OBJECT_NULL : IORegistryGetRootEntry(kIOMainPortDefault);
}
static kern_return_t blocked_properties(io_registry_entry_t entry, CFTypeRef properties) {
    property_writes++;
    return kIOReturnUnsupported;
}

#define CFAllocatorAllocate tracked_allocate
#define CFAllocatorDeallocate tracked_deallocate
#define IOObjectRetain tracked_retain
#define IOObjectRelease tracked_release
#define IOServiceGetMatchingService discovered_root
#define IORegistryEntrySetCFProperties blocked_properties
#ifndef MAC2JB_CONTROLLER_SOURCE
#define MAC2JB_CONTROLLER_SOURCE "../vendor/libusbd/src/plat/macos/alt_IOUSBDeviceControllerLib.c"
#endif
#include MAC2JB_CONTROLLER_SOURCE
#undef CFAllocatorAllocate
#undef CFAllocatorDeallocate
#undef IOObjectRetain
#undef IOObjectRelease
#undef IOServiceGetMatchingService
#undef IORegistryEntrySetCFProperties

#define CHECK(condition, message) do { if (!(condition)) { \
    fprintf(stderr, "FAIL: %s\n", message); return 1; \
} } while (0)

static int test_independent_reference(io_registry_entry_t root) {
    alt_IOUSBDeviceControllerRef wrapper = NULL;
    const uint32_t before = IOObjectGetUserRetainCount(root);
    CHECK(alt_IOUSBDeviceControllerCreateFromService(kCFAllocatorDefault, root, &wrapper) == kIOReturnSuccess && wrapper,
          "wrapper creation failed");
    if (IOObjectGetUserRetainCount(root) != before + 1) {
        // Do not trigger a second release of an unowned/invalid port in the
        // negative control. Process exit cleans its still-owned registry rights.
        CFAllocatorDeallocate(kCFAllocatorDefault, wrapper);
        fprintf(stderr, "FAIL: wrapper did not acquire an independent IOKit reference\n");
        return 1;
    }
    CHECK(IOObjectRelease(root) == KERN_SUCCESS, "caller release failed");
    CHECK(IOObjectGetUserRetainCount(root) == before, "caller release consumed wrapper ownership");
    io_name_t name;
    CHECK(IORegistryEntryGetName(root, name) == KERN_SUCCESS, "registry handle is invalid after caller release");
    const int release_count = releases, free_count = deallocations;
    alt_IOUSBDeviceControllerRelease(wrapper);
    CHECK(IOObjectGetUserRetainCount(root) == before - 1 && releases == release_count + 1,
          "wrapper release did not balance its independent reference");
    CHECK(deallocations == free_count, "Release changed caller-owned wrapper storage semantics");
    alt_IOUSBDeviceControllerRelease(wrapper);
    CHECK(IOObjectGetUserRetainCount(root) == before - 1 && releases == release_count + 1,
          "a cleared live wrapper released the service twice");
    // The real backend also deallocates storage separately. Never use it afterward.
    tracked_deallocate(kCFAllocatorDefault, wrapper);
    puts("PASS independent real IOKit reference survives caller release and balances once");
    return 0;
}

static int test_multiple_wrappers(io_registry_entry_t root) {
    const uint32_t before = IOObjectGetUserRetainCount(root);
    alt_IOUSBDeviceControllerRef first = NULL, second = NULL;
    CHECK(alt_IOUSBDeviceControllerCreateFromService(kCFAllocatorDefault, root, &first) == kIOReturnSuccess,
          "first independent wrapper failed");
    CHECK(alt_IOUSBDeviceControllerCreateFromService(kCFAllocatorDefault, root, &second) == kIOReturnSuccess,
          "second independent wrapper failed");
    CHECK(IOObjectGetUserRetainCount(root) == before + 2, "wrappers share one borrowed reference");
    alt_IOUSBDeviceControllerRelease(first);
    CHECK(IOObjectGetUserRetainCount(root) == before + 1, "first wrapper released another owner's reference");
    alt_IOUSBDeviceControllerRelease(second);
    CHECK(IOObjectGetUserRetainCount(root) == before, "multiple wrapper references leaked");
    tracked_deallocate(kCFAllocatorDefault, first);
    tracked_deallocate(kCFAllocatorDefault, second);
    puts("PASS two wrappers own and release separate references");
    return 0;
}

static int test_failures(io_registry_entry_t root) {
    const uint32_t before = IOObjectGetUserRetainCount(root);
    alt_IOUSBDeviceControllerRef wrapper = (void *)1;
    int a = allocations, d = deallocations, r = retains, release_count = releases;
    CHECK(alt_IOUSBDeviceControllerCreateFromService(kCFAllocatorDefault, root, NULL) == kIOReturnBadArgument,
          "null service output was accepted");
    CHECK(alt_IOUSBDeviceControllerCreate(kCFAllocatorDefault, NULL) == kIOReturnBadArgument,
          "null discovery output was accepted");
    CHECK(alt_IOUSBDeviceControllerCreateFromService(kCFAllocatorDefault, IO_OBJECT_NULL, &wrapper) == kIOReturnNotFound && !wrapper,
          "null service did not leave a null output");
    alt_IOUSBDeviceControllerRelease(NULL);
    CHECK(allocations == a && deallocations == d && retains == r && releases == release_count,
          "null inputs changed ownership");
    puts("PASS null wrapper, service and output handling");

    fail_allocation = 1; wrapper = (void *)1;
    CHECK(alt_IOUSBDeviceControllerCreateFromService(kCFAllocatorDefault, root, &wrapper) == kIOReturnNoMemory && !wrapper,
          "allocation failure published a wrapper");
    fail_allocation = 0;
    CHECK(allocations == a + 1 && deallocations == d && retains == r && releases == release_count &&
          IOObjectGetUserRetainCount(root) == before, "allocation failure changed caller ownership");
    puts("PASS allocation failure leaves caller ownership intact");

    a = allocations; d = deallocations; fail_retain = 1; wrapper = (void *)1;
    CHECK(alt_IOUSBDeviceControllerCreateFromService(kCFAllocatorSystemDefault, root, &wrapper) == kIOReturnNoMemory && !wrapper,
          "retain failure published a wrapper");
    fail_retain = 0;
    CHECK(allocations == a + 1 && deallocations == d + 1 && retains == r + 1 && releases == release_count &&
          allocated_with == kCFAllocatorSystemDefault && deallocated_with == allocated_with &&
          IOObjectGetUserRetainCount(root) == before, "retain failure leaked storage or consumed the caller reference");
    puts("PASS retain failure deallocates with the original allocator and does not release an unowned service");
    return 0;
}

static int test_discovery(io_registry_entry_t root) {
    const uint32_t before = IOObjectGetUserRetainCount(root);
    alt_IOUSBDeviceControllerRef wrapper = NULL;
    CHECK(alt_IOUSBDeviceControllerCreate(kCFAllocatorDefault, &wrapper) == kIOReturnSuccess && wrapper,
          "discovery constructor failed");
    CHECK(IOObjectGetUserRetainCount(root) == before + 1, "discovery did not transfer one independently retained reference");
    alt_IOUSBDeviceControllerRelease(wrapper);
    tracked_deallocate(kCFAllocatorDefault, wrapper);
    CHECK(IOObjectGetUserRetainCount(root) == before, "discovery constructor ownership leaked");
    fail_retain = 1; wrapper = (void *)1;
    CHECK(alt_IOUSBDeviceControllerCreate(kCFAllocatorDefault, &wrapper) == kIOReturnNoMemory && !wrapper,
          "discovery retain failure published a wrapper");
    fail_retain = 0;
    CHECK(IOObjectGetUserRetainCount(root) == before, "discovery failure leaked its temporary owned service");
    missing_service = 1; wrapper = (void *)1;
    CHECK(alt_IOUSBDeviceControllerCreate(kCFAllocatorDefault, &wrapper) == kIOReturnNotFound && !wrapper,
          "missing discovery service did not clear the output");
    missing_service = 0;
    puts("PASS discovery releases its temporary reference on both success and failure");
    return 0;
}

int main(void) {
    io_registry_entry_t root = IORegistryGetRootEntry(kIOMainPortDefault);
    CHECK(root != IO_OBJECT_NULL, "read-only IOKit registry root is unavailable");
    // Keep one guard reference to inspect counts safely after caller/wrapper release.
    CHECK(IOObjectRetain(root) == KERN_SUCCESS, "could not retain registry observation reference");
    if (test_independent_reference(root) || test_multiple_wrappers(root) || test_failures(root) || test_discovery(root)) return 1;
    CHECK(IOObjectGetUserRetainCount(root) == 1, "final observation reference count is unbalanced");
    CHECK(IOObjectRelease(root) == KERN_SUCCESS, "final registry observation release failed");
    CHECK(successful_allocations == deallocations, "wrapper allocation/deallocation accounting is unbalanced");
    CHECK(property_writes == 0, "test attempted an IOKit registry property write");
    puts("7 controller ownership checks passed; registry reads only, no USB configuration or typing.");
    return 0;
}
