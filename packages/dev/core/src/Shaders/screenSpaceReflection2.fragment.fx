// Screen Space Reflection Post-Process based on the following tutorial:
// https://lettier.github.io/3d-game-shaders-for-beginners/screen-space-reflection.html

uniform sampler2D textureSampler;

#ifdef SSR_SUPPORTED
uniform sampler2D normalSampler;
uniform sampler2D positionSampler;
uniform sampler2D specularSampler;
uniform sampler2D depthSampler;
#if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
    uniform samplerCube backUpSampler;
#endif
// SSR parameters
uniform float maxDistance;
uniform float resolution;
uniform int steps;
uniform float thickness;
uniform float strength;
uniform float falloffExponent;
uniform float roughnessFactor;
uniform float distanceFade;
#include<helperFunctions>
#endif // SSR_SUPPORTED

uniform mat4 view;
uniform mat4 projection;

// camera properties
uniform float minZ;
uniform float maxZ;
uniform vec3 cameraPos;

// Varyings
varying vec2 vUV;


#ifdef SSR_SUPPORTED
// Structs
struct ReflectionInfo {
    float visibilityBackup;
    float visibility;
    vec2 coords;
    bool miss;
};

// Fresnel Schlicks formula according to https://learnopengl.com/PBR/Theory 
vec3 fresnelSchlick(float cosTheta, vec3 F0)
{
    return F0 + (vec3(1.0) - F0) * pow(1.0 - cosTheta, 5.0);
}

// Computes and returns the coordinates and the visibility of the reflected pixel if any, as well as a boolean defining if there is a reflected pixel or if it's a miss
// The intersection algorithm based on a David Lettier's tutorial uses 2D ray marching 
ReflectionInfo getReflectionInfo2DRayMarching(vec3 dirVS, vec3 hitCoordVS, vec2 texSize){

    ReflectionInfo info;
    // Default values if the algorithm fail to find intersection:
    info.visibilityBackup = 0.0;
    info.visibility = 0.0;
    info.coords = vUV;
    info.miss = true;

    // Calculate the start and end point of the reflection ray in view space.
    vec4 startVS = vec4(hitCoordVS, 1.0);
    // startVS.z -= thickness;
    vec4 endVS = vec4(hitCoordVS + (dirVS * maxDistance), 1.0);
    // endVS.z -= thickness;

    #ifdef RIGHT_HANDED_SCENE
        if (endVS.z > minZ){ // no need to compute anything, the max depth of reflection is not in the view space (not behind the near plane)
            #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
                info.visibilityBackup = 1.0;
            #endif
            return info;
        }
    #else 
        if (endVS.z < minZ){ 
            #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
                info.visibilityBackup = 1.0;
            #endif
            return info;
        }
    #endif

    // Calculate the start and end point of the reflection ray in screen space.
    vec4 startSS = projection * startVS; // Project to screen space.
    startSS.xyz /= startSS.w; // Perform the perspective divide.
    startSS.xy = startSS.xy * 0.5 + vec2(0.5); // Convert from clip space to texture space.
    startSS.xy *= texSize; // Convert the UV coordinates to fragment/pixel coordinates.

    vec4 endSS = projection * endVS;
    endSS.xyz /= endSS.w;
    endSS.xy = endSS.xy * 0.5 + vec2(0.5);
    endSS.xy *= texSize;

    vec2 currFrag  = startSS.xy; // (currFrag / texSize) equivalent to vUV at this point
    vec2 uv = vUV;

    // compute delta difference between X and Y coordinates
    float deltaX = endSS.x - startSS.x;
    float deltaY = endSS.y - startSS.y;

    // useX = 1 if the X dimension is bigger than the Y one
    float useX = abs(deltaX) >= abs(deltaY) ? 1.0 : 0.0;
    
    // delta: the biggest delta between deltaX and deltaY
    float delta = mix(abs(deltaY), abs(deltaX), useX) * clamp(resolution, 0.0, 1.0);
    
    // increment: interpolation step according to each direction
    vec2 increment = vec2(deltaX, deltaY) / max(delta, 0.01); // we skip some pixels if resolution less than 1.0

    // percentage of research, interpolation coefficient
    float search0 = 0.0;
    float search1 = 0.0;

    // indices defining if there is a hit or not at each pass
    float hit0 = 0.0;
    float hit1 = 0.0;

    float viewDistance = startVS.z; // depth of the start point in view space
    float depth; 
    float depthAtCurrPosVS; 

    // // As explained in https://lup.lub.lu.se/luur/download?func=downloadFile&recordOId=8890761&fileOId=8890762 (p.16)
    // // we should use variable thickness, depending on the distance between two adjacent pixels in view space
    vec3 VSPos = hitCoordVS;
    vec3 oldVSPos = VSPos;
    float accurTol;    
    float tol = thickness;

    // looking for intersection position
    for (int i = 0; i < int(delta); i++) {
        // first pass
        // move from the startSS to endSS using linear interpolation
        // currFragx = (startSS.x) * (1.0 - search1) + (endSS.x) * search1;
        // currFragy = (startSS.y) * (1.0 - search1) + (endSS.y) * search1;
        currFrag += increment;
        uv.xy  = currFrag / texSize;

        depthAtCurrPosVS = (texture2D(depthSampler, uv).r);
        // depthAtCurrPosVS = (view *texture2D(positionSampler, uv.xy)).z; // equivalent to the previous line

        search1 = mix ( (currFrag.y - startSS.y) / deltaY, 
                      (currFrag.x - startSS.x) / deltaX, 
                      useX);

        // perspective-correct interpolation
        viewDistance = (startVS.z * endVS.z) / mix(endVS.z, startVS.z, search1);

        // scale thickness 
        VSPos = (view * texture2D(positionSampler, (currFrag)/texSize)).xyz;
        accurTol = thickness * distance(VSPos, oldVSPos)/ distance(currFrag, currFrag - increment) * 0.5; // filters artifacts (avoid false positive intersection)
        // accurTol = thickness * 0.1;
        tol = thickness;
        // tol = max(thickness * distance(VSPos, oldVSPos) * viewDistance * 0.1, thickness);
        oldVSPos = VSPos;

        // difference between the perspective-correct interpolation and the current depth of the scene
        depth = viewDistance - depthAtCurrPosVS;
        #ifdef RIGHT_HANDED_SCENE
            depth *= -1.0;
        #endif

        if (depth > 0.0 && depth > accurTol && depth < tol) {
        //  if (depth > 0.0 && depth < thickness) {
        // if(depth > 0.0 && depth < accurTol){    
            hit0 = 1.0;
        } else {
            hit0 = 0.0;
        }
        
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){ 
            #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
                info.visibilityBackup = 1.0;
            #endif
            return info;
        } 
        
        if (hit0 == 1.0) break;
        // no intersection, we continue
        // search0 save the position of the last known miss
        search0 = search1;

    }    
    // save search1 as the halfway between the position of the last miss and the position of the last hit 
    search1 = search0 + ((search1 - search0) / 2.0);
    
    // end of the first pass
    
    if (hit0 == 0.0){ // if no hit during the first pass, we skip the second pass
        info.coords = vUV;
        info.miss = true;
        info.visibility = 0.0;
        #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
            info.visibilityBackup = 1.0;
        #endif
        return info;
    }
    
    for (int i = 0; i < steps; i++) { 
        // second pass
        // the aim is to search more precisely where is the intersection point
        // in fact we could have miss a fragment during the first pass
        // or we could have found a false-positive intersection
        currFrag = mix(startSS.xy, endSS.xy, search1);
        uv.xy = currFrag / texSize;

        depthAtCurrPosVS = (texture2D(depthSampler, uv).r);
        // depthAtCurrPosVS = (view * texture2D(positionSampler, uv.xy)).z; // equivalent to the previous line

        viewDistance = (startVS.z * endVS.z) / mix(endVS.z, startVS.z, search1);
        depth = viewDistance - depthAtCurrPosVS;
        #ifdef RIGHT_HANDED_SCENE
            depth *= -1.0;
        #endif

        if (depth > 0.0 && depth < thickness && depth > accurTol) {
        // if (depth > 0.0 && depth < thickness) {
        // if (depth > 0.0 && depth < accurTol){    
            hit1 = 1.0;
            search1 = search0 + ((search1 - search0) / 2.0);
        } else if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){ 
            #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
                info.visibilityBackup = 1.0;
            #endif
            return info;
        } else {
            float temp = search1;
            search1 = search1 + ((search1 - search0) / 2.0);
            search0 = temp;
        }
    }    
    // end of the second pass
       
    // compute how much the reflection is visible
    if (hit1 == 0.0){
        #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
            info.visibilityBackup = 1.0;
        #else
            info.visibilityBackup = 0.0; 
        #endif
        info.visibility = 0.0;
        info.miss = true;
    } else {
        info.miss = false;
        if (dot(dirVS, normalize(texture2D(normalSampler, uv).xyz)) > 0.085 && search1 > 0.05){ // no reflection when hit backface of a mesh
            // sreach1 test to avoid false negative exclusion of ray caused by backface rejection
            info.visibilityBackup = 0.0;
            info.visibility = 0.0;
            info.coords = uv;
            return info;
        }
        // tol = thickness + 0.0005 * pow(distance(hitCoordVS, vec3(0.0, 0.0, 0.0)), 1.5);

        if (length(mix(hitCoordVS, endVS.xyz, search1) - hitCoordVS) < thickness){
            info.visibility = 0.0; // avoid displaying reflection when search level is low (auto intersection)
        } else {
            info.visibility = texture2D(positionSampler, uv).w // alpha value of the reflected scene position 
                * (1.0 - max ( dot(-normalize(hitCoordVS), dirVS), 0.0)) // to fade out the reflection as the reflected direction point to the camera's position (hit behind the camera)
                // * (1.0 - clamp ( length(mix(hitCoordVS, endVS.xyz, search1) - hitCoordVS)/(maxDistance), 0.0, 1.0)) // the reflection should be sharper when near from the starting point
                * (1.0 - search1) // the reflection should be sharper when near from the starting point
                * (1.0 - clamp (abs(hitCoordVS.z / distanceFade), 0.0, 1.0)) // to fade out the reflection near the distanceFade
                * (1.0 - clamp (depth/thickness, 0.0, 1.0)); // since the hit point is not always precisely found, we fade out the reflected color if we aren't precise enough 
        }

        #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
            info.visibilityBackup = 1.0 - info.visibility; // complementary reflectivityColor
        #else
            info.visibilityBackup = 0.0; 
        #endif

        // info.visibility *= (1.0 - clamp (depth/thickness, 0.0, 1.0));
    }

    info.coords = uv;

    return info;
}

// Hash function from screenSpaceReflection.fragment.fx 
// Return a random vec3 
vec3 hash(vec3 a)
{
    a = fract(a * 0.8);
    a += dot(a, a.yxz + 19.19);   
    return fract((a.xxy + a.yxx) * a.zyx) * 0.2; // * 0.2 to set 1.0 default roughness
}

#endif // SSR_SUPPORTED

void main(void)
{

    // ********************* debug **********************

    // float z = ( (1.0/(texture2D(depthSampler, vUV).r )) - (1.0/minZ)) / ((1.0/maxZ) - (1.0/minZ));
    // float depth = pow((z * 2.0 - 1.0), 5.0); 
    // gl_FragColor = vec4(depth, depth, depth, 1.0);
    // return; // just for test

    // float depth = ((texture2D(depthSampler, vUV).r) * (maxZ - minZ) + minZ)/maxZ;
    // float depth = (texture2D(depthSampler, vUV).r);
    // gl_FragColor = vec4(texture2D(positionSampler, vUV).xyz,1.0);
    // return; // just for test

    // #ifdef BACKUP_TEXTURE
    //     // gl_FragColor = texture2D(metallicMap, vUV);
    // // #else 
    // //     gl_FragColor = texture2D(specularMap, vUV);
    //     return;    
    // #endif 

    // gl_FragColor = texture2D(originalColor, vUV);
    // return;   

    // ********************* debug **********************

    #ifdef SSR_SUPPORTED

    // *************** Get data from samplers ***************

    vec4 originalFull = texture2D(textureSampler, vUV);
    vec3 original = originalFull.rgb;
    vec3 spec = toLinearSpace(texture2D(specularSampler, vUV).rgb);

    if (dot(spec, vec3(1.0)) <= 0.0){
        gl_FragColor = texture2D(textureSampler, vUV); // no reflectivity, no need to compute reflection
        return;
    }

    float roughness = 1.0 - texture2D(specularSampler, vUV).a;

    // Get coordinates of the direction of the reflected ray
    // according to the pixel's position and normal.
    vec3 unitNormal = normalize((texture2D(normalSampler, vUV)).xyz);
    vec3 position = (view * texture2D(positionSampler, vUV)).xyz;

    vec3 unitPosition = normalize(position);
    vec3 reflected = normalize(reflect(unitPosition, unitNormal)); // incident direction = unit position in camera space

    // *************** Compute reflection info  ***************
    ReflectionInfo info;

    vec3 jitt = mix(vec3(0.0), hash(texture2D(positionSampler, vUV).xyz), roughness) * roughnessFactor; // hash(position) represents a random vector3, jitt represents a bias to simulate roughness (light deviation)
    
    #ifdef RIGHT_HANDED_SCENE
        if (position.z < -distanceFade || distanceFade == 0.0){ // no need to compute reflection, the point we are evaluating is further than the distanceFade
            #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
                info.coords = vUV;
                info.visibility = 0.0;
                info.miss = true;
                info.visibilityBackup = 1.0;
            #else
                gl_FragColor = texture2D(textureSampler, vUV); // no reflection, we leave the main function
                return;
            #endif
        } else {
            vec2 texSize = gl_FragCoord.xy / vUV;
            info = getReflectionInfo2DRayMarching(reflected + jitt, position, texSize);

            float visibility = clamp(info.visibility, 0.0, 1.0);  
            float visibilityBackup = clamp(info.visibilityBackup, 0.0, 1.0);
        }
    #else // if left handed scene
        if (position.z > distanceFade || distanceFade == 0.0){ // no need to compute reflection, the point we are evaluating is further than the distanceFade
            #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
                info.coords = vUV;
                info.visibility = 0.0;
                info.miss = true;
                info.visibilityBackup = 1.0;
            #else
                gl_FragColor = texture2D(textureSampler, vUV); // no reflection, we leave the main function
                return;
            #endif
        } else {
            vec2 texSize = gl_FragCoord.xy / vUV;
            info = getReflectionInfo2DRayMarching(reflected + jitt, position, texSize);

        }
    #endif

    float visibility = clamp(info.visibility, 0.0, 1.0);  
    float visibilityBackup = clamp(info.visibilityBackup, 0.0, 1.0);

    // *************** Apply reflection ***************

    // if (dot(reflected, unitNormal) < 0.01){
    //     info.coords = vUV;
    //     info.visibility = 0.0;
    //     info.miss = true;
    //     #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
    //         info.visibilityBackup = 1.0;
    //     #endif    
    // }

    // ********************* debug **********************
    // #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
    //     vec3 coord = vec3( inverse(view) * vec4(reflected, 0.0));
    //     // coord.y *= -1.0;
    //     vec3 reflectColor = textureCube(backUpSampler, coord).xyz;
    //     gl_FragColor = vec4(reflectColor, 1.0);
    //     // gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    //     return;
    // #else
    //     gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    //     return;
    // #endif
    // ********************* debug **********************  
    
    // get the color of the reflection
    vec3 reflectedColor;
    
    #if defined(BACKUP_TEXTURE_SKYBOX) || defined(BACKUP_TEXTURE_PROBE)
        // compute reflection in view space and then come back to world space
        vec3 coord = vec3( inverse(view) * vec4(reflected, 0.0));

        #ifdef BACKUP_TEXTURE_PROBE
            coord.y *= -1.0;
        #endif
            
        #ifdef RIGHT_HANDED_SCENE
            coord.z *= -1.0;
        #endif
        reflectedColor = textureCube(backUpSampler, coord + jitt).xyz * visibilityBackup;

        if (!info.miss){
            reflectedColor += texture2D(textureSampler, info.coords).xyz * visibility;
        }
    #else 
        if (info.miss){
            gl_FragColor = texture2D(textureSampler, vUV);
            return;
        } else {
            reflectedColor = texture2D(textureSampler, info.coords).xyz;
        }
    #endif 
    

    // Screen border mask
    vec2 dCoords = smoothstep(vec2(0.2), vec2(0.6), clamp(abs(vec2(0.5, 0.5) - vUV), vec2(0.0), vec2(1.0))); // HermiteInterpolation
    float screenEdgefactor = clamp(1.0 - (dCoords.x + dCoords.y), 0.0, 1.0);
    // float screenEdgefactor = 1.0;
    // Fresnel
    // "The specular map contains F0 for dielectrics and the reflectance value for raw metal" https://substance3d.adobe.com/tutorials/courses/the-pbr-guide-part-2 
    vec3 F0 = spec;
  
    vec3 reflectionCoeff = fresnelSchlick(max(dot(unitNormal, -unitPosition), 0.0), F0) // https://lettier.github.io/3d-game-shaders-for-beginners/fresnel-factor.html
                            * clamp(vec3(pow(spec.x * strength, falloffExponent), pow(spec.y * strength, falloffExponent), pow(spec.z * strength, falloffExponent)), 0.0, 1.0)
                            * clamp(screenEdgefactor * (visibility + visibilityBackup), 0.0, 0.9); 
    // gl_FragColor =  vec4(reflectionCoeff, 1.0);
    // return;

    // // *********************** SHADING *******************************

    // ********************* debug **********************

    // // to render the reflected UV coordinates in rg 
    // // and the visibility of the reflection in b
    // gl_FragColor = vec4(info.coords, visibility, 1.0);

    // to render only the reflection part
    // gl_FragColor = vec4(reflectedColor * visibility, albedoFull.a);
    // return;

    // // to render only the hash Value (suposed to be random)
    // vec3 randomVal = ash(position);
    // gl_FragColor = vec4(randomVal, 1.0);

    // // to render only visibility
    // gl_FragColor = vec4(visibility, visibility, visibility, 1.0);

    // return;

    // ********************* debug **********************

    // Render the final color
    // (no refraction) and (AbsorbtionCoeff + RefractionCoeff + ReflectionCoeff = 1)  => AbsorbtionCoeff = 1 - ReflectionCoeff
    gl_FragColor = vec4((original * (vec3(1.0) - reflectionCoeff)) + (reflectedColor * reflectionCoeff), originalFull.a);

    // gl_FragColor = vec4(reflectionCoeff, originalFull.a);

    #else // SSR_SUPPORTED
    gl_FragColor = texture2D(textureSampler, vUV);
    #endif // SSR_SUPPORTED

    // // ************* input texture rendering ****************


    // vec4 first = texture2D(textureSampler, vUV);
    // vec4 specular = texture2D(specularMap, vUV);
    // vec4 metal = texture2D(metallicMap, vUV);

    // // mixes colors
    // if (vUV.x <= 0.333) { // show only base texture
    //     gl_FragColor = first;
    // }
    // else if (vUV.x <= 0.666) { // show only specular texture
    //     gl_FragColor = specular;
    //     gl_FragColor.a = 1.0;
    // }
    // else { // show only metallic texture
    //     gl_FragColor = metal;
    //     gl_FragColor.a = 1.0;
    // }
    
    // gl_FragColor = metal;
    // gl_FragColor.a = 1.0;
    
    // #else 
    //     gl_FragColor = texture2D(textureSampler, vUV);
    // #endif
}
