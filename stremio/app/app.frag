#version 450
layout(location=0) out vec4 outColor;
layout(set=0,binding=1,std430) readonly buffer Media {uint m[];} media;
vec3 rgb565(uint value) {
    uvec3 bits=uvec3((value>>11u)&31u,(value>>5u)&63u,value&31u);
    return vec3(uvec3((bits.r<<3u)|(bits.r>>2u),(bits.g<<2u)|(bits.g>>4u),(bits.b<<3u)|(bits.b>>2u)))/255.0;
}
bool validSize(uint width,uint height) {
    return (width==320u && height==180u) || (width==640u && height==360u) ||
        (width==960u && height==540u) || (width==1280u && height==720u) ||
        (width==1920u && height==1080u);
}
vec3 sampleBC1(uint slotBase,uvec2 size,ivec2 location) {
    uvec2 pixel=uvec2(clamp(location,ivec2(0),ivec2(size)-ivec2(1)));
    uint block=(pixel.y/4u)*(size.x/4u)+pixel.x/4u;
    uint base=slotBase+4u+block*2u;
    uint endpoints=media.m[base],selectors=media.m[base+1u];
    uint c0=endpoints&65535u,c1=endpoints>>16u;
    vec3 a=rgb565(c0),b=rgb565(c1);
    uint index=(selectors>>(2u*((pixel.y&3u)*4u+(pixel.x&3u))))&3u;
    return index==0u?a:index==1u?b:
        c0>c1?(index==2u?(2.0*a+b)/3.0:(a+2.0*b)/3.0):
        index==2u?(a+b)/2.0:vec3(0);
}
void main() {
    uint commit=media.m[32];
    if(media.m[0]!=0x314d5453u || media.m[1]!=4u || (commit>>2u)==0u || (commit&3u)>=3u) {outColor=vec4(0,0,0,1);return;}
    uint slotBase=(4096u+(commit&3u)*1048576u)/4u;
    uvec2 size=uvec2(media.m[slotBase+2u],media.m[slotBase+3u]);
    if(media.m[slotBase]!=(commit>>2u) || !validSize(size.x,size.y)) {outColor=vec4(0,0,0,1);return;}
    if(size==uvec2(1920,1080)) {outColor=vec4(sampleBC1(slotBase,size,ivec2(gl_FragCoord.xy)),1);return;}
    // Center-aligned bilinear sampling removes nearest-neighbor stair stepping.
    vec2 source=gl_FragCoord.xy*vec2(size)/vec2(1920,1080)-vec2(0.5);
    ivec2 pixel=ivec2(floor(source));vec2 weight=fract(source);
    vec3 top=mix(sampleBC1(slotBase,size,pixel),sampleBC1(slotBase,size,pixel+ivec2(1,0)),weight.x);
    vec3 bottom=mix(sampleBC1(slotBase,size,pixel+ivec2(0,1)),sampleBC1(slotBase,size,pixel+ivec2(1,1)),weight.x);
    outColor=vec4(mix(top,bottom,weight.y),1);
}
