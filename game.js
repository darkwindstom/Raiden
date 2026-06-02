/* --- Raiden game.js (Native HTML5 Canvas Edition) --- */

// --- Game Configurations & Constants ---
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 850;

// Game States (UI layers sync)
const STATES = {
    MENU: 'menu',
    PLAYING: 'playing',
    PAUSED: 'paused',
    HANGAR: 'hangar',
    GAMEOVER: 'gameover',
    VICTORY: 'victory'
};

let gameState = STATES.MENU;

// --- Canvas Setup ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

// --- Active Game Objects ---
let player = null;
let playerBullets = [];
let enemyBullets = [];
let enemies = [];
let lootItems = [];
let particles = [];
let stars = [];
let boss = null;

// --- Game State Variables ---
let score = 0;
let crystalsCollected = 0;
let stage = 1;
let stageTime = 0;
let enemySpawnTimer = 0;
let enemySpawnDelay = 2.5;
let isBossSpawning = false;

// --- VFX & Screen State Variables ---
let flashTimer = 0;
const flashDuration = 0.5;
let shakeTimer = 0;
let shakeIntensity = 0;

// --- Keyboard Input States ---
const keys = {
    W: false,
    A: false,
    S: false,
    D: false,
    Space: false
};

// --- Web Audio API Procedural Synthesizer ---
class AudioSynth {
    constructor() {
        this.ctx = null;
        this.masterVolume = null;
        this.bgmTimer = null;
        this.bgmStep = 0;
        this.isMuted = false;
        
        // Synthwave Bassline Pattern (MIDI note numbers)
        this.bassPattern = [
            40, 40, 40, 40,
            43, 43, 43, 43,
            45, 45, 45, 45,
            38, 38, 38, 38
        ];
        
        // Synth Melody Pattern (0 = rest)
        this.melodyPattern = [
            64, 0, 67, 0, 69, 71, 69, 0,
            67, 0, 64, 0, 74, 71, 67, 69
        ];
    }

    init() {
        if (this.ctx) return;
        
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        this.ctx = new AudioContextClass();
        
        this.masterVolume = this.ctx.createGain();
        this.masterVolume.gain.setValueAtTime(0.25, this.ctx.currentTime); // Low volume
        this.masterVolume.connect(this.ctx.destination);
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    playLaser() {
        if (!this.ctx || this.isMuted) return;
        this.resume();

        const time = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, time);
        osc.frequency.exponentialRampToValueAtTime(100, time + 0.15);

        gain.gain.setValueAtTime(0.12, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

        osc.connect(gain);
        gain.connect(this.masterVolume);

        osc.start(time);
        osc.stop(time + 0.15);
    }

    playEnemyLaser() {
        if (!this.ctx || this.isMuted) return;
        this.resume();
        
        const time = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, time);
        osc.frequency.exponentialRampToValueAtTime(80, time + 0.2);

        gain.gain.setValueAtTime(0.06, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, time);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterVolume);

        osc.start(time);
        osc.stop(time + 0.2);
    }

    playHit(isShield) {
        if (!this.ctx || this.isMuted) return;
        this.resume();

        const time = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        if (isShield) {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, time);
            osc.frequency.exponentialRampToValueAtTime(600, time + 0.08);
            gain.gain.setValueAtTime(0.1, time);
        } else {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(120, time);
            osc.frequency.linearRampToValueAtTime(40, time + 0.1);
            gain.gain.setValueAtTime(0.18, time);
        }

        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

        osc.connect(gain);
        gain.connect(this.masterVolume);

        osc.start(time);
        osc.stop(time + 0.1);
    }

    playExplosion(intensity = 1.0) {
        if (!this.ctx || this.isMuted) return;
        this.resume();

        const time = this.ctx.currentTime;
        const duration = 0.3 * intensity;
        
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noiseNode = this.ctx.createBufferSource();
        noiseNode.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(intensity > 1.5 ? 200 : 400, time);
        filter.frequency.exponentialRampToValueAtTime(30, time + duration);

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0.2 * intensity, time);
        gainNode.gain.exponentialRampToValueAtTime(0.01, time + duration);

        noiseNode.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.masterVolume);

        noiseNode.start(time);
        noiseNode.stop(time + duration);
    }

    playPowerup() {
        if (!this.ctx || this.isMuted) return;
        this.resume();

        const time = this.ctx.currentTime;
        const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
        
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, time + idx * 0.06);
            
            gain.gain.setValueAtTime(0.0, time);
            gain.gain.linearRampToValueAtTime(0.1, time + idx * 0.06 + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.005, time + idx * 0.06 + 0.15);

            osc.connect(gain);
            gain.connect(this.masterVolume);
            
            osc.start(time + idx * 0.06);
            osc.stop(time + idx * 0.06 + 0.25);
        });
    }

    playBomb() {
        if (!this.ctx || this.isMuted) return;
        this.resume();

        const time = this.ctx.currentTime;
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, time);
        osc.frequency.exponentialRampToValueAtTime(30, time + 0.8);
        
        gain.gain.setValueAtTime(0.25, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.8);
        
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(150, time);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterVolume);

        osc.start(time);
        osc.stop(time + 0.8);

        this.playExplosion(2.5);
    }

    mToF(midiNote) {
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    startBGM() {
        this.init();
        this.resume();
        if (this.bgmTimer) return;

        const tempoInterval = 160; // ms per step
        this.bgmTimer = setInterval(() => {
            if (!this.ctx || this.isMuted || gameState !== STATES.PLAYING) return;
            
            const time = this.ctx.currentTime;
            
            // Bass
            const bassMidi = this.bassPattern[this.bgmStep % this.bassPattern.length];
            const bassOsc = this.ctx.createOscillator();
            const bassGain = this.ctx.createGain();
            
            bassOsc.type = 'sawtooth';
            bassOsc.frequency.setValueAtTime(this.mToF(bassMidi), time);
            
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(220, time);
            
            bassGain.gain.setValueAtTime(0.15, time);
            bassGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
            
            bassOsc.connect(filter);
            filter.connect(bassGain);
            bassGain.connect(this.masterVolume);
            
            bassOsc.start(time);
            bassOsc.stop(time + 0.15);

            // Hats
            if (this.bgmStep % 2 === 1) {
                const hatOsc = this.ctx.createOscillator();
                const hatGain = this.ctx.createGain();
                hatOsc.type = 'triangle';
                hatOsc.frequency.setValueAtTime(8000, time);
                
                hatGain.gain.setValueAtTime(0.012, time);
                hatGain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
                
                hatOsc.connect(hatGain);
                hatGain.connect(this.masterVolume);
                hatOsc.start(time);
                hatOsc.stop(time + 0.04);
            }

            // Kick
            if (this.bgmStep % 4 === 0) {
                const kickOsc = this.ctx.createOscillator();
                const kickGain = this.ctx.createGain();
                kickOsc.type = 'sine';
                kickOsc.frequency.setValueAtTime(150, time);
                kickOsc.frequency.exponentialRampToValueAtTime(45, time + 0.1);
                
                kickGain.gain.setValueAtTime(0.24, time);
                kickGain.gain.exponentialRampToValueAtTime(0.005, time + 0.12);
                
                kickOsc.connect(kickGain);
                kickGain.connect(this.masterVolume);
                kickOsc.start(time);
                kickOsc.stop(time + 0.12);
            }

            // Melody
            const melodyMidi = this.melodyPattern[this.bgmStep % this.melodyPattern.length];
            if (melodyMidi > 0 && Math.random() > 0.3) {
                const melOsc = this.ctx.createOscillator();
                const melGain = this.ctx.createGain();
                
                melOsc.type = 'triangle';
                melOsc.frequency.setValueAtTime(this.mToF(melodyMidi), time);
                melOsc.detune.setValueAtTime(Math.sin(time) * 10, time);

                melGain.gain.setValueAtTime(0.03, time);
                melGain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

                const melFilter = this.ctx.createBiquadFilter();
                melFilter.type = 'lowpass';
                melFilter.frequency.setValueAtTime(1500, time);

                melOsc.connect(melFilter);
                melFilter.connect(melGain);
                melGain.connect(this.masterVolume);

                melOsc.start(time);
                melOsc.stop(time + 0.25);
            }

            this.bgmStep++;
        }, tempoInterval);
    }

    stopBGM() {
        if (this.bgmTimer) {
            clearInterval(this.bgmTimer);
            this.bgmTimer = null;
        }
    }
}

const synth = new AudioSynth();

// --- Save/Load and Hangar Shop Upgrades System ---
const UPGRADE_COSTS = {
    armor: [10, 18, 28, 40],
    shield: [12, 20, 30, 45],
    weapon: [15, 25, 38, 55],
    magnet: [8, 14, 22, 32],
    bombs: [20, 35, 50, 75]
};

let userStats = {
    crystals: 0,
    armorLv: 1,
    shieldLv: 1,
    weaponLv: 1,
    magnetLv: 1,
    bombsLv: 1
};

function loadStats() {
    const saved = localStorage.getItem('raiden_stats');
    if (saved) {
        try {
            userStats = { ...userStats, ...JSON.parse(saved) };
        } catch (e) {
            console.error("Failed to parse saved stats:", e);
        }
    }
    updateHangarUI();
}

function saveStats() {
    localStorage.setItem('raiden_stats', JSON.stringify(userStats));
}

function updateHangarUI() {
    const el = document.getElementById('hangar-crystals');
    if (el) el.textContent = userStats.crystals;
    
    const categories = ['armor', 'shield', 'weapon', 'magnet', 'bombs'];
    categories.forEach(cat => {
        const lv = userStats[`${cat}Lv`];
        const displayLv = document.getElementById(`level-${cat}`);
        const btn = document.getElementById(`btn-upgrade-${cat}`);
        
        if (!displayLv || !btn) return;
        
        displayLv.textContent = `Lv ${lv}`;
        
        if (lv >= 5) {
            btn.textContent = "MAXED";
            btn.disabled = true;
        } else {
            const cost = UPGRADE_COSTS[cat][lv - 1];
            btn.innerHTML = `升級 <span class="cost">${cost}</span> 💎`;
            btn.disabled = userStats.crystals < cost;
        }
    });
}

function buyUpgrade(category) {
    const lv = userStats[`${category}Lv`];
    if (lv >= 5) return;
    
    const cost = UPGRADE_COSTS[category][lv - 1];
    if (userStats.crystals >= cost) {
        userStats.crystals -= cost;
        userStats[`${category}Lv`]++;
        saveStats();
        updateHangarUI();
        synth.playPowerup();
    }
}

// --- Custom Particle Classes ---

class EngineParticle {
    constructor(x, y, tint, scaleStart, isSide) {
        this.x = x;
        this.y = y;
        this.tint = tint;
        this.maxLife = isSide ? Math.random() * 0.05 + 0.07 : Math.random() * 0.07 + 0.08;
        this.life = this.maxLife;
        this.vy = isSide ? Math.random() * 100 + 100 : Math.random() * 150 + 200;
        this.vx = (Math.random() - 0.5) * 30;
        this.scaleStart = scaleStart;
    }
    update(dt) {
        this.life -= dt;
        this.y += this.vy * dt;
        this.x += this.vx * dt;
    }
    draw(ctx) {
        const ratio = this.life / this.maxLife;
        if (ratio <= 0) return;
        ctx.save();
        ctx.globalAlpha = ratio * 0.8;
        ctx.fillStyle = this.tint;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.scaleStart * ratio, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class ExplosionParticle {
    constructor(x, y, tint, scaleStart) {
        this.x = x;
        this.y = y;
        this.tint = tint;
        this.maxLife = Math.random() * 0.25 + 0.2;
        this.life = this.maxLife;
        const speed = Math.random() * 140 + 40;
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.scaleStart = scaleStart;
    }
    update(dt) {
        this.life -= dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
    }
    draw(ctx) {
        const ratio = this.life / this.maxLife;
        if (ratio <= 0) return;
        ctx.save();
        ctx.globalAlpha = ratio;
        ctx.fillStyle = this.tint;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.scaleStart * ratio, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class SparkParticle {
    constructor(x, y, tint) {
        this.x = x;
        this.y = y;
        this.tint = tint;
        this.maxLife = 0.12;
        this.life = this.maxLife;
        const speed = Math.random() * 60 + 30;
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
    }
    update(dt) {
        this.life -= dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
    }
    draw(ctx) {
        const ratio = this.life / this.maxLife;
        if (ratio <= 0) return;
        ctx.save();
        ctx.globalAlpha = ratio;
        ctx.fillStyle = this.tint;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 2.5 * ratio, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class BombParticle {
    constructor(x, y, tint) {
        this.x = x;
        this.y = y;
        this.tint = tint;
        this.maxLife = Math.random() * 0.3 + 0.3;
        this.life = this.maxLife;
        const speed = Math.random() * 90 + 30;
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
    }
    update(dt) {
        this.life -= dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
    }
    draw(ctx) {
        const ratio = this.life / this.maxLife;
        if (ratio <= 0) return;
        ctx.save();
        ctx.globalAlpha = ratio;
        ctx.fillStyle = this.tint;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 4 * ratio, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// --- Game Object Classes ---

// Player Ship Entity
class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 44;
        this.height = 40;
        this.active = true;
        this.reset();
    }

    reset() {
        this.speed = 280;
        this.maxArmor = 100 + (userStats.armorLv - 1) * 20;
        this.armor = this.maxArmor;
        
        this.maxShield = 50 + (userStats.shieldLv - 1) * 15;
        this.shield = this.maxShield;
        this.shieldRechargeTimer = 0;
        this.shieldRechargeRate = 4 + (userStats.shieldLv - 1) * 1.5;
        
        this.weaponLevel = userStats.weaponLv;
        this.bombs = userStats.bombsLv;
        this.magnetRange = 55 + (userStats.magnetLv - 1) * 30;
        
        this.isInvulnerable = false;
        this.invulTimer = 0;
        this.invulDuration = 1.4;
        
        this.shootCooldown = 0;
        this.shootRate = 0.14;
    }

    takeDamage(amount) {
        if (this.isInvulnerable) return false;
        
        this.shieldRechargeTimer = 0;
        
        if (this.shield > 0) {
            this.shield -= amount;
            synth.playHit(true);
            
            if (this.shield < 0) {
                this.armor += this.shield;
                this.shield = 0;
                this.triggerInvulnerability();
            }
        } else {
            this.armor -= amount;
            synth.playHit(false);
            this.triggerInvulnerability();
        }
        
        return this.armor <= 0;
    }

    triggerInvulnerability() {
        this.isInvulnerable = true;
        this.invulTimer = 0;
    }

    addWeaponUpgrade() {
        if (this.weaponLevel < 5) {
            this.weaponLevel++;
            synth.playPowerup();
            return true;
        }
        return false;
    }

    addShieldRefill() {
        this.shield = this.maxShield;
        synth.playPowerup();
    }

    addBomb() {
        if (this.bombs < 4) {
            this.bombs++;
            synth.playPowerup();
            return true;
        }
        return false;
    }

    update(dt) {
        // 1. Movement Calculations
        let dx = 0;
        let dy = 0;
        
        if (keys.W) dy -= 1;
        if (keys.S) dy += 1;
        if (keys.A) dx -= 1;
        if (keys.D) dx += 1;
        
        if (dx !== 0 && dy !== 0) {
            const length = Math.hypot(dx, dy);
            dx /= length;
            dy /= length;
        }
        
        this.x += dx * this.speed * dt;
        this.y += dy * this.speed * dt;
        
        // Clamp bounds
        const halfW = this.width / 2;
        const halfH = this.height / 2;
        if (this.x < halfW) this.x = halfW;
        if (this.x > CANVAS_WIDTH - halfW) this.x = CANVAS_WIDTH - halfW;
        if (this.y < halfH) this.y = halfH;
        if (this.y > CANVAS_HEIGHT - halfH) this.y = CANVAS_HEIGHT - halfH;
        
        // 2. Shield Recharge
        this.shieldRechargeTimer += dt;
        if (this.shieldRechargeTimer > 3.0 && this.shield < this.maxShield) {
            this.shield += this.shieldRechargeRate * dt;
            if (this.shield > this.maxShield) this.shield = this.maxShield;
        }
        
        // 3. Invulnerability Blinking
        if (this.isInvulnerable) {
            this.invulTimer += dt;
            if (this.invulTimer >= this.invulDuration) {
                this.isInvulnerable = false;
            }
        }
        
        // 4. Weapon Cooldown
        if (this.shootCooldown > 0) {
            this.shootCooldown -= dt;
        }
        
        if (keys.Space && this.shootCooldown <= 0) {
            this.fireWeapons();
        }
        
        // Twin Engines Particles Trail
        particles.push(new EngineParticle(this.x - 6, this.y + 14, '#ff007f', 4.5, false));
        particles.push(new EngineParticle(this.x + 6, this.y + 14, '#ff007f', 4.5, false));
        particles.push(new EngineParticle(this.x - 20, this.y + 12, '#00f3ff', 2.5, true));
        particles.push(new EngineParticle(this.x + 20, this.y + 12, '#00f3ff', 2.5, true));
    }

    fireWeapons() {
        this.shootCooldown = this.shootRate;
        synth.playLaser();
        
        const bSpeed = 600;
        
        switch(this.weaponLevel) {
            case 1:
                spawnPlayerBullet(this.x, this.y - 15, 0, -bSpeed);
                break;
            case 2:
                spawnPlayerBullet(this.x - 8, this.y - 12, 0, -bSpeed);
                spawnPlayerBullet(this.x + 8, this.y - 12, 0, -bSpeed);
                break;
            case 3:
                spawnPlayerBullet(this.x, this.y - 15, 0, -bSpeed);
                spawnPlayerBullet(this.x - 10, this.y - 8, -100, -bSpeed);
                spawnPlayerBullet(this.x + 10, this.y - 8, 100, -bSpeed);
                break;
            case 4:
                spawnPlayerBullet(this.x - 12, this.y - 8, -40, -bSpeed, 1.2);
                spawnPlayerBullet(this.x - 4, this.y - 15, 0, -bSpeed, 1.2);
                spawnPlayerBullet(this.x + 4, this.y - 15, 0, -bSpeed, 1.2);
                spawnPlayerBullet(this.x + 12, this.y - 8, 40, -bSpeed, 1.2);
                break;
            case 5:
                spawnPlayerBullet(this.x, this.y - 18, 0, -bSpeed, 1.5);
                spawnPlayerBullet(this.x - 10, this.y - 12, -80, -bSpeed, 1.2);
                spawnPlayerBullet(this.x + 10, this.y - 12, 80, -bSpeed, 1.2);
                spawnPlayerBullet(this.x - 20, this.y - 8, -180, -bSpeed * 0.95, 1.0);
                spawnPlayerBullet(this.x + 20, this.y - 8, 180, -bSpeed * 0.95, 1.0);
                break;
        }
    }

    draw(ctx) {
        if (this.isInvulnerable && Math.floor(Date.now() / 80) % 2 === 0) {
            return;
        }
        
        ctx.save();
        
        // 1. Draw Swept-back Wings
        ctx.fillStyle = '#0b2046';
        ctx.strokeStyle = '#00f3ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.x - 10, this.y - 4);
        ctx.lineTo(this.x - 24, this.y + 14);
        ctx.lineTo(this.x - 14, this.y + 11);
        ctx.lineTo(this.x - 8, this.y + 14);
        ctx.lineTo(this.x + 8, this.y + 14);
        ctx.lineTo(this.x + 14, this.y + 11);
        ctx.lineTo(this.x + 24, this.y + 14);
        ctx.lineTo(this.x + 10, this.y - 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 2. Navigation Lights
        ctx.fillStyle = '#ff007f';
        ctx.fillRect(this.x - 25, this.y + 12, 2, 4);
        ctx.fillRect(this.x + 23, this.y + 12, 2, 4);

        // 3. Main Fuselage
        ctx.fillStyle = '#00f3ff';
        ctx.beginPath();
        ctx.moveTo(this.x, this.y - 6);
        ctx.lineTo(this.x - 6, this.y - 20);
        ctx.lineTo(this.x - 10, this.y + 8);
        ctx.lineTo(this.x - 8, this.y + 15);
        ctx.lineTo(this.x, this.y + 10);
        ctx.lineTo(this.x + 8, this.y + 15);
        ctx.lineTo(this.x + 10, this.y + 8);
        ctx.lineTo(this.x + 6, this.y - 20);
        ctx.closePath();
        ctx.fill();

        // 4. Twin exhausts
        ctx.fillStyle = '#ff007f';
        ctx.fillRect(this.x - 8, this.y + 14, 4, 3);
        ctx.fillRect(this.x + 4, this.y + 14, 4, 3);

        // 5. Cockpit canopy
        let canopyGrad = ctx.createLinearGradient(this.x, this.y - 17, this.x, this.y + 13);
        canopyGrad.addColorStop(0, '#ffea00');
        canopyGrad.addColorStop(1, '#ff5500');
        ctx.fillStyle = canopyGrad;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y - 2, 9, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();

        // 6. Rotating Hexagonal Shield
        if (this.shield > 0) {
            ctx.save();
            ctx.strokeStyle = `rgba(0, 243, 255, ${0.22 + (this.shield / this.maxShield) * 0.48})`;
            ctx.fillStyle = `rgba(0, 243, 255, ${0.03 + Math.sin(Date.now() * 0.004) * 0.015})`;
            ctx.lineWidth = 2;
            
            const radius = this.width * 0.85;
            const rot = Date.now() * 0.0016;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2 + rot;
                const sx = this.x + Math.cos(angle) * radius;
                const sy = this.y + Math.sin(angle) * radius;
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    }
}

// Enemy Entity
class Enemy {
    constructor(x, y, type, stage) {
        this.x = x;
        this.y = y;
        this.enemyType = type;
        this.stage = stage;
        this.shootTimer = Math.random() * 1.8 + 0.2;
        this.active = true;
        
        const stageMult = 1.0 + (stage - 1) * 0.15;
        
        if (type === 'scout') {
            this.width = 30;
            this.height = 30;
            this.health = Math.round(1.5 * stageMult);
            this.speed = Math.random() * 50 + 130;
            this.sinAmp = Math.random() * 80 + 40;
            this.sinFreq = Math.random() * 3 + 2;
            this.sinOffset = Math.random() * Math.PI * 2;
            this.startX = x;
            this.color = '#00ff66';
        } else if (type === 'fighter') {
            this.width = 36;
            this.height = 36;
            this.health = Math.round(3 * stageMult);
            this.speed = 110;
            this.stopY = Math.random() * 150 + 100;
            this.behaviorState = 'descending';
            this.stateTimer = 0;
            this.color = '#ff007f';
        } else if (type === 'bomber') {
            this.width = 54;
            this.height = 46;
            this.health = Math.round(9 * stageMult);
            this.speed = 50;
            this.color = '#ffaa00';
        }
        
        this.maxHealth = this.health;
    }

    takeDamage(amount) {
        this.health -= amount;
        return this.health <= 0;
    }

    update(dt) {
        this.shootTimer += dt;
        
        if (this.enemyType === 'scout') {
            this.y += this.speed * dt;
            this.x = this.startX + Math.sin(this.y * 0.01 * this.sinFreq + this.sinOffset) * this.sinAmp;
            
            if (this.x < 15) this.x = 15;
            if (this.x > CANVAS_WIDTH - 15) this.x = CANVAS_WIDTH - 15;
            
            // Scouts shoot more frequently (2.5 seconds instead of 4.0)
            if (this.shootTimer > 2.5) {
                this.shootTimer = 0;
                spawnEnemyBullet(this.x, this.y + 10, 0, 280);
            }
        } 
        else if (this.enemyType === 'fighter') {
            if (this.behaviorState === 'descending') {
                this.y += this.speed * dt;
                if (this.y >= this.stopY) {
                    this.y = this.stopY;
                    this.behaviorState = 'hovering';
                    this.stateTimer = 0;
                    this.shootTimer = 0.5;
                }
            } 
            else if (this.behaviorState === 'hovering') {
                this.stateTimer += dt;
                
                if (player && player.active) {
                    const dx = player.x - this.x;
                    this.x += Math.sign(dx) * 35 * dt;
                }
                
                // Fighter fires guided tracking missiles!
                if (this.shootTimer > 1.8) {
                    this.shootTimer = 0;
                    if (player && player.active) {
                        const angle = Math.atan2(player.y - this.y, player.x - this.x);
                        const bSpd = 200; // Missile speed
                        spawnEnemyBullet(
                            this.x, this.y + 12,
                            Math.cos(angle) * bSpd, Math.sin(angle) * bSpd,
                            'missile'
                        );
                        synth.playEnemyLaser();
                    }
                }
                
                if (this.stateTimer > 3.0) {
                    this.behaviorState = 'escaping';
                }
            } 
            else if (this.behaviorState === 'escaping') {
                this.y += this.speed * 1.8 * dt;
            }
        } 
        else if (this.enemyType === 'bomber') {
            this.y += this.speed * dt;
            
            // Bomber fires heavy 3-way spray and guided missiles
            if (this.shootTimer > 2.2) {
                this.shootTimer = 0;
                spawnEnemyBullet(this.x, this.y + 15, -45, 180, 'heavy');
                spawnEnemyBullet(this.x, this.y + 15, 0, 180, 'heavy');
                spawnEnemyBullet(this.x, this.y + 15, 45, 180, 'heavy');
                
                // 50% chance to fire a guided tracking missile
                if (Math.random() < 0.5 && player && player.active) {
                    const angle = Math.atan2(player.y - this.y, player.x - this.x);
                    spawnEnemyBullet(this.x, this.y + 15, Math.cos(angle) * 200, Math.sin(angle) * 200, 'missile');
                }
                synth.playEnemyLaser();
            }
        }
        
        if (this.y > CANVAS_HEIGHT + 40) {
            this.active = false;
        }
    }

    draw(ctx) {
        ctx.save();
        
        if (this.enemyType === 'scout') {
            // Delta Wing Interceptor (Green)
            ctx.fillStyle = '#052410';
            ctx.strokeStyle = '#00ff66';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y + 12);
            ctx.lineTo(this.x - 15, this.y - 12);
            ctx.lineTo(this.x - 5, this.y - 6);
            ctx.lineTo(this.x, this.y - 12);
            ctx.lineTo(this.x + 5, this.y - 6);
            ctx.lineTo(this.x + 15, this.y - 12);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Fuselage
            ctx.fillStyle = '#00ff66';
            ctx.beginPath();
            ctx.moveTo(this.x, this.y + 15);
            ctx.lineTo(this.x - 4, this.y - 5);
            ctx.lineTo(this.x, this.y - 10);
            ctx.lineTo(this.x + 4, this.y - 5);
            ctx.closePath();
            ctx.fill();

            // Engine glow nozzle
            ctx.fillStyle = '#00f3ff';
            ctx.beginPath();
            ctx.arc(this.x, this.y - 8, 2.5, 0, Math.PI * 2);
            ctx.fill();
        } 
        else if (this.enemyType === 'fighter') {
            // Forward-Swept Wings (Magenta/Pink)
            ctx.fillStyle = '#54002a';
            ctx.strokeStyle = '#ff007f';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y + 18);
            ctx.lineTo(this.x - 18, this.y - 6);
            ctx.lineTo(this.x - 12, this.y - 12);
            ctx.lineTo(this.x - 4, this.y - 4);
            ctx.lineTo(this.x, this.y - 12);
            ctx.lineTo(this.x + 4, this.y - 4);
            ctx.lineTo(this.x + 12, this.y - 12);
            ctx.lineTo(this.x + 18, this.y - 6);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Main fuselage
            ctx.fillStyle = '#ff007f';
            ctx.beginPath();
            ctx.moveTo(this.x, this.y + 18);
            ctx.lineTo(this.x - 5, this.y - 2);
            ctx.lineTo(this.x - 3, this.y - 8);
            ctx.lineTo(this.x, this.y - 14);
            ctx.lineTo(this.x + 3, this.y - 8);
            ctx.lineTo(this.x + 5, this.y - 2);
            ctx.closePath();
            ctx.fill();

            // Purple Cockpit glass
            ctx.fillStyle = '#9b00ff';
            ctx.beginPath();
            ctx.ellipse(this.x, this.y + 3, 3, 6, 0, 0, Math.PI * 2);
            ctx.fill();

            // Dual engine nozzles (red)
            ctx.fillStyle = '#ff073a';
            ctx.fillRect(this.x - 5, this.y - 10, 2, 3);
            ctx.fillRect(this.x + 3, this.y - 10, 2, 3);
        } 
        else if (this.enemyType === 'bomber') {
            // 4 back engine nozzles (drawn first so wings overlay)
            ctx.fillStyle = '#ffbd00';
            ctx.fillRect(this.x - 16, this.y - 25, 3, 4);
            ctx.fillRect(this.x - 8, this.y - 25, 3, 4);
            ctx.fillRect(this.x + 5, this.y - 25, 3, 4);
            ctx.fillRect(this.x + 13, this.y - 25, 3, 4);

            // Heavy Wing Structure (Grey-Orange Wingspan)
            ctx.fillStyle = '#1c1d24';
            ctx.strokeStyle = '#ffaa00';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y - 23);
            ctx.lineTo(this.x - 27, this.y - 11);
            ctx.lineTo(this.x - 20, this.y + 15);
            ctx.lineTo(this.x - 8, this.y + 23);
            ctx.lineTo(this.x + 8, this.y + 23);
            ctx.lineTo(this.x + 20, this.y + 15);
            ctx.lineTo(this.x + 27, this.y - 11);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Wing armor details (orange plates)
            ctx.fillStyle = '#ffaa00';
            ctx.beginPath();
            ctx.moveTo(this.x - 18, this.y - 5);
            ctx.lineTo(this.x - 24, this.y - 10);
            ctx.lineTo(this.x - 18, this.y + 10);
            ctx.lineTo(this.x - 10, this.y + 5);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(this.x + 18, this.y - 5);
            ctx.lineTo(this.x + 24, this.y - 10);
            ctx.lineTo(this.x + 18, this.y + 10);
            ctx.lineTo(this.x + 10, this.y + 5);
            ctx.closePath();
            ctx.fill();

            // Wingtip sensors (cyan)
            ctx.strokeStyle = '#00f3ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.x - 22, this.y, 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(this.x + 22, this.y, 4, 0, Math.PI * 2);
            ctx.stroke();

            // Glowing core reactor (green radial gradient)
            let coreGrad = ctx.createRadialGradient(this.x, this.y, 2, this.x, this.y, 10);
            coreGrad.addColorStop(0, '#ffffff');
            coreGrad.addColorStop(0.3, '#00ff66');
            coreGrad.addColorStop(1, 'rgba(0, 255, 102, 0)');
            ctx.fillStyle = coreGrad;
            ctx.beginPath();
            ctx.arc(this.x, this.y, 10, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Health Bar overlay
        if (this.health < this.maxHealth) {
            const barW = this.width;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(this.x - barW/2, this.y - this.height/2 - 10, barW, 4);
            ctx.fillStyle = '#ff073a';
            ctx.fillRect(this.x - barW/2, this.y - this.height/2 - 10, barW * (this.health / this.maxHealth), 4);
        }
        
        ctx.restore();
    }

// Boss Entity
class Boss {
    constructor(stage) {
        this.x = CANVAS_WIDTH / 2;
        this.y = -100;
        this.width = 160;
        this.height = 100;
        this.active = true;
        
        this.maxHealth = 150 + stage * 100;
        this.health = this.maxHealth;
        this.speed = 45;
        this.targetY = 180;
        this.behavior = 'intro';
        this.timer = 0;
        this.shootTimer = 0;
        this.currentPhase = 1;
        this.angleOffset = 0;
    }

    takeDamage(amount) {
        this.health -= amount;
        return this.health <= 0;
    }

    update(dt) {
        this.timer += dt;
        this.shootTimer += dt;

        if (this.behavior === 'intro') {
            this.y += this.speed * dt;
            if (this.y >= this.targetY) {
                this.y = this.targetY;
                this.behavior = 'active';
                this.shootTimer = 0;
            }
        } 
        else {
            this.x = CANVAS_WIDTH/2 + Math.sin(this.timer * 0.8) * 120;
            
            const healthRatio = this.health / this.maxHealth;
            if (healthRatio > 0.65) {
                this.currentPhase = 1;
            } else if (healthRatio > 0.3) {
                this.currentPhase = 2;
            } else {
                this.currentPhase = 3;
            }
            
            // Firing Patterns
            if (this.currentPhase === 1) {
                if (this.shootTimer > 0.15) {
                    this.shootTimer = 0;
                    this.angleOffset += 0.22;
                    const numSpokes = 8;
                    const bSpd = 160;
                    for (let i = 0; i < numSpokes; i++) {
                        const a = (i / numSpokes) * Math.PI * 2 + this.angleOffset;
                        spawnEnemyBullet(this.x, this.y + 20, Math.cos(a) * bSpd, Math.sin(a) * bSpd);
                    }
                    synth.playEnemyLaser();
                }
            } 
            else if (this.currentPhase === 2) {
                if (this.shootTimer > 0.8) {
                    this.shootTimer = 0;
                    if (player && player.active) {
                        const angle = Math.atan2(player.y - this.y, player.x - this.x);
                        const bSpd = 220;
                        for (let i = -2; i <= 2; i++) {
                            const a = angle + i * 0.15;
                            spawnEnemyBullet(this.x, this.y + 25, Math.cos(a) * bSpd, Math.sin(a) * bSpd, 'normal', 1.2);
                        }
                        synth.playEnemyLaser();
                    }
                }
            } 
            else if (this.currentPhase === 3) {
                if (this.shootTimer > 0.08) {
                    this.shootTimer = 0;
                    this.angleOffset -= 0.18;
                    const numSpokes = 4;
                    const bSpd = 180;
                    
                    for (let i = 0; i < numSpokes; i++) {
                        const a = (i / numSpokes) * Math.PI * 2 + this.angleOffset;
                        spawnEnemyBullet(this.x - 30, this.y + 10, Math.cos(a) * bSpd, Math.sin(a) * bSpd);
                        
                        const a2 = (i / numSpokes) * Math.PI * 2 - this.angleOffset;
                        spawnEnemyBullet(this.x + 30, this.y + 10, Math.cos(a2) * bSpd, Math.sin(a2) * bSpd);
                    }
                    
                    if (Math.random() < 0.15 && player && player.active) {
                        const angle = Math.atan2(player.y - this.y, player.x - this.x);
                        spawnEnemyBullet(this.x, this.y + 35, Math.cos(angle) * 320, Math.sin(angle) * 320, 'heavy', 2.5);
                    }
                    synth.playEnemyLaser();
                }
            }
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.fillStyle = '#ff073a';
        
        ctx.beginPath();
        ctx.moveTo(this.x, this.y + 50); // Nose cone
        ctx.lineTo(this.x - 50, this.y + 10);
        ctx.lineTo(this.x - 80, this.y - 20); // Left wingtip
        ctx.lineTo(this.x - 40, this.y - 40);
        ctx.lineTo(this.x, this.y - 15); // Core valley
        ctx.lineTo(this.x + 40, this.y - 40);
        ctx.lineTo(this.x + 80, this.y - 20); // Right wingtip
        ctx.lineTo(this.x + 50, this.y + 10);
        ctx.closePath();
        ctx.fill();
        
        ctx.strokeStyle = '#00f3ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.x - 40, this.y);
        ctx.lineTo(this.x, this.y + 30);
        ctx.lineTo(this.x + 40, this.y);
        ctx.stroke();

        let coreColor = '#00ff66';
        if (this.currentPhase === 2) coreColor = '#ffaa00';
        if (this.currentPhase === 3) coreColor = '#ff073a';
        
        ctx.fillStyle = coreColor;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 14, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
}

// Bullet Entity
class Bullet {
    constructor(x, y, vx, vy, isPlayer, damage = 1, type = 'normal') {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.isPlayer = isPlayer;
        this.damage = damage;
        this.bulletType = type;
        this.active = true;
        
        this.size = isPlayer ? 4 : 5;
        if (type === 'heavy') this.size = 7;
        if (type === 'missile') this.size = 6;
    }

    update(dt) {
        if (this.bulletType === 'missile') {
            if (player && player.active) {
                const dx = player.x - this.x;
                const dy = player.y - this.y;
                const dist = Math.hypot(dx, dy);
                if (dist > 10) {
                    const speed = 200; // Fixed speed for enemy guided missile
                    const targetVx = (dx / dist) * speed;
                    const targetVy = (dy / dist) * speed;
                    
                    // Smooth tracking steering
                    this.vx += (targetVx - this.vx) * 2.2 * dt;
                    this.vy += (targetVy - this.vy) * 2.2 * dt;
                    
                    // Re-normalize velocity to keep constant speed
                    const currentSpeed = Math.hypot(this.vx, this.vy);
                    if (currentSpeed > 0) {
                        this.vx = (this.vx / currentSpeed) * speed;
                        this.vy = (this.vy / currentSpeed) * speed;
                    }
                }
            }
            
            // Guided missile orange-yellow smoke trails
            if (Math.random() < 0.28) {
                particles.push(new SparkParticle(this.x, this.y, '#ff8800'));
            }
        }

        this.x += this.vx * dt;
        this.y += this.vy * dt;
        
        if (this.y < -30 || this.y > CANVAS_HEIGHT + 30 || this.x < -30 || this.x > CANVAS_WIDTH + 30) {
            this.active = false;
        }
    }

    draw(ctx) {
        if (this.bulletType === 'missile') {
            ctx.save();
            ctx.translate(this.x, this.y);
            const angle = Math.atan2(this.vy, this.vx);
            ctx.rotate(angle);
            
            // Missile fuselage shape (pointed tip, red body)
            ctx.fillStyle = '#ff073a';
            ctx.beginPath();
            ctx.moveTo(10, 0);
            ctx.lineTo(-6, -4);
            ctx.lineTo(-10, -4);
            ctx.lineTo(-8, 0);
            ctx.lineTo(-10, 4);
            ctx.lineTo(-6, 4);
            ctx.closePath();
            ctx.fill();
            
            // White stabilizers
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-10, -5, 2, 10);
            
            // Flame booster glow (orange-yellow circle)
            ctx.fillStyle = '#ffbd00';
            ctx.beginPath();
            ctx.arc(-11, 0, 3 + Math.random() * 2, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.restore();
            return;
        }

        ctx.save();
        if (this.isPlayer) {
            ctx.fillStyle = '#00f3ff';
            ctx.fillRect(this.x - 2, this.y - 12, 4, 18);
        } else {
            const color = this.bulletType === 'heavy' ? '#ff8800' : '#ff073a';
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

// Loot Diamond Entity
class LootItem {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.lootType = type;
        this.radius = 8;
        this.active = true;
        
        this.vx = (Math.random() - 0.5) * 60;
        this.vy = Math.random() * 40 + 40;
    }

    update(dt) {
        if (player && player.active) {
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const dist = Math.hypot(dx, dy);
            
            if (dist < player.magnetRange) {
                const pullSpeed = 420;
                this.vx = (dx / dist) * pullSpeed;
                this.vy = (dy / dist) * pullSpeed;
            } else {
                this.vx *= 0.98;
            }
        }
        
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        
        if (this.y > CANVAS_HEIGHT + 20) {
            this.active = false;
        }
    }

    draw(ctx) {
        ctx.save();
        
        let color = '#ffffff';
        if (this.lootType === 'weapon_upgrade') color = '#ff007f';
        else if (this.lootType === 'shield_refill') color = '#0088ff';
        else if (this.lootType === 'bomb') color = '#e600ff';
        else color = '#ffbd00'; // crystal
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(10, 10, 20, 0.6)';
        
        ctx.beginPath();
        ctx.moveTo(this.x, this.y - this.radius);
        ctx.lineTo(this.x + this.radius, this.y);
        ctx.lineTo(this.x, this.y + this.radius);
        ctx.lineTo(this.x - this.radius, this.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Inner indicator
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
}

// --- Parallax Background Stars Setup ---
function initStars() {
    stars = [];
    for (let i = 0; i < 60; i++) {
        stars.push({
            x: Math.random() * CANVAS_WIDTH,
            y: Math.random() * CANVAS_HEIGHT,
            speed: Math.random() * 30 + 40,
            size: Math.random() * 1.0 + 0.5,
            color: '#ffffff',
            alpha: 0.4
        });
    }
    for (let i = 0; i < 20; i++) {
        stars.push({
            x: Math.random() * CANVAS_WIDTH,
            y: Math.random() * CANVAS_HEIGHT,
            speed: Math.random() * 80 + 90,
            size: Math.random() * 1.5 + 1.2,
            color: '#9bffff',
            alpha: 0.75
        });
    }
}

function updateBackground(dt) {
    stars.forEach(star => {
        star.y += star.speed * dt;
        if (star.y > CANVAS_HEIGHT) {
            star.y = -10;
            star.x = Math.random() * CANVAS_WIDTH;
        }
    });
}

// --- Game Logic Engine Actions ---

function startNewGame() {
    synth.init();
    synth.resume();
    loadStats();

    // Reset keyboard captures to avoid sticky states on reload
    keys.W = false;
    keys.A = false;
    keys.S = false;
    keys.D = false;
    keys.Space = false;

    playerBullets = [];
    enemyBullets = [];
    enemies = [];
    lootItems = [];
    particles = [];
    boss = null;

    player = new Player(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 100);

    score = 0;
    crystalsCollected = 0;
    stage = 1;
    stageTime = 0;
    isBossSpawning = false;
    enemySpawnTimer = 0;
    enemySpawnDelay = 2.5;
    flashTimer = 0;
    shakeTimer = 0;

    gameState = STATES.PLAYING;
    
    hideAllMenus();
    document.getElementById('hud').classList.add('active');
    updateHUD();

    synth.stopBGM();
    synth.startBGM();
}

function togglePause() {
    if (gameState !== STATES.PLAYING && gameState !== STATES.PAUSED) return;

    if (gameState === STATES.PLAYING) {
        gameState = STATES.PAUSED;
        document.getElementById('pause-menu').classList.add('active');
    } else if (gameState === STATES.PAUSED) {
        gameState = STATES.PLAYING;
        document.getElementById('pause-menu').classList.remove('active');
    }
}

function triggerQuantumBomb() {
    if (!player || !player.active || player.bombs <= 0) return;
    
    player.bombs--;
    updateHUD();
    
    // Screen flash & camera shake
    flashTimer = flashDuration;
    cameraShake(0.8, 21);
    synth.playBomb();
    
    // Quantum purple particle burst across screen
    for (let i = 0; i < 80; i++) {
        particles.push(new BombParticle(
            Math.random() * CANVAS_WIDTH,
            Math.random() * CANVAS_HEIGHT,
            '#e600ff'
        ));
    }
    
    // Clear all enemy bullets
    enemyBullets = [];
    
    // Heavy damage all standard enemies
    enemies.forEach(enemy => {
        const isDead = enemy.takeDamage(20);
        if (isDead) {
            enemy.active = false;
            score += enemy.maxHealth * 10;
            explodeEntity(enemy.x, enemy.y, enemy.color, enemy.width);
            spawnLoot(enemy.x, enemy.y);
        }
    });
    
    // Hit boss
    if (boss && boss.active && boss.behavior !== 'intro') {
        const isBossDead = boss.takeDamage(40);
        if (isBossDead) {
            triggerBossVictory();
        }
    }
}

function spawnPlayerBullet(x, y, vx, vy, damage = 1.0) {
    const bullet = new Bullet(x, y, vx, vy, true, damage);
    playerBullets.push(bullet);
    return bullet;
}

function spawnEnemyBullet(x, y, vx, vy, type = 'normal', damage = 1.0) {
    const bullet = new Bullet(x, y, vx, vy, false, damage, type);
    enemyBullets.push(bullet);
    return bullet;
}

function spawnLoot(x, y) {
    const rand = Math.random();
    let itemType = '';
    if (rand < 0.25) itemType = 'crystal';
    else if (rand < 0.29) itemType = 'weapon_upgrade';
    else if (rand < 0.33) itemType = 'shield_refill';
    else if (rand < 0.35) itemType = 'bomb';
    
    if (itemType !== '') {
        const loot = new LootItem(x, y, itemType);
        lootItems.push(loot);
    }
}

function explodeEntity(x, y, colorCode, scale = 30) {
    synth.playExplosion(scale > 40 ? 1.8 : 0.8);
    cameraShake(scale > 40 ? 0.45 : 0.22, scale > 40 ? 8 : 4);
    
    const amount = scale > 40 ? 45 : 15;
    for (let i = 0; i < amount; i++) {
        particles.push(new ExplosionParticle(x, y, colorCode, scale > 40 ? 6.0 : 3.5));
    }
}

function cameraShake(duration, intensity) {
    shakeTimer = duration;
    shakeIntensity = intensity;
}

// --- Collision Checking Helpers ---

function checkCollision(objA, objB, threshold) {
    return Math.hypot(objA.x - objB.x, objA.y - objB.y) < threshold;
}

function checkCollisions() {
    if (!player || !player.active) return;

    // 1. playerBullets vs enemies
    playerBullets.forEach(bullet => {
        if (!bullet.active) return;
        enemies.forEach(enemy => {
            if (!enemy.active) return;
            const threshold = enemy.width / 2 + bullet.size;
            if (checkCollision(bullet, enemy, threshold)) {
                bullet.active = false;
                
                // Spawn impact sparks
                for (let i = 0; i < 3; i++) {
                    particles.push(new SparkParticle(bullet.x, bullet.y, enemy.color));
                }
                
                const isDead = enemy.takeDamage(bullet.damage);
                if (isDead) {
                    enemy.active = false;
                    score += enemy.maxHealth * 10;
                    explodeEntity(enemy.x, enemy.y, enemy.color, enemy.width);
                    spawnLoot(enemy.x, enemy.y);
                }
            }
        });
        
        // playerBullets vs Boss
        if (boss && boss.active && boss.behavior !== 'intro') {
            const bx = Math.abs(bullet.x - boss.x);
            const by = Math.abs(bullet.y - boss.y);
            if (bx < boss.width * 0.45 && by < boss.height * 0.4) {
                bullet.active = false;
                
                for (let i = 0; i < 4; i++) {
                    particles.push(new SparkParticle(bullet.x, bullet.y, '#ffffff'));
                }
                
                const isBossDead = boss.takeDamage(bullet.damage);
                if (isBossDead) {
                    triggerBossVictory();
                }
            }
        }
    });

    // 2. enemyBullets vs player
    enemyBullets.forEach(bullet => {
        if (!bullet.active) return;
        const threshold = 9 + bullet.size; // player hitbox radius (9) + bullet size
        if (checkCollision(bullet, player, threshold)) {
            bullet.active = false;
            
            for (let i = 0; i < 5; i++) {
                particles.push(new SparkParticle(bullet.x, bullet.y, '#00f3ff'));
            }
            
            const isDead = player.takeDamage(bullet.damage * 10);
            updateHUD();
            
            if (isDead) {
                triggerGameOver();
            }
        }
    });

    // 3. enemies vs player (crash)
    enemies.forEach(enemy => {
        if (!enemy.active) return;
        const threshold = enemy.width / 2 + 9;
        if (checkCollision(enemy, player, threshold)) {
            enemy.active = false;
            explodeEntity(enemy.x, enemy.y, enemy.color, enemy.width);
            
            const isDead = player.takeDamage(35);
            updateHUD();
            
            if (isDead) {
                triggerGameOver();
            }
        }
    });

    // 4. lootItems vs player
    lootItems.forEach(loot => {
        if (!loot.active) return;
        const threshold = 20; // Collection radius
        if (checkCollision(loot, player, threshold)) {
            loot.active = false;
            
            if (loot.lootType === 'crystal') {
                crystalsCollected++;
                synth.playPowerup();
            } 
            else if (loot.lootType === 'weapon_upgrade') {
                player.addWeaponUpgrade();
            } 
            else if (loot.lootType === 'shield_refill') {
                player.addShieldRefill();
            } 
            else if (loot.lootType === 'bomb') {
                player.addBomb();
            }
            
            updateHUD();
        }
    });
}

// --- End Game State Handlers ---

function triggerBossVictory() {
    score += 5000;
    explodeEntity(boss.x, boss.y, '#ff073a', 80);
    
    // Crystal fountain drops
    for (let i = 0; i < 15; i++) {
        const loot = new LootItem(
            boss.x + (Math.random() - 0.5) * 60,
            boss.y + (Math.random() - 0.5) * 40,
            'crystal'
        );
        lootItems.push(loot);
    }
    
    // Powerups
    lootItems.push(new LootItem(boss.x - 20, boss.y, 'weapon_upgrade'));
    lootItems.push(new LootItem(boss.x + 20, boss.y, 'bomb'));
    
    boss.active = false;
    boss = null;
    
    gameState = STATES.VICTORY;
    synth.stopBGM();
    
    userStats.crystals += crystalsCollected;
    saveStats();
    
    setTimeout(() => {
        hideAllMenus();
        const scoreEl = document.getElementById('victory-score');
        const crystalEl = document.getElementById('victory-crystals');
        if (scoreEl) scoreEl.textContent = score;
        if (crystalEl) crystalEl.textContent = crystalsCollected;
        document.getElementById('victory-screen').classList.add('active');
    }, 1800);
}

function triggerGameOver() {
    gameState = STATES.GAMEOVER;
    synth.stopBGM();
    explodeEntity(player.x, player.y, '#00f3ff', 50);
    
    player.active = false;
    
    userStats.crystals += crystalsCollected;
    saveStats();
    
    setTimeout(() => {
        hideAllMenus();
        const scoreEl = document.getElementById('final-score');
        const crystalEl = document.getElementById('collected-crystals');
        if (scoreEl) scoreEl.textContent = score;
        if (crystalEl) crystalEl.textContent = crystalsCollected;
        document.getElementById('game-over-screen').classList.add('active');
    }, 1500);
}

// --- General UI Helper Functions ---

function hideAllMenus() {
    const screens = ['start-menu', 'hangar-menu', 'pause-menu', 'game-over-screen', 'victory-screen', 'hud'];
    screens.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.classList.remove('active');
    });
}

function updateHUD() {
    if (!player) return;
    
    const scoreEl = document.getElementById('hud-score');
    const stageEl = document.getElementById('hud-stage');
    const crystalEl = document.getElementById('hud-crystals');
    const wpEl = document.getElementById('hud-weapon-level');
    const shieldEl = document.getElementById('bar-shield');
    const armorEl = document.getElementById('bar-armor');
    
    if (scoreEl) scoreEl.textContent = String(score).padStart(6, '0');
    if (stageEl) stageEl.textContent = stage;
    if (crystalEl) crystalEl.textContent = crystalsCollected;
    if (wpEl) wpEl.textContent = `Lv ${player.weaponLevel}`;
    
    const shieldPct = Math.max(0, (player.shield / player.maxShield) * 100);
    const armorPct = Math.max(0, (player.armor / player.maxArmor) * 100);
    if (shieldEl) shieldEl.style.width = `${shieldPct}%`;
    if (armorEl) armorEl.style.width = `${armorPct}%`;
    
    const bombSlots = document.getElementById('bomb-indicators');
    if (bombSlots) {
        bombSlots.innerHTML = '';
        for (let i = 0; i < 4; i++) {
            const slot = document.createElement('div');
            slot.className = 'bomb-icon';
            if (i < player.bombs) {
                slot.className += ' active';
            }
            bombSlots.appendChild(slot);
        }
    }
}

// --- Main Loop Functions ---

function update(dt) {
    // Background and particles keep updating in all menus for aesthetics
    updateBackground(dt);
    particles.forEach(p => p.update(dt));
    particles = particles.filter(p => p.life > 0);

    if (gameState !== STATES.PLAYING) return;
    
    stageTime += dt;
    
    if (shakeTimer > 0) shakeTimer -= dt;
    
    // Update player and boss
    if (player && player.active) player.update(dt);
    if (boss && boss.active) boss.update(dt);
    
    // Spawn Enemies
    if (!boss && !isBossSpawning) {
        enemySpawnTimer += dt;
        const thresholdTime = 40 + stage * 10;
        
        if (stageTime < thresholdTime) {
            if (enemySpawnTimer >= enemySpawnDelay) {
                enemySpawnTimer = 0;
                enemySpawnDelay = Math.max(0.8, 2.3 - stage * 0.2);
                
                const rand = Math.random();
                const spawnX = Math.random() * (CANVAS_WIDTH - 80) + 40;
                if (rand < 0.55 || stage === 1) {
                    enemies.push(new Enemy(spawnX, -40, 'scout', stage));
                } else if (rand < 0.85) {
                    enemies.push(new Enemy(spawnX, -40, 'fighter', stage));
                } else {
                    enemies.push(new Enemy(spawnX, -40, 'bomber', stage));
                }
            }
        } else {
            // Trigger Boss Alert
            isBossSpawning = true;
            const warn = document.getElementById('boss-warning');
            if (warn) warn.classList.add('active');
            
            setTimeout(() => {
                if (warn) warn.classList.remove('active');
                if (gameState === STATES.PLAYING) {
                    boss = new Boss(stage);
                }
                isBossSpawning = false;
            }, 4000);
        }
    }
    
    // Update groups
    playerBullets.forEach(b => b.update(dt));
    enemyBullets.forEach(b => b.update(dt));
    enemies.forEach(e => e.update(dt));
    lootItems.forEach(l => l.update(dt));
    
    // Trigger Collision Checks
    checkCollisions();
    
    // Filter inactive objects
    playerBullets = playerBullets.filter(b => b.active);
    enemyBullets = enemyBullets.filter(b => b.active);
    enemies = enemies.filter(e => e.active);
    lootItems = lootItems.filter(l => l.active);
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    ctx.save();
    // Camera shake transformation
    if (shakeTimer > 0) {
        const dx = (Math.random() - 0.5) * shakeIntensity;
        const dy = (Math.random() - 0.5) * shakeIntensity;
        ctx.translate(dx, dy);
    }
    
    // 1. Draw Starfield
    stars.forEach(star => {
        ctx.fillStyle = star.color;
        ctx.globalAlpha = star.alpha;
        ctx.fillRect(star.x, star.y, star.size, star.size);
    });
    ctx.globalAlpha = 1.0;
    
    // 2. Draw Particles (Additive blending simulation via ordering)
    particles.forEach(p => p.draw(ctx));
    
    // 3. Draw Game Entities (Only if in game states)
    if (gameState === STATES.PLAYING || gameState === STATES.PAUSED || gameState === STATES.GAMEOVER || gameState === STATES.VICTORY) {
        lootItems.forEach(item => item.draw(ctx));
        playerBullets.forEach(bullet => bullet.draw(ctx));
        enemyBullets.forEach(bullet => bullet.draw(ctx));
        enemies.forEach(enemy => enemy.draw(ctx));
        if (boss && boss.active) boss.draw(ctx);
        if (player && player.active) player.draw(ctx);
    }
    
    ctx.restore();
    
    // 4. Quantum Bomb screen flash
    if (flashTimer > 0) {
        const ratio = Math.max(0, flashTimer / flashDuration);
        ctx.fillStyle = `rgba(230, 0, 255, ${ratio * 0.45})`;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
}

let lastTime = performance.now();
function gameLoop(time) {
    let dt = (time - lastTime) / 1000.0;
    if (dt > 0.1) dt = 0.1;
    lastTime = time;
    
    update(dt);
    draw();
    
    requestAnimationFrame(gameLoop);
}

// --- Initialize and Connect UI Events ---
window.addEventListener('DOMContentLoaded', () => {
    try {
        loadStats();
        initStars();
        
        // Start engine loop
        requestAnimationFrame(gameLoop);

        // Keyboard captures
        const gameKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyB', 'KeyP', 'Escape'];
        
        window.addEventListener('keydown', (e) => {
            if (gameKeys.includes(e.code)) {
                e.preventDefault();
            }
            
            // Movement keys mapping
            if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.W = true;
            if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.S = true;
            if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.A = true;
            if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.D = true;
            
            if (e.code === 'Space') keys.Space = true;
            
            // Action trigger taps
            if (e.code === 'KeyB') {
                if (gameState === STATES.PLAYING) {
                    triggerQuantumBomb();
                }
            }
            if (e.code === 'KeyP' || e.code === 'Escape') {
                if (gameState === STATES.PLAYING || gameState === STATES.PAUSED) {
                    togglePause();
                }
            }
        });
        
        window.addEventListener('keyup', (e) => {
            if (gameKeys.includes(e.code)) {
                e.preventDefault();
            }
            if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.W = false;
            if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.S = false;
            if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.A = false;
            if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.D = false;
            if (e.code === 'Space') keys.Space = false;
        });

        // Unfocus any button after clicking to prevent spacebar conflicts
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (btn) {
                btn.blur();
            }
        });

        // --- Hook HUD UI Overlay Buttons ---
        
        // Start Game
        document.getElementById('btn-start').addEventListener('click', () => {
            startNewGame();
        });

        // Go to Hangar upgrade shop
        document.getElementById('btn-hangar').addEventListener('click', () => {
            gameState = STATES.HANGAR;
            hideAllMenus();
            updateHangarUI();
            document.getElementById('hangar-menu').classList.add('active');
            synth.init();
            synth.resume();
        });

        // Exit Hangar shop
        document.getElementById('btn-hangar-back').addEventListener('click', () => {
            gameState = STATES.MENU;
            hideAllMenus();
            document.getElementById('start-menu').classList.add('active');
        });

        // Resume from Pause overlay
        document.getElementById('btn-resume').addEventListener('click', () => {
            togglePause();
        });

        // Restart from Pause overlay
        document.getElementById('btn-pause-restart').addEventListener('click', () => {
            togglePause();
            startNewGame();
        });

        // Quit to main menu from Pause overlay
        document.getElementById('btn-pause-quit').addEventListener('click', () => {
            gameState = STATES.MENU;
            hideAllMenus();
            document.getElementById('start-menu').classList.add('active');
            synth.stopBGM();
        });

        // Retry after Game Over
        document.getElementById('btn-retry').addEventListener('click', () => {
            startNewGame();
        });

        // Return to hangar from Game Over screen
        document.getElementById('btn-over-hangar').addEventListener('click', () => {
            gameState = STATES.HANGAR;
            hideAllMenus();
            updateHangarUI();
            document.getElementById('hangar-menu').classList.add('active');
        });

        // Continue to hangar after Victory
        document.getElementById('btn-victory-continue').addEventListener('click', () => {
            gameState = STATES.HANGAR;
            hideAllMenus();
            updateHangarUI();
            document.getElementById('hangar-menu').classList.add('active');
        });

        // Upgrade category shop clicks
        const upgrades = ['armor', 'shield', 'weapon', 'magnet', 'bombs'];
        upgrades.forEach(cat => {
            const btn = document.getElementById(`btn-upgrade-${cat}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    buyUpgrade(cat);
                });
            }
        });
        
    } catch (e) {
        // Display critical startup exceptions inside error block
        const overlay = document.getElementById('error-overlay');
        if (overlay) {
            overlay.style.display = 'block';
            document.getElementById('error-msg').textContent = "初始化階段出錯 (Init Error): " + e.message;
            document.getElementById('error-stack').textContent = e.stack || 'No stack trace';
        }
        console.error(e);
    }
});
