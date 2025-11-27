
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { AiStage, type Slider, type TerraformConfig, TerraformTarget, ControlConfig, SoundConfig, Modulation, ModulationSource, ModulationTarget, CameraData, ViewMode, ShipConfig, ShipModulation, ShipModulationTarget, Enemy, Projectile, EnemyType, ENEMY_STATS, SliderSuggestion, PlayerStats, WeaponType, WEAPON_STATS, UPGRADE_COSTS } from '../types';
import { AppContextType } from '../context/AppContext';
import { v4 as uuidv4 } from 'uuid';
import { EDITMODE } from '../config';
import { 
    adjustSliders, 
    analyzeShaderForSliders, 
    createSmartSlider, 
    determineModificationType, 
    enrichSliderDetails, 
    explainCode, 
    fetchSliderSuggestions, 
    fixCode, 
    implementCameraControls, 
    modifyCode 
} from '../services/GeminiService';

interface SessionState {
  sessionId?: string;
  shaderCode?: string;
  sliders?: Slider[];
  uniforms?: { [key:string]: number };
  cameraControlsEnabled?: boolean;
  terraformConfig?: TerraformConfig;
  controlConfig?: ControlConfig;
  soundConfig?: SoundConfig;
  source?: string;
  shipConfig?: ShipConfig;
  // New Settings
  canvasSize?: string;
  viewMode?: ViewMode;
  isHdEnabled?: boolean;
  isFpsEnabled?: boolean;
  isHudEnabled?: boolean;
  collisionThresholdRed?: number;
  collisionThresholdYellow?: number;
}

// Helpers for URL hash management
const parseHash = (): Record<string, string> => {
    const hash = window.location.hash.substring(1);
    if (!hash) return {};
    const params: Record<string, string> = {};
    hash.split('&').forEach(part => {
        const temp = part.split('=');
        if (temp.length === 2) {
            params[decodeURIComponent(temp[0])] = decodeURIComponent(temp[1]);
        }
    });
    return params;
};

const stringifyHash = (params: Record<string, string>): string => {
    return Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
};

// --- Optimized Math Helpers for JS Raymarching ---
// Using typed arrays and strictly avoiding new object creation in loops.

const temp_q = new Float32Array(3);
const temp_q_rot = new Float32Array(3);

const getPlanet1Distance = (p_vec: number[] | Float32Array, uniforms: any, t: number) => {
    const scale = uniforms['slider_fractalScale'] ?? 0.37;
    const rot = uniforms['slider_fractalRotation'] ?? 1.09;
    const pulse = uniforms['slider_fractalPulseStrength'] ?? 0.0;

    // Copy p_vec to temp_q to avoid allocations
    temp_q[0] = p_vec[0];
    temp_q[1] = p_vec[1];
    temp_q[2] = p_vec[2];

    let d = -temp_q[1];
    let i = 58.0;

    while (i > 0.05) {
        const angle = rot + Math.sin(t * 1.0 + temp_q[1] * 5.0) * pulse;
        
        // Inline rotate3D_Y to avoid function call overhead and allocations
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        // q_rotated = rotate3D_Y(angle, temp_q);
        temp_q_rot[0] = temp_q[0] * c + temp_q[2] * s;
        temp_q_rot[1] = temp_q[1];
        temp_q_rot[2] = -temp_q[0] * s + temp_q[2] * c;
        
        // Inline mod, fold, and abs logic
        const two_i = i + i;
        // q_mod = mod(q_rotated, i + i) -> ((v % y) + y) % y
        let qx = ((temp_q_rot[0] % two_i) + two_i) % two_i;
        let qy = ((temp_q_rot[1] % two_i) + two_i) % two_i;
        let qz = ((temp_q_rot[2] % two_i) + two_i) % two_i;

        // q_fold = q_mod - i
        qx -= i;
        qy -= i;
        qz -= i;

        // abs_vec(q_fold)
        qx = Math.abs(qx);
        qy = Math.abs(qy);
        qz = Math.abs(qz);

        // q = (i * 0.9) - abs_fold
        const i9 = i * 0.9;
        temp_q[0] = i9 - qx;
        temp_q[1] = i9 - qy;
        temp_q[2] = i9 - qz;

        d = Math.max(d, Math.min(temp_q[0], temp_q[1], temp_q[2]));
        i *= scale;
    }
    return d;
};


const defaultCanvasSize = '100%';

const defaultSoundConfig: SoundConfig = {
  enabled: true,
  masterVolume: 0.5,
  reverb: {
      enabled: true,
      mix: 0.5,
      decay: 5.0,
      tone: 2000,
  },
  drone: {
      enabled: true,
      gain: 0.4,
      filter: 100,
      pitch: 0,
  },
  atmosphere: {
      enabled: true,
      gain: 0.2,
      texture: 'grit',
  },
  melody: {
      enabled: true,
      gain: 0.3,
      density: 0.4,
      "scale": "dorian",
  },
  arp: {
      enabled: true,
      gain: 0.25,
      speed: 1.0,
      octaves: 2,
      filter: 600,
      direction: 'updown', // Default to ping-pong if not modulated
  },
  rhythm: {
      enabled: true,
      gain: 0.4,
      bpm: 60,
      filter: 150,
  },
  // Updated Vangelis-style mappings based on user request
  modulations: [
      // Existing
      { id: '1', enabled: true, source: 'speed', target: 'drone.filter', amount: 0.4 },
      { id: '5', enabled: true, source: 'altitude', target: 'atmosphere.gain', amount: 0.15 },
      // Restored drone pitch modulation - UPDATED to -10% as requested
      { id: '6', enabled: true, source: 'altitude', target: 'drone.pitch', amount: -0.1 },
      
      // New requested mappings
      // "moves up or down based on our up/down heading" -> Pitch controls direction. Positive pitch (looking up) = UP, Negative = DOWN.
      { id: 'new1', enabled: true, source: 'pitch', target: 'arp.direction', amount: 1.5 }, 
      // "speed relates to our speed"
      { id: 'new2', enabled: true, source: 'speed', target: 'arp.speed', amount: 0.8 },
      // "octave range based on how much are we facing up or down"
      { id: 'new3', enabled: true, source: 'pitch', target: 'arp.octaves', amount: 1.0 },
  ]
}

// Modulation Ranges (what "100%" means for each target)
const MOD_RANGES: Record<ModulationTarget, number> = {
    'masterVolume': 1.0,
    'drone.gain': 1.0, 'drone.filter': 2000, 'drone.pitch': 24,
    'atmosphere.gain': 1.0,
    'arp.gain': 1.0, 'arp.speed': 3.0, 'arp.filter': 4000, 'arp.octaves': 3, 'arp.direction': 1.0,
    'rhythm.gain': 1.0, 'rhythm.filter': 2000, 'rhythm.bpm': 100,
    'melody.gain': 1.0, 'melody.density': 1.0,
    'reverb.mix': 1.0, 'reverb.tone': 5000
};

const SHIP_MOD_RANGES: Record<ShipModulationTarget, number> = {
    'complexity': 5,
    'fold1': 0.5,
    'fold2': 0.5,
    'fold3': 1.0,
    'scale': 0.5,
    'stretch': 1.0,
    'taper': 1.0,
    'twist': 1.0,
    'asymmetryX': 1.0,
    'asymmetryY': 1.0,
    'asymmetryZ': 1.0,
    'twistAsymX': 1.0,
    'scaleAsymX': 1.0,
    'fold1AsymX': 0.5,
    'fold2AsymX': 0.5,
};

// Audio Graph Types
interface ReverbNode {
    input: GainNode;
    output: GainNode;
    setTone: (f: number) => void;
}

interface DroneNodes {
    filter: BiquadFilterNode;
    gain: GainNode;
    osc1: OscillatorNode;
    osc2: OscillatorNode;
    baseFreq: number;
}

interface AtmosphereNodes {
    filter: BiquadFilterNode;
    gain: GainNode;
}

interface ArpNodes {
    gain: GainNode;
    filter: BiquadFilterNode;
    delay: DelayNode;
    feedback: GainNode;
}

interface RhythmNodes {
    gain: GainNode;
    filter: BiquadFilterNode;
    delay: DelayNode;
    feedback: GainNode;
}

// Musical Scales
const SCALES = {
    dorian: [62, 64, 65, 67, 69, 71, 72, 74],
    phrygian: [62, 63, 65, 67, 69, 70, 72],
    lydian: [62, 64, 66, 67, 69, 71, 73],
};

const mtof = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

// Calibrated starting position for Planet 1 "true horizon" at -1.49
const INITIAL_CAMERA_POS: [number, number, number] = [0, -1.49, 0];
// Start with a level camera view, compensated for FLIGHT_PITCH_OFFSET
const INITIAL_CAMERA_ROT: [number, number] = [0.1, 0.0];

// --- COMBAT CONFIG ---
const MAX_ENEMIES = 5; 
const MAX_PROJECTILES = 8;
const SPAWN_DIST = 45.0;

// Optimization: Define constant outside component
const NAV_KEYS = ['w', 'a', 's', 'd', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

export const useAppStoreComplete = (): AppContextType => {
  const [activeShaderCode, setActiveShaderCode] = useState<string>('');
  const [sliders, setSliders] = useState<Slider[]>([]);
  const [uniforms, setUniforms] = useState<{ [key: string]: number }>({});
  const uniformsRef = useRef(uniforms); // Stable ref for game loop
  
  const cameraRef = useRef<CameraData>({
      position: [...INITIAL_CAMERA_POS],
      rotation: [...INITIAL_CAMERA_ROT],
      roll: 0
  });
  
  // Separate ref for what actually gets rendered (allows for chase cam offset)
  const renderCameraRef = useRef<CameraData>({
      position: [...INITIAL_CAMERA_POS],
      rotation: [...INITIAL_CAMERA_ROT],
      roll: 0
  });

  const [cameraControlsEnabled, setCameraControlsEnabled] = useState<boolean>(false);
  const [viewMode, setViewModeState] = useState<ViewMode>('chase');
  const [viewModeTransition, setViewModeTransition] = useState(1.0); // 0 = cockpit, 1 = chase
  const viewModeTransitionRef = useRef({ current: 1.0, target: 1.0 });

  const keysPressed = useRef(new Set<string>());
  const [pressedKeys, setPressedKeys] = useState(new Set<string>());
  const cameraVelocityRef = useRef<[number, number, number]>([0, 0, 0]);
  const cameraAngularVelocityRef = useRef<[number, number]>([0, 0]);
  const [canvasSize, setCanvasSize] = useState<string>(defaultCanvasSize);
  const [isControlsOpen, setIsControlsOpen] = useState<boolean>(false);
  const isControlsOpenRef = useRef(isControlsOpen); // Track for game loop
  const [isInteracting, setIsInteracting] = useState<boolean>(false);
  const [isHdEnabled, setIsHdEnabled] = useState<boolean>(false);
  const [isFpsEnabled, setIsFpsEnabled] = useState<boolean>(false);
  // HUD enabled by default per user request
  const [isHudEnabled, setIsHudEnabled] = useState<boolean>(true);
  
  const [controlConfig, setControlConfig] = useState<ControlConfig>({});
  const controlConfigRef = useRef(controlConfig); // Stable ref for game loop

  const [sessionSource, setSessionSource] = useState<string | null>(null);
  
  // Physics State
  const [isMoving, setIsMoving] = useState(false);
  const isMovingRef = useRef(false);
  const previousSpeedRef = useRef(0); 

  // Determine if we should drop quality for performance.
  // Optimization: Pre-calculate nav keys overlap
  const isNavigating = useMemo(() => NAV_KEYS.some(key => pressedKeys.has(key)), [pressedKeys]);
  const shouldReduceQuality = isMoving || isInteracting || isNavigating;

  const [collisionState, setCollisionState] = useState<'none' | 'approaching' | 'colliding'>('none');
  const collisionStateRef = useRef<'none' | 'approaching' | 'colliding'>('none');
  const [collisionProximity, setCollisionProximity] = useState(0);
  const collisionProximityRef = useRef(0);
  const collisionCooldownRef = useRef(0);
  const spawnProtectionRef = useRef(0);
  
  const [collisionThresholdRed, setCollisionThresholdRed] = useState(0.002);
  const collisionThresholdRedRef = useRef(0.002);
  const [collisionThresholdYellow, setCollisionThresholdYellow] = useState(0.02);
  const collisionThresholdYellowRef = useRef(0.02);

  // Combat State
  const enemiesRef = useRef<Enemy[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const lastFireTimeRef = useRef(0);
  const lastEnemySpawnTimeRef = useRef(0);
  const nextSpawnIntervalRef = useRef(2.0);
  
  const [playerStats, setPlayerStats] = useState<PlayerStats>({
      credits: 0,
      currentHp: 100,
      maxHp: 100,
      unlockedWeapons: ['blaster'],
      currentWeapon: 'blaster',
      upgrades: {
          hullLevel: 1,
          damageLevel: 1,
          fireRateLevel: 1,
          speedLevel: 1,
          homingLevel: 1,
          critChanceLevel: 1,
          critDamageLevel: 1,
          pierceLevel: 1,
          multishotLevel: 1,
          lifetimeLevel: 1,
          knockbackLevel: 1,
          stunLevel: 1,
          creditMultLevel: 1,
          eliteDmgLevel: 1,
          executeLevel: 1,
          blastRadiusLevel: 1,
          freezeLevel: 1,
          ricochetLevel: 1,
          scavengerLevel: 1,
          discountLevel: 1,
          overclockLevel: 1
      }
  });
  const playerStatsRef = useRef(playerStats);
  useEffect(() => { playerStatsRef.current = playerStats; }, [playerStats]);

  const [isGameOver, setIsGameOver] = useState(false);
  const isGameOverRef = useRef(false);

  // Debugging
  const [debugElevation, setDebugElevation] = useState(0);
  const [debugArpVolume, setDebugArpVolume] = useState(0);
  const [debugCameraAltitude, setDebugCameraAltitude] = useState(0);
  const [debugCameraPitch, setDebugCameraPitch] = useState(0);
  const [debugCameraDistance, setDebugCameraDistance] = useState(0);
  const debugCollisionPointRef = useRef<[number, number, number]>([0, 0, 0]);
  const debugRayStartPointRef = useRef<[number, number, number]>([0, 0, 0]);
  const debugRayEndPointRef = useRef<[number, number, number]>([0, 0, 0]);
  const debugCollisionDistanceRef = useRef(0);

  const [currentSessionId, setCurrentSessionId] = useState<string>('1');
  const currentSessionIdRef = useRef(currentSessionId);

  const defaultUniformsRef = useRef<{ [key: string]: number }>({});
  
  const terraform_currentVelocity = useRef<{ [key: string]: number }>({});
  const terraform_targetVelocity = useRef<{ [key: string]: number }>({});
  const isTerraformingHeld = useRef(false);

  const [terraformPower, setTerraformPower] = useState(1.0);
  const terraformPowerRef = useRef(1.0);
  const [terraformConfig, setTerraformConfig] = useState<TerraformConfig | null>(null);
  const terraformConfigRef = useRef(terraformConfig); // Stable ref for game loop

  // NEW MUSICAL AUDIO STATE
  const [soundConfig, setSoundConfig] = useState<SoundConfig>(defaultSoundConfig);
  const soundConfigRef = useRef(soundConfig); // Stable ref for game loop

  // FRACTAL SHIP STATE
  const [shipConfig, setShipConfig] = useState<ShipConfig>({
      complexity: 6,
      fold1: 0.75,
      fold2: 0.85,
      fold3: 0.15,
      scale: 1.65,
      stretch: 1.2,
      taper: 0.0,
      twist: 0.0,
      asymmetryX: 0.0,
      asymmetryY: 0.0,
      asymmetryZ: 0.0,
      twistAsymX: 0.0,
      scaleAsymX: 0.0,
      fold1AsymX: 0.0,
      fold2AsymX: 0.0,
      chaseDistance: 6.5,
      chaseVerticalOffset: 0.0,
      pitchOffset: 0.0,
      generalScale: 1.0,
      translucency: 1.0,
      modulations: []
  });
  const shipConfigRef = useRef(shipConfig);
  // Ensure effectiveShipConfigRef matches AppContextType by explicitly omitting 'modulations'
  const { modulations: _initMods, ...initEffective } = shipConfig;
  const effectiveShipConfigRef = useRef<Omit<ShipConfig, 'modulations'>>(initEffective);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNodesRef = useRef<{
      masterGain: GainNode;
      reverb?: ReverbNode;
      drone?: DroneNodes;
      atmosphere?: AtmosphereNodes;
      arp?: ArpNodes;
      rhythm?: RhythmNodes;
  } | null>(null);

  // Live state for sequencer parameters
  const liveAudioStateRef = useRef({
      rhythmBpm: defaultSoundConfig.rhythm.bpm,
      arpSpeed: defaultSoundConfig.arp.speed,
      arpOctaves: defaultSoundConfig.arp.octaves as number,
      melodyDensity: defaultSoundConfig.melody.density
  });
  
  // Sequencing Refs
  const nextMelodyTimeRef = useRef<number>(0);
  const nextArpTimeRef = useRef<number>(0);
  const nextRhythmTimeRef = useRef<number>(0);
  const arpNoteIndexRef = useRef<number>(0);
  const arpInternalDirectionRef = useRef<number>(1); // 1 for up, -1 for down

  // Performance Refs
  const cameraRollRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const accumulatedTimeRef = useRef(0);
  const slidersRef = useRef(sliders);

  // OPTIMIZATION: Pre-allocate objects to avoid GC in game loop
  const audioInputsRef = useRef<Record<ModulationSource, number>>({
    speed: 0, acceleration: 0, altitude: 0, descent: 0,
    turning: 0, turningSigned: 0, heading: 0, pitch: 0, proximity: 0, time: 0
  });
  const audioTargetAccumulatorsRef = useRef<Record<ModulationTarget, number>>({
    'masterVolume': 0, 'drone.gain': 0, 'drone.filter': 0, 'drone.pitch': 0,
    'atmosphere.gain': 0, 'arp.gain': 0, 'arp.speed': 0, 'arp.filter': 0, 'arp.octaves': 0, 'arp.direction': 0,
    'rhythm.gain': 0, 'rhythm.filter': 0, 'rhythm.bpm': 0, 'melody.gain': 0, 'melody.density': 0,
    'reverb.mix': 0, 'reverb.tone': 0
  });
  // Use typed array for better performance in math heavy loop
  const tempProposedPosRef = useRef(new Float32Array(3));
  const tempCollisionTestPosRef = useRef(new Float32Array(3));

  // AI State
  const [geminiPrompt, setGeminiPrompt] = useState('');
  const [aiStage, setAiStage] = useState<AiStage>(AiStage.IDLE);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isGeneratingExplanation, setIsGeneratingExplanation] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [sliderSuggestions, setSliderSuggestions] = useState<SliderSuggestion[]>([]);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [usedSuggestions, setUsedSuggestions] = useState<Set<string>>(new Set());
  const [isFixingCode, setIsFixingCode] = useState(false);

  // --- SYNC REFS ---
  useEffect(() => { uniformsRef.current = uniforms; }, [uniforms]);
  useEffect(() => { controlConfigRef.current = controlConfig; }, [controlConfig]);
  useEffect(() => { soundConfigRef.current = soundConfig; }, [soundConfig]);
  useEffect(() => { shipConfigRef.current = shipConfig; }, [shipConfig]);
  useEffect(() => { terraformConfigRef.current = terraformConfig; }, [terraformConfig]);
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);
  useEffect(() => { slidersRef.current = sliders; }, [sliders]);
  useEffect(() => { isControlsOpenRef.current = isControlsOpen; }, [isControlsOpen]);
  useEffect(() => { isGameOverRef.current = isGameOver; }, [isGameOver]);
  
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    viewModeTransitionRef.current.target = mode === 'chase' ? 1.0 : 0.0;
  }, []);

  // --- RESTART GAME ---
  const restartGame = useCallback(() => {
     setPlayerStats(prev => ({
         ...prev,
         currentHp: prev.maxHp
     }));
     setIsGameOver(false);
     
     // Reset Position
     cameraRef.current = { position: [...INITIAL_CAMERA_POS], rotation: [...INITIAL_CAMERA_ROT], roll: 0 };
     renderCameraRef.current = { position: [...INITIAL_CAMERA_POS], rotation: [...INITIAL_CAMERA_ROT], roll: 0 };
     cameraVelocityRef.current = [0,0,0];
     
     // Clear Enemies & Projectiles
     enemiesRef.current = [];
     projectilesRef.current = [];
     
     // Reset Timers
     lastEnemySpawnTimeRef.current = accumulatedTimeRef.current;

     // Reset Collision
     collisionStateRef.current = 'none';
     setCollisionState('none');
     collisionProximityRef.current = 0;
     setCollisionProximity(0);
     collisionCooldownRef.current = 0;
     
     // Spawn Protection (3 seconds)
     spawnProtectionRef.current = accumulatedTimeRef.current + 3.0; 
  }, []);

  // --- SHOP ACTIONS ---
  const buyWeapon = useCallback((type: WeaponType) => {
    setPlayerStats(prev => {
        const stats = WEAPON_STATS[type];
        const discountFactor = 1.0 - (prev.upgrades.discountLevel - 1) * 0.05;
        const discountedCost = Math.floor(stats.cost * discountFactor);

        if (prev.credits >= discountedCost && !prev.unlockedWeapons.includes(type)) {
            return {
                ...prev,
                credits: prev.credits - discountedCost,
                unlockedWeapons: [...prev.unlockedWeapons, type],
                currentWeapon: type // Auto equip
            };
        }
        return prev;
    });
  }, []);

  const equipWeapon = useCallback((type: WeaponType) => {
      setPlayerStats(prev => {
          if (prev.unlockedWeapons.includes(type)) {
              return { ...prev, currentWeapon: type };
          }
          return prev;
      });
  }, []);

  const buyUpgrade = useCallback((type: keyof PlayerStats['upgrades']) => {
      setPlayerStats(prev => {
          const level = prev.upgrades[type];
          let baseCost = 0;
          if (UPGRADE_COSTS[type]) {
              baseCost = UPGRADE_COSTS[type](level);
          }

          const discountFactor = 1.0 - (prev.upgrades.discountLevel - 1) * 0.05;
          const finalCost = Math.floor(baseCost * discountFactor);

          if (prev.credits >= finalCost) {
              const newLevel = level + 1;
              const newUpgrades = { ...prev.upgrades, [type]: newLevel };
              
              // Recalculate Max HP immediately if Hull bought
              let newMaxHp = prev.maxHp;
              let newCurrentHp = prev.currentHp;
              
              if (type === 'hullLevel') {
                   // Base 100 + 25 per level
                   newMaxHp = 100 + (newLevel - 1) * 25;
                   // Heal amount added
                   newCurrentHp += 25; 
              }

              return {
                  ...prev,
                  credits: prev.credits - finalCost,
                  upgrades: newUpgrades,
                  maxHp: newMaxHp,
                  currentHp: newCurrentHp
              };
          }
          return prev;
      });
  }, []);

  // --- AUDIO SYSTEM ---

  const createNoiseBuffer = (ctx: AudioContext, duration: number): AudioBuffer => {
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
          const output = buffer.getChannelData(channel);
          for (let i = 0; i < bufferSize; i++) {
              output[i] = Math.random() * 2 - 1;
          }
      }
      return buffer;
  };

  const cleanupAudio = useCallback(() => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(err => console.warn("Audio close error:", err));
    }
    audioContextRef.current = null;
    audioNodesRef.current = null;
  }, []);

  const initAudio = useCallback(() => {
      if (audioContextRef.current) return;
      
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = new AudioCtxClass();
      audioContextRef.current = ctx;

      // Use latest soundConfig from ref or state
      const cfg = soundConfigRef.current;

      liveAudioStateRef.current = {
          rhythmBpm: cfg.rhythm.bpm,
          arpSpeed: cfg.arp.speed,
          arpOctaves: cfg.arp.octaves,
          melodyDensity: cfg.melody.density
      };

      const masterGain = ctx.createGain();
      masterGain.gain.value = cfg.masterVolume;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2.0;
      limiter.ratio.value = 12;
      masterGain.connect(limiter);
      limiter.connect(ctx.destination);

      const nodes: any = { masterGain };

      // 1. Reverb
      let reverbNode: ReverbNode | undefined;
      if (cfg.reverb.enabled) {
          reverbNode = {
            input: ctx.createGain(),
            output: ctx.createGain(),
            setTone: (f) => { if(verbFilter) verbFilter.frequency.setTargetAtTime(f, ctx.currentTime, 0.1) }
          };
          const convolver = ctx.createConvolver();
          const duration = cfg.reverb.decay;
          const length = ctx.sampleRate * duration;
          const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
          for (let i = 0; i < length; i++) {
             const env = Math.pow(1 - i / length, 4);
             impulse.getChannelData(0)[i] = (Math.random() * 2 - 1) * env * 0.8;
             impulse.getChannelData(1)[i] = (Math.random() * 2 - 1) * env * 0.8;
          }
          convolver.buffer = impulse;
          const verbFilter = ctx.createBiquadFilter();
          verbFilter.type = 'lowpass';
          verbFilter.frequency.value = cfg.reverb.tone;
          reverbNode.input.connect(verbFilter);
          verbFilter.connect(convolver);
          convolver.connect(reverbNode.output);
          reverbNode.output.connect(masterGain);
          reverbNode.output.gain.value = cfg.reverb.mix;
          nodes.reverb = reverbNode;
      }

      // 2. Drone
      if (cfg.drone.enabled) {
          const droneGain = ctx.createGain();
          droneGain.gain.value = cfg.drone.gain;
          const droneFilter = ctx.createBiquadFilter();
          droneFilter.type = 'lowpass';
          droneFilter.frequency.value = cfg.drone.filter;
          droneFilter.Q.value = 0.5;
          const baseFreq = mtof(38); // D2
          const osc1 = ctx.createOscillator();
          osc1.type = 'sawtooth';
          osc1.frequency.value = baseFreq;
          const osc2 = ctx.createOscillator();
          osc2.type = 'sawtooth';
          osc2.frequency.value = baseFreq * 1.01;
          osc1.connect(droneFilter);
          osc2.connect(droneFilter);
          droneFilter.connect(droneGain);
          droneGain.connect(masterGain);
          if (reverbNode) droneGain.connect(reverbNode.input);
          osc1.start();
          osc2.start();
          nodes.drone = { filter: droneFilter, gain: droneGain, osc1, osc2, baseFreq };
      }

      // 3. Atmosphere (Improved to be deeper, less hissy)
      if (cfg.atmosphere.enabled) {
          const atmGain = ctx.createGain();
          atmGain.gain.value = cfg.atmosphere.gain;
          const atmFilter = ctx.createBiquadFilter();
          atmFilter.type = 'lowpass'; // Changed from highpass to lowpass for deeper rumbling wind
          atmFilter.frequency.value = 400;
          atmFilter.Q.value = 0.2;
          const noise = ctx.createBufferSource();
          noise.buffer = createNoiseBuffer(ctx, 8);
          noise.loop = true;
          noise.start();
          noise.connect(atmFilter);
          atmFilter.connect(atmGain);
          atmGain.connect(masterGain);
          if (reverbNode) {
              const verbSend = ctx.createGain();
              verbSend.gain.value = 0.3;
              atmGain.connect(verbSend);
              verbSend.connect(reverbNode.input);
          }
          nodes.atmosphere = { filter: atmFilter, gain: atmGain };
      }

      // 4. Arp
      if (cfg.arp.enabled) {
          const arpGain = ctx.createGain();
          arpGain.gain.value = cfg.arp.gain;
          const arpFilter = ctx.createBiquadFilter();
          arpFilter.type = 'lowpass';
          arpFilter.Q.value = 3.0;
          arpFilter.frequency.value = cfg.arp.filter;
          const delayL = ctx.createDelay();
          const delayR = ctx.createDelay();
          delayL.delayTime.value = 0.3;
          delayR.delayTime.value = 0.45;
          const feedback = ctx.createGain();
          feedback.gain.value = 0.4;
          const delayMerger = ctx.createChannelMerger(2);
          arpFilter.connect(arpGain);
          arpGain.connect(masterGain);
          arpGain.connect(delayL);
          arpGain.connect(delayR);
          delayL.connect(feedback);
          delayR.connect(feedback);
          feedback.connect(delayL);
          delayL.connect(delayMerger, 0, 0);
          delayR.connect(delayMerger, 0, 1);
          delayMerger.connect(masterGain);
          if (reverbNode) arpGain.connect(reverbNode.input);
          nodes.arp = { gain: arpGain, filter: arpFilter, delay: delayL, feedback };
      }

      // 5. Rhythm
      if (cfg.rhythm.enabled) {
          const rhyGain = ctx.createGain();
          rhyGain.gain.value = cfg.rhythm.gain;
          // No fixed filter here, handled per hit now for the Tom sound
          rhyGain.connect(masterGain);
          if (reverbNode) {
               const rhyVerbSend = ctx.createGain();
               rhyVerbSend.gain.value = 0.6; // Heavier reverb send for Blade Runner toms
               rhyGain.connect(rhyVerbSend);
               rhyVerbSend.connect(reverbNode.input);
          }
          nodes.rhythm = { gain: rhyGain };
      }

      audioNodesRef.current = nodes;
      const now = ctx.currentTime;
      nextMelodyTimeRef.current = now + 2; 
      nextArpTimeRef.current = now + 0.5;
      nextRhythmTimeRef.current = now + 0.1;

  }, []); // No dependencies needed for initAudio

  const playGenerativeNote = useCallback((time: number) => {
      const ctx = audioContextRef.current;
      const nodes = audioNodesRef.current;
      const cfg = soundConfigRef.current;
      if (!ctx || !nodes || !cfg.melody.enabled) return;

      const scale = SCALES[cfg.melody.scale];
      const noteIndex = Math.floor(Math.random() * scale.length);
      const octaveOffset = Math.random() > 0.7 ? 12 : 0;
      const freq = mtof(scale[noteIndex] + octaveOffset);

      const duration = 3.0 + Math.random() * 5.0; 
      const attack = duration * 0.4;
      const release = 6.0;

      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;

      const subOsc = ctx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.value = freq / 2;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2.0;
      filter.frequency.setValueAtTime(200, time);
      filter.frequency.exponentialRampToValueAtTime(2500, time + attack);
      filter.frequency.exponentialRampToValueAtTime(150, time + duration + release);

      const vca = ctx.createGain();
      vca.gain.setValueAtTime(0, time);
      vca.gain.linearRampToValueAtTime(cfg.melody.gain * (0.7 + Math.random() * 0.3), time + attack);
      vca.gain.setValueAtTime(cfg.melody.gain * 0.6, time + duration);
      vca.gain.exponentialRampToValueAtTime(0.001, time + duration + release);

      osc.connect(filter);
      subOsc.connect(filter);
      filter.connect(vca);
      vca.connect(nodes.masterGain);
      if (nodes.reverb) vca.connect(nodes.reverb.input);

      osc.start(time); subOsc.start(time);
      osc.stop(time + duration + release + 1); subOsc.stop(time + duration + release + 1);

      setTimeout(() => { osc.disconnect(); subOsc.disconnect(); filter.disconnect(); vca.disconnect(); }, (duration + release + 2) * 1000);
  }, []);

  const playArpNote = useCallback((time: number) => {
      const ctx = audioContextRef.current;
      const nodes = audioNodesRef.current;
      const cfg = soundConfigRef.current;
      if (!ctx || !nodes || !nodes.arp || !cfg.arp.enabled) return;

      const scale = SCALES[cfg.melody.scale];
      const currentOctaves = Math.max(1, Math.round(liveAudioStateRef.current.arpOctaves));
      const totalNotes = scale.length * currentOctaves;
      
      // Determine direction: check modulation first, fallback to config
      let direction = cfg.arp.direction ?? 'updown';
      const dirMod = audioTargetAccumulatorsRef.current['arp.direction'];
      // If significantly modulated positive, go UP. Negative, go DOWN.
      if (dirMod > 0.3) direction = 'up';
      else if (dirMod < -0.3) direction = 'down';

      // Update index based on direction
      if (direction === 'up') {
          arpNoteIndexRef.current = (arpNoteIndexRef.current + 1) % totalNotes;
      } else if (direction === 'down') {
          arpNoteIndexRef.current = (arpNoteIndexRef.current - 1 + totalNotes) % totalNotes;
      } else if (direction === 'random') {
          arpNoteIndexRef.current = Math.floor(Math.random() * totalNotes);
      } else if (direction === 'updown') {
          arpNoteIndexRef.current += arpInternalDirectionRef.current;
          if (arpNoteIndexRef.current >= totalNotes - 1) {
              arpNoteIndexRef.current = totalNotes - 1;
              arpInternalDirectionRef.current = -1;
          } else if (arpNoteIndexRef.current <= 0) {
              arpNoteIndexRef.current = 0;
              arpInternalDirectionRef.current = 1;
          }
      }

      // Clamp index in case octaves reduced while index was high
      arpNoteIndexRef.current = Math.max(0, Math.min(totalNotes - 1, arpNoteIndexRef.current));

      const scaleIndex = arpNoteIndexRef.current % scale.length;
      const octave = Math.floor(arpNoteIndexRef.current / scale.length);
      const freq = mtof(scale[scaleIndex] + (octave + 1) * 12);

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(0.8, time + 0.01);
      env.gain.exponentialRampToValueAtTime(0.05, time + 0.3);

      osc.connect(nodes.arp.filter);
      osc.disconnect();
      osc.connect(env);
      env.connect(nodes.arp.filter);

      osc.start(time);
      osc.stop(time + 0.4);
      setTimeout(() => { osc.disconnect(); env.disconnect(); }, 500);
  }, []);

  const playRhythm = useCallback((time: number) => {
      const ctx = audioContextRef.current;
      const nodes = audioNodesRef.current;
      const cfg = soundConfigRef.current;
      if (!ctx || !nodes || !nodes.rhythm || !cfg.rhythm.enabled) return;

      // Synthesized Tom for Blade Runner feel
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      // Pitch sweep downwards
      osc.frequency.setValueAtTime(120, time);
      osc.frequency.exponentialRampToValueAtTime(30, time + 0.2);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(1.0, time + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);

      // Optional click for attack
      const clickOsc = ctx.createOscillator();
      clickOsc.type = 'square';
      clickOsc.frequency.value = 2000;
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(0.1, time);
      clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.01);

      osc.connect(gain);
      clickOsc.connect(clickGain);
      clickGain.connect(gain);

      gain.connect(nodes.rhythm.gain);

      osc.start(time); clickOsc.start(time);
      osc.stop(time + 0.5); clickOsc.stop(time + 0.5);
      setTimeout(() => { osc.disconnect(); clickOsc.disconnect(); clickGain.disconnect(); gain.disconnect(); }, 600);
  }, []);

  const playCollisionSound = useCallback(() => {
      const ctx = audioContextRef.current;
      const nodes = audioNodesRef.current;
      const cfg = soundConfigRef.current;
      if (!ctx || !nodes || !cfg.enabled) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.2);
      
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.8 * cfg.masterVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      
      osc.connect(gain);
      gain.connect(nodes.masterGain);
      
      osc.start(now);
      osc.stop(now + 0.4);
      setTimeout(() => { osc.disconnect(); gain.disconnect(); }, 500);
  }, []);

  const playExplosionSound = useCallback(() => {
    const ctx = audioContextRef.current;
    const nodes = audioNodesRef.current;
    if (!ctx || !nodes || !nodes.masterGain) return;

    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 1.5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-3 * i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + 1.0);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 1.0);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(nodes.masterGain);
    noise.start(now);
  }, []);

  const playLaserSound = useCallback((weaponType: WeaponType = 'blaster') => {
    const ctx = audioContextRef.current;
    const nodes = audioNodesRef.current;
    if (!ctx || !nodes || !nodes.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    if (weaponType === 'laser') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(2000, now);
        osc.frequency.exponentialRampToValueAtTime(500, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.12);
    } else if (weaponType === 'plasma') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.linearRampToValueAtTime(50, now + 0.4);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.45);
    } else if (weaponType === 'railgun') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(50, now);
        osc.frequency.exponentialRampToValueAtTime(10, now + 0.5);
        gain.gain.setValueAtTime(1.0, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        osc.start(now);
        osc.stop(now + 0.8);
    } else {
        // Blaster / Shotgun
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.2);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.25);
    }

    osc.connect(gain);
    gain.connect(nodes.masterGain);
  }, []);


  const applySessionState = useCallback((sessionState: SessionState) => {
    cleanupAudio();
    const loadedSessionId = sessionState.sessionId ?? 'local-file';
    const loadedShader = sessionState.shaderCode ?? '';
    const loadedSliders = (sessionState.sliders ?? []).filter(slider => slider.variableName !== 'slider_cameraXRotation');
    const loadedUniforms = sessionState.uniforms ?? {};
    const loadedCameraControls = sessionState.cameraControlsEnabled ?? false;
    const loadedTerraformConfig = sessionState.terraformConfig ?? { targets: [] };
    const loadedControlConfig = sessionState.controlConfig ?? {};
    const loadedSource = sessionState.source ?? null;
    const loadedSoundConfig = sessionState.soundConfig;
    const mergedSoundConfig: SoundConfig = {
        ...defaultSoundConfig,
        ...loadedSoundConfig,
        reverb: { ...defaultSoundConfig.reverb, ...(loadedSoundConfig?.reverb || {}) },
        drone: { ...defaultSoundConfig.drone, ...(loadedSoundConfig?.drone || {}) },
        atmosphere: { ...defaultSoundConfig.atmosphere, ...(loadedSoundConfig?.atmosphere || {}) },
        melody: { ...defaultSoundConfig.melody, ...(loadedSoundConfig?.melody || {}) },
        arp: { ...defaultSoundConfig.arp, ...(loadedSoundConfig?.arp || {}) },
        rhythm: { ...defaultSoundConfig.rhythm, ...(loadedSoundConfig?.rhythm || {}) },
        modulations: loadedSoundConfig?.modulations || defaultSoundConfig.modulations,
    };

    const defaultShipConfig: ShipConfig = {
        complexity: 6,
        fold1: 0.75,
        fold2: 0.85,
        fold3: 0.15,
        scale: 1.65,
        stretch: 1.2,
        taper: 0.0,
        twist: 0.0,
        asymmetryX: 0.0,
        asymmetryY: 0.0,
        asymmetryZ: 0.0,
        twistAsymX: 0.0,
        scaleAsymX: 0.0,
        fold1AsymX: 0.0,
        fold2AsymX: 0.0,
        chaseDistance: 6.5,
        chaseVerticalOffset: 0.0,
        pitchOffset: 0.0,
        generalScale: 1.0,
        translucency: 1.0,
        modulations: []
    };
    const loadedShipConfig = { ...defaultShipConfig, ...(sessionState.shipConfig ?? {})};


    setCurrentSessionId(loadedSessionId);
    setActiveShaderCode(loadedShader);
    setSliders(loadedSliders);
    setCameraControlsEnabled(loadedCameraControls);
    setTerraformConfig(loadedTerraformConfig);
    setControlConfig(loadedControlConfig);
    setSessionSource(loadedSource);
    setSoundConfig(mergedSoundConfig);
    setUniforms(loadedUniforms);
    setShipConfig(loadedShipConfig);
    
    // Load new settings, defaulting if not present in old save files
    setCanvasSize(sessionState.canvasSize ?? defaultCanvasSize);
    setViewMode(sessionState.viewMode ?? 'chase');
    setIsHdEnabled(sessionState.isHdEnabled ?? false);
    setIsFpsEnabled(sessionState.isFpsEnabled ?? false);
    setIsHudEnabled(sessionState.isHudEnabled ?? true);
    setCollisionThresholdRed(sessionState.collisionThresholdRed ?? 0.002);
    setCollisionThresholdYellow(sessionState.collisionThresholdYellow ?? 0.02);

    defaultUniformsRef.current = { ...loadedUniforms };
    
    // Reset performance refs
    cameraRollRef.current = 0;
    
    cameraRef.current = { position: [...INITIAL_CAMERA_POS], rotation: [...INITIAL_CAMERA_ROT], roll: 0 };
    renderCameraRef.current = { position: [...INITIAL_CAMERA_POS], rotation: [...INITIAL_CAMERA_ROT], roll: 0 };

    setCollisionState('none');
    collisionStateRef.current = 'none';
    setCollisionProximity(0);
    collisionProximityRef.current = 0;
    previousSpeedRef.current = 0;
    
    // Reset Combat
    enemiesRef.current = [];
    projectilesRef.current = [];
    setIsGameOver(false);
    
    // Reset Player Stats - ensure all upgrades are present even if loading old save
    setPlayerStats({
        credits: 0,
        currentHp: 100,
        maxHp: 100,
        unlockedWeapons: ['blaster'],
        currentWeapon: 'blaster',
        upgrades: {
            hullLevel: 1,
            damageLevel: 1,
            fireRateLevel: 1,
            speedLevel: 1,
            homingLevel: 1,
            critChanceLevel: 1,
            critDamageLevel: 1,
            pierceLevel: 1,
            multishotLevel: 1,
            lifetimeLevel: 1,
            knockbackLevel: 1,
            stunLevel: 1,
            creditMultLevel: 1,
            eliteDmgLevel: 1,
            executeLevel: 1,
            blastRadiusLevel: 1,
            freezeLevel: 1,
            ricochetLevel: 1,
            scavengerLevel: 1,
            discountLevel: 1,
            overclockLevel: 1
        }
    });

  }, [cleanupAudio, setViewMode]);

  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`./sessions/shader-session-${sessionId}.json`);
      if (!response.ok) throw new Error(`Session file not found: ${sessionId}`);
      const sessionState: SessionState = await response.json();
      applySessionState(sessionState);
      
      const hashParams = parseHash();
      // Override canvas size from hash if present, otherwise keep what applySessionState set
      if (hashParams.canvasSize) setCanvasSize(hashParams.canvasSize);

      const initialUniforms = { ...(sessionState.uniforms ?? {}) };
      (sessionState.sliders ?? []).forEach(slider => {
        if (hashParams[slider.variableName]) {
          const val = parseFloat(hashParams[slider.variableName]);
          if (!isNaN(val)) initialUniforms[slider.variableName] = Math.max(slider.min, Math.min(slider.max, val));
        }
      });
      setUniforms(initialUniforms);
    } catch (err) {
      console.error(`Failed to load session ${sessionId}:`, err);
      if (sessionId !== '1') window.location.hash = '#planet=1';
    }
  }, [applySessionState]);

  useEffect(() => {
    const hashParams = parseHash();
    loadSession(hashParams.planet || '1');
    return () => cleanupAudio();
  }, [loadSession, cleanupAudio]);
  
  const handleUniformsCommit = useCallback(() => {}, []);

  useEffect(() => {
    const handleHashChange = () => {
        const hashParams = parseHash();
        const newSessionId = hashParams.planet || '1';
        if (newSessionId !== currentSessionId) {
            loadSession(newSessionId);
            return;
        }
        setCanvasSize(hashParams.canvasSize || defaultCanvasSize);
        setUniforms(prev => {
            const next = { ...prev };
            let changed = false;
            sliders.forEach(slider => {
                const def = defaultUniformsRef.current[slider.variableName] ?? slider.defaultValue;
                let val = def;
                if (hashParams[slider.variableName]) {
                    const parsed = parseFloat(hashParams[slider.variableName]);
                    if (!isNaN(val)) val = parsed;
                }
                val = Math.max(slider.min, Math.min(slider.max, val));
                if (next[slider.variableName] !== val) {
                    next[slider.variableName] = val;
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [sliders, currentSessionId, loadSession]);

  const pressKey = useCallback((key: string) => {
    // Check explicitly against the ref to avoid stale closure issues
    if (currentSessionIdRef.current === '1' && !audioContextRef.current && soundConfigRef.current.enabled) {
        initAudio();
        audioContextRef.current?.resume();
    }
    const lowerKey = key.toLowerCase();
    keysPressed.current.add(lowerKey);
    setPressedKeys(prev => new Set(prev).add(lowerKey));
  }, [initAudio]);

  const releaseKey = useCallback((key: string) => {
    const lowerKey = key.toLowerCase();
    keysPressed.current.delete(lowerKey);
    setPressedKeys(prev => {
      const next = new Set(prev);
      next.delete(lowerKey);
      return next;
    });
  }, []);

  const handleTerraformPress = useCallback(() => {
    isTerraformingHeld.current = true;
    const config = terraformConfigRef.current;
    if (!config) return;
    config.targets.forEach(target => {
        if (target.probability !== undefined && Math.random() > target.probability) return;
        const key = target.variableName;
        if (terraform_currentVelocity.current[key] === undefined) terraform_currentVelocity.current[key] = 0;
        if (target.type === 'velocity') terraform_targetVelocity.current[key] = (Math.random() - 0.5) * target.magnitude;
    });
  }, []);

  const handleTerraformRelease = useCallback(() => {
    isTerraformingHeld.current = false;
    Object.keys(terraform_targetVelocity.current).forEach(key => terraform_targetVelocity.current[key] = 0);
  }, []);

  const handleTerraformConfigChange = useCallback((variableName: string, property: keyof TerraformTarget | 'enabled', value: number | boolean) => {
    setTerraformConfig(prev => {
        const targets = prev?.targets ?? [];
        const idx = targets.findIndex(t => t.variableName === variableName);
        if (property === 'enabled') {
            if (value === true && idx === -1) return { targets: [...targets, { variableName, type: 'velocity', magnitude: 0.01, probability: 1.0 }] };
            if (value === false && idx !== -1) return { targets: targets.filter(t => t.variableName !== variableName) };
            return prev;
        } else if (idx !== -1) {
            const newTargets = [...targets];
            newTargets[idx] = { ...newTargets[idx], [property]: value };
            return { targets: newTargets };
        }
        return prev;
    });
  }, []);
  
  const handleControlConfigChange = useCallback((key: keyof ControlConfig, value: boolean | number) => {
    setControlConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSessionSelect = useCallback((sessionId: string) => {
    const hash = parseHash();
    hash['planet'] = sessionId;
    window.location.hash = stringifyHash(hash);
  }, []);
  
  const handleSourceChange = useCallback((source: string) => setSessionSource(source), []);

  const handleSoundConfigChange = useCallback((key: string, value: any) => {
    if (key === 'enabled' && value === true) setTimeout(initAudio, 0);
    setSoundConfig(prev => {
        const path = key.split('.');
        const newConfig = JSON.parse(JSON.stringify(prev));
        let current = newConfig;
        for (let i = 0; i < path.length - 1; i++) current = current[path[i]];
        current[path[path.length - 1]] = value;
        return newConfig;
    });
    
    if (audioNodesRef.current && audioContextRef.current) {
        const now = audioContextRef.current.currentTime;
        const nodes = audioNodesRef.current;
        // Immediate volume cuts when disabling
        if (key === 'masterVolume') nodes.masterGain.gain.setTargetAtTime(value, now, 0.1);
        if (key === 'reverb.enabled' && nodes.reverb) nodes.reverb.output.gain.setTargetAtTime(value ? soundConfigRef.current.reverb.mix : 0, now, 0.1);
        if (key === 'reverb.mix' && nodes.reverb && soundConfigRef.current.reverb.enabled) nodes.reverb.output.gain.setTargetAtTime(value, now, 0.1);
        if (key === 'drone.enabled' && nodes.drone) nodes.drone.gain.gain.setTargetAtTime(value ? soundConfigRef.current.drone.gain : 0, now, 0.1);
        if (key === 'drone.gain' && nodes.drone && soundConfigRef.current.drone.enabled) nodes.drone.gain.gain.setTargetAtTime(value, now, 0.1);
        if (key === 'atmosphere.enabled' && nodes.atmosphere) nodes.atmosphere.gain.gain.setTargetAtTime(value ? soundConfigRef.current.atmosphere.gain : 0, now, 0.5);
        if (key === 'atmosphere.gain' && nodes.atmosphere && soundConfigRef.current.atmosphere.enabled) nodes.atmosphere.gain.gain.setTargetAtTime(value, now, 0.5);
        if (key === 'arp.enabled' && nodes.arp) nodes.arp.gain.gain.setTargetAtTime(value ? soundConfigRef.current.arp.gain : 0, now, 0.1);
        if (key === 'arp.gain' && nodes.arp && soundConfigRef.current.arp.enabled) nodes.arp.gain.gain.setTargetAtTime(value, now, 0.1);
        if (key === 'rhythm.enabled' && nodes.rhythm) nodes.rhythm.gain.gain.setTargetAtTime(value ? soundConfigRef.current.rhythm.gain : 0, now, 0.1);
        if (key === 'rhythm.gain' && nodes.rhythm && soundConfigRef.current.rhythm.enabled) nodes.rhythm.gain.gain.setTargetAtTime(value, now, 0.1);
    }
  }, [initAudio]);

  const addSoundModulation = useCallback((Modulation: Modulation) => {
       setSoundConfig(prev => ({
           ...prev,
           modulations: [...(prev.modulations || []), { ...Modulation, id: uuidv4(), enabled: true }]
       }));
  }, []);

  const updateSoundModulation = useCallback((id: string, newConfig: Partial<Modulation>) => {
      setSoundConfig(prev => ({
          ...prev,
          modulations: (prev.modulations || []).map(mod => mod.id === id ? { ...mod, ...newConfig } : mod)
      }));
  }, []);

  const removeSoundModulation = useCallback((id: string) => {
      setSoundConfig(prev => ({
          ...prev,
          modulations: (prev.modulations || []).filter(mod => mod.id !== id)
      }));
  }, []);

  const getSessionState = useCallback((): SessionState => {
      return {
          sessionId: currentSessionId,
          shaderCode: activeShaderCode,
          sliders,
          uniforms,
          cameraControlsEnabled,
          terraformConfig,
          controlConfig,
          soundConfig,
          source: sessionSource ?? undefined,
          shipConfig,
          canvasSize,
          viewMode,
          isHdEnabled,
          isFpsEnabled,
          isHudEnabled,
          collisionThresholdRed,
          collisionThresholdYellow
      };
  }, [currentSessionId, activeShaderCode, sliders, uniforms, cameraControlsEnabled, terraformConfig, controlConfig, soundConfig, sessionSource, shipConfig, canvasSize, viewMode, isHdEnabled, isFpsEnabled, isHudEnabled, collisionThresholdRed, collisionThresholdYellow]);

  const handleSaveSessionToFile = useCallback(() => {
    const data = getSessionState();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini-shader-pilot-session.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [getSessionState]);

  // Expose a standardized JSON stringifier for the UI to use
  const getSessionStateJson = useCallback(() => JSON.stringify(getSessionState(), null, 2), [getSessionState]);

  const handleLoadSessionFromFile = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        applySessionState(JSON.parse(ev.target?.result as string));
        if(e.target) e.target.value = '';
      } catch (err) { console.error("Failed to parse session file:", err); }
    };
    reader.readAsText(file);
  }, [applySessionState]);

  const handleShipConfigChange = useCallback((key: keyof ShipConfig, value: number) => {
      setShipConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  const addShipModulation = useCallback((Modulation: ShipModulation) => {
        setShipConfig(prev => ({
            ...prev,
            modulations: [...(prev.modulations || []), { ...Modulation, id: uuidv4(), enabled: true }]
        }));
   }, []);
 
   const updateShipModulation = useCallback((id: string, newConfig: Partial<ShipModulation>) => {
       setShipConfig(prev => ({
           ...prev,
           modulations: (prev.modulations || []).map(mod => mod.id === id ? { ...mod, ...newConfig } : mod)
       }));
   }, []);
 
   const removeShipModulation = useCallback((id: string) => {
       setShipConfig(prev => ({
           ...prev,
           modulations: (prev.modulations || []).filter(mod => mod.id !== id)
       }));
   }, []);

  useEffect(() => {
    if (currentSessionId !== '1' || !soundConfig.enabled) cleanupAudio();
  }, [soundConfig.enabled, currentSessionId, cleanupAudio]);

  useEffect(() => {
    collisionThresholdRedRef.current = collisionThresholdRed;
    collisionThresholdYellowRef.current = collisionThresholdYellow;
  }, [collisionThresholdRed, collisionThresholdYellow]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
        // Prevent game controls when typing in input fields
        if ((e.target as HTMLElement).matches('input, textarea, select')) return;
        pressKey(e.key);
    };
    const up = (e: KeyboardEvent) => {
        if ((e.target as HTMLElement).matches('input, textarea, select')) return;
        releaseKey(e.key);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [pressKey, releaseKey]);

  // MAIN GAME LOOP - Now with pre-allocated objects to reduce GC pressure
  useEffect(() => {
    let frameId: number;
    let lastTime = 0;

    const gameLoop = (timestamp: number) => {
        // Pause Game Loop when Controls/Menu is open OR Game Over
        if (isControlsOpenRef.current || isGameOverRef.current) {
            lastTime = timestamp; // Keep lastTime current so delta doesn't jump on resume
            frameId = requestAnimationFrame(gameLoop);
            return;
        }

        if (lastTime === 0) lastTime = timestamp;
        const dt = Math.min((timestamp - lastTime) / 1000.0, 0.1);
        lastTime = timestamp;
        accumulatedTimeRef.current += dt;
        const currentTime = accumulatedTimeRef.current;

        // Read latest configs from Refs
        const controls = controlConfigRef.current;
        const sound = soundConfigRef.current;
        const ship = shipConfigRef.current;
        const currentUniforms = uniformsRef.current;
        const sessionId = currentSessionIdRef.current;
        const pStats = playerStatsRef.current;

        // Update Stats Refs for rendering components
        const updatePlayerStats = (updater: (stats: PlayerStats) => PlayerStats) => {
            setPlayerStats(updater);
        }

        // --- Physics & Camera ---
        const keys = keysPressed.current;
        let fwd = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
        if (controls.invertForward) fwd = -fwd;
        let str = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
        if (controls.invertStrafe) str = -str;
        let asc = (keys.has(' ') ? 1 : 0) - (keys.has('shift') ? 1 : 0);
        if (controls.invertAscend) asc = -asc;
        
        let pitchInput = (keys.has('arrowdown') ? 1 : 0) - (keys.has('arrowup') ? 1 : 0);
        if (controls.invertPitch) pitchInput = -pitchInput;
        let yawInput = (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0);
        if (controls.invertYaw) yawInput = -yawInput;

        const [p, y] = cameraRef.current.rotation;
        const currentPos = cameraRef.current.position;
        const spd = 1.0;
        const rotSpd = 1.0;

        // Flight Pitch Offset: Allows flying level while looking slightly down (nose-down attitude)
        // This sets the "neutral" joystick position to be slightly pitched down relative to the camera view
        const FLIGHT_PITCH_OFFSET = 0.1;

        const dirX = Math.sin(y) * Math.cos(p - FLIGHT_PITCH_OFFSET);
        const dirY = -Math.sin(p - FLIGHT_PITCH_OFFSET);
        const dirZ = Math.cos(y) * Math.cos(p - FLIGHT_PITCH_OFFSET);
        const rightX = Math.cos(y);
        const rightZ = -Math.sin(y);

        const tVX = (dirX * fwd * (controls.forwardVelocity??1) + rightX * str * (controls.strafeVelocity??1)) * spd;
        const tVY = (dirY * fwd * (controls.forwardVelocity??1) + asc * (controls.ascendVelocity??1)) * spd;
        const tVZ = (dirZ * fwd * (controls.forwardVelocity??1) + rightZ * str * (controls.strafeVelocity??1)) * spd;

        cameraVelocityRef.current[0] += (tVX - cameraVelocityRef.current[0]) * 0.1;
        cameraVelocityRef.current[1] += (tVY - cameraVelocityRef.current[1]) * 0.1;
        cameraVelocityRef.current[2] += (tVZ - cameraVelocityRef.current[2]) * 0.1;
        
        // OPTIMIZATION: Reuse temp array for proposed position instead of creating new one
        const proposedPos = tempProposedPosRef.current;
        proposedPos[0] = currentPos[0] + cameraVelocityRef.current[0] * dt;
        proposedPos[1] = currentPos[1] + cameraVelocityRef.current[1] * dt;
        proposedPos[2] = currentPos[2] + cameraVelocityRef.current[2] * dt;

        // Collision (Planet 1 only)
        let newState: 'none' | 'approaching' | 'colliding' = 'none';
        let newProximity = 0;
        
        // Spawn Protection Check
        const isProtected = accumulatedTimeRef.current < spawnProtectionRef.current;

        if (sessionId === '1' && !isProtected) {
             const dist = getPlanet1Distance(proposedPos, currentUniforms, accumulatedTimeRef.current);
             if (dist < collisionThresholdRedRef.current) {
                 newState = 'colliding';
                 newProximity = 1.0;
                 
                 // WALL DAMAGE LOGIC
                 // If colliding, take damage rapidly
                 // Damage scales with speed, minimum 20 DPS
                 const crashDmg = 50.0 * dt; 
                 updatePlayerStats(prev => ({ ...prev, currentHp: prev.currentHp - crashDmg }));
                 
                 // Stop movement on collision
                 cameraVelocityRef.current[0] = 0; cameraVelocityRef.current[1] = 0; cameraVelocityRef.current[2] = 0; 
                 if (collisionStateRef.current !== 'colliding' && timestamp - collisionCooldownRef.current > 500) {
                     collisionCooldownRef.current = timestamp;
                     if (sound.enabled && audioContextRef.current && audioNodesRef.current) {
                         audioGeneratorsRef.current.playCollisionSound();
                     }
                 }
             } else if (dist < collisionThresholdYellowRef.current) {
                 newState = 'approaching';
                 newProximity = 1.0 - (dist - collisionThresholdRedRef.current) / (collisionThresholdYellowRef.current - collisionThresholdRedRef.current);
                 newProximity = Math.max(0, Math.min(1, newProximity));
             }
        }
        
        if (newState !== 'colliding') {
            // OPTIMIZATION: Mutate camera position in place
            cameraRef.current.position[0] = proposedPos[0];
            cameraRef.current.position[1] = proposedPos[1];
            cameraRef.current.position[2] = proposedPos[2];
        }
        
        if (collisionStateRef.current !== newState) {
            collisionStateRef.current = newState;
            setCollisionState(newState);
        }
        if (Math.abs(newProximity - collisionProximityRef.current) > 0.02 || newProximity === 0 || newProximity === 1.0) {
            collisionProximityRef.current = newProximity;
            setCollisionProximity(newProximity);
        }

        // Rotation
        const tRotX = pitchInput * rotSpd * (controls.pitchVelocity ?? 0.3);
        const tRotY = yawInput * rotSpd * (controls.yawVelocity ?? 0.3);
        cameraAngularVelocityRef.current[0] += (tRotX - cameraAngularVelocityRef.current[0]) * 0.07;
        cameraAngularVelocityRef.current[1] += (tRotY - cameraAngularVelocityRef.current[1]) * 0.07;
        
        // OPTIMIZATION: Mutate rotation array
        cameraRef.current.rotation[0] = Math.max(-1.57, Math.min(1.57, p + cameraAngularVelocityRef.current[0] * dt));
        cameraRef.current.rotation[1] = y + cameraAngularVelocityRef.current[1] * dt;

        const v = cameraVelocityRef.current;
        const currentSpeed = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
        
        // Lower threshold for "isMoving" to avoid jarring HD snaps when slowly drifting to a stop
        const isMovingNow = currentSpeed > 0.0001;
        if (isMovingRef.current !== isMovingNow) {
            isMovingRef.current = isMovingNow;
            setIsMoving(isMovingNow);
        }

        cameraRollRef.current += (-yawInput * (controls.yawVelocity??0.3) * 0.75 * 0.4 - cameraRollRef.current) * 0.1;
        cameraRef.current.roll = cameraRollRef.current;

        // --- VIEW MODE TRANSITION & CAMERA ---
        const transitionRef = viewModeTransitionRef.current;
        const LERP_SPEED = 5.0; // Speed of the view mode fade
        if (Math.abs(transitionRef.target - transitionRef.current) > 0.001) {
            transitionRef.current += (transitionRef.target - transitionRef.current) * LERP_SPEED * dt;
            setViewModeTransition(transitionRef.current);
        } else if (transitionRef.current !== transitionRef.target) {
            transitionRef.current = transitionRef.target; // Snap to final value
            setViewModeTransition(transitionRef.current);
        }
        
        // The render camera should always be at the logical camera's position.
        // The ship is just an overlay, so we don't need to move the world's camera back.
        // This prevents the "zoom" effect when switching to chase view.
        renderCameraRef.current.position[0] = cameraRef.current.position[0];
        renderCameraRef.current.position[1] = cameraRef.current.position[1];
        renderCameraRef.current.position[2] = cameraRef.current.position[2];
        
        // Rotation and roll are shared between views and should still be copied
        renderCameraRef.current.rotation[0] = cameraRef.current.rotation[0];
        renderCameraRef.current.rotation[1] = cameraRef.current.rotation[1];
        renderCameraRef.current.roll = cameraRef.current.roll;


        // --- COMBAT SYSTEM ---
        const enemies = enemiesRef.current;
        const projectiles = projectilesRef.current;
        
        // 1. Enemy Spawning
        const activeEnemiesCount = enemies.filter(e => e.active).length;
        
        if (activeEnemiesCount < MAX_ENEMIES) {
            // Check timer instead of just random chance per frame
            if (currentTime - lastEnemySpawnTimeRef.current > nextSpawnIntervalRef.current) {
                const playerYaw = cameraRef.current.rotation[1];
                const playerPos = cameraRef.current.position;

                // Spawn in FRONT (using playerYaw directly, NO PI OFFSET)
                // Angle 0 corresponds to +Z which is Forward in this setup
                // Narrower cone to ensure they appear on screen (FOV ~60 deg)
                const angle = playerYaw + (Math.random() - 0.5) * (Math.PI / 3.5);

                // Randomize distance
                const dist = SPAWN_DIST + (Math.random() * 15 - 5);
                
                const spawnPos: [number, number, number] = [
                    playerPos[0] + Math.sin(angle) * dist,
                    playerPos[1] + (Math.random() * 6 - 3), // Tighter vertical spread
                    playerPos[2] + Math.cos(angle) * dist
                ];

                // Randomize Enemy Type
                const randType = Math.random();
                let type: EnemyType = 'fighter';
                if (randType < 0.3) type = 'scout';
                else if (randType > 0.8) type = 'tank';
                
                const stats = ENEMY_STATS[type];
                
                const newEnemy: Enemy = {
                    id: uuidv4(),
                    type,
                    position: spawnPos,
                    velocity: [0, 0, 0],
                    rotation: [0, Math.random() * Math.PI * 2, 0],
                    active: true,
                    spawnTime: currentTime,
                    hp: stats.hp,
                    maxHp: stats.hp,
                    hitFlash: 0,
                    stunned: 0,
                    frozen: 1.0,
                    frozenTimer: 0
                };
                enemies.push(newEnemy);

                // Reset timer with random interval
                lastEnemySpawnTimeRef.current = currentTime;
                // Random interval between 2 and 5 seconds
                nextSpawnIntervalRef.current = 2.0 + Math.random() * 3.0; 
            }
        }
        
        // 2. Enemy Movement & AI & PLAYER COLLISION DAMAGE
        enemies.forEach(e => {
            if (!e.active) return;
            const playerPos = cameraRef.current.position;
            const toPlayer = [
                playerPos[0] - e.position[0],
                playerPos[1] - e.position[1],
                playerPos[2] - e.position[2]
            ];
            const dist = Math.sqrt(toPlayer[0]**2 + toPlayer[1]**2 + toPlayer[2]**2);
            
            // Check Collision with Player
            // Assuming player hit radius approx 1.5 units
            if (dist < 1.5) {
                 // CRASH!
                 const damageToPlayer = 20;
                 updatePlayerStats(prev => ({ ...prev, currentHp: prev.currentHp - damageToPlayer }));
                 
                 // Kill enemy on impact
                 e.hp = 0;
                 e.active = false;
                 audioGeneratorsRef.current.playCollisionSound(); // Heavy sound
                 return;
            }

            // Handle Hit Flash
            if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 5.0);

            // Handle CC
            if (e.stunned > 0) {
                e.stunned = Math.max(0, e.stunned - dt);
                return; // Skip movement if stunned
            }
            if (e.frozenTimer > 0) {
                e.frozenTimer = Math.max(0, e.frozenTimer - dt);
                e.frozen = 0.4; // 60% slow
            } else {
                e.frozen = 1.0;
            }

            if (dist > 0.1) {
                const dir = [toPlayer[0]/dist, toPlayer[1]/dist, toPlayer[2]/dist];
                
                // Acceleration + CC Factor
                const acc = 2.0 * e.frozen;

                e.velocity[0] += dir[0] * acc * dt;
                e.velocity[1] += dir[1] * acc * dt;
                e.velocity[2] += dir[2] * acc * dt;

                // Speed Cap based on Type
                const maxSpeed = ENEMY_STATS[e.type].speed * e.frozen;
                const spd = Math.sqrt(e.velocity[0]**2 + e.velocity[1]**2 + e.velocity[2]**2);
                if (spd > maxSpeed) {
                    const ratio = maxSpeed / spd;
                    e.velocity[0] *= ratio;
                    e.velocity[1] *= ratio;
                    e.velocity[2] *= ratio;
                }

                // Update Pos
                e.position[0] += e.velocity[0] * dt;
                e.position[1] += e.velocity[1] * dt;
                e.position[2] += e.velocity[2] * dt;

                // Face Player (Simple Yaw)
                e.rotation[1] = Math.atan2(dir[0], dir[2]);
            }
        });

        // 3. Auto-Fire
        const weaponStats = WEAPON_STATS[pStats.currentWeapon];
        const fireRateMultiplier = 1.0 - (pStats.upgrades.fireRateLevel - 1) * 0.08; // 8% faster per level
        const actualFireRate = weaponStats.fireRate * fireRateMultiplier;

        if (enemies.some(e => e.active) && projectiles.filter(p => p.active).length < MAX_PROJECTILES) {
            if (currentTime - lastFireTimeRef.current > actualFireRate) {
                // Find nearest active enemy within field of view
                let nearestDist = Infinity;
                let nearestEnemy: Enemy | null = null;
                const pPos = cameraRef.current.position;
                const pRot = cameraRef.current.rotation;
                
                const camFwd = [
                    Math.sin(pRot[1]),
                    -Math.sin(pRot[0]), 
                    Math.cos(pRot[1]) 
                ];

                enemies.forEach(e => {
                    if (!e.active) return;
                    const dX = e.position[0] - pPos[0];
                    const dY = e.position[1] - pPos[1];
                    const dZ = e.position[2] - pPos[2];
                    const dist = Math.sqrt(dX*dX + dY*dY + dZ*dZ);
                    
                    if (dist < nearestDist) {
                        const dot = (camFwd[0]*dX + camFwd[1]*dY + camFwd[2]*dZ) / dist;
                        const homingAngle = 0.65 - (pStats.upgrades.homingLevel - 1) * 0.05; // Improve angle
                        if (dot > homingAngle) {
                            nearestDist = dist;
                            nearestEnemy = e;
                        }
                    }
                });

                if (nearestEnemy && nearestDist < SPAWN_DIST * 1.5) {
                    const enemy = nearestEnemy as Enemy;
                    const dX = enemy.position[0] - pPos[0];
                    const dY = enemy.position[1] - pPos[1];
                    const dZ = enemy.position[2] - pPos[2];
                    const dist = Math.sqrt(dX*dX + dY*dY + dZ*dZ);
                    const dir = [dX/dist, dY/dist, dZ/dist];
                    
                    const damageMultiplier = 1.0 + (pStats.upgrades.damageLevel - 1) * 0.15; // 15% dmg per level
                    let finalDamage = weaponStats.baseDamage * damageMultiplier;
                    
                    // Crit Calculation
                    const critChance = (pStats.upgrades.critChanceLevel - 1) * 0.05; // 5% per level
                    const isCrit = Math.random() < critChance;
                    if (isCrit) {
                        const critMult = 1.5 + (pStats.upgrades.critDamageLevel - 1) * 0.2; // Base 1.5x + 0.2x per level
                        finalDamage *= critMult;
                    }

                    const speedMultiplier = 1.0 + (pStats.upgrades.speedLevel - 1) * 0.1; // 10% speed per level
                    const finalSpeed = weaponStats.speed * speedMultiplier;

                    const pierceCount = pStats.upgrades.pierceLevel - 1;
                    const multishotChance = (pStats.upgrades.multishotLevel - 1) * 0.2; // 20% per level
                    const extraShots = Math.floor(multishotChance) + (Math.random() < (multishotChance % 1) ? 1 : 0);
                    
                    const lifetime = 3.0 * (1.0 + (pStats.upgrades.lifetimeLevel - 1) * 0.2); // +20% range
                    
                    // CC Stats
                    const knockback = (pStats.upgrades.knockbackLevel - 1) * 2.0;
                    const stunChance = (pStats.upgrades.stunLevel - 1) * 0.1;
                    const freezeChance = (pStats.upgrades.freezeLevel - 1) * 0.1;
                    const blastRadius = (pStats.upgrades.blastRadiusLevel - 1) * 1.5;
                    const ricochetCount = (pStats.upgrades.ricochetLevel - 1);

                    const spawnProjectile = (direction: number[]) => {
                        const proj: Projectile = {
                            id: uuidv4(),
                            position: [pPos[0] + direction[0]*3, pPos[1] + direction[1]*3, pPos[2] + direction[2]*3],
                            velocity: [direction[0]*finalSpeed, direction[1]*finalSpeed, direction[2]*finalSpeed],
                            active: true,
                            spawnTime: currentTime,
                            weaponType: pStats.currentWeapon,
                            damage: finalDamage,
                            color: isCrit ? [1.0, 1.0, 1.0] : weaponStats.color, // Flash white on crit spawn
                            scale: weaponStats.scale * (isCrit ? 1.5 : 1.0),
                            lifetime,
                            pierce: pierceCount,
                            isCrit,
                            knockback,
                            stun: stunChance,
                            freeze: freezeChance,
                            blast: blastRadius,
                            ricochet: ricochetCount,
                            hitList: []
                        };
                        projectiles.push(proj);
                    };

                    spawnProjectile(dir);
                    
                    // Multishot logic
                    if (extraShots > 0) {
                        const spread = 0.1; // 0.1 rad spread
                        const rotY = (v: number[], angle: number) => [v[0]*Math.cos(angle) + v[2]*Math.sin(angle), v[1], -v[0]*Math.sin(angle) + v[2]*Math.cos(angle)];
                        for(let i=1; i<=extraShots; i++) {
                             const angle = (i % 2 === 0 ? 1 : -1) * Math.ceil(i/2) * spread;
                             spawnProjectile(rotY(dir, angle));
                        }
                    }

                    if (pStats.currentWeapon === 'shotgun') {
                        // Shotgun Spread (always active)
                        const spreadAngle = 0.15;
                        const rotY = (v: number[], angle: number) => [v[0]*Math.cos(angle) + v[2]*Math.sin(angle), v[1], -v[0]*Math.sin(angle) + v[2]*Math.cos(angle)];
                        spawnProjectile(rotY(dir, spreadAngle));
                        spawnProjectile(rotY(dir, -spreadAngle));
                    }

                    lastFireTimeRef.current = currentTime;
                    audioGeneratorsRef.current.playLaserSound(pStats.currentWeapon);
                }
            }
        }

        // 4. Projectile Movement & Collision
        projectiles.forEach(p => {
            if (!p.active) return;
            
            p.position[0] += p.velocity[0] * dt;
            p.position[1] += p.velocity[1] * dt;
            p.position[2] += p.velocity[2] * dt;

            // Check collision with enemies
            enemies.forEach(e => {
                if (!e.active || p.hitList.includes(e.id)) return;
                
                const dX = p.position[0] - e.position[0];
                const dY = p.position[1] - e.position[1];
                const dZ = p.position[2] - e.position[2];
                const distSq = dX*dX + dY*dY + dZ*dZ;
                
                const hitRadius = (p.scale * 1.5) + (ENEMY_STATS[e.type].scale * 2.0);
                if (distSq < hitRadius*hitRadius) { 
                    
                    // Apply Damage logic
                    const applyDamage = (enemy: Enemy, dmg: number) => {
                        // Elite Killer Bonus
                        let actualDmg = dmg;
                        if (enemy.type === 'tank') {
                             actualDmg *= 1.0 + (pStats.upgrades.eliteDmgLevel - 1) * 0.2;
                        }
                        // Execution Logic
                        const hpPct = enemy.hp / enemy.maxHp;
                        const executeThreshold = (pStats.upgrades.executeLevel - 1) * 0.05; // 5% per level, max 20%
                        if (hpPct < executeThreshold) {
                            actualDmg = enemy.hp + 1; // Instant Kill
                        }
                        
                        enemy.hp -= actualDmg;
                        enemy.hitFlash = 1.0;

                        // CC
                        if (Math.random() < p.stun) enemy.stunned = 1.0; // 1s stun
                        if (Math.random() < p.freeze) enemy.frozenTimer = 3.0; // 3s freeze
                        if (p.knockback > 0) {
                            const kDir = [p.velocity[0], p.velocity[1], p.velocity[2]];
                            const mag = Math.sqrt(kDir[0]**2+kDir[1]**2+kDir[2]**2);
                            if(mag > 0.01) {
                                enemy.velocity[0] += (kDir[0]/mag) * p.knockback;
                                enemy.velocity[1] += (kDir[1]/mag) * p.knockback;
                                enemy.velocity[2] += (kDir[2]/mag) * p.knockback;
                            }
                        }

                        if (enemy.hp <= 0 && enemy.active) {
                            enemy.active = false;
                            
                            let creditReward = ENEMY_STATS[enemy.type].reward;
                            // Economy Upgrades
                            creditReward *= 1.0 + (pStats.upgrades.creditMultLevel - 1) * 0.1;
                            
                            // Scavenger (Double Loot)
                            const doubleChance = (pStats.upgrades.scavengerLevel - 1) * 0.1;
                            if (Math.random() < doubleChance) creditReward *= 2;

                            setPlayerStats(stats => ({
                                 ...stats,
                                 credits: Math.floor(stats.credits + creditReward)
                            }));
                            audioGeneratorsRef.current.playExplosionSound();
                        }
                    };

                    applyDamage(e, p.damage);
                    p.hitList.push(e.id);

                    // Blast Radius
                    if (p.blast > 0) {
                        enemies.forEach(other => {
                             if(other.id === e.id || !other.active) return;
                             const bX = other.position[0] - e.position[0];
                             const bY = other.position[1] - e.position[1];
                             const bZ = other.position[2] - e.position[2];
                             const bDist = Math.sqrt(bX*bX + bY*bY + bZ*bZ);
                             if (bDist < p.blast) {
                                 applyDamage(other, p.damage * 0.5); // 50% splash damage
                             }
                        });
                    }

                    // Handle Pierce / Ricochet / Death
                    if (p.ricochet > 0) {
                        p.ricochet--;
                        // Find next target
                        let nextTarget = null;
                        let minD = Infinity;
                        enemies.forEach(candidate => {
                            if(!candidate.active || p.hitList.includes(candidate.id)) return;
                            const tX = candidate.position[0] - e.position[0];
                            const tY = candidate.position[1] - e.position[1];
                            const tZ = candidate.position[2] - e.position[2];
                            const tD = Math.sqrt(tX*tX+tY*tY+tZ*tZ);
                            if (tD < 20.0 && tD < minD) { // Max bounce range 20
                                minD = tD;
                                nextTarget = candidate;
                            }
                        });
                        
                        if (nextTarget) {
                            const tX = nextTarget.position[0] - e.position[0];
                            const tY = nextTarget.position[1] - e.position[1];
                            const tZ = nextTarget.position[2] - e.position[2];
                            const d = Math.sqrt(tX*tX+tY*tY+tZ*tZ);
                            const spd = Math.sqrt(p.velocity[0]**2+p.velocity[1]**2+p.velocity[2]**2);
                            p.velocity = [(tX/d)*spd, (tY/d)*spd, (tZ/d)*spd];
                            p.position = [...e.position]; // Start from hit position
                        } else {
                            // No bounce target, check pierce or die
                             if (p.pierce > 0) {
                                p.pierce--;
                            } else {
                                p.active = false;
                            }
                        }

                    } else if (p.pierce > 0) {
                        p.pierce--;
                        // Continue flying
                    } else {
                        p.active = false; 
                    }
                }
            });

            // Cleanup old projectiles
            if (currentTime - p.spawnTime > p.lifetime) p.active = false;
        });

        // 5. Cleanup Inactive
        if (enemies.length > 0) enemiesRef.current = enemies.filter(e => e.active);
        if (projectiles.length > 0) projectilesRef.current = projectiles.filter(p => p.active);

        // 6. Game Over Check
        if (pStats.currentHp <= 0 && !isGameOverRef.current) {
            setIsGameOver(true);
            isGameOverRef.current = true; // Stop loop immediately
            return;
        }

        // --- SHARED PHYSICS INPUTS FOR AUDIO & SHIP ---
        const now = timestamp / 1000.0;
        const acceleration = (currentSpeed - previousSpeedRef.current) / dt;
        previousSpeedRef.current = currentSpeed;

        // OPTIMIZATION: Reuse pre-allocated inputs object to avoid GC
        const inputs = audioInputsRef.current;
        inputs.speed = currentSpeed;
        inputs.acceleration = acceleration * 0.1;
        inputs.altitude = cameraRef.current.position[1] - INITIAL_CAMERA_POS[1];
        inputs.descent = -v[1] * 2.0;
        inputs.turning = Math.abs(cameraAngularVelocityRef.current[1]);
        inputs.turningSigned = cameraAngularVelocityRef.current[1]; // Raw signed velocity for Left/Right distinction
        inputs.heading = (cameraRef.current.rotation[1] % (Math.PI * 2)) / (Math.PI * 2);
        // Pitch normalized: looking UP is positive, DOWN is negative (our rotation[0] is + for down, so invert)
        inputs.pitch = -cameraRef.current.rotation[0] / 1.57; 
        inputs.proximity = collisionProximityRef.current;
        inputs.time = now;


        // --- Audio Update & Scheduling Loop ---
        if (sessionId === '1' && audioContextRef.current && audioNodesRef.current && sound.enabled) {
             // OPTIMIZATION: Reuse pre-allocated accumulators object
             const modulations = sound.modulations || [];
             const targetAccumulators = audioTargetAccumulatorsRef.current;
             
             // Reset accumulators to base values from soundConfig
             targetAccumulators['masterVolume'] = sound.masterVolume;
             targetAccumulators['drone.gain'] = sound.drone.gain;
             targetAccumulators['drone.filter'] = sound.drone.filter;
             targetAccumulators['drone.pitch'] = sound.drone.pitch;
             targetAccumulators['atmosphere.gain'] = sound.atmosphere.gain;
             targetAccumulators['arp.gain'] = sound.arp.gain;
             targetAccumulators['arp.speed'] = sound.arp.speed;
             targetAccumulators['arp.filter'] = sound.arp.filter;
             targetAccumulators['arp.octaves'] = sound.arp.octaves;
             targetAccumulators['arp.direction'] = 0; // Base direction is handled by enum, this is modulation offset
             targetAccumulators['rhythm.gain'] = sound.rhythm.gain;
             targetAccumulators['rhythm.filter'] = sound.rhythm.filter;
             targetAccumulators['rhythm.bpm'] = sound.rhythm.bpm;
             targetAccumulators['melody.gain'] = sound.melody.gain;
             targetAccumulators['melody.density'] = sound.melody.density;
             targetAccumulators['reverb.mix'] = sound.reverb.mix;
             targetAccumulators['reverb.tone'] = sound.reverb.tone;

              for (let i = 0; i < modulations.length; i++) {
                  const mod = modulations[i];
                  if (!mod.enabled) continue;
                  // Calculate modulation amount based on defined range
                  const range = MOD_RANGES[mod.target] || 1.0;
                  targetAccumulators[mod.target] += (inputs[mod.source] || 0) * mod.amount * range;
              }
              const nodes = audioNodesRef.current;
              const ctx = audioContextRef.current;
              const audioNow = ctx.currentTime;

              if (nodes.drone && sound.drone.enabled) {
                  nodes.drone.filter.frequency.setTargetAtTime(Math.max(20, targetAccumulators['drone.filter']), audioNow, 2.0); 
                  const baseFreq = nodes.drone.baseFreq;
                  const pitchOffset = targetAccumulators['drone.pitch'];
                  const finalFreq = baseFreq * Math.pow(2, pitchOffset / 12);
                  nodes.drone.osc1.frequency.setTargetAtTime(finalFreq, audioNow, 0.5); 
                  nodes.drone.osc2.frequency.setTargetAtTime(finalFreq * 1.01, audioNow, 0.5);
                  nodes.drone.gain.gain.setTargetAtTime(Math.max(0, targetAccumulators['drone.gain']), audioNow, 0.1);
              }
              if (nodes.atmosphere && sound.atmosphere.enabled) nodes.atmosphere.gain.gain.setTargetAtTime(Math.max(0, targetAccumulators['atmosphere.gain']), audioNow, 1.5);
              if (nodes.arp && sound.arp.enabled) {
                   nodes.arp.filter.frequency.setTargetAtTime(Math.max(50, targetAccumulators['arp.filter']), audioNow, 0.5);
                   nodes.arp.gain.gain.setTargetAtTime(Math.max(0, targetAccumulators['arp.gain']), audioNow, 0.1);
              }
              if (nodes.rhythm && sound.rhythm.enabled) {
                   // Rhythm filter is per-hit now, modulation applies to gain instead if needed
                   nodes.rhythm.gain.gain.setTargetAtTime(Math.max(0, targetAccumulators['rhythm.gain']), audioNow, 0.1);
              }
              if (nodes.reverb && sound.reverb.enabled) {
                   nodes.reverb.output.gain.setTargetAtTime(Math.max(0, Math.min(1, targetAccumulators['reverb.mix'])), audioNow, 0.5);
                   nodes.reverb.setTone(Math.max(200, targetAccumulators['reverb.tone']));
              }
              nodes.masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1, targetAccumulators['masterVolume'])), audioNow, 0.1);
              
              // Update live state for sequencer
              liveAudioStateRef.current.rhythmBpm = Math.max(30, Math.min(300, targetAccumulators['rhythm.bpm']));
              liveAudioStateRef.current.arpSpeed = Math.max(0.1, Math.min(5.0, targetAccumulators['arp.speed']));
              liveAudioStateRef.current.arpOctaves = Math.max(1, Math.min(5, targetAccumulators['arp.octaves']));
              liveAudioStateRef.current.melodyDensity = Math.max(0.0, Math.min(1.0, targetAccumulators['melody.density']));

            // Scheduling
            const LOOKAHEAD = 0.1;
            const { rhythmBpm, arpSpeed, melodyDensity } = liveAudioStateRef.current;

            if (sound.melody.enabled && audioNow >= nextMelodyTimeRef.current - LOOKAHEAD) {
                const playTime = Math.max(audioNow, nextMelodyTimeRef.current);
                if (Math.random() < melodyDensity) audioGeneratorsRef.current.playGenerativeNote(playTime);
                nextMelodyTimeRef.current += (60 / rhythmBpm) * (Math.random() * 4 + 4); 
            }
            if (sound.arp.enabled && audioNow >= nextArpTimeRef.current - LOOKAHEAD) {
                const playTime = Math.max(audioNow, nextArpTimeRef.current);
                audioGeneratorsRef.current.playArpNote(playTime);
                nextArpTimeRef.current += (60 / rhythmBpm) / (arpSpeed * 4);
            }
            if (sound.rhythm.enabled && audioNow >= nextRhythmTimeRef.current - LOOKAHEAD) {
                const playTime = Math.max(audioNow, nextRhythmTimeRef.current);
                audioGeneratorsRef.current.playRhythm(playTime);
                nextRhythmTimeRef.current += 60 / rhythmBpm;
            }
        }

        // --- SHIP MODULATION ---
        const shipMods = ship.modulations || [];
        const { modulations: _modulations, ...effectiveConfig } = ship;

        for(const mod of shipMods) {
            if (!mod.enabled) continue;
            
            const targetKey = mod.target as keyof typeof effectiveConfig;
            if (!effectiveConfig.hasOwnProperty(targetKey)) continue;

            const range = SHIP_MOD_RANGES[mod.target] || 1.0;
            const valueChange = (inputs[mod.source] || 0) * mod.amount * range;
            
            (effectiveConfig[targetKey] as number) += valueChange;
        }
        effectiveShipConfigRef.current = effectiveConfig;


        // --- Terraforming ---
        if (isTerraformingHeld.current && terraformPowerRef.current > 0) terraformPowerRef.current = Math.max(0, terraformPowerRef.current - 0.33 * dt);
        else terraformPowerRef.current = Math.min(1.0, terraformPowerRef.current + 0.2 * dt);
        
        if (terraformPower !== terraformPowerRef.current) {
             setTerraformPower(terraformPowerRef.current);
        }
        
        const cVs = terraform_currentVelocity.current, tVs = terraform_targetVelocity.current;
        const affectedUniforms = Object.keys(cVs).concat(Object.keys(tVs));
        if (affectedUniforms.length > 0) {
             const uniqueAffected = new Set(affectedUniforms);
             if (uniqueAffected.size > 0) {
                setUniforms(prev => {
                    const next = { ...prev };
                    let chg = false;
                    uniqueAffected.forEach(k => {
                        const s = slidersRef.current.find(sl => sl.variableName === k);
                        if (!s) return;
                        cVs[k] = (cVs[k]||0) + ((tVs[k]||0) - (cVs[k]||0)) * 0.1;
                        if (Math.abs(cVs[k]) < 1e-4 && tVs[k]===0) { delete cVs[k]; delete tVs[k]; return; }
                        let val = (next[k] ?? s.defaultValue) + cVs[k] * terraformPowerRef.current;
                        if (val > s.max) { val = s.max; cVs[k] = 0; }
                        if (val < s.min) { val = s.min; cVs[k] = 0; }
                        if (next[k] !== val) { next[k] = val; chg = true; }
                    });
                    return chg ? next : prev;
                });
             }
        }
        frameId = requestAnimationFrame(gameLoop);
    };
    frameId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(frameId);
  }, []); 

  // Re-bind audio generators
  const audioGeneratorsRef = useRef({
      playGenerativeNote: (t:number) => {},
      playArpNote: (t:number) => {},
      playRhythm: (t:number) => {},
      playCollisionSound: () => {},
      playLaserSound: (w: WeaponType) => {},
      playExplosionSound: () => {}
  });

  useEffect(() => {
      audioGeneratorsRef.current = {
          playGenerativeNote,
          playArpNote,
          playRhythm,
          playCollisionSound,
          playLaserSound,
          playExplosionSound
      };
  }, [playGenerativeNote, playArpNote, playRhythm, playCollisionSound, playLaserSound, playExplosionSound]);

  const handleUniformChange = useCallback((n: string, v: number) => setUniforms(p => ({ ...p, [n]: v })), []);
  const allUniforms = uniforms;
  
  // -- AI HANDLERS --
  const handleAiSliderAdjust = useCallback(async () => {
    if (!geminiPrompt.trim()) return;
    setAiStage(AiStage.ADJUSTING_SLIDERS);
    setGeminiError(null);
    try {
        const adjustments = await adjustSliders(activeShaderCode, sliders, geminiPrompt);
        setUniforms(prev => ({ ...prev, ...adjustments }));
        setGeminiPrompt('');
    } catch (e: any) {
        setGeminiError(e.message || "Failed to adjust sliders");
    } finally {
        setAiStage(AiStage.IDLE);
    }
  }, [geminiPrompt, activeShaderCode, sliders]);

  const handleAiRequest = useCallback(async () => {
    if (!geminiPrompt.trim()) return;
    setGeminiError(null);

    try {
        setAiStage(AiStage.IDLE); // Set initial stage, will update
        const decision = await determineModificationType(activeShaderCode, sliders, geminiPrompt);
        
        if (decision.action === 'adjust_sliders') {
             await handleAiSliderAdjust();
             return;
        } else if (decision.action === 'enable_camera_controls') {
             setAiStage(AiStage.ENABLE_CAMERA_CONTROLS);
             const result = await implementCameraControls(activeShaderCode);
             setActiveShaderCode(result.modifiedCode);
             setCameraControlsEnabled(true);
        } else if (decision.action === 'smart_slider') {
             setAiStage(AiStage.SMART_SLIDER_CREATION);
             const result = await createSmartSlider(activeShaderCode, geminiPrompt);
             setActiveShaderCode(result.modifiedCode);
             // Ensure no duplicate sliders
             if (!sliders.some(s => s.variableName === result.newSlider.variableName)) {
                setSliders(prev => [...prev, result.newSlider]);
             }
             setUniforms(prev => ({ ...prev, [result.newSlider.variableName]: result.newSlider.defaultValue }));
        } else if (decision.action === 'modify_code') {
             setAiStage(AiStage.MODIFYING_CODE);
             const result = await modifyCode(activeShaderCode, geminiPrompt);
             setActiveShaderCode(result.modifiedCode);
        }
        setGeminiPrompt('');
    } catch (e: any) {
        setGeminiError(e.message || "AI Request Failed");
    } finally {
        setAiStage(AiStage.IDLE);
    }
  }, [geminiPrompt, activeShaderCode, sliders, handleAiSliderAdjust]);
  
  const handleExplainCode = useCallback(async (snippet: string) => {
      setIsGeneratingExplanation(true);
      setExplanationError(null);
      setExplanation(null);
      try {
          const result = await explainCode(snippet);
          setExplanation(result);
      } catch (e: any) {
          setExplanationError(e.message || "Failed to explain code");
      } finally {
          setIsGeneratingExplanation(false);
      }
  }, []);
  
  const handleClearExplanation = useCallback(() => {
      setExplanation(null);
      setExplanationError(null);
  }, []);
  
  const handleAnalyzeShader = useCallback(async () => {
      setIsAnalyzing(true);
      setAnalysisError(null);
      try {
          // 1. Find basic sliders
          const discoveredSliders = await analyzeShaderForSliders(activeShaderCode);
          
          // 2. Enrich with better descriptions
          const enrichedSliders = await enrichSliderDetails(activeShaderCode, discoveredSliders);
          
          // Merge with existing sliders (simple de-dupe by variableName)
          const existingNames = new Set(sliders.map(s => s.variableName));
          const newSliders = enrichedSliders.filter(s => !existingNames.has(s.variableName));
          
          setSliders(prev => [...prev, ...newSliders]);
          setUniforms(prev => {
              const next = { ...prev };
              newSliders.forEach(s => next[s.variableName] = s.defaultValue);
              return next;
          });
      } catch (e: any) {
          setAnalysisError(e.message || "Failed to analyze shader");
      } finally {
          setIsAnalyzing(false);
      }
  }, [activeShaderCode, sliders]);

  const handleFetchSliderSuggestions = useCallback(async () => {
      setIsFetchingSuggestions(true);
      setSuggestionsError(null);
      try {
          const suggestions = await fetchSliderSuggestions(activeShaderCode, sliders);
          setSliderSuggestions(suggestions);
      } catch (e: any) {
          setSuggestionsError(e.message || "Failed to get suggestions");
      } finally {
          setIsFetchingSuggestions(false);
      }
  }, [activeShaderCode, sliders]);
  
  const handleClearSuggestions = useCallback(() => {
      setSliderSuggestions([]);
      setSuggestionsError(null);
  }, []);

  const [error, setError] = useState<string | null>(null);
  
  const handleFixCodeWithAi = useCallback(async () => {
      if (!error) return;
      setIsFixingCode(true);
      try {
          const result = await fixCode(activeShaderCode, error);
          setActiveShaderCode(result.fixedCode);
          setError(null); // Clear error optimistically
      } catch (e: any) {
          setGeminiError("AI Fix Failed: " + e.message);
      } finally {
          setIsFixingCode(false);
      }
  }, [activeShaderCode, error]);
  
  // Helper hook to keep main body cleaner
  const [isSidebarVisible, setIsSidebarVisible] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return {
    activeShaderCode, 
    shaderCode: activeShaderCode, // Alias for AppContextType compatibility
    handleCodeEdit: setActiveShaderCode,
    handleRun: () => {}, // No-op if live updating
    error,
    
    sliders, 
    uniforms, 
    handleUniformChange, 
    handleUniformsCommit, 
    handleSliderConfigChange: (name, key, val) => setSliders(prev => prev.map(s => s.variableName === name ? { ...s, [key]: val } : s)),
    handleResetSliders: () => { setSliders([]); setUniforms({}); },
    handleRemoveSlider: (name) => {
        setSliders(prev => prev.filter(s => s.variableName !== name));
        setUniforms(prev => { const n={...prev}; delete n[name]; return n; });
    },

    canvasSize, setCanvasSize, 
    allUniforms, 
    cameraRef, renderCameraRef, cameraVelocityRef, cameraAngularVelocityRef, 
    pressKey, releaseKey, cameraControlsEnabled, pressedKeys, 
    isControlsOpen, setIsControlsOpen, 
    isHdEnabled, setIsHdEnabled, 
    isFpsEnabled, setIsFpsEnabled, 
    isHudEnabled, setIsHudEnabled, 
    handleTerraformPress, handleTerraformRelease, terraformPower, terraformConfig, handleTerraformConfigChange, 
    currentSessionId, EDITMODE, handleSessionSelect, 
    controlConfig, handleControlConfigChange, 
    sessionSource, handleSourceChange, 
    soundConfig, handleSoundConfigChange, addSoundModulation, updateSoundModulation, removeSoundModulation, 
    fileInputRef, handleLoadSessionFromFile, handleSaveSessionToFile, handleFileChange, 
    isMoving, 
    debugElevation, debugArpVolume, debugCameraAltitude, debugCameraPitch, debugCameraDistance, 
    collisionState, collisionProximity, 
    collisionThresholdRed, setCollisionThresholdRed, 
    collisionThresholdYellow, setCollisionThresholdYellow, 
    isInteracting, setIsInteracting: (v: boolean) => setIsInteracting(v), 
    viewMode, setViewMode, viewModeTransition, 
    shipConfig, effectiveShipConfigRef, handleShipConfigChange: (key: keyof ShipConfig, v: number) => setShipConfig(p => ({ ...p, [key]: v })), 
    addShipModulation, updateShipModulation, removeShipModulation, 
    debugCollisionPointRef, debugRayStartPointRef, debugRayEndPointRef, debugCollisionDistanceRef, 
    getSessionStateJson, 
    enemiesRef, projectilesRef, 
    shouldReduceQuality,
    
    // Shop & Stats
    playerStats, buyWeapon, buyUpgrade, equipWeapon,
    isGameOver, restartGame,

    // AI
    geminiPrompt, setGeminiPrompt,
    handleAiRequest,
    handleAiSliderAdjust,
    aiStage,
    geminiError,
    handleExplainCode,
    isGeneratingExplanation,
    explanation,
    explanationError,
    handleClearExplanation,
    handleAnalyzeShader,
    isAnalyzing,
    analysisError,
    handleFetchSliderSuggestions,
    isFetchingSuggestions,
    sliderSuggestions,
    suggestionsError,
    handleClearSuggestions,
    usedSuggestions,
    handleFixCodeWithAi,
    isFixingCode,
    
    // Layout
    isSidebarVisible, setIsSidebarVisible,
    isSettingsOpen, setIsSettingsOpen,

    // Playback state (dummy for now as it wasn't in the original snippet but is in AppContextType)
    playbackState: 'playing',
    handlePlayPause: () => {},
    handleStop: () => {},
    handleRestart: () => {},
    
    // Modal (dummy)
    setIsNewSessionModalOpen: () => {},
    handleConfirmNewSession: () => {},
    handleNewSessionClick: () => {},
    handleLoadSession: () => {}, // This duplicates handleLoadSessionFromFile logic usually
    handleSaveSession: () => {}, // Duplicates handleSaveSessionToFile
    handleUndo: () => {},
    handleRedo: () => {},
    historyIndex: 0,
    history: [],
    settingsRef: { current: null }, // Dummy ref
  };
};
