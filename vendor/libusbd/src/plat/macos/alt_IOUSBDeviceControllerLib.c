/*
 * mac2jb downstream modification notice (IOKit controller ownership)
 *
 * Modified by: cpypwn (mac2jb integration)
 * 2026-10-26: Retain an independent IOKit service reference for each controller
 *             wrapper; discard the wrapper if retaining fails. Validate output
 *             pointers and clear the service on release, including null handling.
 *             Wrapper storage remains caller-owned and is deallocated separately.
 *
 * Based on: https://github.com/shinyquagsire23/libusbd
 * Original upstream copyright and license terms are preserved below and in LICENSE.
 */

/*
 *  alt_IOUSBDeviceLib.c
 *  alt_IOUSBDeviceFamily
 *
 *  Created by Paul Chinn on 11/6/07.
 *  Copyright 2008 Apple Inc. All rights reserved.
 *
 */

#include <pthread.h>
//#include <CoreFoundation/CFRuntime.h>
#include <IOKit/IOKitLib.h>
#include <sys/sysctl.h>

#include "alt_IOUSBDeviceControllerLib.h"

static alt_IOUSBDeviceControllerRef __deviceRefFromService(CFAllocatorRef allocator, io_service_t service);

#define DESTROY(thing) if(thing) CFRelease(thing)

typedef struct __alt_IOUSBDeviceDescription
	{
		CFMutableDictionaryRef			info;
		CFAllocatorRef					allocator;
	}__alt_IOUSBDeviceDescription;

typedef struct __alt_IOUSBDeviceController
{
	io_service_t					deviceIOService; //io service represeniting the underlying device controller
	
} __alt_IOUSBDeviceController, *__alt_IOUSBDeviceControllerRef;

static alt_IOUSBDeviceControllerRef __deviceRefFromService(CFAllocatorRef allocator, io_service_t service)
{
    alt_IOUSBDeviceControllerRef device = NULL;
	void *          offset  = NULL;
    uint32_t        size;
	size    = sizeof(__alt_IOUSBDeviceController);
    device = (alt_IOUSBDeviceControllerRef)CFAllocatorAllocate(
															allocator, 
															size, 
															0);
    
    if (!device)
		return NULL;
	
    offset = device;
    bzero(offset, size);

	if (IOObjectRetain(service) != KERN_SUCCESS) {
		CFAllocatorDeallocate(allocator, device);
		return NULL;
	}
	device->deviceIOService = service;
    return device;
}

IOReturn alt_IOUSBDeviceControllerCreate(     
								   CFAllocatorRef          allocator,
									alt_IOUSBDeviceControllerRef* deviceRefPtr
								   )
{    
    CFMutableDictionaryRef 	matchingDict;
	io_service_t		deviceIOService;
	alt_IOUSBDeviceControllerRef		deviceRef;
	if (!deviceRefPtr)
		return kIOReturnBadArgument;
	*deviceRefPtr = NULL;
	matchingDict = IOServiceMatching("alt_IOUSBDeviceController");
	if (!matchingDict)
		return kIOReturnNoMemory;
	
	deviceIOService = IOServiceGetMatchingService(kIOMainPortDefault, matchingDict);
	if(!deviceIOService)
		return kIOReturnNotFound;
	deviceRef = __deviceRefFromService(allocator, deviceIOService);
	IOObjectRelease(deviceIOService);
	if(deviceRef == NULL)
		return kIOReturnNoMemory;
	*deviceRefPtr = deviceRef;
	return kIOReturnSuccess;
}

IOReturn alt_IOUSBDeviceControllerCreateFromService(     
								   CFAllocatorRef          allocator,
								   io_service_t deviceIOService,
									alt_IOUSBDeviceControllerRef* deviceRefPtr
								   )
{    
	alt_IOUSBDeviceControllerRef		deviceRef;
	if (!deviceRefPtr)
		return kIOReturnBadArgument;
	*deviceRefPtr = NULL;

	if(!deviceIOService)
		return kIOReturnNotFound;
	deviceRef = __deviceRefFromService(allocator, deviceIOService);
	//IOObjectRelease(deviceIOService);
	if(deviceRef == NULL)
		return kIOReturnNoMemory;
	*deviceRefPtr = deviceRef;
	return kIOReturnSuccess;
}

IOReturn alt_IOUSBDeviceControllerGoOffAndOnBus(alt_IOUSBDeviceControllerRef device, uint32_t msecdelay)
{
	CFNumberRef delay = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &msecdelay);
	if(!delay)
		return kIOReturnNoMemory;
	return alt_IOUSBDeviceControllerSendCommand(device, CFSTR("GoOffAndOnBus"), delay);
}

IOReturn alt_IOUSBDeviceControllerForceOffBus(alt_IOUSBDeviceControllerRef device, int enable)
{
	if(enable)
		return alt_IOUSBDeviceControllerSendCommand(device, CFSTR("ForceOffBusEnable"), NULL);
	else
		return alt_IOUSBDeviceControllerSendCommand(device, CFSTR("ForceOffBusDisable"), NULL);
}

void alt_IOUSBDeviceControllerRelease( alt_IOUSBDeviceControllerRef device )
{
    if (device && device->deviceIOService != IO_OBJECT_NULL) {
        io_service_t service = device->deviceIOService;
        device->deviceIOService = IO_OBJECT_NULL;
        IOObjectRelease(service);
    }
}

IOReturn alt_IOUSBDeviceControllerSendCommand(alt_IOUSBDeviceControllerRef device, CFStringRef command, CFTypeRef param)
{
	CFMutableDictionaryRef dict;
	IOReturn kr;
	
	dict = CFDictionaryCreateMutable(NULL, 0,
								 &kCFTypeDictionaryKeyCallBacks,
								 &kCFTypeDictionaryValueCallBacks);
	if(!dict)
		return kIOReturnNoMemory;
	
	CFDictionarySetValue(dict, CFSTR("USBDeviceCommand"), command);
	if(param)
		CFDictionarySetValue(dict, CFSTR("USBDeviceCommandParameter"), param);

	kr = IORegistryEntrySetCFProperties(device->deviceIOService, dict);
	CFRelease(dict);
	return kr;
}

IOReturn alt_IOUSBDeviceControllerSetDescription(alt_IOUSBDeviceControllerRef device, alt_IOUSBDeviceDescriptionRef	description)
{
	//return alt_IOUSBDeviceControllerSendCommand(device, CFSTR("SetDeviceDescription"), description->info);

	CFMutableDictionaryRef dict;
	IOReturn kr;
	
	dict = CFDictionaryCreateMutable(NULL, 0,
								 &kCFTypeDictionaryKeyCallBacks,
								 &kCFTypeDictionaryValueCallBacks);
	if(!dict)
		return kIOReturnNoMemory;
	
	CFDictionarySetValue(dict, CFSTR("PublishConfiguration"), description->info);

	kr = IORegistryEntrySetCFProperties(device->deviceIOService, dict);
	CFRelease(dict);
	return kr;
}

void alt_IOUSBDeviceDescriptionRelease( alt_IOUSBDeviceDescriptionRef desc )
{
	DESTROY(desc->info);
}

alt_IOUSBDeviceDescriptionRef alt_IOUSBDeviceDescriptionCreate(CFAllocatorRef allocator)
{
    alt_IOUSBDeviceDescriptionRef devdesc = NULL;
	void *          offset  = NULL;
    uint32_t        size;
	size    = sizeof(__alt_IOUSBDeviceDescription);
    devdesc = (alt_IOUSBDeviceDescriptionRef)CFAllocatorAllocate(
																		allocator, 
																		size, 
																		0);
    
    if (!devdesc)
		return NULL;
	
    offset = devdesc;
    bzero(offset, size);
	devdesc->info = CFDictionaryCreateMutable(allocator, 8, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
	devdesc->allocator = allocator;
	
	//ensure we have a config descriptor array
	CFMutableArrayRef configs = CFArrayCreateMutable(allocator, 4, &kCFTypeArrayCallBacks);
	CFDictionarySetValue(devdesc->info, CFSTR("ConfigurationDescriptors"), configs);
	CFRelease(configs);
	return devdesc;
}	

uint32_t __getDictNumber(alt_IOUSBDeviceDescriptionRef ref, CFStringRef key)
{
	CFNumberRef aNumber;
	uint32_t val=0;
	if((aNumber = CFDictionaryGetValue(ref->info, key )))
		CFNumberGetValue(aNumber, kCFNumberSInt32Type, &val);
	return val;
}

uint8_t alt_IOUSBDeviceDescriptionGetClass(alt_IOUSBDeviceDescriptionRef ref)
{
	return __getDictNumber(ref, CFSTR("deviceClass"));	
}

void alt_IOUSBDeviceDescriptionSetClass(alt_IOUSBDeviceDescriptionRef devDesc, UInt8 class)
{
	CFNumberRef aNumber = CFNumberCreate(devDesc->allocator, kCFNumberCharType, &class);
	CFDictionarySetValue(devDesc->info, CFSTR("deviceClass"), aNumber);
	CFRelease(aNumber);
}

uint8_t alt_IOUSBDeviceDescriptionGetSubClass(alt_IOUSBDeviceDescriptionRef ref)
{
	return __getDictNumber(ref, CFSTR("deviceSubClass"));	
}

void alt_IOUSBDeviceDescriptionSetSubClass(alt_IOUSBDeviceDescriptionRef devDesc, UInt8 val)
{
	CFNumberRef aNumber = CFNumberCreate(devDesc->allocator, kCFNumberCharType, &val);
	CFDictionarySetValue(devDesc->info, CFSTR("deviceSubClass"), aNumber);
	CFRelease(aNumber);
}

uint8_t alt_IOUSBDeviceDescriptionGetProtocol(alt_IOUSBDeviceDescriptionRef ref)
{
	return __getDictNumber(ref, CFSTR("deviceProtocol"));	
}

void alt_IOUSBDeviceDescriptionSetProtocol(alt_IOUSBDeviceDescriptionRef devDesc, UInt8 val)
{
	CFNumberRef aNumber = CFNumberCreate(devDesc->allocator, kCFNumberCharType, &val);
	CFDictionarySetValue(devDesc->info, CFSTR("deviceProtocol"), aNumber);
	CFRelease(aNumber);
}

uint16_t alt_IOUSBDeviceDescriptionGetVendorID(alt_IOUSBDeviceDescriptionRef ref)
{
	return __getDictNumber(ref, CFSTR("vendorID"));	
}

void alt_IOUSBDeviceDescriptionSetVendorID(alt_IOUSBDeviceDescriptionRef devDesc, UInt16 vendorID)
{
	CFNumberRef aNumber = CFNumberCreate(devDesc->allocator, kCFNumberShortType, &vendorID);
	CFDictionarySetValue(devDesc->info, CFSTR("vendorID"), aNumber);
	CFRelease(aNumber);
}

uint16_t alt_IOUSBDeviceDescriptionGetProductID(alt_IOUSBDeviceDescriptionRef ref)
{
	return __getDictNumber(ref, CFSTR("productID"));	
}

void alt_IOUSBDeviceDescriptionSetProductID(alt_IOUSBDeviceDescriptionRef devDesc, UInt16 productID)
{
	CFNumberRef aNumber = CFNumberCreate(devDesc->allocator, kCFNumberShortType, &productID);
	CFDictionarySetValue(devDesc->info, CFSTR("productID"), aNumber);
	CFRelease(aNumber);
}

uint16_t alt_IOUSBDeviceDescriptionGetVersion(alt_IOUSBDeviceDescriptionRef ref)
{
	return __getDictNumber(ref, CFSTR("deviceID"));	
}

void alt_IOUSBDeviceDescriptionSetVersion(alt_IOUSBDeviceDescriptionRef devDesc, UInt16 val)
{
	CFNumberRef aNumber = CFNumberCreate(devDesc->allocator, kCFNumberShortType, &val);
	CFDictionarySetValue(devDesc->info, CFSTR("deviceID"), aNumber);
	CFRelease(aNumber);
}

CFStringRef alt_IOUSBDeviceDescriptionGetManufacturerString(alt_IOUSBDeviceDescriptionRef ref)
{
	return CFDictionaryGetValue(ref->info, CFSTR("manufacturerString"));
}
CFStringRef alt_IOUSBDeviceDescriptionGetProductString(alt_IOUSBDeviceDescriptionRef ref)
{
	return CFDictionaryGetValue(ref->info, CFSTR("productString"));
}
void alt_IOUSBDeviceDescriptionSetManufacturerString(alt_IOUSBDeviceDescriptionRef ref, CFStringRef val)
{
	CFDictionarySetValue(ref->info, CFSTR("manufacturerString"), val);
}
void alt_IOUSBDeviceDescriptionSetProductString(alt_IOUSBDeviceDescriptionRef ref, CFStringRef val)
{
	CFDictionarySetValue(ref->info, CFSTR("productString"), val);
}
CFStringRef alt_IOUSBDeviceDescriptionGetSerialString(alt_IOUSBDeviceDescriptionRef ref)
{
	return CFDictionaryGetValue(ref->info, CFSTR("serialNumber"));
}
void alt_IOUSBDeviceDescriptionSetSerialString(alt_IOUSBDeviceDescriptionRef ref, CFStringRef serial)
{
	CFDictionarySetValue(ref->info, CFSTR("serialNumber"), serial);
}

void alt_IOUSBDeviceDescriptionRemoveAllConfigurations(alt_IOUSBDeviceDescriptionRef devDesc)
{
	CFArrayRemoveAllValues((CFMutableArrayRef)CFDictionaryGetValue(devDesc->info,	CFSTR("ConfigurationDescriptors")));
}

int alt_IOUSBDeviceDescriptionAppendConfiguration(alt_IOUSBDeviceDescriptionRef devDesc, CFStringRef textDescription, UInt8 attributes, UInt8 maxPower)
{
	CFMutableArrayRef configs = (CFMutableArrayRef)CFDictionaryGetValue(devDesc->info, CFSTR("ConfigurationDescriptors"));
	CFMutableDictionaryRef theConfig;
	CFNumberRef aNumber;
	CFMutableArrayRef interfaces;
	
	//hack to allow manually created descriptions to be sent into the kernel even when its already got one. See the comment
	//in the family's createUSBDevice() function.
	CFDictionarySetValue(devDesc->info, CFSTR("AllowMultipleCreates"), kCFBooleanTrue);
	
	theConfig = CFDictionaryCreateMutable(devDesc->allocator, 3, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
	
	interfaces = CFArrayCreateMutable(devDesc->allocator, 4, &kCFTypeArrayCallBacks);
	CFDictionaryAddValue(theConfig, CFSTR("Interfaces"), interfaces);
	CFRelease(interfaces);

	if(textDescription)
		CFDictionaryAddValue(theConfig, CFSTR("Description"), textDescription);
						   
	aNumber = CFNumberCreate(devDesc->allocator, kCFNumberCharType, &attributes);
	CFDictionaryAddValue(theConfig, CFSTR("Attributes"), aNumber);
	CFRelease(aNumber);
	aNumber = CFNumberCreate(devDesc->allocator, kCFNumberCharType, &maxPower);
	CFDictionaryAddValue(theConfig, CFSTR("MaxPower"), aNumber);
	CFRelease(aNumber);
	CFArrayAppendValue(configs, theConfig);
	CFRelease(theConfig);
	return CFArrayGetCount(configs) - 1;
}

int alt_IOUSBDeviceDescriptionAppendInterfaceToConfiguration(alt_IOUSBDeviceDescriptionRef devDesc, int config, CFStringRef name)
{
	CFMutableDictionaryRef theConfig;
	CFMutableArrayRef configs = (CFMutableArrayRef)CFDictionaryGetValue(devDesc->info, CFSTR("ConfigurationDescriptors"));
	CFMutableArrayRef interfaces;
	
	theConfig = (CFMutableDictionaryRef)CFArrayGetValueAtIndex(configs, config);
	if(NULL == theConfig)
		return -1;
	interfaces = (CFMutableArrayRef)CFDictionaryGetValue(theConfig, CFSTR("Interfaces"));
	CFArrayAppendValue(interfaces, name);
	return CFArrayGetCount(interfaces) - 1;
}
