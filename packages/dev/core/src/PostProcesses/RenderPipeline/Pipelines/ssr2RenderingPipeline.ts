/* eslint-disable @typescript-eslint/naming-convention */
// import { Logger } from "../../../Misc/logger";
import { serialize, SerializationHelper } from "../../../Misc/decorators";
// import { Vector3, TmpVectors } from "../../../Maths/math.vector";
import { Camera } from "../../../Cameras/camera";
import type { Effect } from "../../../Materials/effect";
import { Texture } from "../../../Materials/Textures/texture";
// import { DynamicTexture } from "../../../Materials/Textures/dynamicTexture";
import { PostProcess } from "../../../PostProcesses/postProcess";
import { PostProcessRenderPipeline } from "../../../PostProcesses/RenderPipeline/postProcessRenderPipeline";
import { PostProcessRenderEffect } from "../../../PostProcesses/RenderPipeline/postProcessRenderEffect";
// import { ScreenSpaceReflection2PostProcess } from "core/PostProcesses/screenSpaceReflection2PostProcess";
import { PassPostProcess } from "../../../PostProcesses/passPostProcess";
import type { Scene } from "../../../scene";
import { RegisterClass } from "../../../Misc/typeStore";
// import { EngineStore } from "../../../Engines/engineStore";
import { ScreenSpaceReflections2Configuration } from "../../../Rendering/screenSpaceReflections2Configuration";
import type { PrePassRenderer } from "../../../Rendering/prePassRenderer";
import { GeometryBufferRenderer } from "../../../Rendering/geometryBufferRenderer";
import { Constants } from "../../../Engines/constants";
import type { Nullable } from "../../../types";

import { StandardMaterial } from "../../../Materials/standardMaterial";
import { PBRMaterial } from "../../../Materials/PBR/pbrMaterial";
import { PBRMetallicRoughnessMaterial } from "../../../Materials/PBR/pbrMetallicRoughnessMaterial";
import { PBRSpecularGlossinessMaterial } from "../../../Materials/PBR/pbrSpecularGlossinessMaterial";
import { ShaderMaterial } from "../../../Materials/shaderMaterial";
import { AbstractMesh } from "../../../Meshes/abstractMesh";
import { CubeTexture } from "../../../Materials/Textures/cubeTexture";
// import { Observable } from "../../../Misc/observable";


import "../../../PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";

// import "../../../Shaders/ssao2.fragment";
// import "../../../Shaders/ssaoCombine.fragment";
import "../../../Shaders/specularMap.fragment";
import "../../../Shaders/specularMap.vertex";
import "../../../Shaders/metallicMap.fragment";
import "../../../Shaders/metallicMap.vertex";
import "../../../Shaders/screenSpaceReflection2.fragment";
import "../../../Shaders/screenSpaceReflection2.vertex";
import { RenderTargetTexture } from "../../../Materials";
import { BlurPostProcess } from "../../../PostProcesses/blurPostProcess";
import { Vector2 } from "../../../Maths";

/**
 * Render pipeline to produce ssao effect
 */
export class SSR2RenderingPipeline extends PostProcessRenderPipeline {
    // Members

    /**
     * @ignore
     * The PassPostProcess id in the pipeline that contains the original scene color
     */
    public SSR2OriginalSceneColorEffect: string = "SSR2OriginalSceneColorEffect";
    /**
     
    /**
     * @ignore
     * The BlurPostProcess id in the pipeline that contains the blured scene color
     */
    public SSR2BlurEffect: string = "SSR2BlurEffect";

    /** 
     * @ignore
     * The SSR PostProcess id in the pipeline
     */
    public SSR2RenderEffect: string = "SSR2RenderEffect";
   
     
   
    /**
     * @ignore
     * The horizontal blur PostProcess id in the pipeline
     */
    public SSR2BlurHRenderEffect: string = "SSR2BlurHRenderEffect";
    /**
     * @ignore
     * The vertical blur PostProcess id in the pipeline
     */
    public SSR2BlurVRenderEffect: string = "SSR2BlurVRenderEffect";

    // /**
    //  * @ignore
    //  * The PostProcess id in the pipeline that combines the SSAO-Blur output with the original scene color (SSAOOriginalSceneColorEffect)
    //  */
    // public SSAOCombineRenderEffect: string = "SSAOCombineRenderEffect";

    // /**
    //  * The output strength of the SSAO post-process. Default value is 1.0.
    //  */
    // @serialize()
    // public totalStrength: number = 1.0;

    // /**
    //  * Maximum depth value to still render AO. A smooth falloff makes the dimming more natural, so there will be no abrupt shading change.
    //  */
    // @serialize()
    // public maxZ: number = 100.0;

    // /**
    //  * In order to save performances, SSAO radius is clamped on close geometry. This ratio changes by how much
    //  */
    // @serialize()
    // public minZAspect: number = 0.2;

    // @serialize("samples")
    // private _samples: number = 8;
    // /**
    //  * Number of samples used for the SSAO calculations. Default value is 8
    //  */
    // public set samples(n: number) {
    //     this._samples = n;
    //     this._ssaoPostProcess.updateEffect(this._getDefinesForSSAO());
    //     this._sampleSphere = this._generateHemisphere();
    // }
    // public get samples(): number {
    //     return this._samples;
    // }

    @serialize("textureSamples")
    private _textureSamples: number = 1;
    /**
     * Number of samples to use for antialiasing
     */
    public set textureSamples(n: number) {
        this._textureSamples = n;

        if (this._prePassRenderer) {
            this._prePassRenderer.samples = n;
        } 
        else {
            this._originalColorPostProcess.samples = n;
        }
        if (this._ssr2PostProcess) this._ssr2PostProcess.samples = n;

        this._renderMetallicTarget.samples = n;
        this._renderSpecularTarget.samples = n;
    }
    public get textureSamples(): number {
        return this._textureSamples;
    }

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
 
     /**
      * Gets or sets the cube texture used to define the reflection when the reflected rays of SRR leave the view space or when the maxDistance is reached.
      * As the reflected rays can't reach the skybox, backUpTexture could typically be the skybox texture or a texture from a reflection probe. 
      */
    @serialize()
    private _backUpTexture: Nullable<CubeTexture> = null; 
 
 
    get backUpTexture():Nullable<CubeTexture> {
        return this._backUpTexture;
    }
    set backUpTexture(backUpTex:Nullable<CubeTexture>) {
        this._backUpTexture = backUpTex;
    //  this._updateEffectDefines();
    }
 
     /**
      * Gets or sets the reflection quality through the size of the renderTargetTexture we use.
      * Quality property is expected to be between 0.5 (low quality) and 1.0 (hight quality). It is clamp to [0, 1].
      */
    private _quality: number = 0.75; 

    // private _oldBackUpTexture: Nullable<CubeTexture> = null; 

    // private _ssrDefines: string = ""; 
 


    /**
     * Force rendering the geometry through geometry buffer
     */
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

    private _isSceneRightHanded: boolean;


    /**
     * Ratio object used for SSAO ratio and blur ratio
     */
    @serialize()
    private _ratio: any;

    // /**
    //  * Dynamically generated sphere sampler.
    //  */
    // private _sampleSphere: number[];

    /**
     * Blur filter offsets
     */
    // private _samplerOffsets: number[];

    // @serialize("expensiveBlur")
    // private _expensiveBlur: boolean = true;
    // /**
    //  * If bilateral blur should be used
    //  */
    // public set expensiveBlur(b: boolean) {
    //     this._blurHPostProcess.updateEffect("#define BILATERAL_BLUR\n#define BILATERAL_BLUR_H\n#define SAMPLES 16\n#define EXPENSIVE " + (b ? "1" : "0") + "\n", null, [
    //         "textureSampler",
    //         "depthSampler",
    //     ]);
    //     this._blurVPostProcess.updateEffect("#define BILATERAL_BLUR\n#define SAMPLES 16\n#define EXPENSIVE " + (b ? "1" : "0") + "\n", null, ["textureSampler", "depthSampler"]);
    //     this._expensiveBlur = b;
    // }

    // public get expensiveBlur(): boolean {
    //     return this._expensiveBlur;
    // }

    /**
     * The radius around the analyzed pixel used by the SSR post-process. Default value is 2.0
     */
    @serialize()
    public radius: number = 2.0;

    // /**
    //  * The base color of the SSAO post-process
    //  * The final result is "base + ssao" between [0, 1]
    //  */
    // @serialize()
    // public base: number = 0;

    // /**
    //  *  Support test.
    //  */
    // public static get IsSupported(): boolean {
    //     const engine = EngineStore.LastCreatedEngine; // TODO change
    //     if (!engine) {
    //         return false;
    //     }
    //     return engine._features.supportSSAO2;
    // }

    private _scene: Scene;
    // private _randomTexture: DynamicTexture;
    private _originalColorPostProcess: PassPostProcess;
    private _blurPostProcess: BlurPostProcess;
    private _ssr2PostProcess: PostProcess;
    private _renderSpecularTarget : RenderTargetTexture;
    private _renderMetallicTarget : RenderTargetTexture;

    // private _blurHPostProcess: PostProcess;
    // private _blurVPostProcess: PostProcess;
    // private _ssaoCombinePostProcess: PostProcess;

    /**
     * Gets active scene
     */
    public get scene(): Scene {
        return this._scene;
    }

    /**
     * @constructor
     * @param name The rendering pipeline name
     * @param scene The scene linked to this pipeline
     * @param ratio The size of the postprocesses. Can be a number shared between passes or an object for more precision: { ssaoRatio: 0.5, blurRatio: 1.0 }
     * @param cameras The array of cameras that the rendering pipeline will be attached to
     * @param forceGeometryBuffer Set to true if you want to use the legacy geometry buffer renderer
     * @param textureType The texture type used by the different post processes created by SSAO (default: Constants.TEXTURETYPE_UNSIGNED_INT)
     */
    constructor(
        name: string, 
        scene: Scene, 
        ratio: any, 
        cameras?: Camera[], 
        forceGeometryBuffer = false, 
        textureType = Constants.TEXTURETYPE_UNSIGNED_INT){

        super(scene.getEngine(), name);
        
        this._scene = scene;
        const engine = scene.getEngine()
        
        this._isSceneRightHanded = scene.useRightHandedSystem;
        
        this._ratio = ratio;
        
        if (!scene.activeCamera) {
            return;
        }
        
        // if (!this.isSupported) {
        //     Logger.Error("The current engine does not support SSR 2.");
        //     return;
        // }

        // our own prePass
        this._renderSpecularTarget = new RenderTargetTexture("specularToTexture", {height: engine.getRenderHeight() * this._quality,  width: engine.getRenderWidth() * this._quality}, scene);//, false, true, Constants.TEXTURETYPE_FLOAT, false, Texture.BILINEAR_SAMPLINGMODE, false);
        scene.customRenderTargets.push(this._renderSpecularTarget);
     
        this._renderMetallicTarget = new RenderTargetTexture("metallicToTexture", {height: engine.getRenderHeight() * this._quality,  width: engine.getRenderWidth() * this._quality}, scene);//, false, true, Constants.TEXTURETYPE_FLOAT, false, Texture.BILINEAR_SAMPLINGMODE, false);
        scene.customRenderTargets.push(this._renderMetallicTarget);
        
        scene.meshes.forEach ((mesh) => {
            this._iterateOverTheSceneMeshes(mesh, scene, this._renderSpecularTarget, this._renderMetallicTarget);
        })   

        this._scene.onNewMeshAddedObservable.add( (newMesh) => {
            this._iterateOverTheSceneMeshes(newMesh, scene, this._renderSpecularTarget, this._renderMetallicTarget);
        })
        
        this._scene.onMeshRemovedObservable.add( (mesh) => {
            if(this._renderSpecularTarget.renderList) {
                const idxSpec = this._renderSpecularTarget.renderList.indexOf(mesh);
                if (idxSpec != -1){
                    this._renderSpecularTarget.renderList?.splice(idxSpec, 1);
                }
            }
            if(this._renderMetallicTarget.renderList){
                const idxMetal = this._renderMetallicTarget.renderList.indexOf(mesh);
                if (idxMetal != -1){
                    this._renderMetallicTarget.renderList?.splice(idxMetal, 1);
                }  
            }
        })

        // Set up assets
        this._forceGeometryBuffer = forceGeometryBuffer;
        this._forceGeometryBuffer = false; //forceGeometryBuffer;
        if (this._forceGeometryBuffer) {
            // Get geometry buffer renderer and update effect
            const geometryBufferRenderer = scene.enableGeometryBufferRenderer();
            if (geometryBufferRenderer) {
                if (geometryBufferRenderer.isSupported) {
                    geometryBufferRenderer.enablePosition = true;
                } 
            }
        }
        else { // doesn't work !
            const prePassRenderer = scene.enablePrePassRenderer();
            prePassRenderer?.markAsDirty();
        }

        // this._createRandomTexture();


        this._originalColorPostProcess = new PassPostProcess("SSR2OriginalSceneColor", this._ratio, scene.activeCamera, Texture.BILINEAR_SAMPLINGMODE, scene.getEngine(), true, textureType);
        this._originalColorPostProcess.samples = this.textureSamples;

        this._blurPostProcess = new BlurPostProcess("SSR2Blur", new Vector2(1.0, 1.0), 60.0, this._ratio, scene.activeCamera, Texture.BILINEAR_SAMPLINGMODE, scene.getEngine(), true);
        this._blurPostProcess.samples = this.textureSamples;
        // this._createBlurPostProcess(ssaoRatio, blurRatio, textureType);
        
        this._createSSR2PostProcess(this._ratio, textureType);
        
        // Set up pipeline
        this.addEffect(
            new PostProcessRenderEffect(
                scene.getEngine(),
                this.SSR2OriginalSceneColorEffect,
                () => {
                    return this._originalColorPostProcess;
                },
                true
                )
                );


                
        this.addEffect(
            new PostProcessRenderEffect(
                scene.getEngine(),
                this.SSR2BlurEffect,
                () => {
                    return this._blurPostProcess;
                },
                true
            )
        );

        // this._createBlurPostProcess(ratio, ratio, textureType);
        // this._createSSAOCombinePostProcess(blurRatio, textureType);


        // this.addEffect(
        //     new PostProcessRenderEffect(
        //         scene.getEngine(),
        //         this.SSR2BlurHRenderEffect,
        //         () => {
        //             return this._blurHPostProcess;
        //         },
        //         true
        //     )
        // );
        // this.addEffect(
        //     new PostProcessRenderEffect(
        //         scene.getEngine(),
        //         this.SSR2BlurVRenderEffect,
        //         () => {
        //             return this._blurVPostProcess;
        //         },
        //         true
        //     )
        // );

        this.addEffect(
            new PostProcessRenderEffect(
                scene.getEngine(),
                this.SSR2RenderEffect,
                () => {
                    return this._ssr2PostProcess;
                },
                true
            )
        );

        // Finish
        scene.postProcessRenderPipelineManager.addPipeline(this);
        if (cameras) {
            scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(name, cameras);
        }
        else if (scene.activeCamera) {
            scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(name, scene.activeCamera);
        }

    }

    // Public Methods

    /**
     * Get the class name
     * @returns "SSR22RenderingPipeline"
     */
    public getClassName(): string {
        return "SSR2RenderingPipeline";
    }

    /**
     * Removes the internal pipeline assets and detaches the pipeline from the scene cameras
     * @param disableGeometryBufferRenderer
     */
    public dispose(disableGeometryBufferRenderer: boolean = false): void {
        
        for (let i = 0; i < this._scene.cameras.length; i++) {
            const camera = this._scene.cameras[i];

            this._originalColorPostProcess.dispose(camera);
            this._ssr2PostProcess.dispose(camera);
            // this._blurHPostProcess.dispose(camera);
            // this._blurVPostProcess.dispose(camera);
            // this._ssaoCombinePostProcess.dispose(camera);
        }

        // this._randomTexture.dispose();

        if (disableGeometryBufferRenderer) {
            this._scene.disableGeometryBufferRenderer();
        }

        this._renderSpecularTarget.dispose();
        this._renderMetallicTarget.dispose();

        this._scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(this._name, this._scene.cameras);

        super.dispose();
    }

    // // Private Methods
    // private _createBlurPostProcess(ssaoRatio: number, blurRatio: number, textureType: number): void {
    //     this._samplerOffsets = [];
    //     const expensive = false;

    //     for (let i = -8; i < 8; i++) {
    //         this._samplerOffsets.push(i * 2 + 0.5);
    //     }

    //     this._blurHPostProcess = new PostProcess(
    //         "BlurH",
    //         "ssao2",
    //         ["outSize", "samplerOffsets", "near", "far", "radius"],
    //         ["depthSampler"],
    //         ssaoRatio,
    //         null,
    //         Texture.TRILINEAR_SAMPLINGMODE,
    //         this._scene.getEngine(),
    //         false,
    //         "#define BILATERAL_BLUR\n#define BILATERAL_BLUR_H\n#define SAMPLES 16\n#define EXPENSIVE " + (expensive ? "1" : "0") + "\n",
    //         textureType
    //     );
    //     this._blurHPostProcess.onApply = (effect: Effect) => {
    //         if (!this._scene.activeCamera) {
    //             return;
    //         }

    //         effect.setFloat("outSize", this._ssr2PostProcess.width > 0 ? this._ssr2PostProcess.width : this._originalColorPostProcess.width);
    //         effect.setFloat("near", this._scene.activeCamera.minZ);
    //         effect.setFloat("far", this._scene.activeCamera.maxZ);
    //         effect.setFloat("radius", this.radius);
    //         if (this._geometryBufferRenderer) {
    //             effect.setTexture("depthSampler", this._geometryBufferRenderer.getGBuffer().textures[0]);
    //         } else if (this._prePassRenderer) {
    //             effect.setTexture("depthSampler", this._prePassRenderer.getRenderTarget().textures[this._prePassRenderer.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE)]);
    //         }
    //         effect.setArray("samplerOffsets", this._samplerOffsets);
    //     };

    //     this._blurVPostProcess = new PostProcess(
    //         "BlurV",
    //         "ssao2",
    //         ["outSize", "samplerOffsets", "near", "far", "radius"],
    //         ["depthSampler"],
    //         blurRatio,
    //         null,
    //         Texture.TRILINEAR_SAMPLINGMODE,
    //         this._scene.getEngine(),
    //         false,
    //         "#define BILATERAL_BLUR\n#define BILATERAL_BLUR_V\n#define SAMPLES 16\n#define EXPENSIVE " + (expensive ? "1" : "0") + "\n",
    //         textureType
    //     );
    //     this._blurVPostProcess.onApply = (effect: Effect) => {
    //         if (!this._scene.activeCamera) {
    //             return;
    //         }

    //         effect.setFloat("outSize", this._ssr2PostProcess.height > 0 ? this._ssr2PostProcess.height : this._originalColorPostProcess.height);
    //         effect.setFloat("near", this._scene.activeCamera.minZ);
    //         effect.setFloat("far", this._scene.activeCamera.maxZ);
    //         effect.setFloat("radius", this.radius);
    //         if (this._geometryBufferRenderer) {
    //             effect.setTexture("depthSampler", this._geometryBufferRenderer.getGBuffer().textures[0]);
    //         } else if (this._prePassRenderer) {
    //             effect.setTexture("depthSampler", this._prePassRenderer.getRenderTarget().textures[this._prePassRenderer.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE)]);
    //         }
    //         effect.setArray("samplerOffsets", this._samplerOffsets);
    //     };

    //     this._blurHPostProcess.samples = this.textureSamples;
    //     this._blurVPostProcess.samples = this.textureSamples;
    // }

    /** @hidden */
    public _rebuild() {
        super._rebuild();
    }


    private _getDefinesForSSR2() {
        let defines = "";
        
        if (this._geometryBufferRenderer || this._prePassRenderer) {
            if (this._isSceneRightHanded) {
                if (this._backUpTexture){
                    defines = "#define RIGHT_HANDED_SCENE\n#define SSR_SUPPORTED\n#define SSR_PIPELINE\n#define BACKUP_TEXTURE";
                } else {
                    defines = "#define RIGHT_HANDED_SCENE\n#define SSR_SUPPORTED\n#define SSR_PIPELINE";
                }
            }
            else{
                if (this._backUpTexture){
                    defines = "#define SSR_SUPPORTED\n#define SSR_PIPELINE\n#define BACKUP_TEXTURE";
                } else {
                    defines = "#define SSR_SUPPORTED\n#define SSR_PIPELINE";
                }
            }
        }

        return defines;
    }

    // function cond(currBackUpTex : Nullable <CubeTexture>, oldBackUpTex : Nullable <CubeTexture>){
    //     if(currBackUpTex != oldBackUpTex){
    //         resolve();
    //     }
    // }

    // func

    // public _checkIsReady(checkRenderTargets = false) {
    //     this._registerTransientComponents();

    //     if (this.isReady(checkRenderTargets)) {
    //         this.onReadyObservable.notifyObservers(this);

    //         this.onReadyObservable.clear();
    //         this._executeWhenReadyTimeoutId = null;
    //         return;
    //     }

    // private _whenBackUpTexChange (currBackUpTex : Nullable <CubeTexture>, oldBackUpTex : Nullable <CubeTexture>, resolve : any) {
       
    //     if (currBackUpTex != oldBackUpTex) {
    //         this._oldBackUpTexture = this._backUpTexture;
    //         resolve();
    //         return;
    //     } 
    //     else {
    //         // (currBackUpTex, oldBackUpTex) => void = () => resolve(); 
    //         // function isReady(callback : ) {callback(resolve())};
    //         // this._whenDefinesMustChange();
    //         // () => resolve();
    //         this._checkIsReady() => resolve();
    //     }
    // }
  

    // private _whenDefinesMustChange (currBackUpTex : Nullable <CubeTexture>, oldBackUpTex : Nullable <CubeTexture>) {
    //     return new Promise((resolve : any, reject : any) => {
             
    //         this._whenBackUpTexChange(currBackUpTex, oldBackUpTex, () => resolve());
    //     })
    // }

    // ******************* test 2 *************

    // private _executeWhenReadyTimeoutId: Nullable<ReturnType<typeof setTimeout>> = null;
    
    // public onReadyBackUpTexObservable = new Observable<Nullable <CubeTexture>>();

    // private _isDisposed = false;


    // public _checkBackUpTexReady(oldBackUpTexture : Nullable <CubeTexture>, currBackUpTexture : Nullable <CubeTexture>) {
    //     // this._registerTransientComponents();

    //     if (this._oldBackUpTexture != this._backUpTexture) {
    //         this.onReadyBackUpTexObservable.notifyObservers(currBackUpTexture);
    //         this.onReadyBackUpTexObservable.clear();
    //         this._oldBackUpTexture = this._backUpTexture;
    //         this._executeWhenReadyTimeoutId = null;
    //         return;
    //     }

    //     if (this._isDisposed) {
    //         this.onReadyBackUpTexObservable.clear();
    //         this._executeWhenReadyTimeoutId = null;
    //         return;
    //     }

    //     this._executeWhenReadyTimeoutId = setTimeout(() => {
    //         this._checkBackUpTexReady(this._oldBackUpTexture, this._backUpTexture);
    //     }, 3000);
    // }

    // public executeWhenBackUpTexReady(func: () => void, oldBackUpTexture : Nullable <CubeTexture>, currBackUpTexture :Nullable <CubeTexture>): void {
    //     this.onReadyBackUpTexObservable.add(func);

    //     if (this._executeWhenReadyTimeoutId !== null) {
    //         return;
    //     }

    //     this._executeWhenReadyTimeoutId = setTimeout(() => {
    //         this._checkBackUpTexReady(oldBackUpTexture, currBackUpTexture);
    //     }, 3000);
    // }

    // public whenReadyBackUpTexAsync(oldBackUpTexture : Nullable <CubeTexture>, currBackUpTexture : Nullable <CubeTexture>): Promise<void> {
    //     return new Promise((resolve) => {
    //         this.executeWhenBackUpTexReady(() => {
    //             resolve();
    //         }, oldBackUpTexture, currBackUpTexture);
    //     });
    // }

    private _createSSR2PostProcess(ratio: number, textureType: number): void {

        // this._ssrDefines = this._getDefinesForSSR2();
        const defines = this._getDefinesForSSR2();

        // this._whenDefinesMustChange(this.backUpTexture, this._oldBackUpTexture).then(() => {
        //     this._ssrDefines =  this._getDefinesForSSR2();
        // })
        // this.executeWhenBackUpTexReady(() => {
        //     this._ssrDefines = this._getDefinesForSSR2();
        // }, this._oldBackUpTexture, this._backUpTexture );
;
        this._ssr2PostProcess = new PostProcess(
            "ssr2",
            "screenSpaceReflection2",
            ["projection", "view", "maxDistance", "resolution", "steps", "thickness", "minZ", "maxZ"], 
            ["normalSampler", "depthSampler", "positionSampler", "specularMap", "metallicMap", "originalColor", "blurColor", "backUpSampler" ], 
            ratio,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            this._scene.getEngine(),
            false,
            defines, //this._ssrDefines,
            textureType
        );

    // ***************************************************************


        // add callback to get the new defines value when this._backUpTexture is activated
        // const onStatusObservable = Observable.FromPromise(axios("/ping").then((response : any) => response.statusText));

        // onStatusObservable.add((statusText : any) => {
        //     text1.text = "Server status: " + statusText;
        // });

        // var alpha = 0;
        // scene.onBeforeRenderObservable.add(function () {
        //     sphere.scaling.y = Math.cos(alpha);

        //     alpha += 0.01;
        // });


    // ***************************************************************

        this._ssr2PostProcess.onApply = (effect: Effect) => {
            // On apply, send uniforms
            if (!this._prePassRenderer && !this._geometryBufferRenderer) {
                return;
            }
            if (!this._scene.activeCamera) {
                return;
            }
            const camera = this._scene.activeCamera;
           
            if (this._geometryBufferRenderer) {
                // Samplers
                const positionIndex = this._geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.POSITION_TEXTURE_TYPE);

                effect.setTexture("normalSampler", this._geometryBufferRenderer!.getGBuffer().textures[1]);
                effect.setTexture("positionSampler", this._geometryBufferRenderer!.getGBuffer().textures[positionIndex]);
                effect.setTexture("depthSampler", this._geometryBufferRenderer!.getGBuffer().textures[0]);

            }
            else if (this._prePassRenderer) { // doesn't work !
                // Samplers
                const normalIndex = this._prePassRenderer.getIndex(Constants.PREPASS_NORMAL_TEXTURE_TYPE);
                const positionIndex = this._prePassRenderer.getIndex(Constants.PREPASS_POSITION_TEXTURE_TYPE);
                const depthIndex = this._prePassRenderer.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE);

                effect.setTexture("normalSampler", this._prePassRenderer.getRenderTarget().textures[normalIndex]);
                effect.setTexture("positionSampler", this._prePassRenderer.getRenderTarget().textures[positionIndex]);
                effect.setTexture("depthSampler", this._prePassRenderer.getRenderTarget().textures[depthIndex]);
            }    

            if (this._backUpTexture){
                effect.setTexture("backUpSampler", this._backUpTexture);
            }

            effect.setTextureFromPostProcessOutput("originalColor", this._originalColorPostProcess);
            effect.setTextureFromPostProcessOutput("blurColor", this._blurPostProcess);

            effect.setTexture("metallicMap", this._renderMetallicTarget); 
            effect.setTexture("specularMap", this._renderSpecularTarget); 

            const viewMatrix = camera.getViewMatrix(true);
            const projectionMatrix = camera.getProjectionMatrix(true);

            // const depthRenderer = this._scene.enableDepthRenderer();
            // effect.setTexture("depthSampler", depthRenderer.getDepthMap());

            effect.setMatrix("projection", projectionMatrix);
            effect.setMatrix("view", viewMatrix);

            effect.setFloat("maxDistance", this.maxDistance);
            effect.setFloat("resolution", this.resolution);
            effect.setInt("steps", this.steps);
            effect.setFloat("thickness", this.thickness);

            effect.setFloat("minZ", camera.minZ);
            effect.setFloat("maxZ", camera.maxZ);
        };

        // this._ssr2PostProcess.autoClear = true;
        // this._ssaoPostProcess.samples = this.textureSamples;
        if (!this._forceGeometryBuffer) {
            this._ssr2PostProcess._prePassEffectConfiguration = new ScreenSpaceReflections2Configuration();
        }


    }

    private _whenAllReady (mesh : AbstractMesh, resolve : any) {
       
        if (mesh.isReady()) {
            resolve();
            return;
        } else {
            mesh.onReady = () => resolve(); 
        }
    }
  

    private _whenAbsMeshReady (mesh : AbstractMesh) {
        return new Promise((resolve : any, reject : any) => {
             
            this._whenAllReady(mesh, () => resolve());
            // we need to do something here to make sure the texture are loaded before calling resolve
        })
    }

     // recursive iteration over meshes
    private _iterateOverTheSceneMeshes(mesh : AbstractMesh, scene : Scene,
                                        renderSpecularTarget : RenderTargetTexture,
                                        renderMetallicTarget : RenderTargetTexture) {

        this._whenAbsMeshReady(mesh).then(() => {
            this._computeSpecularMap(mesh, scene, renderSpecularTarget);
            this._computeMetallicMap(mesh, scene, renderMetallicTarget);
            
            mesh.onMaterialChangedObservable.add(() => {
                const idxSpec = renderSpecularTarget.renderList?.indexOf(mesh);
                if (idxSpec && idxSpec != -1){
                    renderSpecularTarget.renderList?.splice(idxSpec, 1);
                }
                const idxMetal = renderMetallicTarget.renderList?.indexOf(mesh);
                if (idxMetal && idxMetal != -1){
                    renderMetallicTarget.renderList?.splice(idxMetal, 1);
                }
                this._whenAbsMeshReady(mesh).then(() => {
                    this._computeSpecularMap(mesh, scene, renderSpecularTarget);
                    this._computeMetallicMap(mesh, scene, renderMetallicTarget);
                })
            })
            
            if (mesh.getChildMeshes()) {
                const subM = mesh.getChildMeshes();
                for (let i = 0; i < subM.length; i++) {
                    const m = subM[i];
                    this._iterateOverTheSceneMeshes(m, scene, renderSpecularTarget, renderMetallicTarget);
                    return;
                }
            } else {
                return;
            }
        })    


    }

    private _computeSpecularMap(m: AbstractMesh, scene: Scene, renderSpecularTarget : RenderTargetTexture) {

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
                uniforms: ["world", "worldView", "worldViewProjection", "view", "projection",
                            "specTexvScale", "specTexuScale", "specTexvOffset", "specTexuOffset",
                            "albedoTexvScale", "albedoTexuScale", "albedoTexvOffset", "albedoTexuOffset",
                            "ORMTexture", "metallic", "roughness", "albedoTexture", "albedoColor", 
                            "specularGlossinessTexture", "glossiness", "reflectivityTexture", "reflectivityColor"],
                defines : defines, // will be fill in according to given material data
            },
        );

        if (m.material) { // there is a material

            // for PBR materials: cf. https://doc.babylonjs.com/divingDeeper/materials/using/masterPBR
            if (m.material instanceof PBRMetallicRoughnessMaterial) {
                // if it is a PBR material in MetallicRoughness Mode:
                if (m.material.metallicRoughnessTexture != null) {
                    specularMapShader.setTexture("ORMTexture", m.material.metallicRoughnessTexture);
                    defines.push("#define ORMTEXTURE");
                    specularMapShader.setFloat("specTexvScale", (m.material.metallicRoughnessTexture as Texture).vScale);
                    specularMapShader.setFloat("specTexuScale", (m.material.metallicRoughnessTexture as Texture).uScale);
                    specularMapShader.setFloat("specTexvOffset", (m.material.metallicRoughnessTexture as Texture).vOffset);
                    specularMapShader.setFloat("specTexuOffset", (m.material.metallicRoughnessTexture as Texture).uOffset);
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
                    specularMapShader.setFloat("albedoTexvScale", (m.material.baseTexture as Texture).vScale);
                    specularMapShader.setFloat("albedoTexuScale", (m.material.baseTexture as Texture).uScale);
                    specularMapShader.setFloat("albedoTexvOffset", (m.material.baseTexture as Texture).vOffset);
                    specularMapShader.setFloat("albedoTexuOffset", (m.material.baseTexture as Texture).uOffset);
                } else if (m.material.baseColor != null) {
                    specularMapShader.setColor3("albedoColor", m.material.baseColor);
                    defines.push("#define ALBEDOCOLOR");
                }

            }
            else if (m.material instanceof PBRSpecularGlossinessMaterial) {
                // if it is a PBR material in Specular/Glossiness Mode:
                if (m.material.specularGlossinessTexture != null) {
                    specularMapShader.setTexture("specularGlossinessTexture", m.material.specularGlossinessTexture);
                    defines.push("#define SPECULARGLOSSINESSTEXTURE");
                    specularMapShader.setFloat("specTexvScale", (m.material.specularGlossinessTexture as Texture).vScale);
                    specularMapShader.setFloat("specTexuScale", (m.material.specularGlossinessTexture as Texture).uScale);
                    specularMapShader.setFloat("specTexvOffset", (m.material.specularGlossinessTexture as Texture).vOffset);
                    specularMapShader.setFloat("specTexuOffset", (m.material.specularGlossinessTexture as Texture).uOffset);
                } else {
                    if (m.material.specularColor != null) {
                        specularMapShader.setColor3("reflectivityColor", m.material.specularColor);
                        defines.push("#define REFLECTIVITYCOLOR");
                     }
                    }
                if (m.material.glossiness != null) {
                    specularMapShader.setFloat("glossiness", m.material.glossiness);
                    defines.push("#define GLOSSINESSS");
                }
            }
            else if (m.material instanceof PBRMaterial) {
                // if it is the bigger PBRMaterial
                if (m.material.metallicTexture != null) {
                    specularMapShader.setTexture("ORMTexture", m.material.metallicTexture);
                    defines.push("#define ORMTEXTURE");
                    specularMapShader.setFloat("specTexvScale", (m.material.metallicTexture as Texture).vScale);
                    specularMapShader.setFloat("specTexuScale", (m.material.metallicTexture as Texture).uScale);
                    specularMapShader.setFloat("specTexvOffset", (m.material.metallicTexture as Texture).vOffset);
                    specularMapShader.setFloat("specTexuOffset", (m.material.metallicTexture as Texture).uOffset);
                }
                if (m.material.metallic != null) {
                    specularMapShader.setFloat("metallic", m.material.metallic);
                    defines.push("#define METALLIC");
                }

                if (m.material.roughness != null) {
                    specularMapShader.setFloat("roughness", m.material.roughness);
                    defines.push("#define ROUGHNESS");
                }

                if (m.material.roughness != null || m.material.metallic != null || m.material.metallicTexture != null){ // MetallicRoughness Model
                    if (m.material.albedoTexture != null) {
                        specularMapShader.setTexture("albedoTexture", m.material.albedoTexture);
                        defines.push("#define ALBEDOTEXTURE");
                        specularMapShader.setFloat("albedoTexvScale", (m.material.albedoTexture as Texture).vScale);
                        specularMapShader.setFloat("albedoTexuScale", (m.material.albedoTexture as Texture).uScale);
                        specularMapShader.setFloat("albedoTexvOffset", (m.material.albedoTexture as Texture).vOffset);
                        specularMapShader.setFloat("albedoTexuOffset", (m.material.albedoTexture as Texture).uOffset);
                    } else if (m.material.albedoColor != null) {
                        specularMapShader.setColor3("albedoColor", m.material.albedoColor);
                        defines.push("#define ALBEDOCOLOR");
                    }

                } else { // SpecularGlossiness Model
                    if (m.material.reflectivityTexture != null) {
                        specularMapShader.setTexture("specularGlossinessTexture", m.material.reflectivityTexture);
                        defines.push("#define SPECULARGLOSSINESSTEXTURE");
                        specularMapShader.setFloat("specTexvScale", (m.material.reflectivityTexture as Texture).vScale);
                        specularMapShader.setFloat("specTexuScale", (m.material.reflectivityTexture as Texture).uScale);
                        specularMapShader.setFloat("specTexvOffset", (m.material.reflectivityTexture as Texture).vOffset);
                        specularMapShader.setFloat("specTexuOffset", (m.material.reflectivityTexture as Texture).uOffset);
                    } else if (m.material.reflectivityColor != null) {
                        specularMapShader.setColor3("reflectivityColor", m.material.reflectivityColor);
                        defines.push("#define REFLECTIVITYCOLOR");
                    }
                    if (m.material.microSurface != null) {
                        specularMapShader.setFloat("glossiness", m.material.microSurface);
                        defines.push("#define GLOSSINESSS");
                    }
                }    
            }
            else if (m.material instanceof StandardMaterial) {
                // if StandardMaterial:
                // if specularTexture not null : use it to compute reflectivity
                if (m.material.specularTexture != null) {
                    specularMapShader.setTexture("reflectivityTexture", m.material.specularTexture);
                    defines.push("#define REFLECTIVITYTEXTURE");
                    specularMapShader.setFloat("specTexvScale", (m.material.specularTexture as Texture).vScale);
                    specularMapShader.setFloat("specTexuScale", (m.material.specularTexture as Texture).uScale);
                    specularMapShader.setFloat("specTexvOffset", (m.material.specularTexture as Texture).vOffset);
                    specularMapShader.setFloat("specTexuOffset", (m.material.specularTexture as Texture).uOffset);
                }
                if (m.material.specularColor != null) {
                    specularMapShader.setColor3("reflectivityColor", m.material.specularColor);
                    defines.push("#define REFLECTIVITYCOLOR");
                }

                // else :
                    // not possible ?
            }
        }
        renderSpecularTarget.setMaterialForRendering(m, specularMapShader);
        renderSpecularTarget.renderList?.push(m);
    }
    
    private _computeMetallicMap(m: AbstractMesh, scene: Scene, renderMetallicTarget : RenderTargetTexture) {

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
                uniforms: ["world", "worldView", "worldViewProjection", "view", "projection",
                           "metallicTexvScale", "metallicTexuScale", "metallicTexvOffset", "metallicTexuOffset",
                           "metallic", "ORMTexture", "indexOfRefraction"],
                defines : defines, // will be fill in according to given material data
            },
        );

        if (m.material) { // there is a material

            // for PBR materials: cf. https://doc.babylonjs.com/divingDeeper/materials/using/masterPBR
            if (m.material instanceof PBRMetallicRoughnessMaterial) {
                // if it is a PBR material in MetallicRoughness Mode:
                if (m.material.metallicRoughnessTexture != null) {
                    metallicMapShader.setTexture("ORMTexture", m.material.metallicRoughnessTexture);
                    defines.push("#define ORMTEXTURE");
                    metallicMapShader.setFloat("metallicTexvScale", (m.material.metallicRoughnessTexture as Texture).vScale);
                    metallicMapShader.setFloat("metallicTexuScale", (m.material.metallicRoughnessTexture as Texture).uScale);
                    metallicMapShader.setFloat("metallicTexvOffset", (m.material.metallicRoughnessTexture as Texture).vOffset);
                    metallicMapShader.setFloat("metallicTexuOffset", (m.material.metallicRoughnessTexture as Texture).uOffset);
                }
                if (m.material.metallic != null) {
                    metallicMapShader.setFloat("metallic", m.material.metallic);
                    defines.push("#define METALLIC");
                }
            }
            else if (m.material instanceof PBRMaterial) {
                // if it is the bigger PBRMaterial
                if (m.material.metallicTexture != null) {
                    metallicMapShader.setTexture("ORMTexture", m.material.metallicTexture);
                    defines.push("#define ORMTEXTURE");
                    metallicMapShader.setFloat("metallicTexvScale", (m.material.metallicTexture as Texture).vScale);
                    metallicMapShader.setFloat("metallicTexuScale", (m.material.metallicTexture as Texture).uScale);
                    metallicMapShader.setFloat("metallicTexvOffset", (m.material.metallicTexture as Texture).vOffset);
                    metallicMapShader.setFloat("metallicTexuOffset", (m.material.metallicTexture as Texture).uOffset);
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
            // if there is no metallic component, nothing is binded and we return a totally black texture
    
            renderMetallicTarget.setMaterialForRendering(m, metallicMapShader);
            renderMetallicTarget.renderList?.push(m);
        }
    }

    // private _createSSAOCombinePostProcess(ratio: number, textureType: number): void {
    //     this._ssaoCombinePostProcess = new PostProcess(
    //         "ssaoCombine",
    //         "ssaoCombine",
    //         [],
    //         ["originalColor", "viewport"],
    //         ratio,
    //         null,
    //         Texture.BILINEAR_SAMPLINGMODE,
    //         this._scene.getEngine(),
    //         false,
    //         undefined,
    //         textureType
    //     );

    //     this._ssaoCombinePostProcess.onApply = (effect: Effect) => {
    //         const viewport = this._scene.activeCamera!.viewport;
    //         effect.setVector4("viewport", TmpVectors.Vector4[0].copyFromFloats(viewport.x, viewport.y, viewport.width, viewport.height));
    //         effect.setTextureFromPostProcessOutput("originalColor", this._originalColorPostProcess);
    //     };
    //     this._ssaoCombinePostProcess.samples = this.textureSamples;

    //     if (!this._forceGeometryBuffer) {
    //         this._ssaoCombinePostProcess._prePassEffectConfiguration = new SSAO2Configuration();
    //     }
    // }

    // private _createRandomTexture(): void {
    //     const size = 128;

    //     this._randomTexture = new DynamicTexture("SSAORandomTexture", size, this._scene, false, Texture.TRILINEAR_SAMPLINGMODE);
    //     this._randomTexture.wrapU = Texture.WRAP_ADDRESSMODE;
    //     this._randomTexture.wrapV = Texture.WRAP_ADDRESSMODE;

    //     const context = this._randomTexture.getContext();

    //     const rand = (min: number, max: number) => {
    //         return Math.random() * (max - min) + min;
    //     };

    //     const randVector = Vector3.Zero();

    //     for (let x = 0; x < size; x++) {
    //         for (let y = 0; y < size; y++) {
    //             randVector.x = rand(0.0, 1.0);
    //             randVector.y = rand(0.0, 1.0);
    //             randVector.z = 0.0;

    //             randVector.normalize();

    //             randVector.scaleInPlace(255);
    //             randVector.x = Math.floor(randVector.x);
    //             randVector.y = Math.floor(randVector.y);

    //             context.fillStyle = "rgb(" + randVector.x + ", " + randVector.y + ", " + randVector.z + ")";
    //             context.fillRect(x, y, 1, 1);
    //         }
    //     }

    //     this._randomTexture.update(false);
    // }

    /**
     * Serialize the rendering pipeline (Used when exporting)
     * @returns the serialized object
     */
    public serialize(): any {
        const serializationObject = SerializationHelper.Serialize(this);
        serializationObject.customType = "SSR2RenderingPipeline";

        return serializationObject;
    }

    /**
     * Parse the serialized pipeline
     * @param source Source pipeline.
     * @param scene The scene to load the pipeline to.
     * @param rootUrl The URL of the serialized pipeline.
     * @returns An instantiated pipeline from the serialized object.
     */
    public static Parse(source: any, scene: Scene, rootUrl: string): SSR2RenderingPipeline {
        return SerializationHelper.Parse(() => new SSR2RenderingPipeline(source._name, scene, source._ratio), source, scene, rootUrl);
    }
}

RegisterClass("BABYLON.SSR2RenderingPipeline", SSR2RenderingPipeline);
