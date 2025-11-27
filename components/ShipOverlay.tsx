
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { ENEMY_STATS, EnemyType } from '../types';

// A simple full-screen quad vertex shader
const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform mat4 u_shipRotInv; // Transposed rotation matrix for transforming ray to local space
uniform float u_thrust;
uniform float u_brake;
uniform float u_yaw_velocity;
uniform float u_pitch_velocity;
uniform float u_thrust_ignition_time;

// Combat
#define MAX_ENEMIES 5
#define MAX_PROJECTILES 8
uniform vec3 u_enemyPos[MAX_ENEMIES];
uniform vec3 u_enemyRot[MAX_ENEMIES]; // Pitch, Yaw, Roll
uniform vec4 u_enemyData[MAX_ENEMIES]; // x: scale, y: type, z: hitFlash, w: unused
uniform int u_enemyActive[MAX_ENEMIES];

uniform vec3 u_projPos[MAX_PROJECTILES];
uniform vec3 u_projVel[MAX_PROJECTILES]; // Velocity for orientation
uniform vec4 u_projData[MAX_PROJECTILES]; // x: scale, y: r, z: g, w: b
uniform int u_projType[MAX_PROJECTILES]; // 0: blaster, 1: laser, 2: plasma, 3: shotgun, 4: railgun
uniform int u_projActive[MAX_PROJECTILES];

// Ship DNA from sliders
uniform float u_complexity;
uniform float u_fold1;
uniform float u_fold2;
uniform float u_fold3;
uniform float u_scale;
uniform float u_stretch;
uniform float u_taper;
uniform float u_twist;
uniform float u_asymmetryX;
uniform float u_asymmetryY;
uniform float u_asymmetryZ;

// Parameter Biases
uniform float u_twistAsymX;
uniform float u_scaleAsymX;
uniform float u_fold1AsymX;
uniform float u_fold2AsymX;

uniform float u_generalScale;
uniform float u_chaseDistance;
uniform float u_chaseVerticalOffset;
uniform float u_translucency;

// Optimization: Reduced Max Steps but safer step size
#define MAX_STEPS 100
#define MAX_DIST 100.0
#define SURF_DIST 0.002

mat2 rot(float a) { float s=sin(a), c=cos(a); return mat2(c, -s, s, c); }

// SDF Primitives
float sdCapsule( vec3 p, vec3 a, vec3 b, float r ) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
  return length( pa - ba*h ) - r;
}

float sdOctahedron( vec3 p, float s) {
  p = abs(p);
  return (p.x+p.y+p.z-s)*0.57735027;
}

// KIFS Fractal for Ship Body
float sdFractalShip(vec3 p, bool isEnemy, float scaleMod) {
    // Store original position for asymmetry calculations
    vec3 pOrig = p;

    // Apply Asymmetry Distortion first (Spatial scaling based on sign)
    // Only apply heavy asymmetry to player for performance/complexity
    if (!isEnemy) {
        p.x *= 1.0 - sign(p.x) * u_asymmetryX * 0.5;
        p.y *= 1.0 - sign(p.y) * u_asymmetryY * 0.5;
        p.z *= 1.0 - sign(p.z) * u_asymmetryZ * 0.5;
    }

    float appliedScale = u_generalScale * scaleMod;
    p /= appliedScale;
    p.z /= u_stretch; // Longitudinal stretch
    
    // Tapering along Z axis (before rotation, Z is longitudinal)
    p.xy *= 1.0 + p.z * u_taper;

    // --- Asymmetric Twisting ---
    float localTwist = u_twist;
    if (!isEnemy) localTwist += pOrig.x * u_twistAsymX;
    p.xy *= rot(p.z * localTwist * 2.0);

    // Initial orientation to make it face forward (-Z)
    p.yz *= rot(1.57); 

    float s = 1.0;
    // Lower iteration count for enemies to save performance
    int loops = isEnemy ? 3 : int(u_complexity);
    
    for(int i=0; i<loops; i++) {
        // --- Asymmetric Folding ---
        float localFold1 = u_fold1;
        float localFold2 = u_fold2;
        if (!isEnemy) {
            localFold1 += pOrig.x * u_fold1AsymX;
            localFold2 += pOrig.x * u_fold2AsymX;
        }

        // Folding space
        p = abs(p) - vec3(localFold1, localFold2, 0.3)/s;
        p.xz *= rot(u_fold3);
        
        // --- Asymmetric Scaling ---
        float localScale = u_scale;
        if (!isEnemy) localScale += pOrig.x * u_scaleAsymX * 0.2;
        p *= localScale;
        s *= localScale;
    }
    // Base shape: a box that gets folded into the fractal
    float d = length(max(abs(p) - vec3(0.1, 0.8, 0.1), 0.0));
    return d/s * appliedScale;
}

// Main SDF mapping the scene (Player + Enemies + Projectiles)
vec2 map(vec3 p) {
    vec2 res = vec2(MAX_DIST, 0.0);
    float closestEnemyIndex = -1.0;

    // 1. Player Ship (ID 1)
    // Transform p into ship's local space using CPU-computed inverse matrix
    vec3 pPlayer = (u_shipRotInv * vec4(p, 1.0)).xyz;
    
    float dBody = sdFractalShip(pPlayer, false, 1.0);
    
    // Engines (simple cylinders at the back)
    vec3 pEng = pPlayer;
    pEng.x = abs(pEng.x);
    pEng -= vec3(0.5, 0.0, 1.2); 
    float dEng = max(length(pEng.xy) - 0.2, abs(pEng.z) - 0.4);
    
    // Flaps (boxes at sides)
    vec3 pFlap = pPlayer;
    pFlap.x = abs(pFlap.x);
    pFlap -= vec3(1.1, 0.0, 0.2);
    pFlap.yz *= rot(u_brake * 0.8);
    float dFlap = length(max(abs(pFlap) - vec3(0.4, 0.05, 0.3), 0.0));

    // Smooth blend body parts
    float dPlayer = -log(exp(-dBody*12.0) + exp(-dEng*12.0) + exp(-dFlap*12.0)) / 12.0;
    
    if (dPlayer < res.x) res = vec2(dPlayer, 1.0);

    // 2. Enemies (ID >= 10.0)
    for (int i=0; i<MAX_ENEMIES; i++) {
        if (u_enemyActive[i] == 0) continue;
        
        vec3 pEnemy = p - u_enemyPos[i];
        // Rotate the enemy domain so the ship faces the correct direction relative to camera
        pEnemy.xz *= rot(-u_enemyRot[i].y); 
        
        // Simple bounding sphere check
        if (length(pEnemy) < 6.0) {
             float scaleMod = u_enemyData[i].x;
             float dE = sdFractalShip(pEnemy, true, scaleMod);
             if (dE < res.x) {
                res = vec2(dE, 10.0 + float(i));
             }
        } else {
             // Lower quality proxy SDF for distance
             float dProxy = length(pEnemy) - 2.0;
             if (dProxy < res.x) {
                res = vec2(dProxy, 10.0 + float(i));
             }
        }
    }

    // 3. Projectiles (ID >= 50.0)
    for (int i=0; i<MAX_PROJECTILES; i++) {
        if (u_projActive[i] == 0) continue;
        
        vec3 pProj = p - u_projPos[i];
        vec3 vel = normalize(u_projVel[i]);
        int type = u_projType[i];
        float scale = u_projData[i].x;
        
        float dP = MAX_DIST;

        if (type == 2) { 
            // PLASMA: Unstable sphere
            // Add noise-like distortion
            float distortion = sin(pProj.x * 20.0 + u_time * 20.0) * sin(pProj.y * 20.0 + u_time * 15.0) * sin(pProj.z * 20.0) * 0.05;
            dP = length(pProj) - (0.4 * scale) + distortion;
        } 
        else if (type == 3) {
            // SHOTGUN: Rotating Octahedron
            vec3 pSpin = pProj;
            pSpin.xy *= rot(u_time * 10.0 + float(i));
            pSpin.xz *= rot(u_time * 5.0);
            dP = sdOctahedron(pSpin, 0.25 * scale);
        }
        else {
            // DIRECTIONAL WEAPONS (Blaster, Laser, Railgun)
            // Construct LookAt Rotation to align Z with Velocity
            vec3 forward = normalize(vel); // This is where we want Z to point
            vec3 up = vec3(0.0, 1.0, 0.0);
            if (abs(dot(forward, up)) > 0.99) up = vec3(1.0, 0.0, 0.0); // Avoid gimbal lock
            vec3 right = normalize(cross(up, forward));
            vec3 newUp = cross(forward, right);
            
            // Rotation Matrix
            mat3 alignMat = mat3(right, newUp, forward);
            // Transform point into projectile local space (inverse rotation)
            vec3 pLocal = pProj * alignMat; 
            
            if (type == 0) {
                // BLASTER: Elongated Bolt
                // Head at +Z (forward), tail at -Z
                float len = 0.6 * scale;
                // tapered capsule?
                dP = sdCapsule(pLocal, vec3(0,0,-len), vec3(0,0,len*0.2), 0.1 * scale);
            }
            else if (type == 1) {
                // LASER: Long Beam Segment
                float len = 4.0 * scale; // Very long
                dP = sdCapsule(pLocal, vec3(0,0,-len), vec3(0,0,len), 0.04 * scale);
            }
            else if (type == 4) {
                // RAILGUN: Sharp Kinetic Penetrator
                vec3 pRail = pLocal;
                pRail.z *= 0.15; // Stretch Z significantly
                dP = sdOctahedron(pRail, 0.4 * scale);
            }
        }
        
        if (dP < res.x) res = vec2(dP, 50.0 + float(i));
    }

    return res;
}

// Calculate normal for lighting
vec3 getNormal(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
    float d = map(p).x;
    return normalize(vec3(
        map(p + e.xyy).x - d,
        map(p + e.yxy).x - d,
        map(p + e.yyx).x - d
    ));
}

void main() {
    // Setup Ray from Chase Camera perspective
    vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / u_resolution.y;
    vec3 ro = vec3(0.0, u_chaseVerticalOffset, u_chaseDistance); // Fixed chase camera relative to ship center (0,0,0)
    vec3 rd = normalize(vec3(uv, -1.5)); // Looking forward (-Z)

    float d = 0.0;
    float t = 0.0; 
    float objID = 0.0;
    
    for(int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + rd * t;
        vec2 res = map(p);
        d = res.x;
        objID = res.y;
        if(d < SURF_DIST || t > MAX_DIST) break;
        t += d * 0.5;
    }

    if(t < MAX_DIST) {
        vec3 p = ro + rd * t;
        vec3 n = getNormal(p);
        // Optimize lighting calcs
        float diff = max(dot(n, normalize(vec3(1.0, 2.0, 3.0))), 0.0);
        vec3 col = vec3(0.2, 0.25, 0.3) * (diff + 0.1);
        
        // Rim lighting
        float rim = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);
        col += vec3(0.1, 0.6, 1.0) * rim * 0.8;

        if (objID >= 50.0) {
            // Projectile Custom Rendering
            int idx = int(objID - 50.0);
            vec3 pColor = u_projData[idx].yzw;
            vec3 vel = u_projVel[idx];
            int type = u_projType[idx];
            float scale = u_projData[idx].x;

            // Reconstruct Local Coordinates for Texturing
            vec3 pProj = p - u_projPos[idx];
            vec3 forward = normalize(vel);
            vec3 up = vec3(0.0, 1.0, 0.0);
            if (abs(dot(forward, up)) > 0.99) up = vec3(1.0, 0.0, 0.0);
            vec3 right = normalize(cross(up, forward));
            vec3 newUp = cross(forward, right);
            // Transform pProj to local space: [dot(p, R), dot(p, U), dot(p, F)]
            vec3 localP = vec3(dot(pProj, right), dot(pProj, newUp), dot(pProj, forward));

            if (type == 0) { 
                // BLASTER: Gradient from tail to head
                // Head is +Z. Tail is -Z.
                float grad = smoothstep(-0.5*scale, 0.2*scale, localP.z);
                col = mix(pColor, vec3(1.0), grad); // White tip
                col += vec3(1.0, 0.8, 0.5) * pow(grad, 3.0) * 2.0; // Glow
            } 
            else if (type == 1) { 
                // LASER: Hot Core
                float core = 1.0 - smoothstep(0.0, 0.05*scale, length(localP.xy));
                col = mix(pColor, vec3(1.0), core * 0.8);
                col += pColor * 2.0; // Overall intense glow
            }
            else if (type == 2) { 
                // PLASMA: Unstable Core
                // Simple pattern
                float noise = sin(localP.x*30.0 + u_time*20.0) * sin(localP.y*30.0 + u_time*15.0);
                col = pColor * (1.0 + noise * 0.3);
                col += pColor * (1.0 - max(0.0, dot(n, -rd))) * 2.0; // Fresnel glow
            }
            else {
                // Default / Railgun / Shotgun
                col = pColor * (diff + 0.5) + rim;
                if(type == 4) col += vec3(1.0) * pow(max(0.0, dot(n, -rd)), 2.0); // Shiny railgun
            }
            
            outColor = vec4(col, 1.0);
            return;
        }
        
        if (objID >= 10.0 && objID < 50.0) {
            // Enemy
            int idx = int(objID - 10.0);
            float type = u_enemyData[idx].y;
            float flash = u_enemyData[idx].z;
            
            // Base Color based on Type (Scout: 0, Fighter: 1, Tank: 2)
            vec3 baseColor = vec3(0.8, 0.0, 0.0); // Default Fighter (Red)
            if (abs(type - 0.0) < 0.1) baseColor = vec3(1.0, 0.7, 0.0); // Scout (Yellow/Orange)
            if (abs(type - 2.0) < 0.1) baseColor = vec3(0.4, 0.0, 0.8); // Tank (Purple)
            
            col = baseColor * 0.2 + baseColor * rim;
            
            // Hit Flash
            if (flash > 0.01) {
                col = mix(col, vec3(1.0), flash * 0.8);
            }
        }

        if (objID == 1.0) {
             // PLAYER SHIP EMISSIVE LOGIC
            // Use same transform as map() for texturing
            vec3 localP = (u_shipRotInv * vec4(p, 1.0)).xyz;
            
            float engineMask = smoothstep(0.4, 1.5, localP.z) * (1.0 - smoothstep(0.4, 1.0, abs(localP.x)));
            float timeSinceIgnition = u_time - u_thrust_ignition_time;
            float pulseProgress = clamp(timeSinceIgnition / 0.3, 0.0, 1.0);
            float ignitionFrontZ = mix(0.5, 1.5, pulseProgress);
            float pulseGlow = smoothstep(0.0, 0.15, localP.z - (ignitionFrontZ - 0.15)) * 
                              smoothstep(0.0, -0.15, localP.z - (ignitionFrontZ + 0.15)) * 2.5 * (1.0 - pulseProgress);
            float sustainedVisibility = (timeSinceIgnition > 0.3) ? 1.0 : smoothstep(ignitionFrontZ - 0.2, ignitionFrontZ, localP.z);
            float finalSustainedGlow = mix(0.1, 0.2 + (sin(localP.z * 8.0)*0.5+0.5), u_thrust * sustainedVisibility);
            col += vec3(1.0, 0.4, 0.05) * engineMask * (finalSustainedGlow + pulseGlow);

            float leftBrakeAmount = u_brake + max(0.0, u_yaw_velocity * 2.5); 
            float rightBrakeAmount = u_brake + max(0.0, -u_yaw_velocity * 2.5);
            float flapMaskLeft = smoothstep(0.8, 1.6, localP.x) * (1.0 - smoothstep(0.0, 0.8, -localP.x));
            float flapMaskRight = smoothstep(0.8, 1.6, -localP.x) * (1.0 - smoothstep(0.0, 0.8, localP.x));
            col += vec3(1.0, 0.1, 0.1) * (flapMaskLeft * leftBrakeAmount + flapMaskRight * rightBrakeAmount) * 2.0;
        }
        outColor = vec4(col, u_translucency);
    } else {
        outColor = vec4(0.0); 
    }
}
`;

// Helper map for weapon type ints
const WEAPON_TYPE_MAP: Record<string, number> = {
    'blaster': 0,
    'laser': 1,
    'plasma': 2,
    'shotgun': 3,
    'railgun': 4
};

export const ShipOverlay: React.FC = () => {
    const { 
        effectiveShipConfigRef, 
        cameraAngularVelocityRef, 
        pressedKeys,
        enemiesRef,
        projectilesRef,
        cameraRef,
        viewModeTransition,
        isHdEnabled
    } = useAppContext();

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const thrustIgnitionTimeRef = useRef(-100.0);
    const wasThrustingRef = useRef(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const gl = canvas.getContext('webgl2', { alpha: true, depth: false, antialias: false });
        if (!gl) return;

        // Compile Shaders
        const vs = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vs, VERTEX_SHADER);
        gl.compileShader(vs);
        
        const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fs, FRAGMENT_SHADER);
        gl.compileShader(fs);

        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(fs));
            return;
        }

        const program = gl.createProgram()!;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.useProgram(program);

        // Buffers
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        // Locations
        const uTime = gl.getUniformLocation(program, 'u_time');
        const uRes = gl.getUniformLocation(program, 'u_resolution');
        const uShipRotInv = gl.getUniformLocation(program, 'u_shipRotInv');
        const uThrust = gl.getUniformLocation(program, 'u_thrust');
        const uBrake = gl.getUniformLocation(program, 'u_brake');
        const uYawVel = gl.getUniformLocation(program, 'u_yaw_velocity');
        const uPitchVel = gl.getUniformLocation(program, 'u_pitch_velocity');
        const uIgnitionTime = gl.getUniformLocation(program, 'u_thrust_ignition_time');
        const uTranslucency = gl.getUniformLocation(program, 'u_translucency');
        
        // Ship Config Uniforms
        const shipUniforms: Record<string, WebGLUniformLocation | null> = {};
        const shipKeys = [
            'u_complexity', 'u_fold1', 'u_fold2', 'u_fold3', 'u_scale', 'u_stretch', 'u_taper', 'u_twist',
            'u_asymmetryX', 'u_asymmetryY', 'u_asymmetryZ',
            'u_twistAsymX', 'u_scaleAsymX', 'u_fold1AsymX', 'u_fold2AsymX',
            'u_generalScale', 'u_chaseDistance', 'u_chaseVerticalOffset'
        ];
        shipKeys.forEach(k => shipUniforms[k] = gl.getUniformLocation(program, k));

        // Arrays
        const uEnemyPos = gl.getUniformLocation(program, 'u_enemyPos');
        const uEnemyRot = gl.getUniformLocation(program, 'u_enemyRot');
        const uEnemyData = gl.getUniformLocation(program, 'u_enemyData');
        const uEnemyActive = gl.getUniformLocation(program, 'u_enemyActive');

        const uProjPos = gl.getUniformLocation(program, 'u_projPos');
        const uProjVel = gl.getUniformLocation(program, 'u_projVel'); // NEW
        const uProjData = gl.getUniformLocation(program, 'u_projData');
        const uProjType = gl.getUniformLocation(program, 'u_projType'); // NEW
        const uProjActive = gl.getUniformLocation(program, 'u_projActive');

        let frameId: number;
        const startTime = performance.now();

        const render = (now: number) => {
            frameId = requestAnimationFrame(render);

            const time = (now - startTime) / 1000.0;
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                gl.viewport(0, 0, w, h);
            }

            // Only render if we can see the ship (Chase mode mostly)
            // viewModeTransition 1.0 = chase, 0.0 = cockpit
            if (viewModeTransition < 0.01) {
                gl.clear(gl.COLOR_BUFFER_BIT);
                return;
            }

            // Inputs
            const isThrusting = pressedKeys.has('w') || pressedKeys.has('arrowup') && !pressedKeys.has('shift'); // Rough approximation
            if (isThrusting && !wasThrustingRef.current) {
                thrustIgnitionTimeRef.current = time;
            }
            wasThrustingRef.current = isThrusting;
            
            const isBraking = pressedKeys.has('s');
            
            gl.uniform1f(uTime, time);
            gl.uniform2f(uRes, w, h);
            gl.uniform1f(uThrust, isThrusting ? 1.0 : 0.0);
            gl.uniform1f(uBrake, isBraking ? 1.0 : 0.0);
            gl.uniform1f(uIgnitionTime, thrustIgnitionTimeRef.current);

            const yawVel = cameraAngularVelocityRef.current[1];
            const pitchVel = cameraAngularVelocityRef.current[0];
            gl.uniform1f(uYawVel, yawVel);
            gl.uniform1f(uPitchVel, pitchVel);

            // Matrix for ship juice (banking)
            // Simple Z rotation based on yaw velocity
            const bankAngle = -yawVel * 0.5;
            const c = Math.cos(bankAngle);
            const s = Math.sin(bankAngle);
            // Inverse rotation Z (-bankAngle)
            // Mat4 column-major:
            // c  s  0  0
            // -s c  0  0
            // 0  0  1  0
            // 0  0  0  1
            const rotInv = new Float32Array([
                 c, -s, 0, 0,
                 s,  c, 0, 0,
                 0,  0, 1, 0,
                 0,  0, 0, 1
            ]);
            gl.uniformMatrix4fv(uShipRotInv, false, rotInv);

            // Ship Config
            const sc = effectiveShipConfigRef.current;
            gl.uniform1f(shipUniforms['u_complexity'], sc.complexity);
            gl.uniform1f(shipUniforms['u_fold1'], sc.fold1);
            gl.uniform1f(shipUniforms['u_fold2'], sc.fold2);
            gl.uniform1f(shipUniforms['u_fold3'], sc.fold3);
            gl.uniform1f(shipUniforms['u_scale'], sc.scale);
            gl.uniform1f(shipUniforms['u_stretch'], sc.stretch);
            gl.uniform1f(shipUniforms['u_taper'], sc.taper);
            gl.uniform1f(shipUniforms['u_twist'], sc.twist);
            gl.uniform1f(shipUniforms['u_asymmetryX'], sc.asymmetryX);
            gl.uniform1f(shipUniforms['u_asymmetryY'], sc.asymmetryY);
            gl.uniform1f(shipUniforms['u_asymmetryZ'], sc.asymmetryZ);
            gl.uniform1f(shipUniforms['u_twistAsymX'], sc.twistAsymX);
            gl.uniform1f(shipUniforms['u_scaleAsymX'], sc.scaleAsymX);
            gl.uniform1f(shipUniforms['u_fold1AsymX'], sc.fold1AsymX);
            gl.uniform1f(shipUniforms['u_fold2AsymX'], sc.fold2AsymX);
            gl.uniform1f(shipUniforms['u_generalScale'], sc.generalScale || 1.0);
            gl.uniform1f(shipUniforms['u_chaseDistance'], sc.chaseDistance || 6.5);
            gl.uniform1f(shipUniforms['u_chaseVerticalOffset'], sc.chaseVerticalOffset || 0.0);
            
            // Translucency based on ship config AND view mode fade
            // If viewModeTransition < 1.0, fade out
            const baseTrans = sc.translucency !== undefined ? sc.translucency : 1.0;
            gl.uniform1f(uTranslucency, baseTrans * viewModeTransition);

            // --- ENEMIES ---
            const enemies = enemiesRef.current;
            const enemyPosArr = new Float32Array(5 * 3); // 5 enemies * 3 coords
            const enemyRotArr = new Float32Array(5 * 3);
            const enemyDataArr = new Float32Array(5 * 4); // scale, type, hitFlash, unused
            const enemyActiveArr = new Int32Array(5);
            
            const camPos = cameraRef.current.position;
            const camRot = cameraRef.current.rotation;
            
            // Camera Rotation Matrix (View Matrix logic)
            // InvRot = RotX(-p) * RotY(-y)
            const cp = Math.cos(-camRot[0]); const sp = Math.sin(-camRot[0]);
            
            // FIXED: Do NOT negate Yaw here. Physics Angle (CCW) + World Rotation (Inv CCW) = Standard Math
            const cy = Math.cos(camRot[1]); 
            const sy = Math.sin(camRot[1]);
            
            // Vector rotation helper
            const transformRel = (x:number, y:number, z:number) => {
                // RotY
                const x1 = x * cy - z * sy;
                const z1 = x * sy + z * cy;
                
                // RotX(-pitch)
                const y2 = y * cp - z1 * sp;
                const z2 = y * sp + z1 * cp;
                return [x1, y2, z2];
            };

            for (let i = 0; i < 5; i++) {
                if (i < enemies.length && enemies[i].active) {
                    const e = enemies[i];
                    const relX = e.position[0] - camPos[0];
                    const relY = e.position[1] - camPos[1];
                    const relZ = e.position[2] - camPos[2];
                    
                    const [ex, ey, ez] = transformRel(relX, relY, relZ);
                    
                    enemyPosArr[i*3+0] = ex;
                    enemyPosArr[i*3+1] = ey;
                    enemyPosArr[i*3+2] = -ez; // INVERT Z: World Forward (+Z) -> View Forward (-Z)
                    
                    enemyRotArr[i*3+0] = e.rotation[0];
                    // Correct orientation: if enemy faces +Z (physics forward), it should face +Z (towards camera) in shader space
                    // Since standard model faces -Z, we rotate 180 (PI).
                    enemyRotArr[i*3+1] = e.rotation[1] - camRot[1] + Math.PI; 
                    enemyRotArr[i*3+2] = e.rotation[2];

                    let typeCode = 0.0;
                    if (e.type === 'fighter') typeCode = 1.0;
                    if (e.type === 'tank') typeCode = 2.0;

                    enemyDataArr[i*4+0] = ENEMY_STATS[e.type].scale;
                    enemyDataArr[i*4+1] = typeCode;
                    enemyDataArr[i*4+2] = e.hitFlash;
                    
                    enemyActiveArr[i] = 1;
                } else {
                    enemyActiveArr[i] = 0;
                }
            }

            gl.uniform3fv(uEnemyPos, enemyPosArr);
            gl.uniform3fv(uEnemyRot, enemyRotArr);
            gl.uniform4fv(uEnemyData, enemyDataArr);
            gl.uniform1iv(uEnemyActive, enemyActiveArr);

            // --- PROJECTILES ---
            const projs = projectilesRef.current;
            const projPosArr = new Float32Array(8 * 3);
            const projVelArr = new Float32Array(8 * 3); // NEW
            const projDataArr = new Float32Array(8 * 4);
            const projTypeArr = new Int32Array(8); // NEW
            const projActiveArr = new Int32Array(8);

            for (let i=0; i<8; i++) {
                if (i < projs.length && projs[i].active) {
                    const p = projs[i];
                    const relX = p.position[0] - camPos[0];
                    const relY = p.position[1] - camPos[1];
                    const relZ = p.position[2] - camPos[2];
                    const [px, py, pz] = transformRel(relX, relY, relZ);
                    
                    // Transform velocity vector too for orientation
                    const [vx, vy, vz] = transformRel(p.velocity[0], p.velocity[1], p.velocity[2]);

                    projPosArr[i*3+0] = px;
                    projPosArr[i*3+1] = py;
                    projPosArr[i*3+2] = -pz; // INVERT Z
                    
                    projVelArr[i*3+0] = vx;
                    projVelArr[i*3+1] = vy;
                    projVelArr[i*3+2] = -vz; // INVERT Z

                    projDataArr[i*4+0] = p.scale;
                    projDataArr[i*4+1] = p.color[0];
                    projDataArr[i*4+2] = p.color[1];
                    projDataArr[i*4+3] = p.color[2];
                    
                    projTypeArr[i] = WEAPON_TYPE_MAP[p.weaponType] ?? 0;

                    projActiveArr[i] = 1;
                } else {
                    projActiveArr[i] = 0;
                }
            }
            gl.uniform3fv(uProjPos, projPosArr);
            gl.uniform3fv(uProjVel, projVelArr);
            gl.uniform4fv(uProjData, projDataArr);
            gl.uniform1iv(uProjType, projTypeArr);
            gl.uniform1iv(uProjActive, projActiveArr);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
        };

        frameId = requestAnimationFrame(render);
        return () => cancelAnimationFrame(frameId);
    }, [isHdEnabled]); // Re-init on HD toggle to handle context attributes if needed, though mostly size logic

    return (
        <canvas 
            ref={canvasRef} 
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
        />
    );
};
