// Do not edit.
import { ShaderStore } from "../Engines/shaderStore";
import "./ShadersInclude/helperFunctions";

const name = "ssr";
const shader = `uniform sampler2D textureSampler;#ifdef SSR_SUPPORTED
uniform sampler2D normalSampler;uniform sampler2D positionSampler;uniform sampler2D specularSampler;uniform sampler2D depthSampler;#if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
uniform samplerCube backUpSampler;#endif
uniform float maxDistance;uniform float resolution;uniform int steps;uniform float thickness;uniform vec2 direction;uniform float roughnessFactor;uniform float distanceFade;#include<helperFunctions>
#endif 
uniform mat4 view;uniform mat4 projection;uniform float minZ;uniform float maxZ;uniform vec3 cameraPos;varying vec2 vUV;#ifdef SSR_PASS
#ifdef SSR_SUPPORTED
struct ReflectionInfo {float visibilityBackup;float visibility;vec2 coords;bool miss;};vec3 fresnelSchlick(float cosTheta,vec3 F0){return F0+(vec3(1.0)-F0)*pow(1.0-cosTheta,5.0);}ReflectionInfo getReflectionInfo2DRayMarching(vec3 dirVS,vec3 hitCoordVS,vec2 texSize){ReflectionInfo info;info.visibilityBackup=0.0;info.visibility=0.0;info.coords=vUV;info.miss=true;vec4 startVS=vec4(hitCoordVS,1.0);vec4 endVS=vec4(hitCoordVS+(dirVS*maxDistance),1.0);#ifdef RIGHT_HANDED_SCENE
if (endVS.z>minZ){ #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
info.visibilityBackup=1.0;#endif
return info;}#else 
if (endVS.z<minZ){ #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
info.visibilityBackup=1.0;#endif
return info;}#endif
vec4 startSS=projection*startVS; startSS.xyz/=startSS.w; startSS.xy=startSS.xy*0.5+vec2(0.5); startSS.xy*=texSize; vec4 endSS=projection*endVS;endSS.xyz/=endSS.w;endSS.xy=endSS.xy*0.5+vec2(0.5);endSS.xy*=texSize;vec2 currFrag =startSS.xy; vec2 uv=vUV;float deltaX=endSS.x-startSS.x;float deltaY=endSS.y-startSS.y;float useX=abs(deltaX)>=abs(deltaY) ? 1.0 : 0.0;float delta=mix(abs(deltaY),abs(deltaX),useX)*clamp(resolution,0.0,1.0);vec2 increment=vec2(deltaX,deltaY)/max(delta,0.01); float search0=0.0;float search1=0.0;float hit0=0.0;float hit1=0.0;float viewDistance=startVS.z; float depth; float depthAtCurrPosVS; float minTol; float maxTol=thickness; for (int i=0; i<int(delta); i++) {currFrag+=increment;uv.xy =currFrag/texSize;depthAtCurrPosVS=(texture2D(depthSampler,uv).r);minTol=(startVS.z*endVS.z)/mix(endVS.z,startVS.z,search1);search1=mix ( (currFrag.y-startSS.y)/deltaY,(currFrag.x-startSS.x)/deltaX,useX);viewDistance=(startVS.z*endVS.z)/mix(endVS.z,startVS.z,search1);minTol=abs(minTol-(startVS.z*endVS.z)/mix(endVS.z,startVS.z,search1));maxTol=thickness+minTol;minTol=thickness*0.01; depth=viewDistance-depthAtCurrPosVS;#ifdef RIGHT_HANDED_SCENE
depth*=-1.0;#endif
if (depth>minTol && depth<maxTol) {hit0=1.0;} else {hit0=0.0;}if (uv.x<0.0 || uv.x>1.0 || uv.y<0.0 || uv.y>1.0){ #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
info.visibilityBackup=1.0;#endif
return info;} if (hit0==1.0) break;search0=search1;} search1=search0+((search1-search0)/2.0);if (hit0==0.0){ info.coords=vUV;info.miss=true;info.visibility=0.0;#if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
info.visibilityBackup=1.0;#endif
return info;}for (int i=0; i<steps; i++) { currFrag=mix(startSS.xy,endSS.xy,search1);uv.xy=currFrag/texSize;depthAtCurrPosVS=(texture2D(depthSampler,uv).r);viewDistance=(startVS.z*endVS.z)/mix(endVS.z,startVS.z,search1);depth=viewDistance-depthAtCurrPosVS;#ifdef RIGHT_HANDED_SCENE
depth*=-1.0;#endif
if (depth>minTol && depth<maxTol) {hit1=1.0;search1=search0+((search1-search0)/2.0);} else {float temp=search1;search1=search1+((search1-search0)/2.0);search0=temp;}} if (hit1==0.0){#if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
info.visibilityBackup=1.0;#else
info.visibilityBackup=0.0; #endif
info.visibility=0.0;info.miss=true;} else {info.miss=false;if (dot(dirVS,texture2D(normalSampler,uv).xyz)>0.085 && search1>0.01){ info.visibilityBackup=0.0;info.visibility=0.0;info.coords=uv;return info;}if (length(mix(hitCoordVS,endVS.xyz,search1)-hitCoordVS)<thickness){info.visibility=0.0; } else {info.visibility=texture2D(positionSampler,uv).w * (1.0-max ( dot(-normalize(hitCoordVS),dirVS),0.0)) * (1.0-search1) * (1.0-clamp (abs(hitCoordVS.z/distanceFade),0.0,1.0)) * (1.0-clamp (depth/maxTol,0.0,1.0)); }#if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
info.visibilityBackup=1.0-info.visibility; #else
info.visibilityBackup=0.0; #endif
}info.coords=uv;return info;}vec3 hash(vec3 a){a=fract(a*0.8);a+=dot(a,a.yxz+19.19); return fract((a.xxy+a.yxx)*a.zyx)*0.2; }#endif 
void main(void){#ifdef SSR_SUPPORTED
vec3 spec=toLinearSpace(texture2D(specularSampler,vUV).rgb);if (dot(spec,vec3(1.0))<=0.0){gl_FragColor=vec4(0.0,0.0,0.0,0.0);return;}float roughness=1.0-texture2D(specularSampler,vUV).a;vec3 unitNormal=normalize((texture2D(normalSampler,vUV)).xyz);vec3 position=(view*texture2D(positionSampler,vUV)).xyz;vec3 unitPosition=normalize(position);vec3 reflected=normalize(reflect(unitPosition,unitNormal)); ReflectionInfo info;vec3 jitt=mix(vec3(0.0),hash(texture2D(positionSampler,vUV).xyz),roughness)*roughnessFactor; #ifdef RIGHT_HANDED_SCENE
if (position.z<-distanceFade || distanceFade==0.0){ #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
info.coords=vUV;info.visibility=0.0;info.miss=true;info.visibilityBackup=1.0;#else
gl_FragColor=vec4(0.0,0.0,0.0,0.0);return;#endif
} else {vec2 texSize=gl_FragCoord.xy/vUV;info=getReflectionInfo2DRayMarching(reflected+jitt,position+0.001,texSize);float visibility=clamp(info.visibility,0.0,1.0); float visibilityBackup=clamp(info.visibilityBackup,0.0,1.0);}#else 
if (position.z>distanceFade || distanceFade==0.0){ #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
info.coords=vUV;info.visibility=0.0;info.miss=true;info.visibilityBackup=1.0;#else
gl_FragColor=vec4(0.0,0.0,0.0,0.0);return;#endif
} else {vec2 texSize=gl_FragCoord.xy/vUV;info=getReflectionInfo2DRayMarching(reflected+jitt,position,texSize);}#endif
float visibility=clamp(info.visibility,0.0,1.0); float visibilityBackup=clamp(info.visibilityBackup,0.0,1.0);vec3 reflectedColor;#if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
vec3 coord=vec3( inverse(view)*vec4(reflected,0.0));#ifdef BACKUP_TEXTURE_PROBE
coord.y*=-1.0;#endif
#ifdef RIGHT_HANDED_SCENE
coord.z*=-1.0;#endif
reflectedColor=textureCube(backUpSampler,coord+jitt).xyz*visibilityBackup;if (!info.miss){reflectedColor+=texture2D(textureSampler,info.coords).xyz*visibility;}#else 
if (info.miss){gl_FragColor=vec4(0.0,0.0,0.0,0.0);return;} else {reflectedColor=texture2D(textureSampler,info.coords).xyz;}#endif 
gl_FragColor=vec4(reflectedColor,visibilityBackup+visibility);#else 
gl_FragColor=texture2D(textureSampler,vUV);#endif 
}#else 
#ifdef BILATERAL_BLUR
void main(void){vec2 texSize=gl_FragCoord.xy/vUV;float blurWidth=1.0-texture2D(reflectivitySampler,vUV).a; float weights[7];weights[0]=0.05;weights[1]=0.1;weights[2]=0.2;weights[3]=0.3;weights[4]=0.2;weights[5]=0.1;weights[6]=0.05;vec2 texelSize=vec2(1.0/texSize.x,1.0/texSize.y);vec2 texelStep=texelSize*direction*blurWidth*2.0;vec2 start=vUV-3.0*texelStep;vec4 baseColor=vec4(0.,0.,0.,0.);vec2 texelOffset=vec2(0.,0.);for (int i=0; i<7; i++){baseColor+=texture2D(textureSampler,start+texelOffset)*weights[i];texelOffset+=texelStep;}gl_FragColor=baseColor;}#else 
#ifdef COMBINE
void main(void) {vec3 bluredColor=texture2D(textureSampler,vUV).xyz;vec3 original=texture2D(originalColor,vUV);float visibility=texture2D(textureSampler,vUV).a;vec3 spec=toLinearSpace(texture2D(specularSampler,vUV).rgb);vec3 unitNormal=normalize((texture2D(normalSampler,vUV)).xyz);vec3 position=(view*texture2D(positionSampler,vUV)).xyz;vec3 unitPosition=normalize(position);vec2 dCoords=smoothstep(vec2(0.2),vec2(0.6),clamp(abs(vec2(0.5,0.5)-vUV),vec2(0.0),vec2(1.0))); float screenEdgefactor=clamp(1.0-(dCoords.x+dCoords.y),0.0,1.0);vec3 F0=spec;vec3 reflectionCoeff=fresnelSchlick(max(dot(unitNormal,-unitPosition),0.0),F0) * clamp(vec3(pow(spec.x*strength,falloffExponent),pow(spec.y*strength,falloffExponent),pow(spec.z*strength,falloffExponent)),0.0,1.0)* clamp(screenEdgefactor*(visibility),0.0,0.9); gl_FragColor=vec4((original.xyz*(vec3(1.0)-reflectionCoeff))+(reflectedColor*reflectionCoeff),original.a);}#endif 
#endif 
#endif 
`;
// Sideeffect
ShaderStore.ShadersStore[name] = shader;
/** @hidden */
export const ssr = { name, shader };
