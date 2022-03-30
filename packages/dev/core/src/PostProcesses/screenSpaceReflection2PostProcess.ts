import { Nullable } from "../types";
import { Logger } from "../Misc/logger";
import { Camera } from "../Cameras/camera";
// import { Effect } from "../M    aterials/effect";
import { Texture } from "../Materials/Textures/texture";
// import { DynamicTexture } from "../Materials/Textures/dynamicTexture";
import { RenderTargetTexture } from "../Materials/Textures/renderTargetTexture";
import { StandardMaterial } from "../Materials/standardMaterial";
import { PBRMaterial } from "../Materials/PBR/pbrMaterial";
import { PBRMetallicRoughnessMaterial } from "../Materials/PBR/pbrMetallicRoughnessMaterial";
import { PBRSpecularGlossinessMaterial } from "../Materials/PBR/pbrSpecularGlossinessMaterial";
import { ShaderMaterial } from "../Materials/shaderMaterial";
import { PostProcess, PostProcessOptions } from "./postProcess";
import { Constants } from "../Engines/constants";
import { GeometryBufferRenderer } from '../Rendering/geometryBufferRenderer';
import { serialize, SerializationHelper } from '../Misc/decorators';
import { PrePassRenderer } from "../Rendering/prePassRenderer";
// import { ScreenSpaceReflections2Configuration } from "../Rendering/screenSpaceReflections2Configuration";

// import "../Shaders/reflectivityMap.fragment";
// import "../Shaders/reflectivityMap.vertex";
import "../Shaders/specularMap.fragment";
import "../Shaders/specularMap.vertex";
import "../Shaders/metallicMap.fragment";
import "../Shaders/metallicMap.vertex";
import "../Shaders/screenSpaceReflection2.fragment";
import "../Shaders/screenSpaceReflection2.vertex";
import { RegisterClass } from "../Misc/typeStore";
// import { Mesh } from "../Meshes/mesh";
import { AbstractMesh } from "../Meshes/abstractMesh";
// import { SubMesh, Viewport } from "..";
// import { RenderTargetTexture, Texture } from "..";
//import { RegisterClass } from '../Misc/typeStore';

declare type Engine = import("../Engines/engine").Engine;
declare type Scene = import("../scene").Scene;

/**
 * The ScreenSpaceReflectionPostProcess performs realtime reflections using only and only the available informations on the screen (positions and normals).
 * Basically, the screen space reflection post-process will compute reflections according the material's reflectivity.
 */
export class ScreenSpaceReflection2PostProcess extends PostProcess {
    /**
     * Gets or sets the maxDistance used to define how far in the scene we look for reflection
     */
    @serialize()
    public maxDistance: number = 15; // maxDistance defined according to the scene size if still equal to -1.0 during the post process 
    /**
     * Gets or sets the resolution used for the first pass of the 2D ray marching algorithm. 
     * Controls how many fragments are skipped while marching the reflection ray. Typically in interval [0.1, 1.0]. 
     * If resolution equals 0.0, every fragments are skiped and this results in no reflection at all.
     */
    @serialize()
    public resolution: number = 0.5;
    /**
     * Gets or sets the number of steps allowed for the second pass of the algorithm. More the steps is high, more the reflections will be precise.
     */
    @serialize()
    public steps: number = 10;
    /**
     * Gets or sets the thickness value used as tolerance when computing the intersection between the reflected ray and the scene. 
     */
    @serialize()
    public thickness: number = 0.3;

    private _forceGeometryBuffer: boolean = false;
    private get _geometryBufferRenderer(): Nullable<GeometryBufferRenderer> {
        if (!this._forceGeometryBuffer) {
            return null;
        }

        return this._scene.geometryBufferRenderer;
    }

    private get _prePassRenderer(): Nullable<PrePassRenderer> {
        if (this._forceGeometryBuffer) {
            return null;
        }

        return this._scene.prePassRenderer;
    }

    private _enableSmoothReflections: boolean = false;
    private _reflectionSamples: number = 64;
    private _smoothSteps: number = 5;
    private _isSceneRightHanded: boolean;

    /**
     * Gets a string identifying the name of the class
     * @returns "ScreenSpaceReflectionPostProcess" string
     */
    public getClassName(): string {
        return "ScreenSpaceReflectionPostProcess";
    }

        /**
     * Creates a new instance of ScreenSpaceReflectionPostProcess.
     * @param name The name of the effect.
     * @param scene The scene containing the objects to calculate reflections.
     * @param options The required width/height ratio to downsize to before computing the render pass.
     * @param camera The camera to apply the render pass to.
     * @param samplingMode The sampling mode to be used when computing the pass. (default: 0)
     * @param engine The engine which the post process will be applied. (default: current engine)
     * @param reusable If the post process can be reused on the same frame. (default: false)
     * @param textureType Type of textures used when performing the post process. (default: 0)
     * @param blockCompilation If compilation of the shader should not be done in the constructor. The updateEffect method can be used to compile the shader at a later time. (default: true)
     * @param forceGeometryBuffer If this post process should use geometry buffer instead of prepass (default: false)
     */
         constructor(name: string, scene: Scene, options: number | PostProcessOptions, camera: Nullable<Camera>, engine: Engine, samplingMode?: number, reusable?: boolean, textureType: number = Constants.TEXTURETYPE_UNSIGNED_INT, blockCompilation = false, forceGeometryBuffer = false) {
            super(name, 'screenSpaceReflection2',
                ["projection", "view", "maxDistance", "resolution", "steps", "thickness"], 
             [
                "textureSampler", "normalSampler", "positionSampler", "specularMap", "metallicMap"
            ], 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, reusable,
                "#define SSR_SUPPORTED\n",
                textureType, undefined, null, blockCompilation);

                if (!camera) {
                    return;
                }

            this._forceGeometryBuffer = true; //forceGeometryBuffer;
            if (this._forceGeometryBuffer) {
                // Get geometry buffer renderer and update effect
                const geometryBufferRenderer = scene.enableGeometryBufferRenderer();
                if (geometryBufferRenderer) {
                    if (geometryBufferRenderer.isSupported) {
                        geometryBufferRenderer.enablePosition = true;
                        // geometryBufferRenderer.enableReflectivity = true;
                    } else {
                        Logger.Error("Multiple Render Target support needed for screen space reflection 2 post process. Please use IsSupported test first.");
                    }
                }
            }
            // else { // doesn't work !
            //     const prePassRenderer = scene.enablePrePassRenderer();
            //     prePassRenderer?.markAsDirty();
            //     this._prePassEffectConfiguration = new ScreenSpaceReflections2Configuration();
            // }

            // our own prepass
            const renderSpecularTarget = new RenderTargetTexture("specular to texture", {height: engine.getRenderHeight(),  width: engine.getRenderWidth()}, scene); // TODO change texture size
            scene.customRenderTargets.push(renderSpecularTarget);
            // {height: engine.getRenderHeight(),  width: engine.getRenderWidth()}

            const renderMetallicTarget = new RenderTargetTexture("metallic to texture", {height: engine.getRenderHeight(),  width: engine.getRenderWidth()}, scene);
            scene.customRenderTargets.push(renderMetallicTarget);

            scene.executeWhenReady(() => {
                scene.meshes.forEach ((mesh) => {
                    this.iterateOverTheSceneMeshes(mesh, scene, renderSpecularTarget, renderMetallicTarget);
                });
            });

            this._updateEffectDefines();

            // var finalPass = new PostProcess(
            //             'SSR2 shader',
            //             'screenSpaceReflection2', // shader name
            //             null, // attributes
            //             [ "specularMap", "metallicMap" ], // textures
            //             1.0,  // options
            //             camera,
            //             Texture.BILINEAR_SAMPLINGMODE, // sampling
            //             engine // engine
            //         );

            // On apply, send uniforms
            this.onApply = (effect) => {

                effect.setTexture("specularMap", renderSpecularTarget); // pass the renderSpecularTarget as our second texture
                effect.setTexture("metallicMap", renderMetallicTarget); // pass the renderMetallicTarget as our third texture

                const prePassRenderer = this._prePassRenderer;
                // const geometryBufferRenderer = this._geometryBufferRenderer;

                if (!prePassRenderer && !this._geometryBufferRenderer) {
                    return;
                }

                if (this._geometryBufferRenderer) {
                    // Samplers
                    const positionIndex = this._geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.POSITION_TEXTURE_TYPE);
                    // const roughnessIndex = geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.REFLECTIVITY_TEXTURE_TYPE);

                    effect.setTexture("normalSampler", this._geometryBufferRenderer!.getGBuffer().textures[1]);
                    effect.setTexture("positionSampler", this._geometryBufferRenderer!.getGBuffer().textures[positionIndex]);
                    // effect.setTexture("reflectivitySampler", geometryBufferRenderer.getGBuffer().textures[roughnessIndex]);
                }
                // else if (prePassRenderer) { // doesn't work !
                //     // Samplers
                //     const positionIndex = prePassRenderer.getIndex(Constants.PREPASS_POSITION_TEXTURE_TYPE);
                //     // const roughnessIndex = prePassRenderer.getIndex(Constants.PREPASS_REFLECTIVITY_TEXTURE_TYPE);
                //     const normalIndex = prePassRenderer.getIndex(Constants.PREPASS_NORMAL_TEXTURE_TYPE);

                //     effect.setTexture("normalSampler", prePassRenderer.getRenderTarget().textures[normalIndex]);
                //     effect.setTexture("positionSampler", prePassRenderer.getRenderTarget().textures[positionIndex]);
                //     // effect.setTexture("reflectivitySampler", prePassRenderer.getRenderTarget().textures[roughnessIndex]);
                // }

                const viewMatrix = camera.getViewMatrix(true);
                const projectionMatrix = camera.getProjectionMatrix(true);

                effect.setMatrix("projection", projectionMatrix);
                effect.setMatrix("view", viewMatrix);

                effect.setFloat("maxDistance", this.maxDistance);
                effect.setFloat("resolution", this.resolution);
                effect.setInt("steps", this.steps);
                effect.setFloat("thickness", this.thickness);
            };

            this._isSceneRightHanded = scene.useRightHandedSystem;
        }

        // recursive iteration over meshes
        private iterateOverTheSceneMeshes(mesh : AbstractMesh, scene : Scene,
                                          renderSpecularTarget : RenderTargetTexture,
                                          renderMetallicTarget : RenderTargetTexture) {
            // console.log(mesh.name + "    " + mesh.subMeshes.length);
            this.computeSpecularMap(mesh, scene, renderSpecularTarget);
            this.computeMetallicMap(mesh, scene, renderMetallicTarget);

            if (mesh.getChildMeshes()) {
                const subM = mesh.getChildMeshes();
                for (let i = 0; i < subM.length; i++) {
                    const m = subM[i];
                    this.iterateOverTheSceneMeshes(m, scene, renderSpecularTarget, renderMetallicTarget);
                }
                return;
            } else {
                return;
            }
        }

    /**
     * Gets whether or not smoothing reflections is enabled.
     * Enabling smoothing will require more GPU power and can generate a drop in FPS.
     */
    @serialize()
    public get enableSmoothReflections(): boolean {
        return this._enableSmoothReflections;
    }

    /**
     * Sets whether or not smoothing reflections is enabled.
     * Enabling smoothing will require more GPU power and can generate a drop in FPS.
     */
    public set enableSmoothReflections(enabled: boolean) {
        if (enabled === this._enableSmoothReflections) {
            return;
        }

        this._enableSmoothReflections = enabled;
        this._updateEffectDefines();
    }

    /**
     * Gets the number of samples taken while computing reflections. More samples count is high,
     * more the post-process wil require GPU power and can generate a drop in FPS. Basically in interval [25, 100].
     */
    @serialize()
    public get reflectionSamples(): number {
        return this._reflectionSamples;
    }

    /**
     * Sets the number of samples taken while computing reflections. More samples count is high,
     * more the post-process wil require GPU power and can generate a drop in FPS. Basically in interval [25, 100].
     */
    public set reflectionSamples(samples: number) {
        if (samples === this._reflectionSamples) {
            return;
        }

        this._reflectionSamples = samples;
        this._updateEffectDefines();
    }

    /**
     * Gets the number of samples taken while smoothing reflections. More samples count is high,
     * more the post-process will require GPU power and can generate a drop in FPS.
     * Default value (5.0) work pretty well in all cases but can be adjusted.
     */
    @serialize()
    public get smoothSteps(): number {
        return this._smoothSteps;
    }

    /*
     * Sets the number of samples taken while smoothing reflections. More samples count is high,
     * more the post-process will require GPU power and can generate a drop in FPS.
     * Default value (5.0) work pretty well in all cases but can be adjusted.
     */
    public set smoothSteps(steps: number) {
        if (steps === this._smoothSteps) {
            return;
        }

        this._smoothSteps = steps;
        this._updateEffectDefines();
    }

    private _updateEffectDefines(): void {
        const defines: string[] = [];
        if (this._geometryBufferRenderer || this._prePassRenderer) {
            defines.push("#define SSR_SUPPORTED");
        }
        if (this._enableSmoothReflections) {
            defines.push("#define ENABLE_SMOOTH_REFLECTIONS");
        }
        if (this._isSceneRightHanded) {
            defines.push("#define RIGHT_HANDED_SCENE");
        }

        defines.push("#define REFLECTION_SAMPLES " + (this._reflectionSamples >> 0));
        defines.push("#define SMOOTH_STEPS " + (this._smoothSteps >> 0));

        this.updateEffect(defines.join("\n"));
    }

    /** @hidden **/
    /**
     * 
     * @param parsedPostProcess 
     * @param targetCamera 
     * @param scene 
     * @param rootUrl 
     * @returns 
     */
    public static _Parse(parsedPostProcess: any, targetCamera: Camera, scene: Scene, rootUrl: string) {
        return SerializationHelper.Parse(() => {
            return new ScreenSpaceReflection2PostProcess(
                parsedPostProcess.name, scene,
                parsedPostProcess.options, targetCamera, scene.getEngine(),
                parsedPostProcess.renderTargetSamplingMode,
                parsedPostProcess.textureType, parsedPostProcess.reusable);
        }, parsedPostProcess, scene, rootUrl);
    }

    // public computeReflectivityMap(m: Mesh, scene: Scene) {

    //     //var defines = []; // used in the fragment shader to compute the Occlusion-Roughness-Metallic-Reflectivity map
    //     var defines: string[] = [];

    //     let reflectivityMapShader = new ShaderMaterial(
    //         "reflectivityMapShader",
    //         scene,
    //         {
    //             vertex: "reflectivityMap",
    //             fragment: "reflectivityMap",
    //         },
    //         {
    //             attributes: ["position", "normal", "uv"],
    //             uniforms: ["world", "worldView", "worldViewProjection", "view", "projection"],
    //             defines : defines, // will be fill in according to given material data
    //         },
    //     )

    //     if (m.material){ // there is a material

    //         // for PBR materials: cf. https://doc.babylonjs.com/divingDeeper/materials/using/masterPBR
    //         if(m.material instanceof PBRMetallicRoughnessMaterial){
    //             // if it is a PBR material in MetallicRoughness Mode:
    //             if(m.material.metallicRoughnessTexture){
    //                 reflectivityMapShader.setTexture("ORMTexture", m.material.metallicRoughnessTexture);
    //                 defines.push("#define ORMTEXTURE");
    //             }
    //             if(m.material.metallic){
    //                 reflectivityMapShader.setFloat("metallic", m.material.metallic);
    //                 defines.push("#define METALLIC");
    //             }
    //             if(m.material.roughness){
    //                 reflectivityMapShader.setFloat("roughness", m.material.roughness);
    //                 defines.push("#define ROUGHNESS");
    //             }
    //         }
    //         else if (m.material instanceof PBRSpecularGlossinessMaterial){
    //             // if it is a PBR material in Specular/Glossiness Mode:

    //             //reflectivityMapShader.setTexture("specularGlossinessTexture", m.material.specularGlossinessTexture);
    //             //defines.push("#define SPECULARGLOSSINESSTEXTURE");
    //             if(m.material.specularGlossinessTexture){
    //                 reflectivityMapShader.setTexture("specularGlossinessTexture", m.material.specularGlossinessTexture);
    //                 defines.push("#define SPECULARGLOSSINESSTEXTURE");
    //             } else {
    //                 if(m.material.specularColor){
    //                     reflectivityMapShader.setColor3("reflectivityColor", m.material.specularColor);
    //                     defines.push("#define REFLECTIVITYCOLOR");
    //                  }
    //                 if(m.material.glossiness){
    //                     reflectivityMapShader.setFloat("glossiness", m.material.glossiness);
    //                     defines.push("#define GLOSSINESSS");
    //                 }
    //             }
    //             if(m.material.occlusionTexture){
    //                 reflectivityMapShader.setTexture("occlusionTexture", m.material.occlusionTexture);
    //                 defines.push("#define OCCLUSIONTEXTURE");
    //             }

    //         }
    //         else if(m.material instanceof PBRMaterial){
    //             // if it is the bigger PBRMaterial
    //             if(m.material.metallicTexture){
    //                 reflectivityMapShader.setTexture("ORMTexture", m.material.metallicTexture);
    //                 defines.push("#define ORMTEXTURE");
    //             }
    //             if(m.material.metallic){
    //                 reflectivityMapShader.setFloat("metallic", m.material.metallic);
    //                 defines.push("#define METALLIC");
    //             }
    //             if(m.material.roughness){
    //                 reflectivityMapShader.setFloat("roughness", m.material.roughness);
    //                 defines.push("#define ROUGHNESS");
    //             }
    //             if(m.material.reflectivityTexture){
    //                 reflectivityMapShader.setTexture("reflectivityTexture", m.material.reflectivityTexture);
    //                 defines.push("#define REFLECTIVITYTEXTURE");
    //             }
    //             if(m.material.ambientTexture){
    //                 reflectivityMapShader.setTexture("occlusionTexture", m.material.ambientTexture);
    //                 defines.push("#define OCCLUSIONTEXTURE");
    //             }
    //             if(m.material.reflectivityColor){
    //                 reflectivityMapShader.setColor3("reflectivityColor", m.material.reflectivityColor);
    //                 defines.push("#define REFLECTIVITYCOLOR");
    //             }
    //             if(m.material.microSurface){
    //                 reflectivityMapShader.setFloat("glossiness", m.material.microSurface);
    //                 defines.push("#define GLOSSINESSS");
    //             }
    //         }
    //         else if(m.material instanceof StandardMaterial){
    //             // if StandardMaterial:
    //             // if specularTexture not null : use it to compute reflectivity
    //             if(m.material.specularTexture){
    //                 reflectivityMapShader.setTexture("reflectivityTexture", m.material.specularTexture);
    //                 defines.push("#define REFLECTIVITYTEXTURE");
    //             }
    //             if(m.material.specularColor){
    //                 reflectivityMapShader.setColor3("reflectivityColor", m.material.specularColor);
    //                 defines.push("#define REFLECTIVITYCOLOR");
    //             }

    //             // else :
    //                 // if Specular or Roughness : use it to compute reflectivity

    //                 // else : not possible ?
    //         }
    //     }
    //     m.material = reflectivityMapShader;
    //     // if there is no material, nothing is binded and we return a totally black texture
    // }
// ********************************************* pre pass first version

    // private prepassSpecularMetallic(scene : Scene, camera : Nullable<Camera>, engine : Engine){
    //     var renderSpecularTarget = new RenderTargetTexture('specular to texture', 512, scene); // TODO change texture size
    //     scene.customRenderTargets.push(renderSpecularTarget);

    //     var renderMetallicTarget = new RenderTargetTexture('metallic to texture', 512, scene);
    //     scene.customRenderTargets.push(renderMetallicTarget);

    //     scene.meshes.forEach ((mesh) => {
    //         this.computeSpecularMap(mesh, scene, renderSpecularTarget);
    //         this.computeMetallicMap(mesh, scene, renderMetallicTarget);
    //     })

    //     // scene.meshes.forEach ((mesh) => {
    //     //     this.computeSpecularMap(mesh, scene, renderSpecularTarget);
    //     //     this.computeMetallicMap(mesh, scene, renderMetallicTarget);
    //     //     while (mesh.subMeshes && mesh.subMeshes.length > 0) {
    //     //         for (let i = 0; i < mesh.subMeshes.length ; i++){
    //     //             mesh = mesh.subMeshes[i].getMesh();
    //     //             this.computeSpecularMap(mesh, scene, renderSpecularTarget);
    //     //             this.computeMetallicMap(mesh, scene, renderMetallicTarget);
    //     //         }

    //     //     }
    //     // })
    //     // for meshes in scene : computeSpecularMap(mesh, scene, renderSpecularTarget)
    //     // for meshes in scene : computeSpecularMap(mesh, scene, renderSpecularTarget)

    //     // console.log(renderSpecularTarget.renderList?.length);
    //     // console.log(renderMetallicTarget.renderList?.length);
    //     // TODO - creuser ca !!
    //     // https://doc.babylonjs.com/divingDeeper/postProcesses/renderTargetTextureMultiPass

    //     var finalPass = new PostProcess(
    //         'Final compose shader',
    //         'finalTest', // shader name
    //         null, // attributes
    //         [ 'specularMap', 'metallicMap' ], // textures
    //         1.0,  // options
    //         camera,
    //         Texture.BILINEAR_SAMPLINGMODE, // sampling
    //         engine // engine
    //     );
    //     finalPass.onApply = (effect) => {
    //         effect.setTexture('specularMap', renderSpecularTarget); // pass the renderSpecularTarget as our second texture
    //         effect.setTexture('metallicMap', renderMetallicTarget); // pass the renderMetallicTarget as our third texture
    //     };
    // }

    private computeSpecularMap(m: AbstractMesh, scene: Scene, renderSpecularTarget : RenderTargetTexture) {

        //var defines = []; // used in the fragment shader to compute the Occlusion-Roughness-Metallic-Reflectivity map
        const defines: string[] = [];

        const specularMapShader = new ShaderMaterial(
            "specularMapShader",
            scene,
            {
                vertex: "specularMap",
                fragment: "specularMap",
            },
            {
                attributes: ["position", "normal", "uv"],
                uniforms: ["world", "worldView", "worldViewProjection", "view", "projection"],
                defines : defines, // will be fill in according to given material data
            },
        );

        if (m.material) { // there is a material

            // for PBR materials: cf. https://doc.babylonjs.com/divingDeeper/materials/using/masterPBR
            if (m.material instanceof PBRMetallicRoughnessMaterial) {
                // if it is a PBR material in MetallicRoughness Mode:
                // console.log(m.name + " PBRMetallicRoughnessMaterial");
                if (m.material.metallicRoughnessTexture != null) {
                    specularMapShader.setTexture("ORMTexture", m.material.metallicRoughnessTexture);
                    defines.push("#define ORMTEXTURE");
                }
                if (m.material.metallic != null) {
                    specularMapShader.setFloat("metallic", m.material.metallic);
                    defines.push("#define METALLIC");
                }
                if (m.material.roughness != null) {
                    specularMapShader.setFloat("roughness", m.material.roughness);
                    defines.push("#define ROUGHNESS");
                }
                if (m.material.baseTexture != null) {
                    specularMapShader.setTexture("albedoTexture", m.material.baseTexture);
                    defines.push("#define ALBEDOTEXTURE");
                } else if (m.material.baseColor != null) {
                    specularMapShader.setColor3("albedoColor", m.material.baseColor);
                    defines.push("#define ALBEDOCOLOR");
                }

            }
            else if (m.material instanceof PBRSpecularGlossinessMaterial) {
                // console.log(m.name + " PBRSpecularGlossinessMaterial");
                // if it is a PBR material in Specular/Glossiness Mode:
                if (m.material.specularGlossinessTexture != null) {
                    specularMapShader.setTexture("specularGlossinessTexture", m.material.specularGlossinessTexture);
                    defines.push("#define SPECULARGLOSSINESSTEXTURE");
                } else {
                    if (m.material.specularColor != null) {
                        specularMapShader.setColor3("reflectivityColor", m.material.specularColor);
                        defines.push("#define REFLECTIVITYCOLOR");
                     }
                    if (m.material.glossiness != null) {
                        specularMapShader.setFloat("glossiness", m.material.glossiness);
                        defines.push("#define GLOSSINESSS");
                    }
                }
                // if (m.material.occlusionTexture != null) {
                //     specularMapShader.setTexture("occlusionTexture", m.material.occlusionTexture);
                //     defines.push("#define OCCLUSIONTEXTURE");
                // }

            }
            else if (m.material instanceof PBRMaterial) {
                // console.log(m.name + " PBRMaterial");
                // if it is the bigger PBRMaterial
                if (m.material.metallicTexture != null) {
                    specularMapShader.setTexture("ORMTexture", m.material.metallicTexture);
                    defines.push("#define ORMTEXTURE");
                }
                if (m.material.metallic != null) {
                    specularMapShader.setFloat("metallic", m.material.metallic);
                    defines.push("#define METALLIC");
                }

                if (m.material.roughness != null) {
                    specularMapShader.setFloat("roughness", m.material.roughness);
                    defines.push("#define ROUGHNESS");
                }

                if (m.material.roughness === null && m.material.metallic === null && m.material.metallicTexture === null){ // SpecularGlossiness Model
                    if (m.material.reflectivityTexture != null) {
                        specularMapShader.setTexture("specularGlossinessTexture", m.material.reflectivityTexture);
                        defines.push("#define SPECULARGLOSSINESSTEXTURE");
                    } else if (m.material.reflectivityColor != null) {
                        specularMapShader.setColor3("reflectivityColor", m.material.reflectivityColor);
                        defines.push("#define REFLECTIVITYCOLOR");
                    }
                    if (m.material.microSurface != null) {
                        specularMapShader.setFloat("glossiness", m.material.microSurface);
                        defines.push("#define GLOSSINESSS");
                    }
                } else { // MetallicRoughness Model
                    if (m.material.albedoTexture != null) {
                        specularMapShader.setTexture("albedoTexture", m.material.albedoTexture);
                        defines.push("#define ALBEDOTEXTURE");
                    } else if (m.material.albedoColor != null) {
                        specularMapShader.setColor3("albedoColor", m.material.albedoColor);
                        defines.push("#define ALBEDOCOLOR");
                    }
                }    
                // if (m.material.ambientTexture != null) {
                //     specularMapShader.setTexture("occlusionTexture", m.material.ambientTexture);
                //     defines.push("#define OCCLUSIONTEXTURE");
                // }
            }
            else if (m.material instanceof StandardMaterial) {
                // console.log(m.name + " StandardMaterial");

                // if StandardMaterial:
                // if specularTexture not null : use it to compute reflectivity
                if (m.material.specularTexture != null) {
                    specularMapShader.setTexture("reflectivityTexture", m.material.specularTexture);
                    defines.push("#define REFLECTIVITYTEXTURE");
                }
                if (m.material.specularColor != null) {
                    specularMapShader.setColor3("reflectivityColor", m.material.specularColor);
                    defines.push("#define REFLECTIVITYCOLOR");
                }

                // else :
                    // not possible ?
            }
        }
        // if there is no material, nothing is binded and we return a totally white texture

        renderSpecularTarget.setMaterialForRendering(m, specularMapShader);
        renderSpecularTarget.renderList?.push(m);
        //m.material = specularMapShader;
    }

    private computeMetallicMap(m: AbstractMesh, scene: Scene, renderMetallicTarget : RenderTargetTexture) {

        //var defines = []; // used in the fragment shader to compute the Occlusion-Roughness-Metallic-Reflectivity map
        const defines: string[] = [];

        const metallicMapShader = new ShaderMaterial(
            "metallicMapShader",
            scene,
            {
                vertex: "metallicMap",
                fragment: "metallicMap",
            },
            {
                attributes: ["position", "normal", "uv"],
                uniforms: ["world", "worldView", "worldViewProjection", "view", "projection"],
                defines : defines, // will be fill in according to given material data
            },
        );

        if (m.material) { // there is a material

            // for PBR materials: cf. https://doc.babylonjs.com/divingDeeper/materials/using/masterPBR
            if (m.material instanceof PBRMetallicRoughnessMaterial) {
                // console.log(m.name + " PBRMetallicRoughnessMaterial");
                // if it is a PBR material in MetallicRoughness Mode:
                if (m.material.metallicRoughnessTexture != null) {
                    metallicMapShader.setTexture("ORMTexture", m.material.metallicRoughnessTexture);
                    defines.push("#define ORMTEXTURE");
                }
                if (m.material.metallic != null) {
                    metallicMapShader.setFloat("metallic", m.material.metallic);
                    defines.push("#define METALLIC");
                }
            }
            else if (m.material instanceof PBRMaterial) {
                // console.log(m.name + " PBRMaterial");

                // if it is the bigger PBRMaterial
                if (m.material.metallicTexture != null) {
                    metallicMapShader.setTexture("ORMTexture", m.material.metallicTexture);
                    defines.push("#define ORMTEXTURE");
                }
                if (m.material.metallic != null) {
                    metallicMapShader.setFloat("metallic", m.material.metallic);
                    defines.push("#define METALLIC");
                }
                if (m.material.indexOfRefraction != null) {
                    metallicMapShader.setFloat("indexOfRefraction", m.material.indexOfRefraction);
                    defines.push("#define INDEXOFREFRACTION");
                }
            }
        }
        // if there is no metallic component, nothing is binded and we return a totally black texture

        renderMetallicTarget.setMaterialForRendering(m, metallicMapShader);
        renderMetallicTarget.renderList?.push(m);
        // m.material = metallicMapShader;
    }
}

RegisterClass("BABYLON.ScreenSpaceReflection2PostProcess", ScreenSpaceReflection2PostProcess);
