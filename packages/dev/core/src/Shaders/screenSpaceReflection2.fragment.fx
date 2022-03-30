// #ifdef GL_ES
// precision mediump float;
// #endif

uniform sampler2D textureSampler;

#ifdef SSR_SUPPORTED
uniform sampler2D specularMap;
uniform sampler2D metallicMap;
uniform sampler2D normalSampler;
uniform sampler2D positionSampler;
#endif

uniform mat4 view;
uniform mat4 projection;


// Varyings
varying vec2 vUV;

// #ifdef SSR_SUPPORTED

// Structs
struct ReflectionInfo {
    float visibility;
    vec2 coords;
};

vec3 fresnelSchlick(float cosTheta, vec3 F0)
{
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

// ReflectionInfo getReflectionInfo3DRayMarching(vec3 dir, vec3 hitCoord)
// {
//     // TODO
//     ReflectionInfo info;
//     return info;
// }


ReflectionInfo getReflectionInfo2DRayMarching(vec3 dirVS, vec3 hitCoordVS, vec2 texSize, float maxDistance,
                                            float resolution, int steps, float thickness)
{
    // based on : https://lettier.github.io/3d-game-shaders-for-beginners/screen-space-reflection.html
    
    ReflectionInfo info;

    // vec2 texCoord = vUV;

    // Calculate the start and end point of the reflection ray in view space.
    vec4 startVS = vec4(hitCoordVS, 1.0);
    vec4 endVS   = vec4(hitCoordVS + (dirVS * maxDistance), 1.0);

    // Calculate the start and end point of the reflection ray in screen space.
    vec4 startSS = projection * startVS; // Project to screen space.
    startSS.xyz /= startSS.w; // Perform the perspective divide.
    startSS.xy= startSS.xy * 0.5 + vec2(0.5); // Convert the screen-space XY coordinates to UV coordinates.
    startSS.xy *= texSize; // Convert the UV coordinates to fragment/pixel coordinates.
    // vec4 startSS = vec4(vUV * texSize, 0.0, 1.0);


    vec4 endSS = projection * endVS;
    endSS.xyz /= endSS.w;
    endSS.xy   = endSS.xy * 0.5 + vec2(0.5);
    endSS.xy  *= texSize;

    vec2 currFrag  = startSS.xy;
    // vec2 uv = currFrag / texSize; // test OK :  currFrag / texSize equivalent to vUV at this point
    vec2 uv = vUV;

    // ************************************************************************************

    // info.coords = clamp(startSS.xy/texSize, 0.0, 1.0);
    // // info.coords = clamp(uv, 0.0, 1.0);
    // // info.visibility = 0.0;
    // info.visibility = 1.0;
    // return info;

    // ************************************************************************************

    // compute delta difference between X and Y coordinates
    // will be used to for ray marching in screen space 
    float deltaX = endSS.x - startSS.x;
    float deltaY = endSS.y - startSS.y;


    // useX = 1 if the X dimension is bigger than the Y one
    float useX = abs(deltaX) >= abs(deltaY) ? 1.0 : 0.0;
    
    // delta : the biggest delta between deltaX and deltaY
    float delta = mix(abs(deltaY), abs(deltaX), useX) * clamp(resolution, 0.0, 1.0);
    
    // increment : interpolation step according to each direction
    vec2 increment = vec2(deltaX, deltaY) / max(delta, 0.001); // we skip some pixels if resolution less than 1.0
    
    // percentage of research, interpolation coefficient
    float search0 = 0.0;
    float search1 = 0.0;

    // indices defining if there is a hit or not at each pass
    float hit0 = 0.0;
    float hit1 = 0.0;

    // TODO : use depth buffer instead of viewDistance
    // TODO : test if rightHanded or leftHanded 
    float viewDistance = startVS.z; // distance between the camera and the start point in view space
    float depth = thickness;

    float depthAtCurrPosVS;

    // looking for intersection position
    for (int i = 0; i < int(delta); i++) {
        // first pass
        // move from the startSS to endSS using linear interpolation
        //currFragx = (startSS.x) * (1.0 - search1) + (endSS.x) * search1;
        //currFragy = (startSS.y) * (1.0 - search1) + (endSS.y) * search1;
        currFrag += increment;
        uv.xy  = currFrag / texSize;

        // depthAtCurrPosVS = (texture2D(positionSampler, uv.xy)).z;
        depthAtCurrPosVS = (view *texture2D(positionSampler, uv.xy)).z;

        search1 = mix ( (currFrag.y - startSS.y) / deltaY, 
                      (currFrag.x - startSS.x) / deltaX, 
                      useX);

        // perspective-correct interpolation
        viewDistance = (startVS.z * endVS.z) / mix(endVS.z, startVS.z, search1);
        
        // difference between the perspective-correct interpolation and the current depth of the scene
        depth = viewDistance - depthAtCurrPosVS;

        #ifdef RIGHT_HANDED_SCENE
            depth *= -1.0;
        #endif

        if (depth > 0.0 && depth < thickness) {
            // intersection
            hit0 = 1.0;
            break;
        } else { 
            // no intersection, we continue
            // search0 save the position of the last known miss
            search0 = search1;
        }
    }    
    // save search1 as the halfway between the position of the last miss and the position of the last hit 
    search1 = search0 + ((search1 - search0) / 2.0);
    
    // end of the first pass
    
    if (hit0 == 0.0){ // if no hit during the first pass, we skip this second pass
        info.coords = uv;
        info.visibility = 0.0;
        // info.visibility = deltaX;
        return info;
    }

    for (int i = 0; i < steps; i++) { 
        // second pass
        // the aim is to search more precisely where is the intersection point
        // in fact we could have miss a fragment during the first pass
        // or we could have found a false-positive intersection
        currFrag = mix(startSS.xy, endSS.xy, search1);
        uv.xy = currFrag / texSize;
        // depthAtCurrPosVS = (texture2D(positionSampler, uv.xy)).z;
        depthAtCurrPosVS = (view * texture2D(positionSampler, uv.xy)).z;

        viewDistance = (startVS.z * endVS.z) / mix(endVS.z, startVS.z, search1);
        depth = viewDistance - depthAtCurrPosVS;

        #ifdef RIGHT_HANDED_SCENE
            depth *= -1.0;
        #endif

        if (depth > 0.0 && depth < thickness) {
            hit1 = 1.0;
            search1 = search0 + ((search1 - search0) / 2.0);
        } else {
            float temp = search1;
            search1 = search1 + ((search1 - search0) / 2.0);
            search0 = temp;
        }
    }    
    // end of the second pass
    
   
    // compute how much the reflection is visible

    float visibility;
    if (hit1 == 1.0){ // no hit => no reflected value
        visibility = texture2D(positionSampler, uv).w // alpha value of the reflected scene position 
            * (1.0 - max ( dot(-normalize(hitCoordVS), dirVS), 0.0)) // to fade out the reflexion as the reflected direction point to the camera's position (hit backface of something)
            * (1.0 - clamp (depth/thickness, 0.0, 1.0)) // since the hit point is not always precisely found, we fade out the reflected color if we aren't precise enough 
            * (1.0 - clamp ( length(depthAtCurrPosVS - hitCoordVS.z)/maxDistance, 0.0, 1.0)) // the reflection should be sharper when near from the starting point
            * (uv.x < 0.0 || uv.x > 1.0 ? 0.0 : 1.0) // test if the reflected ray is ou of bounds
            * (uv.y < 0.0 || uv.y > 1.0 ? 0.0 : 1.0);
        // visibility = 1.0;

    } else {
        visibility = 1.0; 
    }

    info.coords = uv;
    info.visibility = visibility;

    return info;
}

// #endif

vec3 hash(vec3 a)
{
    a = fract(a * 0.8);
    a += dot(a, a.yxz + 19.19);
    return fract((a.xxy + a.yxx) * a.zyx);
}
       
void main(void)
{
    // TODO change
    float maxDistance = 10.0;
    float resolution  = 0.5;
    int   steps       = 20;
    float thickness   = 0.4;


    // Intensity
    vec4 albedoFull = texture2D(textureSampler, vUV);
    vec3 albedo = albedoFull.rgb;
    vec3 spec = texture2D(specularMap, vUV).rgb;
    float metallic = texture2D(metallicMap, vUV).b;
    float indexOfRefraction = texture2D(metallicMap, vUV).r;
    float roughness = 1.0 - texture2D(specularMap, vUV).a;

    // if metallic material: spec = albedo * metallic 
    //TODO modify since we dont have reflectivity on black metallic surfaces this way
    // no reflectitivy, no need to compute any reflection
    if ( dot(spec, vec3(1.0)) == 0.0 || roughness == 1.0) {
        gl_FragColor = albedoFull;
        // gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
        
    // Get coordinates of the direction of the reflected ray
    // according to the pixel's position and normal.
    vec3 unitNormal = normalize((texture2D(normalSampler, vUV)).xyz);
    // vec3 position = (texture2D(positionSampler, vUV)).xyz;
    vec3 position = (view * texture2D(positionSampler, vUV)).xyz;
    vec3 unitPosition = normalize((view * texture2D(positionSampler, vUV)).xyz);

    vec3 reflected = normalize(reflect(unitPosition, unitNormal));

    // vec2 texSize = texture2D(positionSampler, 1.0).xy; // doesn't work
    vec2 texSize = gl_FragCoord.xy / vUV; // works

    // vec3 jitt = mix(vec3(0.0), hash(position), roughness);
    ReflectionInfo info = getReflectionInfo2DRayMarching(reflected, position, texSize, maxDistance, resolution, steps, thickness);
    float visibility = clamp(info.visibility, 0.0, 1.0);      

    // get the color of the reflection
    vec3 reflectedColor = texture2D(textureSampler, info.coords).xyz;
    // reflectedColor *= visibility;



    vec2 dCoords = smoothstep(0.2, 0.6, abs(vec2(0.5, 0.5) - info.coords.xy));
    float screenEdgefactor = clamp(1.0 - (dCoords.x + dCoords.y), 0.0, 1.0);
    
    // Fresnel F0
    vec3 F0 = vec3(0.04); // TODO change that for metallic components
    F0 = mix(F0, albedo, spec);

    // Reflection coefficient
    #ifdef RIGHT_HANDED_SCENE
        reflected.z *= -1.0;
    #endif

    vec3 reflectionCoeff = fresnelSchlick(max(dot(unitNormal, unitPosition), 0.0), F0)
                            * visibility
                            * clamp(spec * screenEdgefactor * reflected.z, 0.0, 0.9);;

    // Apply
    // float reflectionPart = clamp(pow(spec, reflectionSpecularFalloffExponent) 
    //                         * screenEdgefactor * reflected.z, 0.0, 0.9);
    // vec3 SSR = info.color * fresnel;

    // *********************** SHADING *******************************

    // // to render the reflected UV coordinates in rg 
    // // and the visibility of the reflection in b
    // gl_FragColor = vec4(info.coords, visibility, 1.0);

    // // to render only the reflection part
    // gl_FragColor = vec4(reflectedColor, albedoFull.a);


    // to render the final color
    // (no refraction) and (AbsorbtionCoeff + RefractionCoeff + ReflectionCoeff = 1)  => AbsorbtionCoeff = 1 - ReflectionCoeff
    gl_FragColor = vec4((albedo * (1.0 - reflectionCoeff)) + (reflectedColor * reflectionCoeff), albedoFull.a);


    // // ************* input texture rendering ****************
    // vec4 first = texture2D(textureSampler, vUV);
    // vec4 specular = texture2D(specularMap, vUV);
    // vec4 metal = texture2D(metallicMap, vUV);

    // // // mixes colors
    // if (vUV.x <= 0.333) { // show only base texture
    //     gl_FragColor = first;
    // }
    // else if (vUV.x <= 0.666) { // show only specular texture
    //     gl_FragColor = specular;
    //     // gl_FragColor.a = 1.0;
    // }
    // else { // show only metallic texture
    //     gl_FragColor = metal;
    //     // gl_FragColor.a = 1.0;
    // }
}

 // // vec2 dCoords = smoothstep(0.2, 0.6, abs(vec2(0.5, 0.5) - info.coords.xy));
    // // float screenEdgefactor = clamp(1.0 - (dCoords.x + dCoords.y), 0.0, 1.0);
        
    // // Fresnel
    // // if no metallic 
    // vec3 F0 = vec3(0.04);
    // F0 = mix(F0, albedo, spec);
    // // TODO if metallic or/and indexOfRefraction
    // vec3 fresnel = fresnelSchlick(max(dot(normalize(normal), normalize(position)), 0.0), F0);

    // #ifdef RIGHT_HANDED_SCENE
    //     reflected.z *= -1.0;
    // #endif

    // // Apply
    // float reflectionMultiplier = clamp(pow(spec * strength, reflectionSpecularFalloffExponent) * screenEdgefactor * reflected.z, 0.0, 0.9);
    // float albedoMultiplier = 1.0 - reflectionMultiplier;
    // vec3 SSR = info.color * fresnel;

    // //     gl_FragColor = vec4((albedo * albedoMultiplier) + (SSR * reflectionMultiplier), albedoFull.a);
    // // #else
    // //     gl_FragColor = texture2D(textureSampler, vUV);
    // // #endif

    // float visibility = clamp(info.visibility, 0.0, 1.0);             
    // gl_FragColor = vec4(info.coords, visibility, visibility);

    // gl_FragColor = vec4(normalize(position), 1.0);
    // gl_FragColor = vec4(unitNormal, 1.0);
    // gl_FragColor = vec4(reflected, 1.0);

    // gl_FragColor = vec4(vUV, 0.5, 1.0);