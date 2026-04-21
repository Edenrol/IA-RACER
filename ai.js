// AI & Genetic Algorithm Logic - IA RACER PRO

// Colors for the cars
var CCOLS = ['#4fc3f7', '#ffb74d', '#f48fb1', '#ce93d8', '#80cbc4', '#fff176', '#ff8a65', '#a5d6a7', '#90caf9', '#ef9a9a', '#b39ddb', '#80deea', '#ffe082', '#c5e1a5', '#ffcc80', '#b0bec5', '#f8bbd0', '#d1c4e9', '#b2dfdb', '#ffe0b2', '#fff9c4', '#e1bee7', '#bbdefb', '#dcedc8', '#81c784'];
var SANGS = [-75, -45, -20, 0, 20, 45, 75].map(function (a) { return a * Math.PI / 180; });
var SL = 200;

// Global Simulation State
var gen = 0, gbl = Infinity, cars = [], top3ids = new Set();
var currentLaps = 1, currentMut = 0.15, prevBestFitness = -Infinity, staleCount = 0;
var CL = [], OUT = [], INN = [], loaded = false, startLine = null, TW = 50;
var phys = { a: 3.5, ms: 5.5, tt: 0.5, br: 5, bb: 0.6, abs: 0, dr: 0.97, df: 0.5, ma: 1.2, gr: 0.08, ov: 0.2, st: 0.07, co: 0.5, dg: 0, tg: 1, wi: 0, sm: 10 };
var train = { pop: 28, elite: 3, inject: 0.2, mutBase: 0.15, mutMin: 0.05, mutMax: 0.45, stale: 3, ftime: 0.7, fpen: 0.5, fbonus: 8000, lapStart: 1, lapMax: 8, lapThresh: 0.5, lapValid: 0.85 };
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
    var H = 10, w = { l1: [], b1: [], l2: [], b2: [] };
    for (var i = 0; i < H; i++) { w.l1.push(Array.from({ length: 9 }, function () { return (Math.random() - 0.5) * 2; })); w.b1.push((Math.random() - 0.5) * 0.5); }
    for (var i = 0; i < 3; i++) { w.l2.push(Array.from({ length: H }, function () { return (Math.random() - 0.5) * 2; })); w.b2.push((Math.random() - 0.5) * 0.5); }
    return w;
};
Net.prototype.fwd = function (inp) {
    var w = this.w;
    var h = w.l1.map(function (row, i) { var s = w.b1[i]; for (var j = 0; j < inp.length; j++)s += row[j] * inp[j]; return relu(s); });
    return w.l2.map(function (row, i) { var s = w.b2[i]; for (var j = 0; j < h.length; j++)s += row[j] * h[j]; return Math.tanh(s); });
};
Net.prototype.clone = function () { return new Net(JSON.parse(JSON.stringify(this.w))); };
Net.prototype.mut = function (r) {
    var nw = JSON.parse(JSON.stringify(this.w));
    function m(a) { return a.map(function (v) { return Math.random() < r ? v + (Math.random() - 0.5) * 0.6 : v; }); }
    nw.l1 = nw.l1.map(function (x) { return m(x); }); nw.b1 = m(nw.b1); nw.l2 = nw.l2.map(function (x) { return m(x); }); nw.b2 = m(nw.b2);
    return new Net(nw);
};

// Car Class
function Car(net, id, col, customPhys, profileName) {
    this.id = id; this.col = col; this.net = net || new Net();
    this.phys = customPhys || phys;
    this.profileName = profileName || null;
    this.x = startLine ? startLine.x : 0; this.y = startLine ? startLine.y : 0; this.ang = startLine ? startLine.ang : 0;
    this.spd = 0; this.slip = 0; this.tw = 1;
    this.alive = true; this.finished = false;
    this.prevIdx = startLine ? startLine.idx : 0; this.totalD = 0; this.stuck = 0;
    this.laps = 0; this.lapTimes = []; this.lapStartFrame = 0; this.fc = 0; this.finishFrame = 0;
    this.lastZoneFrame = 0; // New: track when the last new zone was hit
    this.prevX = this.x; this.prevY = this.y; this.crossCD = 0;
    this.sens = []; this.thrOut = 0; this.brkOut = 0; this.msens = 1; this._fitness = 0;
    this.ZONES = 24;
    this.zonesHit = new Array(this.ZONES).fill(false);
    
    // Race Strategy Props (Race Mode only)
    this.fuel = this.phys.fuelLiters || 50; 
    this.compound = this.phys.compound || 'M'; // S, M, H
    this.tw = 1.0; // Tyre life starts at 100%
}
Car.prototype.bestLap = function () { return this.lapTimes.length ? Math.min.apply(null, this.lapTimes) : Infinity; };
Car.prototype.calcFitness = function () {
    var lapBonus = this.laps * train.fbonus;
    var timePenalty = this.fc * train.fpen;
    var distBonus = this.totalD * (1 - train.ftime);
    var timeBonus = this.finished ? (train.fbonus * currentLaps * 2 - this.finishFrame * train.ftime) : 0;
    return lapBonus + distBonus + timeBonus - timePenalty;
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
    if (minW < 3.5) { this.alive = false; this._fitness = this.calcFitness(); return; }
    this.sens = sens; this.msens = minW / SL;

    var p = this.phys || phys;

    var compM = p.co < 0.35 ? 1.15 : p.co > 0.65 ? 0.85 : 1;
    var eg = p.gr * p.tg * compM * this.tw;
    var dfB = 1 + p.df * (this.spd / p.ms) * 0.5;
    var tg2 = eg * dfB;

    var inp = sens.map(function (s) { return s.dist / SL; });
    inp.push(this.spd / p.ms);
    inp.push(this.slip / 30);

    var out = this.net.fwd(inp);
    var thr = Math.max(0, Math.min(1, (out[0] + 1) / 2));
    var brk = Math.max(0, Math.min(1, (out[1] + 1) / 2));
    this.thrOut = thr; this.brkOut = brk;

    var absA = p.abs > 0.5 ? Math.max(0.2, 1 - (this.spd / p.ms) * 0.8) : 1;
    
    // Advanced Physics (Race Mode)
    var curMass = p.ma;
    if (isRaceMode) {
        if (useFuel) {
            curMass = p.ma + (this.fuel * 0.005); 
            if (this.fuel <= 0) { thr = 0; } // No fuel, no power
        }
    }

    // Tyre Grip Impact
    var compMod = this.compound === 'S' ? 1.2 : (this.compound === 'H' ? 0.9 : 1.0);
    var gripMod = compMod * (this.tw > 0.2 ? 1 : (this.tw / 0.2)); 
    
    var af = (thr * p.a) / curMass;
    var bf = (brk * p.br * absA * (0.5 + p.bb)) / curMass;

    this.spd = Math.max(0, Math.min(p.ms, (this.spd + af * 0.016 - bf * this.spd * 0.016) * p.dr));
    var sr = this.spd / p.ms;
    var mst = p.st * (1 - sr * 0.6) * dfB;
    var si = out[2] * mst * (this.spd > 0.2 ? 1 : 0);
    this.ang += si + (this.slip * 0.002 * sr);
    
    // Adjusted Grip in slip formula
    var tg2_mod = tg2 * gripMod;
    this.slip = Math.max(-40, Math.min(40, (this.slip + si * this.spd * p.ov) * (1 - tg2_mod * (0.3 + sr * 0.4) * 0.5)));

    if (isRaceMode) {
        var wBase = p.dg * 0.1, wBrk = brk * p.dg * 0.8, wCor = Math.abs(si) * p.dg * 1.5, wSlp = Math.abs(this.slip) * p.dg * 3.0;
        var cDeg = this.compound === 'S' ? 3.5 : (this.compound === 'H' ? 0.4 : 1.0);
        this.tw = Math.max(0, this.tw - (wBase + wBrk + wCor + wSlp) * cDeg);
    } else {
        if (p.dg > 0) this.tw = Math.max(0.4, this.tw - p.dg * (1 + Math.abs(this.slip) * 0.05));
    }
    this.prevX = this.x; this.prevY = this.y;

    // Movement Update
    var windShift = (p.wi || 0) * 0.004;
    this.x += Math.cos(this.ang) * this.spd + Math.sin(this.ang) * (this.slip * 0.012) - windShift;
    this.y += Math.sin(this.ang) * this.spd - Math.cos(this.ang) * (this.slip * 0.012);

    if (isNaN(this.x) || isNaN(this.y)) { this.x = 0; this.y = 0; this.alive = false; return; }

    var idx = nearCL(this.x, this.y);
    var n = CL.length;
    var fwd = (idx - this.prevIdx + n) % n;
    if (fwd > 0 && fwd < n / 2) { this.totalD += fwd; this.stuck = 0; } else { this.stuck++; }
    
    // Checkpoint progress check (10 seconds timeout)
    var zone = Math.floor((idx / n) * this.ZONES);
    if (!this.zonesHit[zone]) {
        this.zonesHit[zone] = true;
        this.lastZoneFrame = this.fc; // Reset timer when a new zone is reached
    }

    if (this.stuck > 180 || (this.fc - this.lastZoneFrame > 600)) { 
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
                if (typeof createProfileFromCar === 'function') {
                    createProfileFromCar(this, true);
                }
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
    sctx.beginPath(); sctx.moveTo(9, 0); sctx.lineTo(-6, 5); sctx.lineTo(-3, 0); sctx.lineTo(-6, -5); sctx.closePath(); sctx.fill();
    if (isBest) { sctx.font = 'bold 8px sans-serif'; sctx.fillStyle = '#000'; sctx.textAlign = 'center'; sctx.fillText('1', 1, 3); }
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
    gen = 0; gbl = Infinity; cars = []; top3ids = new Set();
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
    return { mode: 'fitness', selected: carList.slice().sort(function (a, b) { return b._fitness - a._fitness; }).slice(0, 3) };
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
        if (improved) { staleCount = 0; currentMut = Math.max(train.mutMin, currentMut * 0.85); }
        else { staleCount++; if (staleCount >= train.stale) { currentMut = Math.min(train.mutMax, currentMut * 1.4); staleCount = 0; } }

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
    for (var i = 0; i < eliteCount; i++) newNets.push(eliteNets[i % eliteNets.length].mut(currentMut * 0.3));
    for (var i = 0; i < eliteCount; i++) newNets.push(eliteNets[i % eliteNets.length].mut(currentMut * 0.6));
    var injectN = Math.floor(train.pop * train.inject);
    for (var i = 0; i < injectN; i++) newNets.push(new Net());

    // Fine-Tuning Injection
    if (fineTuneProfile && gen === 1) {
        var baseSeed = new Net(fineTuneProfile.net);
        while (newNets.length < train.pop) {
            newNets.push(baseSeed.mut(currentMut * (0.5 + Math.random() * 0.5)));
        }
    } else {
        while (newNets.length < train.pop) {
            var base = eliteNets.length > 0 ? eliteNets[Math.floor(Math.random() * eliteNets.length)] : new Net();
            newNets.push(base.mut(currentMut * (0.7 + Math.random() * 0.6)));
        }
    }
    while (newNets.length > train.pop) newNets.pop();
    cars = newNets.map(function (n, i) { return new Car(n, i, CCOLS[i % CCOLS.length]); });
}
