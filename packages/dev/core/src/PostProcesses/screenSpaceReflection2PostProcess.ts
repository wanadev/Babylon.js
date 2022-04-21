import { Nullable } from "../types";
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
import { ScreenSpaceReflections2Configuration } from "../Rendering/screenSpaceReflections2Configuration";
// import { PrePassRenderTarget } from "../Materials/Textures/prePassRenderTarget";

import "../Shaders/specularMap.fragment";
import "../Shaders/specularMap.vertex";
import "../Shaders/metallicMap.fragment";
import "../Shaders/metallicMap.vertex";
import "../Shaders/screenSpaceReflection2.fragment";
import "../Shaders/screenSpaceReflection2.vertex";
import { RegisterClass } from "../Misc/typeStore";
import { AbstractMesh } from "../Meshes/abstractMesh";
import { CubeTexture } from "../Materials/Textures/cubeTexture";

// import { Mesh } from "../Meshes/mesh";


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
        this._updateEffectDefines();
    }

    /**
     * Gets or sets the reflection quality through the size of the renderTargetTexture we use.
     * Quality property is expected to be between 0.5 (low quality) and 1.0 (hight quality). It is clamp to [0, 1].
     */
    @serialize()
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
     * Creates a new instance of ScreenSpaceReflectionPostProcess.
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
            ["projection", "view", "maxDistance", "resolution", "steps", "thickness", "minZ", "maxZ"], 
            ["textureSampler", "normalSampler", "depthSampler", "positionSampler", "specularMap", "metallicMap", "cameraPos", "backUpSampler"], 
            options, 
            camera, 
            samplingMode,//Texture.BILINEAR_SAMPLINGMODE, 
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

        // our own prePass
        const renderSpecularTarget = new RenderTargetTexture("specular to texture", {height: engine.getRenderHeight() * this._quality,  width: engine.getRenderWidth() * this._quality}, scene);
        scene.customRenderTargets.push(renderSpecularTarget);
     
        const renderMetallicTarget = new RenderTargetTexture("metallic to texture", {height: engine.getRenderHeight() * this._quality,  width: engine.getRenderWidth() * this._quality}, scene);
        scene.customRenderTargets.push(renderMetallicTarget);
        
        scene.meshes.forEach ((mesh) => {
            this._iterateOverTheSceneMeshes(mesh, scene, renderSpecularTarget, renderMetallicTarget);
        })   

        this._scene.onNewMeshAddedObservable.add( (newMesh) => {
            this._iterateOverTheSceneMeshes(newMesh, scene, renderSpecularTarget, renderMetallicTarget);
        })
        
        this._scene.onMeshRemovedObservable.add( (mesh) => {
            if(renderSpecularTarget.renderList) {
                const idxSpec = renderSpecularTarget.renderList.indexOf(mesh);
                if (idxSpec != -1){
                    renderSpecularTarget.renderList?.splice(idxSpec, 1);
                }
            }
            if(renderMetallicTarget.renderList){
                const idxMetal = renderMetallicTarget.renderList.indexOf(mesh);
                if (idxMetal != -1){
                    renderMetallicTarget.renderList?.splice(idxMetal, 1);
                }  
            }
        })

        // prePass
        this._forceGeometryBuffer = forceGeometryBuffer;
        this._forceGeometryBuffer = true; //forceGeometryBuffer;
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
            }
            else if (this._prePassRenderer) { // doesn't work !
                // Samplers
                const normalIndex = this._prePassRenderer.getIndex(Constants.PREPASS_NORMAL_TEXTURE_TYPE);
                const positionIndex = this._prePassRenderer.getIndex(Constants.PREPASS_POSITION_TEXTURE_TYPE);

                effect.setTexture("normalSampler", this._prePassRenderer.getRenderTarget().textures[normalIndex]);
                effect.setTexture("positionSampler", this._prePassRenderer.getRenderTarget().textures[positionIndex]);
            }
               
            effect.setTexture("specularMap", renderSpecularTarget); 
            effect.setTexture("metallicMap", renderMetallicTarget); 

            if (this._backUpTexture){
                effect.setTexture("backUpSampler", this._backUpTexture);
            }

            const viewMatrix = camera.getViewMatrix(true);
            const projectionMatrix = camera.getProjectionMatrix(true);

            const depthRenderer = scene.enableDepthRenderer();
            effect.setTexture("depthSampler", depthRenderer.getDepthMap());

            effect.setMatrix("projection", projectionMatrix);
            effect.setMatrix("view", viewMatrix);

            effect.setFloat("maxDistance", this.maxDistance);
            effect.setFloat("resolution", this.resolution);
            effect.setInt("steps", this.steps);
            effect.setFloat("thickness", this.thickness);

            effect.setFloat("minZ", camera.minZ);
            effect.setFloat("maxZ", camera.maxZ);

            // effect.setVector3("cameraPos", camera.position);
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

    private _updateEffectDefines(): void {
        const defines: string[] = [];
        if (this._geometryBufferRenderer || this._prePassRenderer) {
            defines.push("#define SSR_SUPPORTED");
        }

        if (this._isSceneRightHanded) {
            defines.push("#define RIGHT_HANDED_SCENE");
        }

        if (this._backUpTexture) {
            defines.push("#define BACKUP_TEXTURE");
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
}


RegisterClass("BABYLON.ScreenSpaceReflection2PostProcess", ScreenSpaceReflection2PostProcess);
