// AI & Genetic Algorithm Logic - IA RACER PRO
// REWRITE v3 — fixes aplicados:
// 1. Red neuronal 20→32→16→3 (2 capas ocultas)
// 2. Throttle/freno con rango completo (out+1)/2
// 3. Throttle y freno mutuamente excluyentes (1 output para accel/brake)
// 4. Bug staleCount doble reset corregido
// 5. Stuck limits reducidos (600→180, 1500→600)
// 6. Look-ahead con fracciones relativas al circuito
// 7. Todos los inputs normalizados a [-1,1]
// 8. Input de aceleración (delta velocidad) agregado
// 9. Input 20 (lap progress redundante) eliminado
// 10. fineTuneActive flag separado del numero de gen
// 11. Penalización por dirección inversa en fitness
// 12. lapCoverageOk duplicado removido

var CCOLS = ['#4fc3f7', '#ffb74d', '#f48fb1', '#ce93d8', '#80cbc4', '#fff176', '#ff8a65', '#a5d6a7', '#90caf9', '#ef9a9a', '#b39ddb', '#80deea', '#ffe082', '#c5e1a5', '#ffcc80', '#b0bec5', '#f8bbd0', '#d1c4e9', '#b2dfdb', '#ffe0b2', '#fff9c4', '#e1bee7', '#bbdefb', '#dcedc8', '#81c784'];
var SANGS = [-75, -45, -20, 0, 20, 45, 75].map(function (a) { return a * Math.PI / 180; });
var SL = 200;

// Global Simulation State
var gen = 0, gbl = Infinity, cars = [], top3ids = new Set();
var bestDistFound = 0;
var bestDistNet = null;
var bestLapNet = null;
var lastRecordGen = 0;
var lastDistRecordGen = 0;
var currentLaps = 1, currentMut = 0.15, prevBestFitness = -Infinity, staleCount = 0;
var CL = [], OUT = [], INN = [], loaded = false, startLine = null, TW = 50;
var clDist = [], clTotalLen = 0;
var phys = {
    vmax: 220,
    accel: 6.0,
    maneuver: 50,
    drivetrain: 'RWD',
    engine: 'M',
    sm: 10
};
var train = {
    pop: 28, elite: 3, inject: 0.2,
    mutBase: 0.15, mutMin: 0.05, mutMax: 0.35, stale: 5,
    ftime: 0.7, fpen: 0.5, fbonus: 8000,
    lapStart: 1, lapMax: 8, lapThresh: 0.5, lapValid: 0.85,
    safety: 2.5, stagLimit: 50, stagConfirm: true
};
var isEditing = true, sctx = null, actF = new Set(['speed', 'laps', 'bl', 'fit']);

// ==================== AUTO TRAIN ====================
var autoTrain = {
    active: false,
    phase: 0,  // 0=EXPLORE, 1=CURRICULUM, 2=LAPS, 3=CMAES
    phaseNames: ['EXPLORACIÓN', 'COBERTURA', 'VUELTAS', 'OPTIMIZAR'],
    phaseColors: ['#4fc3f7', '#7c4dff', '#00e676', '#ce93d8'],
    sectorStuckGens: 0,   // gens seguidas con hitRate<5% (para switch aislado)
    sectorTotalStuck: 0,  // gens totales atascado en sector actual (no se resetea)
    prevSector: -1,       // detecta cuándo avanza el sector
    origThresh: 0.6,      // umbral original del usuario (para restaurar al avanzar sector)
    lapReadyGens: 0,
    lastPhaseGen: 0
};

function autoTrainSetPhase(phase) {
    autoTrain.phase = phase;
    autoTrain.lastPhaseGen = gen;
    autoTrain.sectorStuckGens = 0;
    autoTrain.sectorTotalStuck = 0;
    autoTrain.prevSector = -1;
    autoTrain.lapReadyGens = 0;
    staleCount = 0;
    currentMut = train.mutBase;
    prevBestFitness = -Infinity;
    if (typeof updateAutoTrainUI === 'function') updateAutoTrainUI();
}

function autoTrainTick(finRate, hitRate) {
    if (!autoTrain.active) return;
    var gensInPhase = gen - autoTrain.lastPhaseGen;

    if (autoTrain.phase === 0) {
        // EXPLORE: CMA-ES cold start — aprende conducción básica eficientemente.
        // Siempre iniciar desde red ALEATORIA con sigma=0.5 (exploración amplia).
        // NO usar cmaesToggle: si hay autos disponibles usaría sigma=0.15, demasiado estrecho.
        distributedSpawnMode = false;
        curriculumMode = false;
        if (!cmaes.active) {
            cmaesInit(new Net(), 0.5);
        }
        if (gbl !== Infinity) {
            // Primera vuelta durante exploración → Phase 3 (re-seed CMA-ES desde bestLapNet)
            if (bestLapNet) {
                var reseeded = new Net(JSON.parse(JSON.stringify(bestLapNet)));
                cmaesInit(reseeded, 0.15);
            }
            autoTrainSetPhase(3);
            return;
        }
        // Transición por tiempo fijo: 30 gens = ~690 evaluaciones.
        // Para n=563 pesos con lambda≈23: necesita ~25 gens mínimo. 30 da margen suficiente.
        // NO esperar estancamiento: si CMA-ES mejora, lastDistRecordGen nunca estagna y fase 0 no terminaría.
        if (gensInPhase >= 30) {
            if (cmaes.mean && cmaes.templateW) {
                var cmaesNet = netUnflatten(cmaes.mean, cmaes.templateW);
                bestDistNet = JSON.parse(JSON.stringify(cmaesNet));
                // Sembrar Phase 1 explícitamente desde la media CMA-ES, no desde elites aleatorias
                fineTuneProfile = { net: JSON.parse(JSON.stringify(cmaesNet)) };
                fineTuneActive = true;
                currentMut = train.mutBase * 0.5;
            }
            cmaes.active = false;
            autoTrainSetPhase(1);
        }
    }
    else if (autoTrain.phase === 1) {
        // COBERTURA: distributed spawn CMA-ES.
        // Todos los autos spawnean distribuidos por toda la pista cada generación.
        // CMA-ES aprende una política que funciona desde CUALQUIER posición del track.
        // Sin forgetting, sin distribution shift. Mejor transferencia a vuelta completa.
        if (!distributedSpawnMode) {
            distributedSpawnMode = true;
            curriculumMode = false;
            if (typeof updateCurriculumUI === 'function') updateCurriculumUI();
            var p1Seed = bestDistNet
                ? new Net(JSON.parse(JSON.stringify(bestDistNet)))
                : new Net();
            cmaesInit(p1Seed, 0.3);
        }

        // Primera vuelta → ir directo a Phase 3 (optimizar tiempo)
        if (gbl !== Infinity) {
            distributedSpawnMode = false;
            cmaes.active = false;
            autoTrainSetPhase(3);
            return;
        }

        // Si CMA-ES colapsó (sigma muy pequeño): reiniciar con sigma mayor desde mejor red
        if (cmaes.active && cmaes.sigma < 0.025) {
            var recoverW = (cmaes.mean && cmaes.templateW)
                ? netUnflatten(cmaes.mean, cmaes.templateW)
                : (bestDistNet ? JSON.parse(JSON.stringify(bestDistNet)) : null);
            cmaesInit(recoverW ? new Net(recoverW) : new Net(), 0.35);
        }

        // Cada 30 gens sin vuelta: reinicio amplio para escapar óptimos locales
        if (gensInPhase > 0 && gensInPhase % 30 === 0) {
            // netUnflatten devuelve pesos crudos — guardar en bestDistNet y wrappear en Net para cmaesInit
            var expandW = (cmaes.mean && cmaes.templateW)
                ? netUnflatten(cmaes.mean, cmaes.templateW)
                : (bestDistNet ? JSON.parse(JSON.stringify(bestDistNet)) : null);
            if (expandW) bestDistNet = JSON.parse(JSON.stringify(expandW));
            cmaesInit(expandW ? new Net(expandW) : new Net(), Math.min(0.6, cmaes.sigma * 2.5));
        }

        // Después de 90 gens → Phase 2 (intentar vuelta desde zona 0)
        if (gensInPhase >= 90) {
            distributedSpawnMode = false;
            if (cmaes.mean && cmaes.templateW) {
                bestDistNet = JSON.parse(JSON.stringify(netUnflatten(cmaes.mean, cmaes.templateW)));
            }
            cmaes.active = false;
            autoTrainSetPhase(2);
        }
    }
    else if (autoTrain.phase === 2) {
        // VUELTAS: CMA-ES desde spawn zona 0, intenta completar la vuelta entera.
        // Llega aquí con una red que ya sabe manejar cualquier parte del track (Phase 1).
        if (curriculumMode) { curriculumMode = false; if (typeof updateCurriculumUI === 'function') updateCurriculumUI(); }
        distributedSpawnMode = false;
        if (!cmaes.active) {
            var p2Seed = bestDistNet
                ? new Net(JSON.parse(JSON.stringify(bestDistNet)))
                : (bestLapNet ? new Net(JSON.parse(JSON.stringify(bestLapNet))) : new Net());
            cmaesInit(p2Seed, 0.2);
        }
        if (gbl !== Infinity) {
            // Primera vuelta conseguida → Phase 3 (optimizar tiempo)
            if (finRate >= 0.15) {
                autoTrain.lapReadyGens++;
                if (autoTrain.lapReadyGens >= 2) { autoTrainSetPhase(3); }
            } else {
                autoTrain.lapReadyGens = Math.max(0, autoTrain.lapReadyGens - 1);
            }
        } else {
            // Sin vuelta: escalar sigma progresivamente para ampliar la búsqueda
            if (gensInPhase === 20 && cmaes.active) {
                cmaes.sigma = Math.max(cmaes.sigma, 0.3);
            } else if (gensInPhase === 45) {
                var p2Fallback = bestDistNet
                    ? new Net(JSON.parse(JSON.stringify(bestDistNet)))
                    : new Net();
                cmaesInit(p2Fallback, 0.5);
            } else if (gensInPhase === 70) {
                // Último intento: reinicio amplio desde mejor red conocida
                var p2Last = bestLapNet || bestDistNet;
                cmaesInit(p2Last ? new Net(JSON.parse(JSON.stringify(p2Last))) : new Net(), 0.7);
            }
        }
    }
    else if (autoTrain.phase === 3) {
        // CMA-ES: optimización final de tiempo
        if (curriculumMode) { curriculumMode = false; if (typeof updateCurriculumUI === 'function') updateCurriculumUI(); }
        distributedSpawnMode = false;
        // Activar CMA-ES: funciona con bestLapNet o con cold start desde red aleatoria
        if (!cmaes.active) {
            if (typeof cmaesToggle === 'function') cmaesToggle();
        }
        // Totalmente convergido → volver a GA para inyectar diversidad
        if (cmaes.active && cmaes.sigma < 0.002) {
            cmaes.active = false;
            autoTrain.lapReadyGens = 0;
            autoTrainSetPhase(2);
        }
    }

    if (typeof updateAutoTrainUI === 'function') updateAutoTrainUI();
}
var fineTuneProfile = null;
var fineTuneActive = false; // FIX #10: flag separado de gen===1
var isCompareMode = false;

// ==================== CURRICULUM LEARNING ====================
var curriculumMode = false;
var curriculumSector = 1;   // sector objetivo actual (1..CURRICULUM_ZONES)
var curriculumThresh = 0.6; // fracción de autos que deben llegar al goal para avanzar
// Granularidad del curriculum: 24=1x, 48=2x, 96=4x, 192=8x.
// Más sectores = cada paso es más corto y fácil. Curvas complejas se aprenden en varios micro-pasos.
var CURRICULUM_ZONES = 24;
var bestCurriculumNet = null; // best net that ever reached the curriculum goal
// Estado real de aproximación a cada zona: {x, y, ang, spd}
// Guardado cuando un auto pasa la zona en modo cumulativo (no aislado).
// Usado en spawn aislado para eliminar covariate shift: el auto entrena el sector
// con la misma velocidad/ángulo que tendría llegando desde el inicio de la pista.
var sectorApproachStates = {};

// ==================== DISTRIBUTED SPAWN ====================
var distributedSpawnMode = false;
var curriculumIsolated = false; // false = acumulativo (spawn zona 0), true = aislado (spawn inicio del sector)
var genHistory = [];
var finishTimer = -1;
var isRaceMode = false;
var useFuel = true;

// INPUT COUNT: 7 sensores + spd + slip + 3 specs fisica + dt + eng + 3 lookahead + relHead + latPos + accelDelta + sin/cos checkpointDir + 2 prev_action = 24
var NET_INPUT_SIZE = 24;

// Misma lógica que zoneClIndex en script.js pero disponible en ai.js
function zoneClIndexAI(z, ZONES) {
    if (clTotalLen <= 0 || clDist.length !== CL.length) {
        return Math.round((z / ZONES) * CL.length) % CL.length;
    }
    var target = (z / ZONES) * clTotalLen;
    var lo = 0, hi = CL.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (clDist[mid] < target) lo = mid + 1; else hi = mid; }
    return lo % CL.length;
}

// ==================== HELPERS ====================
function relu(x) { return x > 0 ? x : 0; }

function segi(ax, ay, bx, by, cx, cy, dx, dy) {
    var d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(d) < 1e-10) return null;
    var t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
    var u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
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

function pointInPoly(px, py, poly) {
    if (!poly || poly.length < 3) return false;
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
            inside = !inside;
    }
    return inside;
}

function isOnTrack(px, py) {
    if (!OUT || !INN || OUT.length < 3 || INN.length < 3) return true;
    return pointInPoly(px, py, OUT) && !pointInPoly(px, py, INN);
}

// ==================== NEURAL NETWORK ====================
// Arquitectura 24→16→8→3: suficiente para conducción reactiva, converge 2.5x más rápido en CMA-ES
// (563 pesos vs 1379 anterior — Sep-CMA-ES necesita O(n) evaluaciones: 24 vs 57 gens mínimos)
function Net(w) { this.w = w || this.rnd(); }

Net.prototype.rnd = function () {
    var H1 = 16, H2 = 8;
    var w = { l1: [], b1: [], l2: [], b2: [], l3: [], b3: [] };

    // Capa 1: NET_INPUT_SIZE → H1
    for (var i = 0; i < H1; i++) {
        w.l1.push(Array.from({ length: NET_INPUT_SIZE }, function () { return (Math.random() - 0.5) * 2; }));
        w.b1.push((Math.random() - 0.5) * 0.5);
    }
    // Capa 2: H1 → H2
    for (var i = 0; i < H2; i++) {
        w.l2.push(Array.from({ length: H1 }, function () { return (Math.random() - 0.5) * 2; }));
        w.b2.push((Math.random() - 0.5) * 0.5);
    }
    // Salida: H2 → 3 (accel/brake combinado, steer, aux)
    // FIX #3: output 0 = accel/brake combinado (positivo=acelerar, negativo=frenar)
    // Bias throttle positivo para las primeras generaciones
    for (var i = 0; i < 3; i++) {
        var row = Array.from({ length: H2 }, function () { return (Math.random() - 0.5) * 2; });
        if (i === 0) row = row.map(function (v) { return v + 0.3; }); // bias throttle
        w.l3.push(row);
        w.b3.push(i === 0 ? 0.2 : (Math.random() - 0.5) * 0.5);
    }
    return w;
};

Net.prototype.fwd = function (inp) {
    var w = this.w;
    // Capa 1
    var h1 = w.l1.map(function (row, i) {
        var s = w.b1[i];
        var len = Math.min(row.length, inp.length);
        for (var j = 0; j < len; j++) s += row[j] * inp[j];
        return relu(s);
    });
    // Capa 2
    var h2 = w.l2.map(function (row, i) {
        var s = w.b2[i];
        for (var j = 0; j < h1.length; j++) s += row[j] * h1[j];
        return relu(s);
    });
    // Salida
    return w.l3.map(function (row, i) {
        var s = w.b3[i];
        for (var j = 0; j < h2.length; j++) s += row[j] * h2[j];
        return Math.tanh(s);
    });
};

Net.prototype.clone = function () { return new Net(JSON.parse(JSON.stringify(this.w))); };

Net.prototype.mut = function (r) {
    var nw = JSON.parse(JSON.stringify(this.w));
    function m(a) { return a.map(function (v) { return Math.random() < r ? v + (Math.random() - 0.5) * 0.6 : v; }); }
    nw.l1 = nw.l1.map(function (x) { return m(x); }); nw.b1 = m(nw.b1);
    nw.l2 = nw.l2.map(function (x) { return m(x); }); nw.b2 = m(nw.b2);
    nw.l3 = nw.l3.map(function (x) { return m(x); }); nw.b3 = m(nw.b3);
    return new Net(nw);
};

// Uniform crossover: cada peso se toma aleatoriamente de uno u otro padre
Net.prototype.crossover = function (other) {
    var a = this.w, b = other.w;
    function cx(va, vb) { return va.map(function (v, i) { return Math.random() < 0.5 ? v : vb[i]; }); }
    function cxR(ra, rb) { return ra.map(function (row, i) { return cx(row, rb[i]); }); }
    return new Net({ l1: cxR(a.l1, b.l1), b1: cx(a.b1, b.b1), l2: cxR(a.l2, b.l2), b2: cx(a.b2, b.b2), l3: cxR(a.l3, b.l3), b3: cx(a.b3, b.b3) });
};

// ==================== CAR CLASS ====================
function Car(net, id, col, customPhys, profileName, tuning) {
    this.id = id;
    this.col = col;
    this.net = net || new Net();
    this.phys = customPhys ? JSON.parse(JSON.stringify(customPhys)) : JSON.parse(JSON.stringify(phys));
    this.profileName = profileName || null;
    this.tuning = tuning || [];

    this.x = startLine ? startLine.x : 0;
    this.y = startLine ? startLine.y : 0;
    this.ang = startLine ? startLine.ang : 0;
    this.spd = 0;
    this.prevSpd = 0; // FIX #8: para calcular aceleracion
    this.slip = 0;
    this.tw = 1;
    this.alive = true;
    this.finished = false;
    this.prevIdx = startLine ? startLine.idx : 0;
    this.totalD = 0;
    this.stuck = 0;
    this.laps = 0;
    this.lapTimes = [];
    this.lapStartFrame = 0;
    this.fc = 0;
    this.finishFrame = 0;
    this.lastZoneFrame = 0;
    this.prevX = this.x;
    this.prevY = this.y;
    this.crossCD = 0;
    this.sens = [];
    this.thrOut = 0;
    this.brkOut = 0;
    this.msens = 1;
    this.prevAction = [0, 0]; // [accelBrake, steer] del frame anterior
    this.steerJerkAccum = 0; // suma de |delta steer| por frame — penaliza conducción errática
    this.wallProxAccum = 0;  // suma de proximidad a paredes — penaliza rozar muros
    this._fitness = 0;
    this.ZONES = 24;
    this.zonesHit = new Array(this.ZONES).fill(false);
    this.totalSlip = 0;
    this.reverseFrames = 0;
    this.curriculumGoalHit = false;
    this.spawnZone = 0;
    this.fuel = customPhys ? (customPhys.fuelLiters || 100) : 100;
    this.compound = customPhys ? (customPhys.compound || 'M') : 'M';
}

Car.prototype.bestLap = function () {
    return this.lapTimes.length ? Math.min.apply(null, this.lapTimes) : Infinity;
};

// FIX #11: penalización por reversa en fitness
Car.prototype.calcFitness = function () {
    if (curriculumMode) {
        // Fitness cuadrático: zonas más cercanas al goal valen exponencialmente más
        // Esto crea un gradiente fuerte que "tira" a los autos hacia el objetivo
        // Mapear sector curriculum a zona interna del auto (0..ZONES-1)
        var goalCarZone = Math.min(Math.floor(curriculumSector / CURRICULUM_ZONES * this.ZONES), this.ZONES - 1);
        var proximityScore = 0;
        for (var z = 0; z <= goalCarZone; z++) {
            if (this.zonesHit[z]) {
                var w = Math.pow((z + 1) / (goalCarZone + 1), 2); // 0..1 cuadrático
                proximityScore += w * 4000;
            }
        }
        // Bonus enorme por llegar al goal — siempre domina sobre proximityScore
        var goalBonus = this.curriculumGoalHit ? 40000 : 0;
        var timePenalty = this.fc * 0.04;
        var reversePenalty = this.reverseFrames * 5;
        return proximityScore + goalBonus - timePenalty - reversePenalty;
    }
    var lapBonus = this.laps * train.fbonus;
    // En exploración: penalidad de tiempo casi nula para no castigar aprendizaje lento.
    // En modo vuelta: presión completa para optimizar velocidad.
    var exploring = gbl === Infinity;
    var timePenalty = this.fc * (exploring ? train.fpen * 0.05 : train.fpen);
    var distBonus = this.totalD * (1 - train.ftime);
    // Bonus inversamente proporcional al tiempo: spread enorme entre rápidos y lentos
    var timeBonus = this.finished
        ? (8000000 / (this.finishFrame + 1)) + train.fbonus * currentLaps
        : 0;
    // Carros que terminan: slip admisible (líneas de carrera agresivas son más rápidas)
    var stabilityFactor = (this.totalSlip / (this.fc || 1)) * (this.finished ? 5 : 50);
    var reversePenalty = this.reverseFrames * 3;
    // En exploración: bonus de cobertura mucho mayor para incentivar visitar zonas nuevas.
    // En modo vuelta: bonus pequeño (la presión es sobre el tiempo de vuelta).
    var zonesHitCount = 0;
    for (var z = 0; z < this.ZONES; z++) if (this.zonesHit[z]) zonesHitCount++;
    var coverageBonus = zonesHitCount * (train.fbonus * (exploring ? 0.15 : 0.025));
    // Penalidad de suavidad: driving errático (alto jerk de volante) penalizado
    // Normalizado por frames para que no crezca con el tiempo de vida
    var smoothPenalty = ((this.steerJerkAccum || 0) / (this.fc || 1)) * (exploring ? 150 : 350);
    // Penalidad de proximidad a paredes: trayectorias que rozan muros penalizadas
    var wallPenalty = ((this.wallProxAccum || 0) / (this.fc || 1)) * (exploring ? 80 : 180);
    return lapBonus + distBonus + timeBonus + coverageBonus - timePenalty - stabilityFactor - reversePenalty - smoothPenalty - wallPenalty;
};

// FIX #12: solo una definicion de lapCoverageOk
Car.prototype.lapCoverageOk = function () {
    var hit = 0;
    for (var i = 0; i < this.ZONES; i++) if (this.zonesHit[i]) hit++;
    return (hit / this.ZONES) >= train.lapValid;
};

Car.prototype.resetLapTracking = function () {
    this.zonesHit = new Array(this.ZONES).fill(false);
};

Car.prototype.lapProgress = function () {
    var hit = 0;
    for (var i = 0; i < this.ZONES; i++) if (this.zonesHit[i]) hit++;
    return hit / this.ZONES;
};

Car.prototype.upd = function () {
    if (!this.alive) return;
    this.fc++;
    var self = this;

    var sens = SANGS.map(function (a) { return raycast(self.x, self.y, self.ang + a); });
    var minW = sens.reduce(function (a, b) { return a.dist < b.dist ? a : b; }).dist;

    if (this.fc > 30 && minW < 4.0) { this.alive = false; this._fitness = this.calcFitness(); return; }

    // Acumular proximidad continua a paredes (penaliza trayectorias que rozan muros)
    var wpThresh = SL * 0.15;
    if (minW < wpThresh) this.wallProxAccum += (wpThresh - minW) / wpThresh;

    this.sens = sens;
    this.msens = minW / SL;

    var p = this.phys;

    // Tuning
    var tune_vmax = 0, tune_accel = 0, tune_maneuver = 0;
    this.tuning.forEach(function (t) {
        tune_vmax += (t.vmax || 0);
        tune_accel += (t.accel || 0);
        tune_maneuver += (t.maneuver || 0);
    });

    var eVmax_kmh = p.vmax + tune_vmax;
    var eAccel_0_100 = Math.max(0.1, p.accel + tune_accel);
    var eManeuver = Math.max(0, Math.min(100, p.maneuver + tune_maneuver));
    var internalVmax = eVmax_kmh / p.sm;
    var internalAccelForce = (100 / p.sm) / (eAccel_0_100 * 0.96);

    // ==================== INPUTS ====================
    // FIX #7: todos normalizados a [-1, 1]

    var inp = [];

    // 0-6: sensores (ya estan en [0,1], convertir a [-1,1] multiplicando por 2 - 1)
    sens.forEach(function (s) { inp.push(s.dist / SL * 2 - 1); });

    // 7: velocidad normalizada [-1,1]
    inp.push((this.spd / internalVmax) * 2 - 1);

    // 8: slip normalizado
    inp.push(this.slip / 40);

    // 9-11: specs de fisica normalizados
    inp.push(eVmax_kmh / 400 * 2 - 1);       // vmax: 0-400 → -1 a 1
    inp.push(eAccel_0_100 / 15 * 2 - 1);      // accel: 0-15 → -1 a 1
    inp.push(eManeuver / 100 * 2 - 1);         // maneuver: 0-100 → -1 a 1

    // 12: drivetrain como valor continuo
    var dtVal = -1; // FWD
    if (p.drivetrain === 'RWD') dtVal = 1;
    else if (p.drivetrain === 'AWD') dtVal = 0.33;
    else if (p.drivetrain === '4WD') dtVal = -0.33;
    inp.push(dtVal);

    // 13: engine position
    var engVal = 0; // M
    if (p.engine === 'F') engVal = -1;
    else if (p.engine === 'R') engVal = 1;
    inp.push(engVal);

    // 14-16: look-ahead con fracciones relativas (FIX #6)
    var n = CL.length;
    if (n > 0) {
        var fracs = [0.04, 0.12, 0.25]; // 4%, 12%, 25% del circuito
        fracs.forEach(function (frac) {
            var offset = Math.max(1, Math.floor(n * frac));
            var tIdx = (self.prevIdx + offset) % n;
            var target = CL[tIdx];
            var angToT = Math.atan2(target[1] - self.y, target[0] - self.x);
            var diff = angToT - self.ang;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            inp.push(diff / Math.PI); // ya en [-1,1]
        });

        // 17: heading relativo al track
        var curP = CL[self.prevIdx], nextP = CL[(self.prevIdx + 1) % n];
        var trackAng = Math.atan2(nextP[1] - curP[1], nextP[0] - curP[0]);
        var relHead = self.ang - trackAng;
        while (relHead > Math.PI) relHead -= Math.PI * 2;
        while (relHead < -Math.PI) relHead += Math.PI * 2;
        inp.push(relHead / Math.PI); // [-1,1]

        // 18: posicion lateral normalizada a [-1,1] (FIX #7: clamp a -1,1)
        var dx = self.x - curP[0], dy = self.y - curP[1];
        var dist = Math.sqrt(dx * dx + dy * dy);
        var cross = Math.cos(trackAng) * dy - Math.sin(trackAng) * dx;
        var latPos = (dist / (TW / 2)) * (cross > 0 ? 1 : -1);
        inp.push(Math.max(-1, Math.min(1, latPos)));

        // 19: aceleracion delta (FIX #8) — cambio de velocidad normalizado
        var accelDelta = (this.spd - this.prevSpd) / (internalAccelForce * 0.016 || 1);
        inp.push(Math.max(-1, Math.min(1, accelDelta)));

        // 20-21: dirección al próximo checkpoint (sin/cos del ángulo relativo)
        // En curriculum: apunta al goal. En normal: al siguiente sector no visitado.
        var curZone = (clTotalLen > 0 && clDist.length === n)
            ? Math.floor((clDist[self.prevIdx] / clTotalLen) * self.ZONES)
            : Math.floor((self.prevIdx / n) * self.ZONES);
        var targetZone = curriculumMode
            ? Math.min(Math.floor(curriculumSector / CURRICULUM_ZONES * self.ZONES), self.ZONES - 1)
            : (curZone + 1) % self.ZONES;
        var tIdx = zoneClIndexAI(targetZone, self.ZONES);
        var tPt = CL[tIdx];
        if (tPt) {
            var angToCP = Math.atan2(tPt[1] - self.y, tPt[0] - self.x);
            var relCP = angToCP - self.ang;
            while (relCP > Math.PI) relCP -= Math.PI * 2;
            while (relCP < -Math.PI) relCP += Math.PI * 2;
            inp.push(Math.sin(relCP));
            inp.push(Math.cos(relCP));
        } else {
            inp.push(0); inp.push(1);
        }
    } else {
        // padding si no hay CL
        for (var k = 0; k < 9; k++) inp.push(0);
    }

    // 22-23: acciones del frame anterior — da contexto temporal para maniobras encadenadas
    inp.push(this.prevAction[0]); // prev accelBrake [-1,1]
    inp.push(this.prevAction[1]); // prev steer [-1,1]

    // guardar velocidad anterior para delta
    this.prevSpd = this.spd;

    // ==================== FORWARD PASS ====================
    var out = this.net.fwd(inp);

    // FIX #2 + #3: output 0 = accel/brake combinado
    // positivo = acelerar, negativo = frenar
    // rango completo de tanh [-1,1]
    var accelBrake = out[0]; // -1=frenar fuerte, 0=neutro, 1=acelerar fuerte
    var thr = Math.max(0, accelBrake);   // 0 a 1
    var brk = Math.max(0, -accelBrake);  // 0 a 1 (solo cuando negativo)
    this.thrOut = thr;
    this.brkOut = brk;
    var prevSteerOut = this.prevAction[1];
    this.prevAction[0] = out[0];
    this.prevAction[1] = out[1];
    // Acumular jerk de dirección: penaliza cambios bruscos de volante frame a frame
    this.steerJerkAccum += Math.abs(out[1] - prevSteerOut);

    // ==================== FISICA ====================
    if (brk > 0.1 && this.spd > 0.5) {
        this.spd = Math.max(0, this.spd - (internalAccelForce * 12 * brk * 0.016));
    }
    if (thr > 0.05) {
        this.spd += (thr * internalAccelForce) * 0.016;
        this.spd *= 0.999;
    } else if (brk <= 0.1) {
        this.spd *= 0.98;
    }
    this.spd = Math.max(0, Math.min(internalVmax, this.spd));

    var sr = this.spd / internalVmax;
    var steerPower = 1.0 - (sr * 0.75);
    var baseSteerAngle = (0.05 + (eManeuver / 100) * 0.1) * steerPower;
    var si = out[1] * baseSteerAngle * (this.spd > 0.1 ? 1 : 0);

    var oversteerFactor = 0.2;
    if (p.engine === 'R') oversteerFactor = 0.45;
    else if (p.engine === 'F') oversteerFactor = 0.1;

    if (p.drivetrain === 'RWD') {
        oversteerFactor *= (1 + thr * 0.5);
    } else if (p.drivetrain === 'FWD') {
        si *= (1 - thr * 0.3);
        oversteerFactor *= 0.5;
    }

    var gripThreshold = 0.2 + (eManeuver / 100) * 0.4;
    var lateralForce = Math.abs(si) * this.spd;
    if (lateralForce > gripThreshold) {
        var slipLoss = (lateralForce - gripThreshold) * 0.5;
        si /= (1 + slipLoss);
    }

    this.ang += si + (this.slip * (oversteerFactor / 10) * sr);

    var gripStability = 0.3 + (eManeuver / 100) * 0.5;
    this.slip = Math.max(-40, Math.min(40, (this.slip + si * this.spd * oversteerFactor * 8) * (1 - gripStability * 0.1)));
    this.totalSlip += Math.abs(this.slip);

    this.prevX = this.x;
    this.prevY = this.y;
    var windShift = (p.wi || 0) * 0.004;
    this.x += Math.cos(this.ang) * this.spd + Math.sin(this.ang) * (this.slip * 0.012) - windShift;
    this.y += Math.sin(this.ang) * this.spd - Math.cos(this.ang) * (this.slip * 0.012);

    if (isNaN(this.x) || isNaN(this.y)) { this.x = 0; this.y = 0; this.alive = false; return; }

    var idx = nearCL(this.x, this.y);

    // Death walls
    if (loaded && typeof deathWalls !== 'undefined') {
        for (var i = 0; i < deathWalls.length; i++) {
            var wall = deathWalls[i];
            for (var j = 0; j < wall.length - 1; j++) {
                if (lineIntersect(this.prevX, this.prevY, this.x, this.y, wall[j][0], wall[j][1], wall[j + 1][0], wall[j + 1][1])) {
                    this.alive = false;
                    this._fitness = this.calcFitness();
                    return;
                }
            }
        }
    }

    // Off-track detection using actual track polygon geometry
    if (loaded && OUT && OUT.length > 2 && !isOnTrack(this.x, this.y)) {
        this.alive = false; this._fitness = this.calcFitness(); return;
    }

    n = CL.length;
    if (n === 0) return;

    var fwd = (idx - this.prevIdx + n) % n;

    // FIX #11: contar frames yendo al reves
    if (fwd > n / 2) {
        this.reverseFrames++;
    }

    if (fwd >= 0 && fwd < n / 2) {
        if (fwd > 0) { this.totalD += fwd; this.stuck = 0; }
        else { this.stuck++; }
    } else {
        this.stuck++;
    }

    // FIX #5: stuck limits — más agresivo para matar carros lentos/perdidos rápido
    if (this.stuck > 100) {
        this.alive = false;
        this._fitness = this.calcFitness();
        return;
    }

    var zone = (clTotalLen > 0 && clDist.length === n)
        ? Math.floor((clDist[idx] / clTotalLen) * this.ZONES)
        : Math.floor((idx / n) * this.ZONES);
    if (!this.zonesHit[zone]) {
        this.zonesHit[zone] = true;
        this.lastZoneFrame = this.fc;
        // Guardar estado de aproximación real solo en modo cumulativo (no aislado y no distributed).
        // En modo aislado el auto arranca desde cero — ese estado NO refleja la llegada real al sector.
        if (!curriculumIsolated && !distributedSpawnMode) {
            sectorApproachStates[zone] = { x: this.x, y: this.y, ang: this.ang, spd: this.spd };
        }
    }

    // FIX #5: zone timeout — eliminar carros atascados entre zonas más rápido
    if (this.fc - this.lastZoneFrame > 250) {
        this.alive = false;
        this._fitness = this.calcFitness();
        return;
    }

    // Curriculum mode: detectar llegada al goal usando distancia real del track.
    // Funciona con cualquier valor de CURRICULUM_ZONES, no depende de la grilla de 24 zonas.
    if (curriculumMode && !this.curriculumGoalHit) {
        var carDist = (clTotalLen > 0 && clDist.length === n)
            ? clDist[idx]
            : (idx / n) * (clTotalLen || n);
        // Cap at CURRICULUM_ZONES-1 to avoid requesting 100% track coverage
        // (clDist never reaches clTotalLen; last sector auto-passes after the previous one)
        var goalDist = (Math.min(curriculumSector, CURRICULUM_ZONES - 1) / CURRICULUM_ZONES) * (clTotalLen || n);
        if (carDist >= goalDist) {
            this.curriculumGoalHit = true;
        }
    }

    this.prevIdx = idx;

    if (this.crossCD > 0) { this.crossCD--; return; }

    if (!curriculumMode && this.fc > 60 && checkCross(this.x, this.y, this.prevX, this.prevY)) {
        if (this.lapCoverageOk()) {
            var lapF = this.fc - this.lapStartFrame;
            this.lapTimes.push(lapF);
            if (lapF < gbl) {
                gbl = lapF;
                lastRecordGen = gen;
                bestLapNet = JSON.parse(JSON.stringify(this.net.w));
                if (typeof createProfileFromCar === 'function') createProfileFromCar(this, true);
            }

            // Compare/Race mode reloop
            if (typeof compareCars !== 'undefined' && compareCars.length > 0 && compareCars.filter(function (c) { return c.alive; }).length === 0) {
                compareCars.forEach(function (c) {
                    c.x = startLine.x; c.y = startLine.y; c.ang = startLine.ang;
                    c.spd = 0; c.prevSpd = 0; c.slip = 0; c.alive = true; c.finished = false;
                    c.fc = 0; c.prevIdx = startLine.idx; c.totalD = 0; c.stuck = 0;
                    c.laps = 0; c.lapStartFrame = 0; c.finishFrame = 0; c.lapTimes = [];
                    c.resetLapTracking(); c.crossCD = 0; c.tw = 1; c.totalSlip = 0; c.reverseFrames = 0;
                });
            }

            this.laps++;
            this.lapStartFrame = this.fc;
            this.crossCD = 40;
            this.resetLapTracking();
            this.lastZoneFrame = this.fc;

            if (isRaceMode && useFuel) {
                this.fuel = Math.max(0, this.fuel - (p.fpl || 2));
            }

            if (this.laps >= currentLaps) {
                this.finished = true;
                this.finishFrame = this.fc;
                this._fitness = this.calcFitness();
                this.alive = false;
                if (finishTimer === -1) finishTimer = 300;
            }
        } else {
            this._fitness -= 2000;
            this.crossCD = 60;
            this.resetLapTracking();
        }
    }
};

Car.prototype.draw = function (isBest, isTop3, showS) {
    if (!sctx) return;
    var alive = this.alive, finished = this.finished;
    sctx.save();
    if (showS && this.sens.length && alive) {
        sctx.globalAlpha = 0.1;
        var col = this.col;
        this.sens.forEach(function (s) {
            sctx.beginPath(); sctx.moveTo(this.x, this.y); sctx.lineTo(s.ex, s.ey);
            sctx.strokeStyle = col; sctx.lineWidth = 0.8; sctx.stroke();
        }, this);
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
    var w = 14, h = 8;
    sctx.beginPath();
    sctx.roundRect(-w / 2, -h / 2, w, h, 2);
    sctx.fill();
    sctx.fillStyle = 'rgba(255,255,255,0.4)';
    sctx.fillRect(w / 2 - 4, -h / 2 + 1, 3, h - 2);
    sctx.fillStyle = 'rgba(0,0,0,0.3)';
    sctx.fillRect(-w / 2 + 1, -h / 2 + 1, 2, h - 2);
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

// ==================== CMA-ES (Sep-CMA-ES diagonal) ====================
// Reemplaza la fase GA cuando está activo. Aprende qué combinaciones
// de cambios de pesos mejoran el tiempo → converge mucho más rápido
// que mutación aleatoria para fine-tuning de velocidad.

var cmaes = {
    active: false,
    n: 0, lambda: 0, mu: 0,
    weights: null, mueff: 0,
    ps: null, pc: null,
    mean: null, D: null,
    sigma: 0.15,
    cs: 0, ds: 0, cc: 0, c1: 0, cmu: 0, chiN: 0,
    gen: 0,
    zs: null, xs: null,
    templateW: null,
};

function gaussRandom() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function netFlatten(w) {
    var v = [];
    w.l1.forEach(function (row) { row.forEach(function (x) { v.push(x); }); });
    w.b1.forEach(function (x) { v.push(x); });
    w.l2.forEach(function (row) { row.forEach(function (x) { v.push(x); }); });
    w.b2.forEach(function (x) { v.push(x); });
    w.l3.forEach(function (row) { row.forEach(function (x) { v.push(x); }); });
    w.b3.forEach(function (x) { v.push(x); });
    return v;
}

function netUnflatten(v, templateW) {
    var w = { l1: [], b1: [], l2: [], b2: [], l3: [], b3: [] };
    var idx = 0;
    w.l1 = templateW.l1.map(function (row) { return row.map(function () { return v[idx++]; }); });
    w.b1 = templateW.b1.map(function () { return v[idx++]; });
    w.l2 = templateW.l2.map(function (row) { return row.map(function () { return v[idx++]; }); });
    w.b2 = templateW.b2.map(function () { return v[idx++]; });
    w.l3 = templateW.l3.map(function (row) { return row.map(function () { return v[idx++]; }); });
    w.b3 = templateW.b3.map(function () { return v[idx++]; });
    return w;
}

function cmaesInit(seedNet, initSigma) {
    var flat = netFlatten(seedNet.w);
    var n = flat.length;
    // Lambda óptimo para CMA-ES: fórmula estándar independiente del tamaño de población del GA.
    // Siempre par (para muestreo antitético), mínimo 10, máximo train.pop*2.
    var lambda = Math.max(10, Math.floor((4 + Math.floor(3 * Math.log(n))) / 2) * 2);
    var mu = Math.floor(lambda / 2);

    // Pesos logarítmicos: los mejores candidatos pesan exponencialmente más
    var rawW = [];
    for (var i = 0; i < mu; i++) rawW.push(Math.log(mu + 0.5) - Math.log(i + 1));
    var wSum = rawW.reduce(function (a, b) { return a + b; }, 0);
    var weights = rawW.map(function (w) { return w / wSum; });
    var mueff = 1 / weights.reduce(function (s, w) { return s + w * w; }, 0);

    // Tasas de aprendizaje estándar Sep-CMA-ES
    var cs = (mueff + 2) / (n + mueff + 5);
    var ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
    var cc = (4 + mueff / n) / (n + 4 + 2 * mueff / n);
    var c1 = 2 / ((n + 1.3) * (n + 1.3) + mueff);
    var cmu = Math.min(1 - c1, 2 * (mueff - 2 + 1 / mueff) / ((n + 2) * (n + 2) + mueff));
    var chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));

    cmaes.n = n; cmaes.lambda = lambda; cmaes.mu = mu;
    cmaes.weights = weights; cmaes.mueff = mueff;
    cmaes.cs = cs; cmaes.ds = ds; cmaes.cc = cc; cmaes.c1 = c1; cmaes.cmu = cmu; cmaes.chiN = chiN;
    cmaes.mean = flat;
    cmaes.D = new Array(n).fill(1.0);
    cmaes.ps = new Array(n).fill(0);
    cmaes.pc = new Array(n).fill(0);
    cmaes.sigma = initSigma || 0.15;
    cmaes.gen = 0;
    cmaes.zs = null; cmaes.xs = null;
    cmaes.templateW = JSON.parse(JSON.stringify(seedNet.w));
    cmaes.active = true;
}

function cmaesGenPop() {
    var n = cmaes.n, zs = [], xs = [], nets = [];
    var half = Math.floor(cmaes.lambda / 2);
    // Muestreo antitético: genera pares (+z, -z) para cubrir el espacio simétricamente.
    // Reduce la varianza del estimador de gradiente a la mitad con el mismo presupuesto.
    for (var k = 0; k < half; k++) {
        var z = [];
        for (var i = 0; i < n; i++) z.push(gaussRandom());
        var sqrtD = cmaes.D.map(function (d) { return Math.sqrt(Math.max(1e-10, d)); });
        var xPos = z.map(function (zi, i) { return cmaes.mean[i] + cmaes.sigma * sqrtD[i] * zi; });
        var zNeg = z.map(function (zi) { return -zi; });
        var xNeg = zNeg.map(function (zi, i) { return cmaes.mean[i] + cmaes.sigma * sqrtD[i] * zi; });
        zs.push(z);    xs.push(xPos); nets.push(new Net(netUnflatten(xPos, cmaes.templateW)));
        zs.push(zNeg); xs.push(xNeg); nets.push(new Net(netUnflatten(xNeg, cmaes.templateW)));
    }
    // Si lambda es impar, agregar una muestra extra
    if (cmaes.lambda % 2 === 1) {
        var z = [], x = [];
        for (var i = 0; i < n; i++) {
            var zi = gaussRandom();
            z.push(zi);
            x.push(cmaes.mean[i] + cmaes.sigma * Math.sqrt(Math.max(1e-10, cmaes.D[i])) * zi);
        }
        zs.push(z); xs.push(x); nets.push(new Net(netUnflatten(x, cmaes.templateW)));
    }
    cmaes.zs = zs; cmaes.xs = xs;
    return nets;
}

function cmaesUpdate(sortedIndices) {
    var n = cmaes.n, mu = cmaes.mu;
    var meanOld = cmaes.mean.slice();

    // Nueva media: promedio ponderado de los mu mejores candidatos
    var meanNew = new Array(n).fill(0);
    for (var i = 0; i < mu; i++) {
        var xi = cmaes.xs[sortedIndices[i]];
        for (var j = 0; j < n; j++) meanNew[j] += cmaes.weights[i] * xi[j];
    }
    cmaes.mean = meanNew;

    // Paso normalizado en espacio de búsqueda
    var step = meanNew.map(function (m, i) { return (m - meanOld[i]) / cmaes.sigma; });

    // Actualizar ps (evolution path para control de sigma)
    var csFactor = Math.sqrt(cmaes.cs * (2 - cmaes.cs) * cmaes.mueff);
    var psNormSq = 0;
    for (var i = 0; i < n; i++) {
        cmaes.ps[i] = (1 - cmaes.cs) * cmaes.ps[i]
            + csFactor * step[i] / Math.sqrt(Math.max(1e-10, cmaes.D[i]));
        psNormSq += cmaes.ps[i] * cmaes.ps[i];
    }

    // Adaptar sigma: aumenta si búsqueda activa, decrece al converger
    var psNorm = Math.sqrt(psNormSq);
    cmaes.sigma *= Math.exp((cmaes.cs / cmaes.ds) * (psNorm / cmaes.chiN - 1));
    cmaes.sigma = Math.max(0.001, Math.min(1.5, cmaes.sigma));

    // h_sigma: indicador para evitar path de covarianza inestable
    var psNormNorm = psNorm / Math.sqrt(1 - Math.pow(1 - cmaes.cs, 2 * (cmaes.gen + 1)));
    var hsig = (psNormNorm < (1.4 + 2 / (n + 1)) * cmaes.chiN) ? 1 : 0;

    // Actualizar pc (evolution path para covarianza)
    var ccFactor = Math.sqrt(cmaes.cc * (2 - cmaes.cc) * cmaes.mueff);
    for (var i = 0; i < n; i++) {
        cmaes.pc[i] = (1 - cmaes.cc) * cmaes.pc[i] + hsig * ccFactor * step[i];
    }

    // Actualizar diagonal de covarianza D (varianza por dimensión)
    for (var i = 0; i < n; i++) {
        var r1 = cmaes.c1 * cmaes.pc[i] * cmaes.pc[i];
        var rmu = 0;
        for (var k = 0; k < mu; k++) {
            var zi = cmaes.zs[sortedIndices[k]][i];
            rmu += cmaes.weights[k] * zi * zi;
        }
        cmaes.D[i] = (1 - cmaes.c1 - cmaes.cmu) * cmaes.D[i] + r1 + cmaes.cmu * rmu;
        cmaes.D[i] = Math.max(1e-10, Math.min(1e6, cmaes.D[i]));
    }
    cmaes.gen++;
}

function cmaesToggle() {
    if (cmaes.active) {
        cmaes.active = false;
        var el = document.getElementById('cmaes-toggle');
        if (el) el.checked = false;
        var info = document.getElementById('info-box');
        if (info) info.innerHTML += '<br><span style="color:#ff8a65">CMA-ES desactivado — vuelve al GA estándar</span>';
        return;
    }
    // Inicializar desde el mejor cerebro disponible
    var seedNet = null;
    if (bestLapNet) {
        seedNet = new Net(JSON.parse(JSON.stringify(bestLapNet)));
    } else if (cars.length > 0) {
        var best = cars.slice().sort(function (a, b) { return b._fitness - a._fitness; })[0];
        seedNet = best.net.clone();
    }
    var coldStart = !seedNet;
    if (coldStart) seedNet = new Net(); // exploración desde red aleatoria con sigma alto
    cmaesInit(seedNet, coldStart ? 0.5 : 0.15);
    var info = document.getElementById('info-box');
    if (info) info.innerHTML += '<br><span style="color:#00e676">CMA-ES activado — n=' + cmaes.n + ' dims, σ=' + cmaes.sigma.toFixed(3) + '</span>';
}

// ==================== EVOLUTION ====================
function resetTraining() {
    gen = 0; gbl = Infinity; bestDistFound = 0; bestDistNet = null; cars = []; top3ids = new Set();
    lastRecordGen = 0; lastDistRecordGen = 0;
    sectorApproachStates = {};
    currentLaps = train.lapStart; currentMut = train.mutBase;
    prevBestFitness = -Infinity; staleCount = 0;
    genHistory = [];
    fineTuneActive = false; // FIX #10
    if (curriculumMode) { curriculumSector = 1; bestCurriculumNet = null; }
    cmaes.zs = null; cmaes.xs = null; // limpiar candidatos anteriores sin desactivar CMA-ES
    // distributedSpawnMode no se resetea: persiste entre entrenamientos
    var info = document.getElementById('info-box');
    if (info) info.textContent = 'Entrenamiento reiniciado.';
}

function selectTop3(carList) {
    // Curriculum: priorizar siempre autos que llegaron al goal
    if (curriculumMode) {
        var goalHitters = carList.filter(function (c) { return c.curriculumGoalHit; })
            .sort(function (a, b) { return b._fitness - a._fitness; });
        if (goalHitters.length >= 3) return { mode: 'curriculum-goal', selected: goalHitters.slice(0, 3) };
        var byFit = carList.slice().sort(function (a, b) { return b._fitness - a._fitness; });
        if (goalHitters.length > 0) {
            var rest = byFit.filter(function (c) { return !c.curriculumGoalHit; });
            return { mode: 'curriculum-mix', selected: goalHitters.concat(rest).slice(0, 3) };
        }
        return { mode: 'curriculum-explore', selected: byFit.slice(0, 3) };
    }
    var finished = carList.filter(function (c) { return c.finished && c.laps >= currentLaps; });
    if (finished.length >= 3) {
        finished.sort(function (a, b) { return a.finishFrame - b.finishFrame; });
        return { mode: 'tiempo', selected: finished.slice(0, 3) };
    }
    if (finished.length > 0) {
        var rest = carList.filter(function (c) { return !c.finished; }).sort(function (a, b) { return b._fitness - a._fitness; });
        finished.sort(function (a, b) { return a.finishFrame - b.finishFrame; });
        return { mode: 'mixto', selected: finished.concat(rest).slice(0, 3) };
    }
    return { mode: 'distancia', selected: carList.slice().sort(function (a, b) { return b._fitness - a._fitness; }).slice(0, 3) };
}

function newGen() {
    if (!loaded || CL.length < 10) return;
    finishTimer = -1;

    var selResult = { mode: 'init', selected: [] };

    if (cars.length > 0) {
        cars.forEach(function (c) { if (c.alive) { c.alive = false; c._fitness = c.calcFitness(); } });

        // Presión de diversidad: niche counting por zona máxima alcanzada
        // Autos que mueren todos en el mismo lugar se dividen el fitness → evita convergencia prematura
        var nicheCounts = {};
        cars.forEach(function (c) {
            var maxZ = 0;
            for (var z = c.ZONES - 1; z >= 0; z--) { if (c.zonesHit[z]) { maxZ = z; break; } }
            c._nicheZone = maxZ;
            nicheCounts[maxZ] = (nicheCounts[maxZ] || 0) + 1;
        });
        cars.forEach(function (c) {
            var n = nicheCounts[c._nicheZone] || 1;
            // Solo aplicar a exploradores: finalizadores deben converger en velocidad, no diversificarse
            if (n > 1 && !c.finished) c._fitness /= Math.sqrt(n);
        });

        selResult = selectTop3(cars);

        var bestFit = Math.max.apply(null, cars.map(function (c) { return c._fitness; }));
        var finCount = cars.filter(function (c) { return c.finished; }).length;
        var finRate = finCount / cars.length;

        // FIX #4: solo UN bloque de staleCount, sin el segundo if(improved)
        var improved = bestFit > prevBestFitness * 1.01;
        if (improved) {
            staleCount = 0;
            currentMut = Math.max(train.mutMin, currentMut * 0.85);
        } else {
            staleCount++;
            if (staleCount >= train.stale) {
                currentMut = Math.min(train.mutMax, currentMut * 1.2);
                staleCount = 0;
            }
        }
        prevBestFitness = Math.max(prevBestFitness, bestFit);

        // Distance record (fase exploratoria sin vueltas)
        var genBestExplorer = cars.slice().sort(function (a, b) { return b.totalD - a.totalD; })[0];
        if (gbl === Infinity && genBestExplorer && genBestExplorer.totalD > bestDistFound && genBestExplorer.totalD > 20) {
            bestDistFound = genBestExplorer.totalD;
            lastDistRecordGen = gen;
            bestDistNet = JSON.parse(JSON.stringify(genBestExplorer.net.w));
            if (typeof createProfileFromCar === 'function') createProfileFromCar(genBestExplorer, false, "EXPLORADOR (GEN " + gen + ")");
        }

        // Stagnation detection (autoTrain gestiona las transiciones automáticamente)
        if (!autoTrain.active) {
            if (gbl === Infinity && bestDistNet && gen - lastDistRecordGen >= train.stagLimit) {
                var doReset = !train.stagConfirm || confirm("ESTANCAMIENTO: nadie completo una vuelta en " + train.stagLimit + " gens. Reiniciar desde mejor explorador?");
                if (doReset) {
                    lastDistRecordGen = gen;
                    fineTuneProfile = { net: JSON.parse(JSON.stringify(bestDistNet)) };
                    fineTuneActive = true;
                    gen = 0; staleCount = 0; currentMut = train.mutBase;
                } else {
                    lastDistRecordGen = gen;
                }
            }

            if (gbl !== Infinity && gen - lastRecordGen >= train.stagLimit && bestLapNet) {
                var doReset2 = !train.stagConfirm || confirm("RECORD ESTANCADO " + train.stagLimit + " gens. Recuperar desde mejor cerebro historico?");
                if (doReset2) {
                    lastRecordGen = gen;
                    fineTuneProfile = { net: JSON.parse(JSON.stringify(bestLapNet)) };
                    fineTuneActive = true;
                    gen = 0; staleCount = 0; currentMut = train.mutBase;
                } else {
                    lastRecordGen = gen;
                }
            }
        }

        // Progresion de vueltas (solo fuera de curriculum)
        if (!curriculumMode && finRate >= train.lapThresh && currentLaps < train.lapMax) {
            currentLaps++;
            staleCount = 0;
            currentMut = train.mutBase;
        }

        // Curriculum: avanzar sector + mutación adaptativa al hit rate
        if (curriculumMode) {
            var hitCount = cars.filter(function (c) { return c.curriculumGoalHit; }).length;
            var hitRate = hitCount / cars.length;

            // Guardar mejor auto que llegó al goal (para seeding cross-sector)
            var goalCars = cars.filter(function (c) { return c.curriculumGoalHit; })
                .sort(function (a, b) { return b._fitness - a._fitness; });
            if (goalCars.length > 0) {
                bestCurriculumNet = JSON.parse(JSON.stringify(goalCars[0].net.w));
            }

            // Mutación adaptativa: si muchos llegan al goal → explotar (menos mutación)
            // si pocos llegan → explorar (más mutación). Override del sistema estándar.
            if (hitRate > 0.5) {
                currentMut = Math.max(train.mutMin, currentMut * 0.75);
            } else if (hitRate < 0.1 && bestCurriculumNet === null) {
                currentMut = Math.min(train.mutMax, currentMut * 1.3);
            }

            if (hitRate >= curriculumThresh) {
                curriculumSector++;
                staleCount = 0;
                prevBestFitness = -Infinity;

                // Seed toda la próxima gen desde el mejor auto que llegó al goal
                // con baja mutación para converger rápido en el nuevo sector
                if (bestCurriculumNet) {
                    fineTuneProfile = { net: JSON.parse(JSON.stringify(bestCurriculumNet)) };
                    fineTuneActive = true;
                    currentMut = train.mutBase * 0.4;
                } else {
                    currentMut = train.mutBase;
                }

                if (curriculumSector > CURRICULUM_ZONES) {
                    curriculumMode = false;
                    curriculumSector = 1;
                    var info = document.getElementById('info-box');
                    if (info) info.innerHTML += '<br><span style="color:#00e676">✓ Curriculum completo — modo vuelta activado</span>';
                    if (typeof updateCurriculumUI === 'function') updateCurriculumUI();
                }
            }
        }

        var avgFitness = cars.reduce(function (sum, c) { return sum + c._fitness; }, 0) / cars.length;
        var allLaps = cars.map(function (c) { return c.bestLap(); }).filter(function (l) { return l !== Infinity && l > 0; });
        var genBestLap = allLaps.length > 0 ? Math.min.apply(null, allLaps) : null;
        genHistory.push({
            gen: gen,
            bestLap: genBestLap,
            avgFitness: avgFitness,
            completionRate: finRate
        });
        if (typeof drawChart === 'function') drawChart();

        var info = document.getElementById('info-box');
        if (info) {
            var modeStr = selResult.mode === 'tiempo' ? 'top3 tiempo' : selResult.mode === 'mixto' ? 'mixto' : 'distancia';
            var selStr = selResult.selected.map(function (c) {
                return c.finished ? (c.finishFrame / 60).toFixed(2) + 's' : 'fit:' + Math.round(c._fitness);
            }).join(' / ');
            if (curriculumMode) {
                var hitC = cars.filter(function (c) { return c.curriculumGoalHit; }).length;
                info.innerHTML = 'Gen <span>' + gen + '</span> | Mut: <span>' + currentMut.toFixed(3) + '</span> | <span style="color:#4fc3f7">CURRICULUM Sector ' + curriculumSector + '/' + CURRICULUM_ZONES + '</span><br>Alcanzaron meta: <span style="color:#00e676">' + hitC + '/' + cars.length + '</span> (' + Math.round(hitC / cars.length * 100) + '%) | umbral: ' + Math.round(curriculumThresh * 100) + '%';
            } else {
                info.innerHTML = 'Gen <span>' + gen + '</span> | Mut: <span>' + currentMut.toFixed(3) + '</span> | Obj: <span>' + currentLaps + 'v</span><br>Sel: <span>' + selStr + '</span>';
            }
        }
        if (typeof updateCurriculumUI === 'function') updateCurriculumUI();

        // CMA-ES: actualizar media y covarianza con la generación evaluada
        if (cmaes.active && cmaes.xs) {
            var sortedIdx = cars.map(function (_, i) { return i; })
                .sort(function (a, b) { return cars[b]._fitness - cars[a]._fitness; });
            cmaesUpdate(sortedIdx);
            // Mostrar sigma actual en info-box
            var infoEl = document.getElementById('info-box');
            if (infoEl) infoEl.innerHTML += ' | <span style="color:#ce93d8">CMA σ=' + cmaes.sigma.toFixed(4) + '</span>';
        }
    }

    // Auto-train: evaluar transición de fase antes de construir la próxima generación
    if (autoTrain.active) {
        var _finRate = cars.length > 0 ? cars.filter(function (c) { return c.finished; }).length / cars.length : 0;
        var _hitRate = cars.length > 0 ? cars.filter(function (c) { return c.curriculumGoalHit; }).length / cars.length : 0;
        autoTrainTick(_finRate, _hitRate);
    }

    gen++;
    top3ids = new Set(selResult.selected.map(function (c) { return c.id; }));
    var eliteNets = selResult.selected.map(function (c) { return c.net; });
    var newNets = [];

    // FIX #10: usar fineTuneActive en lugar de gen===1
    if (fineTuneActive && fineTuneProfile) {
        var baseSeed = new Net(fineTuneProfile.net);
        if (cmaes.active) {
            // Redirigir CMA-ES al nuevo seed (avance de sector o stage recovery)
            // En curriculum: sigma 0.2 para que CMA-ES explore el nuevo sector con margen suficiente.
            // En fase de laps (no curriculum): sigma 0.15 para explotar lo aprendido.
            cmaes.mean = netFlatten(baseSeed.w);
            cmaes.ps = new Array(cmaes.n).fill(0);
            cmaes.pc = new Array(cmaes.n).fill(0);
            cmaes.D = new Array(cmaes.n).fill(1.0);
            cmaes.sigma = curriculumMode ? 0.2 : 0.15;
            newNets = cmaesGenPop();
        } else {
            newNets = [];
            while (newNets.length < train.pop) {
                newNets.push(baseSeed.mut(currentMut * (0.3 + Math.random() * 0.7)));
            }
        }
        fineTuneActive = false; // reset flag despues de aplicar
        fineTuneProfile = null;
    } else if (cmaes.active) {
        // CMA-ES: muestrea desde la distribución aprendida
        newNets = cmaesGenPop();
        // Preservar la mejor élite exacta como seguro contra regresión
        if (eliteNets.length > 0) newNets[newNets.length - 1] = eliteNets[0].clone();
    } else {
        // Elite exactas
        var eliteCount = Math.min(train.elite, eliteNets.length);
        for (var i = 0; i < eliteCount; i++) newNets.push(eliteNets[i % eliteNets.length].clone());

        // Inyectar mejor explorador si aun no hay vueltas
        if (gbl === Infinity && bestDistNet) {
            newNets.push(new Net(JSON.parse(JSON.stringify(bestDistNet))));
        }
        // Preservar conocimiento de curriculum aunque no haya vuelta aún
        if (gbl === Infinity && bestCurriculumNet) {
            newNets.push(new Net(JSON.parse(JSON.stringify(bestCurriculumNet))));
        }
        // Hall of fame: siempre preservar el mejor lap net histórico para prevenir olvido catastrófico
        if (gbl !== Infinity && bestLapNet) {
            newNets.push(new Net(JSON.parse(JSON.stringify(bestLapNet))));
        }

        // Micro-mutaciones: ajustes mínimos para exprimir décimas de segundo
        if (selResult.mode === 'tiempo') {
            for (var i = 0; i < eliteCount; i++) newNets.push(eliteNets[i % eliteNets.length].mut(currentMut * 0.08));
        }
        // Mutaciones suaves de elite
        for (var i = 0; i < eliteCount; i++) newNets.push(eliteNets[i % eliteNets.length].mut(currentMut * 0.3));
        for (var i = 0; i < eliteCount; i++) newNets.push(eliteNets[i % eliteNets.length].mut(currentMut * 0.6));

        // Crossover entre elite: combina conocimientos de distintos padres
        if (eliteNets.length >= 2) {
            var crossoverN = Math.max(2, Math.floor(train.pop * 0.2));
            for (var i = 0; i < crossoverN; i++) {
                var pA = eliteNets[Math.floor(Math.random() * eliteNets.length)];
                var pB = eliteNets[Math.floor(Math.random() * eliteNets.length)];
                if (pA !== pB) {
                    newNets.push(pA.crossover(pB).mut(currentMut * 0.25));
                }
            }
        }

        // Inyección aleatoria: reducida en modo tiempo para no diluir genes rápidos
        var injectFraction = (selResult.mode === 'tiempo') ? 0.05 : train.inject;
        var injectN = Math.floor(train.pop * injectFraction);
        for (var i = 0; i < injectN; i++) newNets.push(new Net());

        // Relleno con mutaciones
        while (newNets.length < train.pop) {
            var base = eliteNets.length > 0 ? eliteNets[Math.floor(Math.random() * eliteNets.length)] : new Net();
            newNets.push(base.mut(currentMut * (0.7 + Math.random() * 0.6)));
        }
    }

    while (newNets.length > train.pop) newNets.pop();

    cars = newNets.map(function (n, i) {
        var c = new Car(n, i, CCOLS[i % CCOLS.length]);
        if (typeof currentAppliedTuning !== 'undefined') c.tuning = JSON.parse(JSON.stringify(currentAppliedTuning));

        if (CL.length >= 10) {
            var spawnZoneTarget = -1;
            if (distributedSpawnMode) {
                var ZONES = 24;
                spawnZoneTarget = Math.floor((i / newNets.length) * ZONES + Math.random() * (ZONES / newNets.length)) % ZONES;
            } else if (curriculumMode && curriculumIsolated) {
                // Aislado: usar estado de aproximación REAL si está disponible.
                // Esto elimina el covariate shift: el auto ve el sector con la velocidad
                // y ángulo que tendría llegando desde el inicio, no arrancando de cero.
                // Mapear sector curriculum (puede ser 1..192) a zona interna (0..23) para el approach state
                var approachCarZone = Math.max(0, Math.min(23, Math.floor((curriculumSector - 1) / CURRICULUM_ZONES * 24)));
                var savedState = sectorApproachStates[approachCarZone]
                    || sectorApproachStates[Math.max(0, approachCarZone - 1)]; // zona anterior como fallback
                if (savedState) {
                    // Retroceder ~2.5% del track desde el estado guardado para dar un runway corto.
                    // Spawning exactamente en la frontera de zona = puede ser plena curva a alta velocidad.
                    // Con runway: el auto sale alineado con el CL y tiene espacio para reaccionar.
                    var nearIdx = nearCL(savedState.x, savedState.y);
                    var runupSteps = Math.max(3, Math.floor(CL.length * 0.025));
                    var backIdx = (nearIdx - runupSteps + CL.length) % CL.length;
                    var bPt = CL[backIdx];
                    var bNext = CL[(backIdx + 1) % CL.length];
                    c.x = bPt[0] + (Math.random() - 0.5) * 2;
                    c.y = bPt[1] + (Math.random() - 0.5) * 2;
                    c.ang = Math.atan2(bNext[1] - bPt[1], bNext[0] - bPt[0]) + (Math.random() - 0.5) * 0.06;
                    c.spd = savedState.spd * (0.6 + Math.random() * 0.25); // algo más lento para mayor margen
                    c.prevX = c.x; c.prevY = c.y;
                    c.prevIdx = nearCL(c.x, c.y);
                    c.spawnZone = approachCarZone;
                    c.crossCD = 30;
                } else {
                    spawnZoneTarget = approachCarZone; // fallback si aún no hay estado guardado
                }
            }
            if (spawnZoneTarget >= 0) {
                var ZONES = 24;
                var spawnIdx = zoneClIndexAI(spawnZoneTarget, ZONES);
                var pt = CL[spawnIdx];
                var nextPt = CL[(spawnIdx + 1) % CL.length];
                c.x = pt[0];
                c.y = pt[1];
                c.prevX = pt[0];
                c.prevY = pt[1];
                c.ang = Math.atan2(nextPt[1] - pt[1], nextPt[0] - pt[0]);
                c.prevIdx = spawnIdx;
                c.spawnZone = spawnZoneTarget;
                c.crossCD = 30;
            }
        }

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