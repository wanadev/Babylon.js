/* eslint-disable @typescript-eslint/naming-convention */
import { serialize, SerializationHelper } from "../../../Misc/decorators";
import { Vector2 } from "../../../Maths/math.vector";
import { Camera } from "../../../Cameras/camera";
import type { Effect } from "../../../Materials/effect";
import { Texture } from "../../../Materials/Textures/texture";
import { PostProcess } from "../../../PostProcesses/postProcess";
import { BlurPostProcess } from "../../../PostProcesses/blurPostProcess";
import { PostProcessRenderPipeline } from "../../../PostProcesses/RenderPipeline/postProcessRenderPipeline";
import { PostProcessRenderEffect } from "../../../PostProcesses/RenderPipeline/postProcessRenderEffect";
import { PassPostProcess } from "../../../PostProcesses/passPostProcess";
import type { Scene } from "../../../scene";
import { RegisterClass } from "../../../Misc/typeStore";
import { ScreenSpaceReflectionsConfiguration } from "../../../Rendering/screenSpaceReflectionsConfiguration";
import type { PrePassEffectConfiguration } from "../../../Rendering/prePassEffectConfiguration";
import { PrePassRenderer } from "../../../Rendering/prePassRenderer";
import { GeometryBufferRenderer } from "../../../Rendering/geometryBufferRenderer";
import { Constants } from "../../../Engines/constants";
import type { Nullable } from "../../../types";
import { CubeTexture } from "../../../Materials/Textures/cubeTexture";

import "../../../PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";

import "../../../Shaders/ssr.fragment";

/**
 * Render pipeline to produce ssao effect
 */
export class SSRRenderingPipeline extends PostProcessRenderPipeline {
    // Members

    /**
     * @ignore
     * The PassPostProcess id in the pipeline that contains the original scene color
     */
    public SSROriginalSceneColorEffect: string = "SSROriginalSceneColorEffect";
    /**
     * @ignore
     * The SSR reflections PostProcess id in the pipeline
     */
    public SSRReflectionsRenderEffect: string = "SSRReflectionsRenderEffect";
    /**
     * @ignore
     * The horizontal blur PostProcess id in the pipeline
     */
    public SSRBlurHRenderEffect: string = "SSRBlurHRenderEffect";
    /**
     * @ignore
     * The vertical blur PostProcess id in the pipeline
     */
    public SSRBlurVRenderEffect: string = "SSRBlurVRenderEffect";
    /**
     * @ignore
     * The PostProcess id in the pipeline that combines the SSR-Blur output with the original scene color (SSROriginalSceneColorEffect)
     */
    public SSRCombineRenderEffect: string = "SSRCombineRenderEffect";

    @serialize("samples")
    private _samples: number = 8;
    /**
     * Number of samples used for the SSAO calculations. Default value is 8
     */
    public set samples(n: number) {
        this._samples = n;
        this._ssrReflectionsPostProcess.updateEffect(this._getDefinesForSSR());
    }
    public get samples(): number {
        return this._samples;
    }

    @serialize("textureSamples")
    private _textureSamples: number = 1;
    /**
     * Number of samples to use for antialiasing
     */
    public set textureSamples(n: number) {
        this._textureSamples = n;

        if (this._prePassRenderer) {
            this._prePassRenderer.samples = n;
        } else {
            this._originalColorPostProcess.samples = n;
        }
    }
    public get textureSamples(): number {
        return this._textureSamples;
    }

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
   
    /**
     * Gets or sets the maxDistance used to define how far we look for reflection during the ray-marching on the reflected ray
     */
    @serialize()
    public maxDistance: number = 10.0;

    /**
     * Gets or sets the resolution used for the first pass of the 2D ray marching algorithm.
     * Controls how many fragments are skipped while marching the reflected ray. Typically in interval [0.1, 1.0].
     * If resolution equals 0.0, every fragments are skiped and this results in no reflection at all.
     */
    @serialize()
    public resolution: number = 0.5;

    /**
     * Gets or sets the number of steps allowed for the second pass of the algorithm. More the steps is high, more the reflections will be precise.
     */
    @serialize()
    public steps: number = 15;

    /**
     * Gets or sets the thickness value used as tolerance when computing the intersection between the reflected ray and the scene.
     */
    @serialize()
    public thickness: number = 0.2;

    /**
     * Gets or sets the current reflection strength. 1.0 is an ideal value but can be increased/decreased for particular results.
     */
    @serialize()
    public strength: number = 1.0;

    /**
     * Gets or sets the falloff exponent used while computing fresnel. More the exponent is high, more the reflections will be discrete. Default value is 1.0.
     */
    @serialize()
    public reflectionSpecularFalloffExponent: number = 1.0;

    /**
     * Gets or sets the factor applied when computing roughness. Default value is 1.0.
     */
    @serialize()
    public roughnessFactor: number = 1.0;

    /**
     * Gets or sets the distance at whitch the SSR algorithme no longer applies.
     */
    @serialize()
    public distanceFade: number = 1000.0;

    /**
     * Gets or sets the boolean deciding if we display only backUp reflections and no SSR reflection (true), or a mix of both (false).
     */
    @serialize()
    public backupOnlyWhenTooSpecular: boolean = false;

    @serialize()
    private _backUpTextureSkybox: Nullable<CubeTexture> = null;

    /**
     * Gets the Skybox cubeTexture used to define the reflection when the reflected rays of SSR leave the view space or when the maxDistance is reached.
     */
    get backUpTextureSkybox(): Nullable<CubeTexture> {
        return this._backUpTextureSkybox;
    }

    /**
     * Sets the Skybox cubeTexture to define the reflection when the reflected rays of SSR leave the view space or when the maxDistance is reached.
     */
    set backUpTextureSkybox(backUpTex: Nullable<CubeTexture>) {
        this._backUpTextureSkybox = backUpTex;
        this._ssrReflectionsPostProcess.updateEffect(this._getDefinesForSSR());
    }

    @serialize()
    private _backUpTextureProbe: Nullable<CubeTexture> = null;

    /**
     * Gets the Probe cubeTexture used to define the reflection when the reflected rays of SSR leave the view space or when the maxDistance is reached.
     */
    public get backUpTextureProbe(): Nullable<CubeTexture> {
        return this._backUpTextureProbe;
    }

    /**
     * Sets a Probe cubeTexture to define the reflection when the reflected rays of SSR leave the view space or when the maxDistance is reached.
     */
    public set backUpTextureProbe(backUpTex: Nullable<CubeTexture>) {
        this._backUpTextureProbe = backUpTex;
        this._ssrReflectionsPostProcess.updateEffect(this._getDefinesForSSR());
    }
    
    private _isSceneRightHanded: boolean;
    
    private _scene: Scene;
    private _originalColorPostProcess: PassPostProcess;
    private _ssrReflectionsPostProcess: PostProcess;
    private _ssrBlurHPostProcess: PostProcess;
    private _ssrBlurVPostProcess: PostProcess;
    private _ssrCombinePostProcess: PostProcess;

    private _config: PrePassEffectConfiguration = new ScreenSpaceReflectionsConfiguration();

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
    constructor(name: string, scene: Scene, ratio: any, cameras?: Camera[], forceGeometryBuffer = false, textureType = Constants.TEXTURETYPE_UNSIGNED_INT) {
        super(scene.getEngine(), name);

        this._scene = scene;
        this._forceGeometryBuffer = forceGeometryBuffer;

        const ssrRatio = ratio;
        const blurRatio = ratio;

        this._isSceneRightHanded = this._scene.useRightHandedSystem;

        // Set up assets
        if (this._forceGeometryBuffer) {
            const geometryBufferRenderer = this._scene.enableGeometryBufferRenderer();
            if (geometryBufferRenderer) {
                if (geometryBufferRenderer.isSupported) {
                    geometryBufferRenderer.enablePosition = true;
                    geometryBufferRenderer.enableReflectivity = true;
                }
            }
        } else {
            scene.enablePrePassRenderer();
        }

        this._originalColorPostProcess = new PassPostProcess("SSROriginalSceneColor", 1.0, null, Texture.BILINEAR_SAMPLINGMODE, scene.getEngine(), undefined, textureType);
        this._originalColorPostProcess.samples = this.textureSamples;
        this._createSSRReflectionsPostProcess(1.0, textureType);
        this._createSSRBlurPostProcess(ssrRatio, blurRatio, textureType);
        this._createSSRCombinePostProcess(blurRatio, textureType);

        // Set up pipeline
        this.addEffect(
            new PostProcessRenderEffect(
                scene.getEngine(),
                this.SSROriginalSceneColorEffect,
                () => {
                    return this._originalColorPostProcess;
                },
                true
            )
        );
        this.addEffect(
            new PostProcessRenderEffect(
                scene.getEngine(),
                this.SSRReflectionsRenderEffect,
                () => {
                    return this._ssrReflectionsPostProcess;
                },
                true
            )
        );
        // this.addEffect(
        //     new PostProcessRenderEffect(
        //         scene.getEngine(),
        //         this.SSRBlurHRenderEffect,
        //         () => {
        //             return this._ssrBlurHPostProcess;
        //         },
        //         true
        //     )
        // );
        // this.addEffect(
        //     new PostProcessRenderEffect(
        //         scene.getEngine(),
        //         this.SSRBlurVRenderEffect,
        //         () => {
        //             return this._ssrBlurVPostProcess;
        //         },
        //         true
        //     )
        // );
        this.addEffect(
            new PostProcessRenderEffect(
                scene.getEngine(),
                this.SSRBlurHRenderEffect,
                () => {
                    return new BlurPostProcess("Horizontal blur", new Vector2(1.0, 0), 256, 0.5, this._scene.activeCamera,  Texture.BILINEAR_SAMPLINGMODE, this._ssrReflectionsPostProcess.getEngine(), true);
                },
                true
            )
        );
        this.addEffect(
            new PostProcessRenderEffect(
                scene.getEngine(),
                this.SSRBlurVRenderEffect,
                () => {
                    return new BlurPostProcess("Vertical blur", new Vector2(0.0, 1.0), 256, 0.5, this._scene.activeCamera,  Texture.BILINEAR_SAMPLINGMODE, this._ssrReflectionsPostProcess.getEngine(), true);
                },
                true
            )
        );
        this.addEffect(
            new PostProcessRenderEffect(
                scene.getEngine(),
                this.SSRCombineRenderEffect,
                () => {
                    return this._ssrCombinePostProcess;
                },
                true
            )
        );

        // Finish
        scene.postProcessRenderPipelineManager.addPipeline(this);
        if (cameras) {
            scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(name, cameras);
        }
    }

    // Public Methods

    /**
     * Get the class name
     * @returns "SSRRenderingPipeline"
     */
    public getClassName(): string {
        return "SSRRenderingPipeline";
    }

    /**
     * Removes the internal pipeline assets and detaches the pipeline from the scene cameras
     * @param disableGeometryBufferRenderer
     */
    public dispose(disableGeometryBufferRenderer: boolean = false): void {
        for (let i = 0; i < this._scene.cameras.length; i++) {
            const camera = this._scene.cameras[i];

            this._originalColorPostProcess.dispose(camera);
            this._ssrReflectionsPostProcess.dispose(camera);
            this._ssrBlurHPostProcess.dispose(camera);
            this._ssrBlurVPostProcess.dispose(camera);
            this._ssrCombinePostProcess.dispose(camera);
        }

        if (disableGeometryBufferRenderer) {
            this._scene.disableGeometryBufferRenderer();
        }

        this._scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(this._name, this._scene.cameras);

        super.dispose();
    }

    private _getDefinesForSSR() {
        const defines: string[] = [];
        if (this._geometryBufferRenderer || this._prePassRenderer) {
            defines.push("#define SSR_SUPPORTED");
            defines.push("#define SSR_PASS");
        }
        if (this._isSceneRightHanded) {
            defines.push("#define RIGHT_HANDED_SCENE");
        }

        if (this._backUpTextureSkybox) {
            defines.push("#define BACKUP_TEXTURE_SKYBOX");
        }

        if (this._backUpTextureProbe) {
            defines.push("#define BACKUP_TEXTURE_PROBE");
        }

        return defines.join("\n");
    }

    private _createSSRReflectionsPostProcess(ratio: number, textureType: number): void {

        const defines = this._getDefinesForSSR();

        const uniforms = ["projection", "view", "maxDistance", "resolution", "steps", "thickness", "roughnessFactor", 
                          "distanceFade", "minZ", "maxZ", "cameraPos", "backupOnlyWhenTooSpecular"];
        const samplers = ["textureSampler", "normalSampler", "depthSampler", "positionSampler", 
                          "specularSampler", "cameraPos", "backUpSampler"];

        this._ssrReflectionsPostProcess = new PostProcess(
            "ssrReflections",
            "ssr",
            uniforms,
            samplers,
            ratio,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            this._scene.getEngine(),
            false,
            defines,
            textureType,
            undefined,
            null,
            this._forceGeometryBuffer
        );
        
        this._ssrReflectionsPostProcess.updateEffect(this._getDefinesForSSR());
    
        if (!this._forceGeometryBuffer) {
            this._ssrReflectionsPostProcess._prePassEffectConfiguration = this._config;
        }
        // On apply, send uniforms
        this._ssrReflectionsPostProcess.onApply = (effect: Effect) => {
            if (!this._prePassRenderer && !this._geometryBufferRenderer) {
                return;
            }

            if (this._geometryBufferRenderer) {
                // Samplers
                const positionIndex = this._geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.POSITION_TEXTURE_TYPE);
                const reflectivityIndex = this._geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.REFLECTIVITY_TEXTURE_TYPE);
                effect.setTexture("normalSampler", this._geometryBufferRenderer!.getGBuffer().textures[1]);
                effect.setTexture("positionSampler", this._geometryBufferRenderer!.getGBuffer().textures[positionIndex]);
                effect.setTexture("depthSampler", this._geometryBufferRenderer!.getGBuffer().textures[0]);
                effect.setTexture("specularSampler", this._geometryBufferRenderer!.getGBuffer().textures[reflectivityIndex]);
            } else if (this._prePassRenderer) {
                // Samplers
                const normalIndex = this._prePassRenderer.getIndex(Constants.PREPASS_NORMAL_TEXTURE_TYPE);
                const positionIndex = this._prePassRenderer.getIndex(Constants.PREPASS_POSITION_TEXTURE_TYPE);
                const depthIndex = this._prePassRenderer.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE);
                const reflectivityIndex = this._prePassRenderer.getIndex(Constants.PREPASS_REFLECTIVITY_TEXTURE_TYPE);
                effect.setTexture("normalSampler", this._prePassRenderer.getRenderTarget().textures[normalIndex]);
                effect.setTexture("positionSampler", this._prePassRenderer.getRenderTarget().textures[positionIndex]);
                effect.setTexture("depthSampler", this._prePassRenderer.getRenderTarget().textures[depthIndex]);
                effect.setTexture("specularSampler", this._prePassRenderer.getRenderTarget().textures[reflectivityIndex]);
            }
            if (this._backUpTextureSkybox) {
                effect.setTexture("backUpSampler", this._backUpTextureSkybox);
            } else if (this._backUpTextureProbe) {
                effect.setTexture("backUpSampler", this._backUpTextureProbe);
            }

            if (this._scene.activeCamera){
                effect.setMatrix("view", this._scene.activeCamera.getViewMatrix(true));
                effect.setMatrix("projection", this._scene.activeCamera.getProjectionMatrix(true));
                effect.setFloat("minZ", this._scene.activeCamera.minZ);
                effect.setFloat("maxZ", this._scene.activeCamera.maxZ);
                effect.setVector3("cameraPos", this._scene.activeCamera.position)
            } else {
                effect.setMatrix("view", this._scene.cameras[0].getViewMatrix(true));
                effect.setMatrix("projection", this._scene.cameras[0].getProjectionMatrix(true));
                effect.setFloat("minZ", this._scene.cameras[0].minZ);
                effect.setFloat("maxZ", this._scene.cameras[0].maxZ);
                effect.setVector3("cameraPos", this._scene.cameras[0].position)
            }
            effect.setFloat("maxDistance", this.maxDistance);
            effect.setFloat("resolution", this.resolution);
            effect.setInt("steps", this.steps);
            effect.setFloat("thickness", this.thickness);
            effect.setFloat("distanceFade", this.distanceFade);            
            effect.setFloat("roughnessFactor", this.roughnessFactor);
            effect.setBool("backupOnlyWhenTooSpecular", this.backupOnlyWhenTooSpecular);
        };
        this._ssrReflectionsPostProcess.samples = this.textureSamples;
    }


    // Private Methods
    private _createSSRBlurPostProcess(ssrRatio: number, blurRatio: number, textureType: number): void {

        const uniforms = ["direction"];
        const samplers = ["textureSampler"];

        this._ssrBlurHPostProcess = new PostProcess(
            "BlurH",
            "ssr",
            uniforms,
            samplers,
            ssrRatio,
            null,
            Texture.TRILINEAR_SAMPLINGMODE,
            this._scene.getEngine(),
            false,
            "#define BILATERAL_BLUR\n",
            textureType
        );
        if (!this._forceGeometryBuffer) {
            this._ssrBlurHPostProcess._prePassEffectConfiguration = this._config;
        }
        this._ssrBlurHPostProcess.onApply = (effect: Effect) => {
            if (!this._scene.activeCamera) {
                return;
            }

            effect.setVector2("direction", new Vector2(1.0, 0.0));
        };

        this._ssrBlurVPostProcess = new PostProcess(
            "BlurV",
            "ssr",
            uniforms,
            samplers,
            blurRatio,
            null,
            Texture.TRILINEAR_SAMPLINGMODE,
            this._scene.getEngine(),
            false,
            "#define BILATERAL_BLUR\n",
            textureType
        );
        if (!this._forceGeometryBuffer) {
            this._ssrBlurVPostProcess._prePassEffectConfiguration = this._config;
        }
        this._ssrBlurVPostProcess.onApply = (effect: Effect) => {
            if (!this._scene.activeCamera) {
                return;
            }

            effect.setVector2("direction", new Vector2(0.0, 1.0));
            if (this._geometryBufferRenderer) {
                const positionIndex = this._geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.POSITION_TEXTURE_TYPE);
                const reflectivityIndex = this._geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.REFLECTIVITY_TEXTURE_TYPE);
                effect.setTexture("positionSampler", this._geometryBufferRenderer!.getGBuffer().textures[positionIndex]);
                effect.setTexture("specularSampler", this._geometryBufferRenderer!.getGBuffer().textures[reflectivityIndex]);
            } else if (this._prePassRenderer) {
                const positionIndex = this._prePassRenderer.getIndex(Constants.PREPASS_POSITION_TEXTURE_TYPE);
                const reflectivityIndex = this._prePassRenderer.getIndex(Constants.PREPASS_REFLECTIVITY_TEXTURE_TYPE);
                effect.setTexture("positionSampler", this._prePassRenderer.getRenderTarget().textures[positionIndex]);
                effect.setTexture("specularSampler", this._prePassRenderer.getRenderTarget().textures[reflectivityIndex]);
            }
        };

        this._ssrBlurHPostProcess.samples = this.textureSamples;
        this._ssrBlurVPostProcess.samples = this.textureSamples;
    }

    /** @hidden */
    public _rebuild() {
        super._rebuild();
    }

    private _createSSRCombinePostProcess(ratio: number, textureType: number): void {

        const uniforms = ["view", "strength", "falloffExponent", "roughnessFactor"];
        const samplers = ["textureSampler", "originalColor", "reflectedSampler", "normalSampler", "positionSampler", "specularSampler"];

        this._ssrCombinePostProcess = new PostProcess(
            "ssrCombine",
            "ssr",
            uniforms,
            samplers,
            ratio,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            this._scene.getEngine(),
            false,
            "#define COMBINE\n",
            textureType
        );
        if (!this._forceGeometryBuffer) {
            this._ssrCombinePostProcess._prePassEffectConfiguration = this._config;
        }
        this._ssrCombinePostProcess.onApply = (effect: Effect) => {
            effect.setTextureFromPostProcessOutput("originalColor", this._originalColorPostProcess);
            effect.setTextureFromPostProcessOutput("reflectedSampler", this._ssrReflectionsPostProcess);
            if (this._geometryBufferRenderer) {
                // Samplers
                const positionIndex = this._geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.POSITION_TEXTURE_TYPE);
                const reflectivityIndex = this._geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.REFLECTIVITY_TEXTURE_TYPE);
                effect.setTexture("normalSampler", this._geometryBufferRenderer!.getGBuffer().textures[1]);
                effect.setTexture("positionSampler", this._geometryBufferRenderer!.getGBuffer().textures[positionIndex]);
                effect.setTexture("specularSampler", this._geometryBufferRenderer!.getGBuffer().textures[reflectivityIndex]);
            } else if (this._prePassRenderer) {
                // Samplers
                const normalIndex = this._prePassRenderer.getIndex(Constants.PREPASS_NORMAL_TEXTURE_TYPE);
                const positionIndex = this._prePassRenderer.getIndex(Constants.PREPASS_POSITION_TEXTURE_TYPE);
                const reflectivityIndex = this._prePassRenderer.getIndex(Constants.PREPASS_REFLECTIVITY_TEXTURE_TYPE);
                effect.setTexture("normalSampler", this._prePassRenderer.getRenderTarget().textures[normalIndex]);
                effect.setTexture("positionSampler", this._prePassRenderer.getRenderTarget().textures[positionIndex]);
                effect.setTexture("specularSampler", this._prePassRenderer.getRenderTarget().textures[reflectivityIndex]);
            }
            if (this._scene.activeCamera){
                effect.setMatrix("view", this._scene.activeCamera.getViewMatrix(true));
            } else {
                effect.setMatrix("view", this._scene.cameras[0].getViewMatrix(true));
            }    
            effect.setFloat("strength", this.strength);
            effect.setFloat("falloffExponent", this.reflectionSpecularFalloffExponent);
            effect.setFloat("roughnessFactor", this.roughnessFactor);
        };
        this._ssrCombinePostProcess.samples = this.textureSamples;
    }

    /**
     * Serialize the rendering pipeline (Used when exporting)
     * @returns the serialized object
     */
    public serialize(): any {
        const serializationObject = SerializationHelper.Serialize(this);
        serializationObject.customType = "SSRRenderingPipeline";

        return serializationObject;
    }

    /**
     * Parse the serialized pipeline
     * @param source Source pipeline.
     * @param scene The scene to load the pipeline to.
     * @param rootUrl The URL of the serialized pipeline.
     * @returns An instantiated pipeline from the serialized object.
     */
    public static Parse(source: any, scene: Scene, rootUrl: string): SSRRenderingPipeline {
        return SerializationHelper.Parse(() => new SSRRenderingPipeline(source._name, scene, source._ratio), source, scene, rootUrl);
    }
}

RegisterClass("BABYLON.SSRRenderingPipeline", SSRRenderingPipeline);
