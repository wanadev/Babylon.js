uniform sampler2D reflectivityTexture;
uniform sampler2D ORMTexture;
uniform sampler2D specularGlossinessTexture;
uniform sampler2D occlusionTexture;

uniform vec3 reflectivityColor;

uniform float roughness;
uniform float metallic;
uniform float glossiness;

varying vec2 vUV;

//#include<helperFunctions>

void main(void) { // we compute ORMS values in each case -> r = occlusion, g = roughness, b = metallic, a = specularity

    #ifdef ORMTEXTURE
        // Used as if :
        // pbr.useRoughnessFromMetallicTextureAlpha = false;
        // pbr.useRoughnessFromMetallicTextureGreen = true;
        // pbr.useMetallnessFromMetallicTextureBlue = true;

        gl_FragColor.rgb = texture2D(ORMTexture, vUV).rgb;
        #ifdef ROUGHNESS
            gl_FragColor.g *= roughness;
        #endif
        #ifdef METALLIC
            gl_FragColor.b *= metallic;
        #endif
        gl_FragColor.a = gl_FragColor.b; 
        // Specularity should be: metallic * albedoColor: 
        // but in the shading pass of SSR we will do an interpolation between F0 and the albedo according to specularity
        // then, we will need a float coefficient for specularity; and the tint will be taken into account in the F0 value.

    #else
        #ifdef SPECULARGLOSSINESSTEXTURE

            gl_FragColor.a = texture2D(reflectivityTexture, vUV).r; // we assume that specular texture are gray scale texture
            gl_FragColor.g = 1.0 - texture2D(reflectivityTexture, vUV).a; // roughness = 1.0 - glossiness
        #else 

            gl_FragColor.rgba = vec4(0.0, 0.0, 0.0, 0.0);
            #ifdef REFLECTIVITYTEXTURE 
                gl_FragColor.a = texture2D(reflectivityTexture, vUV).r; // could also be .g or .b since reflectyvity should be a gray scale texture
            #else 
                #ifdef REFLECTIVITYCOLOR
                gl_FragColor.a = 0.0;
                gl_FragColor.a = reflectivityColor.x; // could also be .g or .b since reflectyvity should be a gray scale color 
                #endif

                // else: no reflectivity texture nor color, we keep FragColor to vec4(0.0)
            #endif

            #ifdef ROUGHNESS
                gl_FragColor.g = roughness;
            #else
                #ifdef GLOSSINESSS
                gl_FragColor.g = 1.0 - glossiness; // roughness = 1.0 - glossiness
                #endif
            #endif

            #ifdef METALLIC
                gl_FragColor.b = metallic;
                //gl_FragColor.a = 0.0; // ? 
            #endif    

        #endif

        #ifdef OCCLUSIONTEXTURE
            gl.FragColor.r = texture2D(occlusionTexture, vUV).r;
        #endif
    #endif
}
