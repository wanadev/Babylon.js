import { Nullable } from "../types";
import { Camera } from "../Cameras/camera";
import { Texture } from "../Materials/Textures/texture";
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
import { ScreenSpaceReflections2Configuration } from "../Rendering/screenSpaceReflections2Configuration";

import "../Shaders/specularMap.fragment";
import "../Shaders/specularMap.vertex";
import "../Shaders/metallicMap.fragment";
import "../Shaders/metallicMap.vertex";
import "../Shaders/screenSpaceReflection2.fragment";
import "../Shaders/screenSpaceReflection2.vertex";
import { RegisterClass } from "../Misc/typeStore";
import { AbstractMesh } from "../Meshes/abstractMesh";
import { CubeTexture } from "../Materials/Textures/cubeTexture";

declare type Engine = import("../Engines/engine").Engine;
declare type Scene = import("../scene").Scene;

/**
 * The ScreenSpaceReflectionPostProcess performs realtime reflections using only the available informations on the screen (positions, depth and normals).
 * Basically, the screen space reflection post-process will compute reflections according the material's properties (TODO: verify this specularity/glossiness, metallic/roughness or reflectivity).
 */
export class ScreenSpaceReflection2PostProcess extends PostProcess {
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
    public thickness: number = 0.05;

    
    @serialize()
    private _backUpTextureSkybox: Nullable<CubeTexture> = null; 

    /**
     * Gets the Skybox cubeTexture used to define the reflection when the reflected rays of SSR leave the view space or when the maxDistance is reached.
     */
    get backUpTextureSkybox():Nullable<CubeTexture> {
        return this._backUpTextureSkybox;
    }

    /**
     * Sets the Skybox cubeTexture to define the reflection when the reflected rays of SSR leave the view space or when the maxDistance is reached.
     */
    set backUpTextureSkybox(backUpTex:Nullable<CubeTexture>) {
        this._backUpTextureSkybox = backUpTex;
        this._updateEffectDefines();
    }

    @serialize()
    private _backUpTextureProbe: Nullable<CubeTexture> = null; 

    /**
     * Gets the Probe cubeTexture used to define the reflection when the reflected rays of SSR leave the view space or when the maxDistance is reached.
     */
    public get backUpTextureProbe():Nullable<CubeTexture> {
        return this._backUpTextureProbe;
    }

    /**
     * Sets a Probe cubeTexture to define the reflection when the reflected rays of SSR leave the view space or when the maxDistance is reached.
     */
    public set backUpTextureProbe(backUpTex:Nullable<CubeTexture>) {
        this._backUpTextureProbe = backUpTex;
        this._updateEffectDefines();
    }

    /**
     * Gets or sets a boolean which defines if the algorithme must increase the rendering quality according to the depth view 
     */
    @serialize()
    public changeProperties: boolean = false; 

    /**
     * Defines the reflection quality through the size of the renderTargetTexture we use.
     * Quality property is expected to be between 0.5 (low quality) and 1.0 (hight quality). It is clamp to [0, 1].
     */
    // todo remove RTT and update comments
    // @serialize()
    private _quality: number = 0.75; 

    // get quality():number {
    //     return this._quality;
    // }
    // set quality(val:number) {
    //     // clamp val to [0,1] in case the user in not aware about the way to set the quality 
    //     //(and avoid to create a renderTargetTexture of size 10000 * size of canva)
    //     this._quality = val <= 0.0 ? 0.0 
    //                     : val >= 1.0 ? 1.0 
    //                     : val;
    // }

    private renderSpecularTarget : RenderTargetTexture;
    private renderMetallicTarget : RenderTargetTexture;

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
     * @returns "ScreenSpaceReflection2PostProcess" string
     */
    public getClassName(): string {
        return "ScreenSpaceReflection2PostProcess";
    }

    /**
     * Creates a new instance of ScreenSpaceReflection2PostProcess.
     * @param name The name of the effect.
     * @param scene The scene containing the objects to calculate reflections.
     * @param options The required width/height ratio to downsize to before computing the render pass.
     * @param camera The camera to apply the render pass to.
     * @param engine The engine which the post process will be applied. (default: current engine)
     * @param samplingMode The sampling mode to be used when computing the pass. (default: 0)
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
        engine: Engine, 
        samplingMode?: number, 
        reusable?: boolean, 
        textureType: number = Constants.TEXTURETYPE_UNSIGNED_INT, 
        blockCompilation = true, 
        forceGeometryBuffer = false) {

        super(
            name, 
            'screenSpaceReflection2',
            ["projection", "view", "maxDistance", "resolution", "steps", "thickness", "minZ", "maxZ", "changeProperties"], 
            ["textureSampler", "normalSampler", "depthSampler", "positionSampler", "specularMap", "metallicMap", "cameraPos", "backUpSampler", "albedoSampler"], 
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

        if (!camera){
            return;
        }
      
        // PrePass
        this._forceGeometryBuffer = forceGeometryBuffer;
        this._forceGeometryBuffer = false; //forceGeometryBuffer; // TODO remove when problem solved
        if (this._forceGeometryBuffer) {
            // Get geometry buffer renderer and update effect
            const geometryBufferRenderer = scene.enableGeometryBufferRenderer();
            if (geometryBufferRenderer) {
                if (geometryBufferRenderer.isSupported) {
                    geometryBufferRenderer.enablePosition = true;
                } 
            }
            // Our own 'prePass'
            this.renderSpecularTarget = new RenderTargetTexture("specular to texture", {height: engine.getRenderHeight() * this._quality,  width: engine.getRenderWidth() * this._quality}, scene);
            scene.customRenderTargets.push(this.renderSpecularTarget);
        
            this.renderMetallicTarget = new RenderTargetTexture("metallic to texture", {height: engine.getRenderHeight() * this._quality,  width: engine.getRenderWidth() * this._quality}, scene);
            scene.customRenderTargets.push(this.renderMetallicTarget);
            
            scene.meshes.forEach ((mesh) => {
                this._iterateOverTheSceneMeshes(mesh, scene, this.renderSpecularTarget, this.renderMetallicTarget);
            })   

            // When new mesh : add the mesh (and submeshes..) to the RTT.renderList 
            this._scene.onNewMeshAddedObservable.add( (newMesh) => {
                this._iterateOverTheSceneMeshes(newMesh, scene, this.renderSpecularTarget, this.renderMetallicTarget);
            })
            
            // When mesh removal : remove the mesh from the RTT.renderList 
            this._scene.onMeshRemovedObservable.add( (mesh) => {
                if(this.renderSpecularTarget.renderList) {
                    const idxSpec = this.renderSpecularTarget.renderList.indexOf(mesh);
                    if (idxSpec != -1){
                        this.renderSpecularTarget.renderList?.splice(idxSpec, 1);
                    }
                }
                if(this.renderMetallicTarget.renderList){
                    const idxMetal = this.renderMetallicTarget.renderList.indexOf(mesh);
                    if (idxMetal != -1){
                        this.renderMetallicTarget.renderList?.splice(idxMetal, 1);
                    }  
                }
            })
        }
        else { // doesn't work ! incompatibility with RTT and PrePass + metallic not taken into account in prepass :(
            const prePassRenderer = scene.enablePrePassRenderer();
            prePassRenderer?.markAsDirty();
            this._prePassEffectConfiguration = new ScreenSpaceReflections2Configuration();
        }

        this._isSceneRightHanded = scene.useRightHandedSystem;
        this._updateEffectDefines();      

        // On apply, send uniforms
        this.onApply = (effect) => {

            if (!this._prePassRenderer && !this._geometryBufferRenderer) {
                return;
            }

            if (this._geometryBufferRenderer) {
                // Samplers
                const positionIndex = this._geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.POSITION_TEXTURE_TYPE);
                
                effect.setTexture("normalSampler", this._geometryBufferRenderer!.getGBuffer().textures[1]);
                effect.setTexture("positionSampler", this._geometryBufferRenderer!.getGBuffer().textures[positionIndex]);
                effect.setTexture("depthSampler", this._geometryBufferRenderer!.getGBuffer().textures[0]);

                effect.setTexture("specularMap", this.renderSpecularTarget); 
                effect.setTexture("metallicMap", this.renderMetallicTarget); 
            }
            else if (this._prePassRenderer) { // doesn't work ! incompatibility with RTT and PrePass + metallic not taken into account in prepass :(
                // Samplers
                const normalIndex = this._prePassRenderer.getIndex(Constants.PREPASS_NORMAL_TEXTURE_TYPE);
                const positionIndex = this._prePassRenderer.getIndex(Constants.PREPASS_POSITION_TEXTURE_TYPE);
                const depthIndex = this._prePassRenderer.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE);
                // const reflectivityIndex = this._prePassRenderer.getIndex(Constants.PREPASS_REFLECTIVITY_TEXTURE_TYPE);
                const reflectivityIndex = this._prePassRenderer.getIndex(Constants.PREPASS_SPECULARGLOSSINESS_EQUIVALENT_TEXTURE_TYPE);
                // const albedoIndex = this._prePassRenderer.getIndex(Constants.PREPASS_ALBEDO_SQRT_TEXTURE_TYPE);

                effect.setTexture("normalSampler", this._prePassRenderer.getRenderTarget().textures[normalIndex]);
                effect.setTexture("positionSampler", this._prePassRenderer.getRenderTarget().textures[positionIndex]);
                effect.setTexture("depthSampler", this._prePassRenderer.getRenderTarget().textures[depthIndex]);
                effect.setTexture("specularMap", this._prePassRenderer.getRenderTarget().textures[reflectivityIndex]);
                // effect.setTexture("albedoSampler", this._prePassRenderer.getRenderTarget().textures[albedoIndex]);
                // effect.setTexture("metallicMap", this._prePassRenderer.getRenderTarget().textures[reflectivityIndex]); // TODO changen, for debug only
            }

            if (this._backUpTextureSkybox){
                effect.setTexture("backUpSampler", this._backUpTextureSkybox);
            }
            else if (this._backUpTextureProbe){
                effect.setTexture("backUpSampler", this._backUpTextureProbe);
            }

            const viewMatrix = camera.getViewMatrix(true);
            const projectionMatrix = camera.getProjectionMatrix(true);

            // const depthRenderer = scene.enableDepthRenderer();
            // effect.setTexture("depthSampler", depthRenderer.getDepthMap());

            effect.setMatrix("projection", projectionMatrix);
            effect.setMatrix("view", viewMatrix);

            effect.setFloat("maxDistance", this.maxDistance);
            
            effect.setFloat("resolution", this.resolution);
            effect.setInt("steps", this.steps);
            effect.setFloat("thickness", this.thickness);

            effect.setBool("changeProperties", this.changeProperties);

            effect.setFloat("minZ", camera.minZ); // only used with depthRenderer
            effect.setFloat("maxZ", camera.maxZ);
        };
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
        })
    }

    // recursive iteration over meshes
    private _iterateOverTheSceneMeshes(mesh : AbstractMesh, scene : Scene,
                                        renderSpecularTarget : RenderTargetTexture,
                                        renderMetallicTarget : RenderTargetTexture) {

        this._whenAbsMeshReady(mesh).then(() => { // wait until mesh is ready before updating RTT.renderList, otherwise the texture is not taken into account
            this._computeSpecularMap(mesh, scene, renderSpecularTarget);
            this._computeMetallicMap(mesh, scene, renderMetallicTarget);
            
            mesh.onMaterialChangedObservable.add(() => { // When change in material : remove the mesh and add the new one to the RTT.renderList 
                const idxSpec = renderSpecularTarget.renderList?.indexOf(mesh);
                if (idxSpec && idxSpec != -1){
                    renderSpecularTarget.renderList?.splice(idxSpec, 1);
                }
                const idxMetal = renderMetallicTarget.renderList?.indexOf(mesh);
                if (idxMetal && idxMetal != -1){
                    renderMetallicTarget.renderList?.splice(idxMetal, 1);
                }
                this._whenAbsMeshReady(mesh).then(() => { // wait until mesh is ready before updating RTT.renderList, otherwise the texture is not taken into account
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
                return new ScreenSpaceReflection2PostProcess(
                    parsedPostProcess.name,
                    scene,
                    parsedPostProcess.options,
                    targetCamera,
                    scene.getEngine(),
                    parsedPostProcess.renderTargetSamplingMode,
                    parsedPostProcess.textureType,
                    parsedPostProcess.reusable
                );
            },
            parsedPostProcess,
            scene,
            rootUrl
        );
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
                            "albedoTextureMatrix", "albedoTextureMatrix",
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
                    specularMapShader.setMatrix("specTextureMatrix", (m.material.metallicRoughnessTexture as Texture).getTextureMatrix());
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
                    specularMapShader.setMatrix("albedoTextureMatrix", (m.material.baseTexture as Texture).getTextureMatrix());

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
                    specularMapShader.setMatrix("specTextureMatrix", (m.material.specularGlossinessTexture as Texture).getTextureMatrix());

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
                    specularMapShader.setMatrix("specTextureMatrix", (m.material.metallicTexture as Texture).getTextureMatrix());
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
                        specularMapShader.setMatrix("albedoTextureMatrix", (m.material.albedoTexture as Texture).getTextureMatrix());

                    } else if (m.material.albedoColor != null) {
                        specularMapShader.setColor3("albedoColor", m.material.albedoColor);
                        defines.push("#define ALBEDOCOLOR");
                    }

                } else { // SpecularGlossiness Model
                    if (m.material.reflectivityTexture != null) {
                        specularMapShader.setTexture("specularGlossinessTexture", m.material.reflectivityTexture);
                        defines.push("#define SPECULARGLOSSINESSTEXTURE");
                        specularMapShader.setMatrix("specTextureMatrix", (m.material.reflectivityTexture as Texture).getTextureMatrix());

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
                    specularMapShader.setMatrix("specTextureMatrix", (m.material.specularTexture as Texture).getTextureMatrix());

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
                uniforms: ["world", "worldView", "worldViewProjection", "view", "projection", "textureMatrix",
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
                    metallicMapShader.setMatrix("textureMatrix", (m.material.metallicRoughnessTexture as Texture).getTextureMatrix());                  
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
                    metallicMapShader.setMatrix("textureMatrix", (m.material.metallicTexture as Texture).getTextureMatrix());         
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
}


RegisterClass("BABYLON.ScreenSpaceReflection2PostProcess", ScreenSpaceReflection2PostProcess);
