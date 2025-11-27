







/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/



export interface Slider {
  name: string;
  variableName: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  description?: string;
  targetLiteral?: string;
}

export enum AiStage {
  IDLE,
  ADJUSTING_SLIDERS,
  SMART_SLIDER_CREATION,
  MODIFYING_CODE,
  ENABLE_CAMERA_CONTROLS,
  SOUND,
}

export interface SliderSuggestion {
  suggestion: string;
  type: 'safe' | 'creative';
}

export interface TerraformTarget {
  variableName: string;
  type: 'velocity';
  magnitude: number;
  probability?: number;
}

export interface TerraformConfig {
  targets: TerraformTarget[];
}

export interface ControlConfig {
    invertStrafe?: boolean;
    invertForward?: boolean;
    invertAscend?: boolean;
    invertPitch?: boolean;
    invertYaw?: boolean;
    forwardVelocity?: number;
    strafeVelocity?: number;
    ascendVelocity?: number;
    pitchVelocity?: number;
    yawVelocity?: number;
}

// Expanded Inputs
export type ModulationSource = 
    | 'speed'        // 0.0 to ~1.0+
    | 'acceleration' // Delta speed, positive (speeding up) or negative (slowing down)
    | 'altitude'     // Height relative to start (can be negative)
    | 'descent'      // Downward velocity (positive when falling/diving)
    | 'turning'      // Yaw rotation speed (absolute value, 0.0 to ~1.0)
    | 'turningSigned' // Yaw rotation speed with direction (Negative = Left, Positive = Right)
    | 'heading'      // Compass direction (0.0 to 1.0)
    | 'pitch'        // Camera look up/down angle (-1.0 looking down, +1.0 looking up)
    | 'proximity'    // Closeness to obstacles (0.0 safe, 1.0 collision)
    | 'time';        // Always increasing seconds

// Expanded Outputs
export type ModulationTarget =
    | 'masterVolume'
    | 'drone.gain' | 'drone.filter' | 'drone.pitch'
    | 'atmosphere.gain'
    | 'arp.gain' | 'arp.speed' | 'arp.filter' | 'arp.octaves' | 'arp.direction'
    | 'rhythm.gain' | 'rhythm.filter' | 'rhythm.bpm'
    | 'melody.gain' | 'melody.density'
    | 'reverb.mix' | 'reverb.tone';

export interface Modulation {
  id: string;
  enabled: boolean;
  source: ModulationSource;
  target: ModulationTarget;
  amount: number; // -1.0 to 1.0 (representing -100% to +100% of standard range)
}

export interface ReverbConfig {
  enabled: boolean;
  mix: number; // 0 to 1 (wet/dry mix)
  decay: number; // seconds
  tone: number; // lowpass filter frequency for damping
}

export interface ArpConfig {
    enabled: boolean;
    gain: number;
    speed: number; // 0.1 to 2.0 factor
    octaves: 1 | 2 | 3;
    filter: number; // Base filter cutoff
    direction: 'up' | 'down' | 'updown' | 'random';
}

export interface RhythmConfig {
    enabled: boolean;
    gain: number;
    bpm: number;
    filter: number; // Base filter cutoff
}

export interface SoundConfig {
  enabled: boolean;
  masterVolume: number;
  reverb: ReverbConfig;
  drone: { // Deep bass foundation
      enabled: boolean;
      gain: number;
      filter: number; // Lowpass cutoff
      pitch: number; // Semitone offset
  };
  atmosphere: { // Texture layer (rain/wind)
      enabled: boolean;
      gain: number;
      texture: 'smooth' | 'grit';
  };
  melody: { // Generative CS-80 style leads
      enabled: boolean;
      gain: number;
      density: number; // How often notes play
      scale: 'dorian' | 'phrygian' | 'lydian';
  };
  arp: ArpConfig;
  rhythm: RhythmConfig;
  modulations: Modulation[]; // Active patch bay connections
}

export interface CameraData {
    position: [number, number, number];
    rotation: [number, number];
    roll: number;
}

export type ViewMode = 'cockpit' | 'chase';

export type ShipModulationTarget = 
    | 'complexity' 
    | 'fold1' | 'fold2' | 'fold3' 
    | 'scale' | 'stretch' | 'taper' | 'twist'
    | 'asymmetryX' | 'asymmetryY' | 'asymmetryZ'
    | 'twistAsymX' | 'scaleAsymX' | 'fold1AsymX' | 'fold2AsymX';

export interface ShipModulation {
    id: string;
    enabled: boolean;
    source: ModulationSource;
    target: ShipModulationTarget;
    amount: number;
}

export interface ShipConfig {
    complexity: number; // Iterations
    fold1: number;
    fold2: number;
    fold3: number;
    scale: number;
    stretch: number;
    taper: number;
    twist: number;
    asymmetryX: number; // Left/Right Bias
    asymmetryY: number; // Up/Down Bias
    asymmetryZ: number; // Front/Back Bias
    // New Parameter Biases
    twistAsymX: number;
    scaleAsymX: number;
    fold1AsymX: number;
    fold2AsymX: number;
    
    chaseDistance?: number;
    chaseVerticalOffset?: number;
    pitchOffset?: number;
    generalScale?: number;
    translucency?: number;
    modulations: ShipModulation[];
}

export type EnemyType = 'scout' | 'fighter' | 'tank';

export interface Enemy {
    id: string;
    type: EnemyType;
    position: [number, number, number];
    velocity: [number, number, number];
    rotation: [number, number, number]; // Euler: Pitch, Yaw, Roll
    active: boolean;
    spawnTime: number;
    hp: number;
    maxHp: number;
    hitFlash: number; // 0.0 to 1.0, decays over time
    // Crowd Control States
    stunned: number; // Time remaining
    frozen: number; // Factor (0.0 = frozen, 1.0 = normal) - but simpler to use time for freeze too
    frozenTimer: number; // Time remaining for freeze
}

export type WeaponType = 'blaster' | 'laser' | 'plasma' | 'shotgun' | 'railgun';

export interface Projectile {
    id: string;
    position: [number, number, number];
    velocity: [number, number, number];
    active: boolean;
    spawnTime: number;
    weaponType: WeaponType;
    damage: number;
    color: [number, number, number]; // RGB
    scale: number;
    lifetime: number; // Seconds
    
    // Projectile Properties derived from Upgrades
    pierce: number; // How many enemies it can pass through
    isCrit: boolean; 
    knockback: number; // Force
    stun: number; // Chance 0-1
    freeze: number; // Chance 0-1
    blast: number; // Radius
    ricochet: number; // Count
    hitList: string[]; // IDs of enemies already hit (for pierce/ricochet)
}

export interface PlayerStats {
    credits: number;
    currentHp: number;
    maxHp: number;
    unlockedWeapons: WeaponType[];
    currentWeapon: WeaponType;
    upgrades: {
        damageLevel: number; // 1. Урон
        fireRateLevel: number; // 2. Скорострельность
        speedLevel: number; // 3. Скорость полета
        homingLevel: number; // 4. Наведение
        critChanceLevel: number; // 5. Шанс крита
        critDamageLevel: number; // 6. Сила крита
        pierceLevel: number; // 7. Пробивание
        multishotLevel: number; // 8. Мульти-выстрел
        lifetimeLevel: number; // 9. Дальность
        knockbackLevel: number; // 10. Отталкивание
        stunLevel: number; // 11. Оглушение
        creditMultLevel: number; // 12. Жадность
        eliteDmgLevel: number; // 13. Убийца Титанов
        executeLevel: number; // 14. Палач
        blastRadiusLevel: number; // 15. Взрывная волна
        freezeLevel: number; // 16. Заморозка
        ricochetLevel: number; // 17. Рикошет
        scavengerLevel: number; // 18. Мародер
        discountLevel: number; // 19. Торговля
        overclockLevel: number; // 20. Разгон
        hullLevel: number; // 21. Корпус (HP)
    }
}

// Enemy Stats Configuration
export const ENEMY_STATS: Record<EnemyType, { hp: number; speed: number; scale: number; reward: number }> = {
    scout: { hp: 2, speed: 7.0, scale: 0.6, reward: 20 },
    fighter: { hp: 6, speed: 4.0, scale: 1.0, reward: 50 },
    tank: { hp: 25, speed: 2.0, scale: 1.8, reward: 150 }
};

export const WEAPON_STATS: Record<WeaponType, { 
    name: string;
    baseDamage: number; 
    fireRate: number; // delay in seconds
    speed: number; 
    color: [number, number, number];
    scale: number;
    cost: number;
    description: string;
}> = {
    blaster: { 
        name: "Бластер",
        baseDamage: 2, 
        fireRate: 0.15, 
        speed: 80.0, 
        color: [0.5, 0.9, 1.0], // Cyan
        scale: 1.0,
        cost: 0,
        description: "Стандартное скорострельное энергетическое оружие."
    },
    laser: { 
        name: "Лазерный Повторитель",
        baseDamage: 0.8, 
        fireRate: 0.06, 
        speed: 120.0, 
        color: [1.0, 0.2, 0.2], // Red
        scale: 0.4, // Reduced scale for beam effect
        cost: 500,
        description: "Чрезвычайно высокая скорострельность, низкий урон за попадание."
    },
    plasma: { 
        name: "Плазменная Пушка",
        baseDamage: 12, 
        fireRate: 0.4, 
        speed: 50.0, 
        color: [0.2, 1.0, 0.4], // Green
        scale: 2.0, // Reduced from 2.5
        cost: 1500,
        description: "Медленный сгусток энергии огромной разрушительной силы."
    },
    shotgun: { 
        name: "Дробовик",
        baseDamage: 3, 
        fireRate: 0.5, 
        speed: 70.0, 
        color: [1.0, 0.8, 0.2], // Orange
        scale: 0.8,
        cost: 2500,
        description: "Выстреливает 3 снаряда веером."
    },
    railgun: { 
        name: "Рельсотрон",
        baseDamage: 30, 
        fireRate: 0.8, 
        speed: 200.0, 
        color: [1.0, 1.0, 1.0], // White
        scale: 1.5,
        cost: 5000,
        description: "Гиперзвуковой снаряд для нанесения огромного урона."
    }
};

export const UPGRADE_META: Record<keyof PlayerStats['upgrades'], { name: string; description: string; max: number }> = {
    hullLevel: { name: "Усиление Корпуса", description: "+25 Макс. здоровья", max: 20 },
    damageLevel: { name: "Усилитель Урона", description: "+15% Урона", max: 10 },
    fireRateLevel: { name: "Скорострельность", description: "+8% Скорости стрельбы", max: 10 },
    speedLevel: { name: "Скорость Полета", description: "+10% Скорости снаряда", max: 10 },
    homingLevel: { name: "Наведение", description: "Улучшает угол авто-наведения", max: 5 },
    critChanceLevel: { name: "Шанс Крита", description: "+5% Шанс критического удара", max: 10 },
    critDamageLevel: { name: "Сила Крита", description: "+20% Урон от критов", max: 10 },
    pierceLevel: { name: "Пробивание", description: "Снаряды проходят сквозь врагов", max: 3 },
    multishotLevel: { name: "Мульти-выстрел", description: "Шанс выстрелить дважды", max: 5 },
    lifetimeLevel: { name: "Дальность", description: "Увеличивает дальность полета", max: 5 },
    knockbackLevel: { name: "Отталкивание", description: "Отбрасывает врагов при попадании", max: 5 },
    stunLevel: { name: "Оглушение", description: "Шанс оглушить врага", max: 5 },
    creditMultLevel: { name: "Жадность", description: "+10% Кредитов", max: 10 },
    eliteDmgLevel: { name: "Убийца Титанов", description: "+20% Урона по Танкам", max: 5 },
    executeLevel: { name: "Палач", description: "Шанс убить врага с <20% HP", max: 5 },
    blastRadiusLevel: { name: "Взрывная Волна", description: "Урон по площади", max: 5 },
    freezeLevel: { name: "Заморозка", description: "Шанс замедлить врага", max: 5 },
    ricochetLevel: { name: "Рикошет", description: "Снаряды отскакивают", max: 3 },
    scavengerLevel: { name: "Мародер", description: "Шанс на двойную награду", max: 5 },
    discountLevel: { name: "Торговля", description: "-5% Цены в магазине", max: 10 },
    overclockLevel: { name: "Разгон", description: "Небольшой бонус ко всему", max: 10 },
};

export const UPGRADE_COSTS: Record<keyof PlayerStats['upgrades'], (level: number) => number> = {
    hullLevel: (l) => Math.floor(150 * Math.pow(1.3, l - 1)),
    damageLevel: (l) => Math.floor(100 * Math.pow(1.5, l - 1)),
    fireRateLevel: (l) => Math.floor(100 * Math.pow(1.5, l - 1)),
    speedLevel: (l) => Math.floor(100 * Math.pow(1.4, l - 1)),
    homingLevel: (l) => Math.floor(200 * Math.pow(2.0, l - 1)),
    critChanceLevel: (l) => Math.floor(150 * Math.pow(1.6, l - 1)),
    critDamageLevel: (l) => Math.floor(150 * Math.pow(1.5, l - 1)),
    pierceLevel: (l) => Math.floor(1000 * Math.pow(2.5, l - 1)),
    multishotLevel: (l) => Math.floor(800 * Math.pow(2.0, l - 1)),
    lifetimeLevel: (l) => Math.floor(100 * Math.pow(1.4, l - 1)),
    knockbackLevel: (l) => Math.floor(200 * Math.pow(1.5, l - 1)),
    stunLevel: (l) => Math.floor(300 * Math.pow(1.6, l - 1)),
    creditMultLevel: (l) => Math.floor(250 * Math.pow(1.5, l - 1)),
    eliteDmgLevel: (l) => Math.floor(400 * Math.pow(1.5, l - 1)),
    executeLevel: (l) => Math.floor(500 * Math.pow(1.8, l - 1)),
    blastRadiusLevel: (l) => Math.floor(600 * Math.pow(1.7, l - 1)),
    freezeLevel: (l) => Math.floor(350 * Math.pow(1.6, l - 1)),
    ricochetLevel: (l) => Math.floor(1200 * Math.pow(2.2, l - 1)),
    scavengerLevel: (l) => Math.floor(300 * Math.pow(1.6, l - 1)),
    discountLevel: (l) => Math.floor(200 * Math.pow(1.8, l - 1)),
    overclockLevel: (l) => Math.floor(1000 * Math.pow(1.4, l - 1)),
};
