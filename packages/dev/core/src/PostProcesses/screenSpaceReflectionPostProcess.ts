import { Nullable } from "../types";
import { Camera } from "../Cameras/camera";
import type { Effect } from "../Materials/effect";
import { PostProcess, PostProcessOptions } from "./postProcess";
import { Constants } from "../Engines/constants";
import { GeometryBufferRenderer } from "../Rendering/geometryBufferRenderer";
import { serialize, SerializationHelper } from "../Misc/decorators";
import { PrePassRenderer } from "../Rendering/prePassRenderer";
import { ScreenSpaceReflectionsConfiguration } from "../Rendering/screenSpaceReflectionsConfiguration";

import "../Shaders/screenSpaceReflection.fragment";
import { RegisterClass } from "../Misc/typeStore";
import { CubeTexture } from "../Materials/Textures/cubeTexture";

declare type Engine = import("../Engines/engine").Engine;
declare type Scene = import("../scene").Scene;

/**
 * The ScreenSpaceReflectionPostProcess performs realtime reflections using only the available informations on the screen (positions, depth and normals).
 * Basically, the screen space reflection post-process will compute reflections according the material's properties (TODO: verify this specularity/glossiness, metallic/roughness or reflectivity).
 */
export class ScreenSpaceReflectionPostProcess extends PostProcess {
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
        this._updateEffectDefines();
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
        this._updateEffectDefines();
    }
    
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
    constructor(
        name: string,
        scene: Scene,
        options: number | PostProcessOptions,
        camera: Nullable<Camera>,
        samplingMode?: number,
        engine?: Engine,
        reusable?: boolean,
        textureType: number = Constants.TEXTURETYPE_UNSIGNED_INT,
        blockCompilation = true,
        forceGeometryBuffer = false
    ) {
        super(
            name,
            "screenSpaceReflection",
            ["projection", "view", "maxDistance", "resolution", "steps", "thickness", 
            "strength", "falloffExponent", "distanceFade", "minZ", "maxZ", "cameraPos", "backupOnlyWhenTooSpecular", 
            "roughnessFactor"],
            ["textureSampler", "normalSampler", "depthSampler", "positionSampler", 
            "specularSampler", "cameraPos", "backUpSampler"],
            options,
            camera,
            samplingMode,
            engine,
            reusable,
            "#define SSR_SUPPORTED\n",
            textureType,
            undefined,
            null,
            blockCompilation
        );

        if (!camera) {
            return;
        }

        // PrePass
        this._forceGeometryBuffer = forceGeometryBuffer;
        if (this._forceGeometryBuffer) {
            // Get geometry buffer renderer and update effect
            const geometryBufferRenderer = scene.enableGeometryBufferRenderer();
            if (geometryBufferRenderer) {
                if (geometryBufferRenderer.isSupported) {
                    geometryBufferRenderer.enablePosition = true;
                    geometryBufferRenderer.enableReflectivity = true;
                }
            }
        } else {
            const prePassRenderer = scene.enablePrePassRenderer();
            prePassRenderer?.markAsDirty();
            this._prePassEffectConfiguration = new ScreenSpaceReflectionsConfiguration();
        }

        this._isSceneRightHanded = scene.useRightHandedSystem;
        this._updateEffectDefines();

        // On apply, send uniforms
        this.onApply = (effect: Effect) => {
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

            const viewMatrix = camera.getViewMatrix(true);
            const projectionMatrix = camera.getProjectionMatrix(true);

            effect.setMatrix("projection", projectionMatrix);
            effect.setMatrix("view", viewMatrix);

            effect.setFloat("maxDistance", this.maxDistance);

            effect.setFloat("resolution", this.resolution);
            effect.setInt("steps", this.steps);
            effect.setFloat("thickness", this.thickness);
            effect.setFloat("strength", this.strength);
            effect.setFloat("falloffExponent", this.reflectionSpecularFalloffExponent);
            effect.setFloat("roughnessFactor", this.roughnessFactor);
            effect.setFloat("distanceFade", this.distanceFade);
            effect.setBool("backupOnlyWhenTooSpecular", this.backupOnlyWhenTooSpecular);

            effect.setFloat("minZ", camera.minZ);
            effect.setFloat("maxZ", camera.maxZ);

            effect.setVector3("cameraPos", camera.position)
        };
    }

    private _updateEffectDefines(): void {
        const defines: string[] = [];
        if (this._geometryBufferRenderer || this._prePassRenderer) {
            defines.push("#define SSR_SUPPORTED");
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

        this.updateEffect(defines.join("\n"));
    }

    /**
     *
     * @param parsedPostProcess
     * @param targetCamera
     * @param scene
     * @param rootUrl
     * @returns
     */
    public static _Parse(parsedPostProcess: any, targetCamera: Camera, scene: Scene, rootUrl: string) {
        return SerializationHelper.Parse(
            () => {
                return new ScreenSpaceReflectionPostProcess(
                    parsedPostProcess.name,
                    scene,
                    parsedPostProcess.options,
                    targetCamera,
                    parsedPostProcess.renderTargetSamplingMode,
                    scene.getEngine(),
                    parsedPostProcess.textureType,
                    parsedPostProcess.reusable
                );
            },
            parsedPostProcess,
            scene,
            rootUrl
        );
    }
}

RegisterClass("BABYLON.ScreenSpaceReflectionPostProcess", ScreenSpaceReflectionPostProcess);
