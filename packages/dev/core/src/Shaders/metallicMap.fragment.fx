uniform sampler2D ORMTexture;

uniform float metallic;
uniform float indexOfRefraction;

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
 
        gl_FragColor.b = metal; 


    #else
        #ifdef METALLIC // already added 
            // should be a PBRMaterial
            gl_FragColor.b = metallic;
        #else // no metallic component
            gl_FragColor.b = 0.0;
        #endif    

    #endif

    #ifdef INDEXOFREFRACTION
        gl_FragColor.r = max(1.0, indexOfRefraction / 3.0); 
        // we assume that an indexOfRefraction can't be higher than 3
        // since we need to share values lower than 1.0, we divide the 
        // indexOfRefraction by its maximum value. We just have to keep
        // this in mind and multiply the indexOfRefraction later 
    #else
        gl_FragColor.r = 1.5/3.0;// / 3.0;
        // no index set
        // we will use default values later according to the metallic of material
    #endif

    gl_FragColor.g = 0.0;
    gl_FragColor.a = 1.0;

}
