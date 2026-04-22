// AI & Genetic Algorithm Logic - IA RACER PRO

// Colors for the cars
var CCOLS = ['#4fc3f7', '#ffb74d', '#f48fb1', '#ce93d8', '#80cbc4', '#fff176', '#ff8a65', '#a5d6a7', '#90caf9', '#ef9a9a', '#b39ddb', '#80deea', '#ffe082', '#c5e1a5', '#ffcc80', '#b0bec5', '#f8bbd0', '#d1c4e9', '#b2dfdb', '#ffe0b2', '#fff9c4', '#e1bee7', '#bbdefb', '#dcedc8', '#81c784'];
var SANGS = [-75, -45, -20, 0, 20, 45, 75].map(function (a) { return a * Math.PI / 180; });
var SL = 200;

// Global Simulation State
var gen = 0, gbl = Infinity, cars = [], top3ids = new Set();
var bestDistFound = 0; // Track the all-time furthest distance reached
var bestDistNet = null; // Store the weights (brain) of the best explorer
var bestLapNet = null; // Store the weights of the all-time best lap
var lastRecordGen = 0; // The generation when the lap record was last broken
var lastDistRecordGen = 0; // The generation when the distance record was last broken
var currentLaps = 1, currentMut = 0.15, prevBestFitness = -Infinity, staleCount = 0;
var CL = [], OUT = [], INN = [], loaded = false, startLine = null, TW = 50;
var phys = { 
    vmax: 220, // km/h
    accel: 6.0, // 0-100 in s
    maneuver: 50, // 0-100%
    drivetrain: 'RWD', // FWD, RWD, 4WD, AWD
    engine: 'M', // F (Front), M (Mid), R (Rear)
    sm: 10 // Visualization scale
};
var train = { pop: 28, elite: 3, inject: 0.2, mutBase: 0.15, mutMin: 0.05, mutMax: 0.45, stale: 3, ftime: 0.7, fpen: 0.5, fbonus: 8000, lapStart: 1, lapMax: 8, lapThresh: 0.5, lapValid: 0.85, safety: 2.5, stagLimit: 100, stagConfirm: true };
var isEditing = true, sctx = null, actF = new Set(['speed', 'laps', 'bl', 'fit']);
var fineTuneProfile = null; // Profile loaded for fine-tuning
var isCompareMode = false; // Flag for comparison mode
var genHistory = []; // Track metrics for charting
var finishTimer = -1; // New: countdown after first finisher
var isRaceMode = false; // New: Strategy mode
var useFuel = true; // New: Toggle fuel system

// Helper functions 
function relu(x) { return x > 0 ? x : 0; }
function segi(ax, ay, bx, by, cx, cy, dx, dy) {
    var d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(d) < 1e-10) return null;
    var t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { t: t, x: ax + t * (bx - ax), y: ay + t * (by - ay) };
    return null;
}
function raycast(ox, oy, ang) {
    var ex = ox + Math.cos(ang) * SL, ey = oy + Math.sin(ang) * SL, best = SL, bx = ex, by = ey;
    [OUT, INN].forEach(function (poly) {
        if (!poly) return;
        for (var i = 0; i < poly.length; i++) {
            var j = (i + 1) % poly.length;
            var r = segi(ox, oy, ex, ey, poly[i][0], poly[i][1], poly[j][0], poly[j][1]);
            if (r && r.t * SL < best) { best = r.t * SL; bx = r.x; by = r.y; }
        }
    });
    return { dist: best, ex: bx, ey: by };
}
function nearCL(px, py) {
    var md = 1e18, idx = 0;
    for (var i = 0; i < CL.length; i++) {
        var dx = px - CL[i][0], dy = py - CL[i][1], d = dx * dx + dy * dy;
        if (d < md) { md = d; idx = i; }
    }
    return idx;
}
function checkCross(x, y, px, py) {
    if (!startLine) return false;
    return segi(x, y, px, py, startLine.ax, startLine.ay, startLine.bx, startLine.by) !== null;
}

// Neural Network Class
function Net(w) { this.w = w || this.rnd(); }
Net.prototype.rnd = function () {
    var H = 24, w = { l1: [], b1: [], l2: [], b2: [] };
    var inputSize = 20; 
    for (var i = 0; i < H; i++) { 
        w.l1.push(Array.from({ length: inputSize }, function () { return (Math.random() - 0.5) * 2; })); 
        w.b1.push((Math.random() - 0.5) * 0.5); 
    }
    for (var i = 0; i < 3; i++) { 
        var row = Array.from({ length: H }, function () { return (Math.random() - 0.5) * 2; });
        // Bias the first output (Throttle) to be more likely positive in Gen 0
        if (i === 0) row = row.map(function(v) { return v + 0.2; });
        w.l2.push(row); 
        w.b2.push(i === 0 ? 0.1 : (Math.random() - 0.5) * 0.5); 
    }
    return w;
};
Net.prototype.fwd = function (inp) {
    var w = this.w;
    // Iterate over row.length instead of inp.length to handle mismatches gracefully
    var h = w.l1.map(function (row, i) { 
        var s = w.b1[i]; 
        var len = Math.min(row.length, inp.length);
        for (var j = 0; j < len; j++) s += row[j] * inp[j]; 
        return relu(s); 
    });
    return w.l2.map(function (row, i) { 
        var s = w.b2[i]; 
        for (var j = 0; j < h.length; j++) s += row[j] * h[j]; 
        return Math.tanh(s); 
    });
};
Net.prototype.clone = function () { return new Net(JSON.parse(JSON.stringify(this.w))); };
Net.prototype.mut = function (r) {
    var nw = JSON.parse(JSON.stringify(this.w));
    function m(a) { return a.map(function (v) { return Math.random() < r ? v + (Math.random() - 0.5) * 0.6 : v; }); }
    nw.l1 = nw.l1.map(function (x) { return m(x); }); nw.b1 = m(nw.b1); nw.l2 = nw.l2.map(function (x) { return m(x); }); nw.b2 = m(nw.b2);
    return new Net(nw);
};

// Car Class
function Car(net, id, col, customPhys, profileName, tuning) {
    this.id = id; this.col = col; this.net = net || new Net();
    this.phys = customPhys ? JSON.parse(JSON.stringify(customPhys)) : JSON.parse(JSON.stringify(phys));
    this.profileName = profileName || null;
    this.tuning = tuning || []; // Array of tuning item objects: { id, name, vmax, accel, maneuver }
    
    this.x = startLine ? startLine.x : 0; this.y = startLine ? startLine.y : 0; this.ang = startLine ? startLine.ang : 0;
    this.spd = 0; this.slip = 0; this.tw = 1;
    this.alive = true; this.finished = false;
    this.prevIdx = startLine ? startLine.idx : 0; this.totalD = 0; this.stuck = 0;
    this.laps = 0; this.lapTimes = []; this.lapStartFrame = 0; this.fc = 0; this.finishFrame = 0;
    this.lastZoneFrame = 0; 
    this.prevX = this.x; this.prevY = this.y; this.crossCD = 0;
    this.sens = []; this.thrOut = 0; this.brkOut = 0; this.msens = 1; this._fitness = 0;
    this.ZONES = 24;
    this.zonesHit = new Array(this.ZONES).fill(false);
    
    this.tw = 1.0; 
    this.totalSlip = 0; 
    this.fuel = customPhys ? (customPhys.fuelLiters || 100) : 100;
    this.compound = customPhys ? (customPhys.compound || 'M') : 'M';
}
Car.prototype.lapCoverageOk = function () { 
    return this.lapProgress() >= (train.lapValid || 0.85); 
};
Car.prototype.bestLap = function () { return this.lapTimes.length ? Math.min.apply(null, this.lapTimes) : Infinity; };
Car.prototype.calcFitness = function () {
    var lapBonus = this.laps * train.fbonus;
    var timePenalty = this.fc * train.fpen;
    var distBonus = this.totalD * (1 - train.ftime);
    var timeBonus = this.finished ? (train.fbonus * currentLaps * 2 - this.finishFrame * train.ftime) : 0;
    
    // Stability Bonus/Penalty: Reward cars that drive with less unnecessary sliding
    var stabilityFactor = (this.totalSlip / (this.fc || 1)) * 50; 
    
    return lapBonus + distBonus + timeBonus - timePenalty - stabilityFactor;
};
Car.prototype.lapCoverageOk = function () {
    var hit = 0; for (var i = 0; i < this.ZONES; i++) if (this.zonesHit[i]) hit++;
    return (hit / this.ZONES) >= train.lapValid;
};
Car.prototype.resetLapTracking = function () { this.zonesHit = new Array(this.ZONES).fill(false); };
Car.prototype.upd = function () {
    if (!this.alive) return;
    this.fc++;
    var self = this;
    var sens = SANGS.map(function (a) { return raycast(self.x, self.y, self.ang + a); });
    var minW = sens.reduce(function (a, b) { return a.dist < b.dist ? a : b; }).dist;
    
    // Strict collision check with 0.5s margin to prevent instant death on spawn jitter
    if (this.fc > 30 && minW < 4.0) { this.alive = false; this._fitness = this.calcFitness(); return; }
    
    this.sens = sens; this.msens = minW / SL;

    var p = this.phys;
    
    // Apply Tuning effects
    var tune_vmax = 0, tune_accel = 0, tune_maneuver = 0;
    this.tuning.forEach(function(t) {
        tune_vmax += (t.vmax || 0);
        tune_accel += (t.accel || 0);
        tune_maneuver += (t.maneuver || 0);
    });

    // Effective Stats
    var eVmax_kmh = p.vmax + tune_vmax;
    var eAccel_0_100 = Math.max(0.1, p.accel + tune_accel);
    var eManeuver = Math.max(0, Math.min(100, p.maneuver + tune_maneuver));

    // Internal Simulation Conversion
    var internalVmax = eVmax_kmh / p.sm;
    var internalAccelForce = (100 / p.sm) / (eAccel_0_100 * 0.96); // 0.96 = 60fps * 0.016 step
    
    var inp = sens.map(function (s) { return s.dist / SL; });
    inp.push(this.spd / internalVmax);
    inp.push(this.slip / 30);
    
    // --- Context Awareness Inputs (Specs) ---
    inp.push(eVmax_kmh / 400); // UI max 400
    inp.push(eAccel_0_100 / 15); // UI max 15
    inp.push(eManeuver / 100); // UI max 100
    
    var dtVal = 0; // FWD
    if (p.drivetrain === 'RWD') dtVal = 1;
    else if (p.drivetrain === '4WD') dtVal = 0.33;
    else if (p.drivetrain === 'AWD') dtVal = 0.66;
    inp.push(dtVal);
    
    var engVal = 0.5; // M
    if (p.engine === 'F') engVal = 0;
    else if (p.engine === 'R') engVal = 1;
    inp.push(engVal);

    // --- Look-ahead Awareness (Track knowledge) ---
    var n = CL.length;
    if (n > 0) {
        [15, 40, 80].forEach(function(offset) {
            var tIdx = (self.prevIdx + offset) % n;
            var target = CL[tIdx];
            var angToT = Math.atan2(target[1] - self.y, target[0] - self.x);
            var diff = angToT - self.ang;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            inp.push(diff / Math.PI); 
        });

        // --- NEW: Lane & Orientation Awareness ---
        var curP = CL[self.prevIdx], nextP = CL[(self.prevIdx + 1) % n];
        var trackAng = Math.atan2(nextP[1] - curP[1], nextP[0] - curP[0]);
        
        // 18. Relative Heading (Am I aligned with the track?)
        var relHead = self.ang - trackAng;
        while (relHead > Math.PI) relHead -= Math.PI * 2;
        while (relHead < -Math.PI) relHead += Math.PI * 2;
        inp.push(relHead / Math.PI);

        // 19. Lateral Position (Where am I in the lane? -1 to 1)
        var dx = self.x - curP[0], dy = self.y - curP[1];
        var dist = Math.sqrt(dx*dx + dy*dy);
        var cross = Math.cos(trackAng) * dy - Math.sin(trackAng) * dx;
        inp.push(Math.max(-2, Math.min(2, (dist / (TW/2)) * (cross > 0 ? 1 : -1))));

        // 20. Lap Progress (0 to 1)
        inp.push(self.prevIdx / n);
    } else {
        inp.push(0, 0, 0, 0, 0, 0);
    }

    var out = this.net.fwd(inp);
    // Neutral output (0) now means 0 throttle and 0 brake.
    var thr = Math.max(0, out[0]); 
    var brk = Math.max(0, out[1]);
    this.thrOut = thr; this.brkOut = brk;

    // Acceleration & Braking Logic
    var af = (thr * internalAccelForce);
    if (brk > 0.4 && this.spd > 1.0) { // Only cut throttle if braking hard and moving
        thr = 0; 
        this.spd = Math.max(0, this.spd - (internalAccelForce * 12 * brk * 0.016));
    }

    if (thr > 0.05) {
        this.spd += (thr * internalAccelForce) * 0.016;
        this.spd *= 0.999; 
    } else if (brk <= 0.1) {
        this.spd *= 0.98; 
    }
    
    // Final Cap at V-MAX
    this.spd = Math.max(0, Math.min(internalVmax, this.spd));
    
    // Steering & Maneuverability (Speed Sensitive)
    var sr = this.spd / internalVmax; // Speed ratio
    
    // Base Steering Angle with speed-based reduction (Understeer)
    // At high speed, the car turns much less.
    var steerPower = 1.0 - (sr * 0.75); // Lose up to 75% steering at V-MAX
    var baseSteerAngle = (0.05 + (eManeuver / 100) * 0.1) * steerPower;
    var si = out[2] * baseSteerAngle * (this.spd > 0.1 ? 1 : 0);
    
    // Engine Position & Drivetrain Impact
    var oversteerFactor = 0.2;
    if (p.engine === 'R') oversteerFactor = 0.45;
    else if (p.engine === 'F') oversteerFactor = 0.1;

    var tractionGrip = 1;
    if (p.drivetrain === 'RWD') {
        oversteerFactor *= (1 + thr * 0.5); // RWD oversteers more on power
    } else if (p.drivetrain === 'FWD') {
        si *= (1 - thr * 0.3); // FWD understeers on power
        oversteerFactor *= 0.5;
    }

    // Centrifugal Understeer (Go "long" physics)
    // As speed increase, steering efficacy decreases if we exceed "grip"
    var gripThreshold = 0.2 + (eManeuver / 100) * 0.4;
    var lateralForce = Math.abs(si) * this.spd;
    if (lateralForce > gripThreshold) {
        var slipLoss = (lateralForce - gripThreshold) * 0.5;
        si /= (1 + slipLoss); // Car goes "longer"
    }

    this.ang += si + (this.slip * (oversteerFactor/10) * sr);
    
    // Slip Angle Calculation
    var gripStability = 0.3 + (eManeuver / 100) * 0.5;
    this.slip = Math.max(-40, Math.min(40, (this.slip + si * this.spd * oversteerFactor * 8) * (1 - gripStability * 0.1)));

    this.totalSlip += Math.abs(this.slip);

    this.prevX = this.x; this.prevY = this.y;

    // Movement Update
    var windShift = (p.wi || 0) * 0.004;
    this.x += Math.cos(this.ang) * this.spd + Math.sin(this.ang) * (this.slip * 0.012) - windShift;
    this.y += Math.sin(this.ang) * this.spd - Math.cos(this.ang) * (this.slip * 0.012);

    if (isNaN(this.x) || isNaN(this.y)) { this.x = 0; this.y = 0; this.alive = false; return; }

    var idx = nearCL(this.x, this.y);
    
    // MANUAL DEATH WALLS CHECK: Kill car if it hits a user-drawn red line
    if (loaded && typeof deathWalls !== 'undefined') {
        for (var i = 0; i < deathWalls.length; i++) {
            var wall = deathWalls[i];
            for (var j = 0; j < wall.length - 1; j++) {
                if (lineIntersect(this.px, this.py, this.x, this.y, wall[j][0], wall[j][1], wall[j+1][0], wall[j+1][1])) {
                    this.alive = false;
                    this._fitness = this.calcFitness();
                    return;
                }
            }
        }
    }

    // STRICT OFF-TRACK GEODETECTION: Kill car if it strays too far from the center line
    if (loaded && CL.length > 0 && CL[idx]) {
        var dx = this.x - CL[idx][0], dy = this.y - CL[idx][1];
        var distSq = dx*dx + dy*dy;
        var limit = (TW / 2) * (train.safety || 2.0); 
        if (distSq > limit * limit) { 
            this.alive = false; this._fitness = this.calcFitness(); return; 
        }
    }

    var n = CL.length;
    if (n === 0) return; 
    var fwd = (idx - this.prevIdx + n) % n;
    // Allow small progress or even neutral to reduce "stuck" sensitivity at start
    if (fwd >= 0 && fwd < n / 2) { 
        if (fwd > 0) { this.totalD += fwd; this.stuck = 0; }
        else { this.stuck++; } // Still same point
    } else { 
        this.stuck++; // Backwards
    }

    // Increased stuck limit (10 seconds)
    if (this.stuck > 600 || (this.fc - this.lastZoneFrame > 1500)) { 
        this.alive = false; 
        this._fitness = this.calcFitness(); 
        return; 
    }
    
    // Checkpoint progress check (10 seconds timeout)
    var zone = Math.floor((idx / n) * this.ZONES);
    if (!this.zonesHit[zone]) {
        this.zonesHit[zone] = true;
        this.lastZoneFrame = this.fc; // Reset timer when a new zone is reached
    }

    if (this.stuck > 420 || (this.fc - this.lastZoneFrame > 1200)) { 
        this.alive = false; 
        this._fitness = this.calcFitness(); 
        return; 
    }
    this.prevIdx = idx;

    if (this.crossCD > 0) { this.crossCD--; return; }
    if (this.fc > 60 && checkCross(this.x, this.y, this.prevX, this.prevY)) {
        if (this.lapCoverageOk()) {
            var lapF = this.fc - this.lapStartFrame;
            this.lapTimes.push(lapF);
            if (lapF < gbl) {
                gbl = lapF;
                lastRecordGen = gen;
                bestLapNet = JSON.parse(JSON.stringify(this.net.w));
                if (typeof createProfileFromCar === 'function') {
                    createProfileFromCar(this, true);
                }
            }
            // Reloop dead/finished cars in Compare/Race mode
            if (compareCars.length > 0 && compareCars.filter(function(c){return c.alive}).length === 0) {
                compareCars.forEach(function(c) {
                    c.x = startLine.x; c.y = startLine.y; c.ang = startLine.ang;
                    c.spd = 0; c.slip = 0; c.alive = true; c.finished = false;
                    c.fc = 0; c.prevIdx = startLine.idx; c.totalD = 0; c.stuck = 0;
                    c.laps = 0; c.lapStartFrame = 0; c.finishFrame = 0; c.lapTimes = [];
                    c.resetLapTracking(); c.crossCD = 0; c.tw = 1; c.totalSlip = 0;
                    if (isRaceMode) {
                        var strat = raceStrategy[profiles[c.id] ? profiles[c.id].id : 0] || { fuel: 50 };
                        c.fuel = c.phys.fuelLiters || 50;
                    }
                });
            }
            this.laps++;
            this.lapStartFrame = this.fc;
            this.crossCD = 40;
            this.resetLapTracking();
            this.lastZoneFrame = this.fc; // Reset zone timer on new lap
            if (isRaceMode && useFuel) {
                this.fuel = Math.max(0, this.fuel - (p.fpl || 2)); // Subtract fuel per lap
            }
            this.resetLapTracking();
            if (this.laps >= currentLaps) { 
                this.finished = true; 
                this.finishFrame = this.fc; 
                this._fitness = this.calcFitness(); 
                this.alive = false; 
                if (finishTimer === -1) finishTimer = 300; // Start 5s countdown
            }
        } else {
            this._fitness -= 2000; this.crossCD = 60; this.resetLapTracking();
        }
    }
};
Car.prototype.lapProgress = function () {
    var hit = 0; for (var i = 0; i < this.ZONES; i++) if (this.zonesHit[i]) hit++; return hit / this.ZONES;
};
Car.prototype.draw = function (isBest, isTop3, showS) {
    if (!sctx) return;
    var alive = this.alive, finished = this.finished;
    sctx.save();
    if (showS && this.sens.length && alive) {
        sctx.globalAlpha = 0.1;
        var col = this.col;
        this.sens.forEach(function (s) { sctx.beginPath(); sctx.moveTo(this.x, this.y); sctx.lineTo(s.ex, s.ey); sctx.strokeStyle = col; sctx.lineWidth = 0.8; sctx.stroke(); }, this);
    }
    if (!alive && !finished) {
        sctx.globalAlpha = 0.07; sctx.translate(this.x, this.y); sctx.rotate(this.ang); sctx.fillStyle = this.col;
        sctx.beginPath(); sctx.moveTo(9, 0); sctx.lineTo(-6, 5); sctx.lineTo(-3, 0); sctx.lineTo(-6, -5); sctx.closePath(); sctx.fill();
        sctx.restore(); return;
    }
    sctx.globalAlpha = finished ? 0.5 : 1;
    if (Math.abs(this.slip) > 8) {
        sctx.globalAlpha = finished ? 0.15 : 0.25; sctx.fillStyle = this.col;
        sctx.beginPath(); sctx.arc(this.x - Math.cos(this.ang) * 5, this.y - Math.sin(this.ang) * 5, 4, 0, Math.PI * 2); sctx.fill();
    }
    sctx.globalAlpha = finished ? 0.5 : 1;
    sctx.translate(this.x, this.y); sctx.rotate(this.ang);
    sctx.fillStyle = isBest ? '#ffeb3b' : isTop3 ? '#81c784' : this.col;
    
    // Rectangular Body
    var w = 14, h = 8;
    sctx.beginPath();
    sctx.roundRect(-w/2, -h/2, w, h, 2);
    sctx.fill();
    
    // Front and Back indication
    sctx.fillStyle = 'rgba(255,255,255,0.4)';
    sctx.fillRect(w/2 - 4, -h/2 + 1, 3, h-2); // Front windshield
    sctx.fillStyle = 'rgba(0,0,0,0.3)';
    sctx.fillRect(-w/2 + 1, -h/2 + 1, 2, h-2); // Rear spoiler/area
    
    if (isBest) { sctx.font = 'bold 7px sans-serif'; sctx.fillStyle = '#000'; sctx.textAlign = 'center'; sctx.fillText('1', 0, 3); }
    var prog = this.lapProgress();
    if (prog > 0 && alive) {
        sctx.globalAlpha = 0.7;
        sctx.beginPath(); sctx.arc(0, 0, 7, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
        sctx.strokeStyle = prog >= train.lapValid ? '#81c784' : '#4fc3f7';
        sctx.lineWidth = 1.5; sctx.stroke();
    }
    sctx.restore();
};

// Evolution Management
function resetTraining() {
    gen = 0; gbl = Infinity; bestDistFound = 0; bestDistNet = null; cars = []; top3ids = new Set();
    lastRecordGen = 0; lastDistRecordGen = 0;
    currentLaps = train.lapStart; currentMut = train.mutBase;
    prevBestFitness = -Infinity; staleCount = 0;
    genHistory = [];
    var info = document.getElementById('info-box');
    if (info) info.textContent = 'Entrenamiento reiniciado.';
}

function selectTop3(carList) {
    var finished = carList.filter(function (c) { return c.finished && c.laps >= currentLaps; });
    if (finished.length >= 3) { finished.sort(function (a, b) { return a.finishFrame - b.finishFrame; }); return { mode: 'tiempo', selected: finished.slice(0, 3) }; }
    if (finished.length > 0) {
        var rest = carList.filter(function (c) { return !c.finished; }).sort(function (a, b) { return b._fitness - a._fitness; });
        finished.sort(function (a, b) { return a.finishFrame - b.finishFrame; });
        return { mode: 'mixto', selected: finished.concat(rest).slice(0, 3) };
    }
    // NO FINISHERS -> Selection by PURE DISTANCE
    return { mode: 'distancia', selected: carList.slice().sort(function (a, b) { return b.totalD - a.totalD; }).slice(0, 3) };
}

function newGen() {
    if (!loaded || CL.length < 10) return;
    finishTimer = -1; // Reset countdown
    var selResult = { mode: 'init', selected: [] };
    if (cars.length > 0) {
        cars.forEach(function (c) { if (c.alive) { c.alive = false; c._fitness = c.calcFitness(); } });
        selResult = selectTop3(cars);
        var bestFit = Math.max.apply(null, cars.map(function (c) { return c._fitness; }));
        var finCount = cars.filter(function (c) { return c.finished; }).length;
        var finRate = finCount / cars.length;
        var improved = bestFit > prevBestFitness * 1.01;
        
        // Auto Fine-Tuning Trigger: N gens without record improvement
        if (gbl !== Infinity && gen - lastRecordGen > train.stagLimit && bestLapNet) {
            lastRecordGen = gen; // Reset trigger
            var info = document.getElementById('info-box');
            if (info) info.innerHTML = '<span style="color:#ffb74d; font-weight:bold;">¡RECUPERACIÓN AUTOMÁTICA!</span> Reinyectando el mejor cerebro histórico por estancamiento.';
            console.log("Auto-Recovery triggered: Reinjecting best lap brain.");
            
            // Override fineTuneProfile for this generation
            fineTuneProfile = { net: JSON.parse(JSON.stringify(bestLapNet)) };
            gen = 1; // Force a "re-launch" from the best base
            currentMut = train.mutBase;
        }

        if (improved) { staleCount = 0; currentMut = Math.max(train.mutMin, currentMut * 0.85); }
        else { 
            staleCount++; 
            if (staleCount >= train.stale) { 
                currentMut = Math.min(train.mutMax, currentMut * 1.4); 
                staleCount = 0; 
            } 
        }

        // Distance Record Logic: Save the best explorer if no lap finished yet
        var genBestExplorer = cars.slice().sort(function(a,b){ return b.totalD - a.totalD; })[0];
        if (gbl === Infinity && genBestExplorer && genBestExplorer.totalD > bestDistFound && genBestExplorer.totalD > 20) {
            bestDistFound = genBestExplorer.totalD;
            lastDistRecordGen = gen; // Update distance record timestamp
            bestDistNet = JSON.parse(JSON.stringify(genBestExplorer.net.w)); // Memorize the brain
            if (typeof createProfileFromCar === 'function') {
                createProfileFromCar(genBestExplorer, false, "EXPLORADOR (GEN " + gen + ")");
            }
        }

        // --- NEW DECISION POINTS (Confirmation Prompts - Synchronous) ---

        // Case A: Stagnation in Explorer Phase (no laps done)
        if (gbl === Infinity && bestDistNet && gen - lastDistRecordGen >= train.stagLimit) {
            var doReset = !train.stagConfirm || confirm("⚠️ ESTANCAMIENTO DETECTADO\n\nNadie ha completado una vuelta tras " + train.stagLimit + " generaciones. ¿Deseas reiniciar el entrenamiento usando al mejor EXPLORADOR como base única y forzar el progreso?");
            if (doReset) {
                lastDistRecordGen = gen; 
                fineTuneProfile = { net: JSON.parse(JSON.stringify(bestDistNet)) };
                gen = 1; staleCount = 0; currentMut = train.mutBase;
            } else {
                lastDistRecordGen = gen; // Ignorar por otras N
            }
        }

        // Case B: Stagnation in Lap Phase (lap record stalls)
        if (gbl !== Infinity && gen - lastRecordGen >= train.stagLimit && bestLapNet) {
            var doReset = !train.stagConfirm || confirm("⚠️ RÉCORD ESTANCADO\n\nLlevamos " + train.stagLimit + " generaciones sin mejorar el tiempo. ¿Deseas forzar una RECUPERACIÓN AUTOMÁTICA usando el mejor cerebro histórico?");
            if (doReset) {
                lastRecordGen = gen;
                fineTuneProfile = { net: JSON.parse(JSON.stringify(bestLapNet)) };
                gen = 1; staleCount = 0; currentMut = train.mutBase;
            } else {
                lastRecordGen = gen; // Ignorar por otras N
            }
        }

        if (improved) { staleCount = 0; currentMut = Math.max(train.mutMin, currentMut * 0.85); }

        var lapsIncreased = false;
        if (finRate >= train.lapThresh && currentLaps < train.lapMax) { currentLaps++; staleCount = 0; currentMut = train.mutBase; lapsIncreased = true; }

        var avgFitness = cars.reduce(function (sum, c) { return sum + c._fitness; }, 0) / cars.length;
        var allLaps = cars.map(function (c) { return c.bestLap(); }).filter(function (l) { return l !== Infinity && l > 0; });
        var genBestLap = allLaps.length > 0 ? Math.min.apply(null, allLaps) : null;

        genHistory.push({
            gen: gen,
            bestLap: genBestLap,
            avgFitness: avgFitness,
            completionRate: finRate,
            lapsIncreased: lapsIncreased
        });

        prevBestFitness = Math.max(prevBestFitness, bestFit);
        if (typeof drawChart === 'function') drawChart();

        var info = document.getElementById('info-box');
        if (info) {
            var modeStr = selResult.mode === 'tiempo' ? 'top 3 por tiempo' : selResult.mode === 'mixto' ? 'mixto tiempo+fitness' : 'top 3 por fitness';
            var selStr = selResult.selected.map(function (c) { return c.finished ? (c.finishFrame / 60).toFixed(2) + 's' : 'fit:' + Math.round(c._fitness); }).join(' / ');
            info.innerHTML = 'Gen <span>' + gen + '</span> | Mut: <span>' + currentMut.toFixed(3) + '</span> | Objeto: <span>' + currentLaps + 'v</span><br>Sel: <span>' + selStr + '</span>';
        }
    }
    gen++;
    top3ids = new Set(selResult.selected.map(function (c) { return c.id; }));
    var eliteNets = selResult.selected.map(function (c) { return c.net; });
    var newNets = [];
    var eliteCount = Math.min(train.elite, eliteNets.length);
    for (var i = 0; i < eliteCount; i++) newNets.push(eliteNets[i % eliteNets.length].clone());
    
    // Inject the all-time best explorer if no lap finished yet
    if (gbl === Infinity && bestDistNet) {
        newNets.push(new Net(JSON.parse(JSON.stringify(bestDistNet))));
    }

    for (var i = 0; i < eliteCount; i++) newNets.push(eliteNets[i % eliteNets.length].mut(currentMut * 0.3));
    for (var i = 0; i < eliteCount; i++) newNets.push(eliteNets[i % eliteNets.length].mut(currentMut * 0.6));
    var injectN = Math.floor(train.pop * train.inject);
    for (var i = 0; i < injectN; i++) newNets.push(new Net());

    // Fine-Tuning Injection: 100% of the population from the seed
    if (fineTuneProfile && gen === 1) {
        var baseSeed = new Net(fineTuneProfile.net);
        newNets = []; // Total clear to remove stagnant models
        console.log("Fine-Tuning pivot: Total reset to best-ever seed.");
        while (newNets.length < train.pop) {
            newNets.push(baseSeed.mut(currentMut * (Math.random() * 0.8)));
        }
    } else {
        while (newNets.length < train.pop) {
            var base = eliteNets.length > 0 ? eliteNets[Math.floor(Math.random() * eliteNets.length)] : new Net();
            newNets.push(base.mut(currentMut * (0.7 + Math.random() * 0.6)));
        }
    }
    while (newNets.length > train.pop) newNets.pop();
    cars = newNets.map(function (n, i) { 
        var c = new Car(n, i, CCOLS[i % CCOLS.length]);
        // Inherit current base tuning if applicable
        if (typeof currentAppliedTuning !== 'undefined') c.tuning = JSON.parse(JSON.stringify(currentAppliedTuning));
        return c;
    });
}

function lineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    var det = (x2 - x1) * (y4 - y3) - (x4 - x3) * (y2 - y1);
    if (det === 0) return false;
    var lambda = ((y4 - y3) * (x4 - x1) + (x3 - x4) * (y4 - y1)) / det;
    var gamma = ((y1 - y2) * (x4 - x1) + (x1 - x2) * (y4 - y1)) / det;
    return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
}

if (typeof module !== 'undefined') module.exports = { Net, Car, newGen };
else window.ai = { Net, Car, newGen };
