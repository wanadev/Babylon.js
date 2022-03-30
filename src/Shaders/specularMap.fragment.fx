uniform sampler2D reflectivityTexture;
uniform sampler2D ORMTexture;
uniform sampler2D albedoTexture;
uniform sampler2D specularGlossinessTexture;
uniform sampler2D occlusionTexture;

uniform vec3 reflectivityColor;
uniform vec3 albedoColor;

uniform float roughness;
uniform float metallic;
uniform float glossiness;

varying vec2 vUV;

//#include<helperFunctions>

void main(void) { // we compute Specularity in .rgb  and shininess in .a

    #ifdef ORMTEXTURE
        // Used as if :
        // pbr.useRoughnessFromMetallicTextureAlpha = false;
        // pbr.useRoughnessFromMetallicTextureGreen = true;
        // pbr.useMetallnessFromMetallicTextureBlue = true;
        float metal = texture2D(ORMTexture, vUV).b;

        #ifdef METALLIC
            metal *= metallic;
        #endif

        gl_FragColor.r = metal; 
        gl_FragColor.g = metal;  
        gl_FragColor.b = metal; 

        gl_FragColor.a = texture2D(ORMTexture, vUV).g;

        #ifdef ROUGHNESS
            gl_FragColor.a *= roughness;
        #endif
        
        #ifdef ALBEDOTEXTURE // Specularity should be: metallic * albedoTexture:
            gl_FragColor.r *= texture2D(albedoTexture, vUV).r; 
            gl_FragColor.g *= texture2D(albedoTexture, vUV).g;  
            gl_FragColor.b *= texture2D(albedoTexture, vUV).b; 
        #else
            #ifdef ALBEDOCOLOR : // Specularity should be: metallic * albedoColor:
                gl_FragColor.r *= albedoColor.x; 
                gl_FragColor.g *= albedoColor.y;  
                gl_FragColor.b *= albedoColor.z;   
            // else : albedo color suposed to be white   
            #endif          
        #endif
    #else
        #ifdef METALLIC // already added 
            // should be a PBRMaterial
            gl_FragColor.r = metallic;
            gl_FragColor.g = metallic;
            gl_FragColor.b = metallic;

            #ifdef ROUGHNESS
                gl_FragColor.a = roughness;
            #else 
                gl_FragColor.a = 1.0;
            #endif    
            #ifdef ALBEDOTEXTURE // Specularity should be: metallic * albedoTexture:
                gl_FragColor.r *= texture2D(albedoTexture, vUV).r; 
                gl_FragColor.g *= texture2D(albedoTexture, vUV).g;  
                gl_FragColor.b *= texture2D(albedoTexture, vUV).b; 
            #else
                #ifdef ALBEDOCOLOR : // Specularity should be: metallic * albedoColor:
                    gl_FragColor.r *= albedoColor.x; 
                    gl_FragColor.g *= albedoColor.y;  
                    gl_FragColor.b *= albedoColor.z;   
                // else : albedo color suposed to be white   
                #endif          
            #endif
        #else
            #ifdef ROUGHNESS
                gl_FragColor.a = roughness;
                gl_FragColor.r = 1.0; // metallic supposed to be 1.0
                gl_FragColor.g = 1.0;
                gl_FragColor.b = 1.0;

                #ifdef ALBEDOTEXTURE // Specularity should be: metallic * albedoTexture:
                    gl_FragColor.r *= texture2D(albedoTexture, vUV).r; 
                    gl_FragColor.g *= texture2D(albedoTexture, vUV).g;  
                    gl_FragColor.b *= texture2D(albedoTexture, vUV).b; 
                #else
                    #ifdef ALBEDOCOLOR : // Specularity should be: metallic * albedoColor:
                        gl_FragColor.r *= albedoColor.x; 
                        gl_FragColor.g *= albedoColor.y;  
                        gl_FragColor.b *= albedoColor.z;   
                    // else : albedo color suposed to be white   
                    #endif          
                #endif

            #else // SpecularGlossiness  Model 
                #ifdef SPECULARGLOSSINESSTEXTURE
                    gl_FragColor.rgb = texture2D(specularGlossinessTexture, vUV).rbg; 
                    gl_FragColor.a = 1.0 - texture2D(specularGlossinessTexture, vUV).a; // roughness = 1.0 - glossiness
                    #ifdef GLOSSINESSS
                        gl_FragColor.a = gl_FragColor.a * glossiness; 
                    #endif
                #else 
                    #ifdef REFLECTIVITYTEXTURE 
                        gl_FragColor.rbg = texture2D(reflectivityTexture, vUV).rbg;
                    #else    
                        #ifdef REFLECTIVITYCOLOR
                            gl_FragColor.rgb = reflectivityColor.xyz;
                            gl_FragColor.a = dot(reflectivityColor.xyz, vec3(1)) / 3.0;
                            // by default we put the shininess to the mean of specular values
                            // if it is not a StandardMaterial, the shininess will be next defined according to the roughness/glossiness
                        #else 
                            // We never reach this case since even if the reflectivity color is not defined
                            // by the user, there is a default reflectivity/specular color set to (1.0, 1.0, 1.0)
                            gl_FragColor.rgba = vec4(1.0, 1.0, 1.0, 1.0);            
                        #endif          
                    #endif 
                    #ifdef GLOSSINESSS
                        gl_FragColor.a = 1.0 - glossiness; // roughness = 1.0 - glossiness
                    #else
                        gl_FragColor.a = 0.0; // glossiness default value in SpecularGlossiness mode = 1.0
                    #endif
                #endif
            #endif    
        #endif   
    #endif
    gl_FragColor.a = 1.0 - gl_FragColor.a; // to return shininess insted of roughness
}
