in vec3 position;
attribute vec2 uv;
varying vec2 vUV;

uniform mat4 worldViewProjection;

void main(void) {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vUV = uv;
}