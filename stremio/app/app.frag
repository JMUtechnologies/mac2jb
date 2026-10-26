#version 450
layout(location=0) out vec4 outColor;
layout(set=0,binding=1,std430) readonly buffer Media {uint m[];} media;
vec3 rgb565(uint value) {
    return vec3(float((value>>11u)&31u)/31.0,float((value>>5u)&63u)/63.0,float(value&31u)/31.0);
}
void main() {
    uint commit=media.m[32];
    if(commit==0u || (commit&3u)>=3u) {outColor=vec4(0,0,0,1);return;}
    uvec2 pixel=uvec2(clamp(floor(gl_FragCoord.xy*vec2(320.0/1920.0,180.0/1080.0)),vec2(0),vec2(319,179)));
    uint block=(pixel.y/4u)*80u+pixel.x/4u;
    uint base=(4096u+(commit&3u)*32768u+16u)/4u+block*2u;
    uint endpoints=media.m[base], selectors=media.m[base+1u];
    uint c0=endpoints&65535u,c1=endpoints>>16u;
    vec3 a=rgb565(c0),b=rgb565(c1);
    uint index=(selectors>>(2u*((pixel.y&3u)*4u+(pixel.x&3u))))&3u;
    vec3 color=index==0u?a:index==1u?b:
        c0>c1?(index==2u?(2.0*a+b)/3.0:(a+2.0*b)/3.0):
        index==2u?(a+b)/2.0:vec3(0);
    outColor=vec4(color,1);
}
