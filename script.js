// AI RACER v2.0 - Core Simulation & Viewport Logic

sc = document.getElementById('sc');
sctx = sc.getContext('2d');
var container = document.getElementById('viewport-container');

// Viewport State
var view = { x: 0, y: 0, zoom: 1, panning: false, lastX: 0, lastY: 0 };
var CW, CH;

function resize() {
    CW = container.clientWidth;
    CH = container.clientHeight;
    sc.width = CW;
    sc.height = CH;
    if (view.x === 0 && view.y === 0) {
        view.x = CW / 2 - 330;
        view.y = CH / 2 - 180;
    }
    render();
}
window.addEventListener('resize', resize);
setTimeout(resize, 100);

function applyView(ctx) { ctx.setTransform(view.zoom, 0, 0, view.zoom, view.x, view.y); }
function resetView(ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); }
function screenToWorld(sx, sy) { return { x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom }; }

// Interactions
grabbedIdx = -1;
grabbedWallIdx = -1;
isEditing = true;
editorMode = 'track'; // 'track' or 'walls'
deathWalls = []; // Each wall is an array of points [[x,y], [x,y], ...]

function getMousePos(e) {
    var r = sc.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}

sc.addEventListener('mousedown', function (e) {
    var m = getMousePos(e);
    var w = screenToWorld(m.x, m.y);

    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        view.panning = true;
        view.lastX = m.x;
        view.lastY = m.y;
        return;
    }

    if (e.button === 0 && isEditing) {
        if (editorMode === 'track') {
            var found = -1;
            for (var i = 0; i < pmpts.length; i++) {
                if (Math.hypot(w.x - pmpts[i][0], w.y - pmpts[i][1]) < 12 / view.zoom) {
                    found = i; break;
                }
            }
            if (found !== -1) grabbedIdx = found;
            else { pmpts.push([w.x, w.y]); rebuild(); }
        } else if (editorMode === 'walls') {
            // New wall node or grab existing
            var foundWall = -1, foundNode = -1;
            for (var i = 0; i < deathWalls.length; i++) {
                for (var j = 0; j < deathWalls[i].length; j++) {
                    if (Math.hypot(w.x - deathWalls[i][j][0], w.y - deathWalls[i][j][1]) < 12 / view.zoom) {
                        foundWall = i; foundNode = j; break;
                    }
                }
                if (foundWall !== -1) break;
            }

            if (foundWall !== -1) {
                grabbedIdx = foundNode;
                grabbedWallIdx = foundWall;
            } else {
                // If double click logic is needed, we could close walls. 
                // For now, let's just make it simple: 
                // If there's an ongoing wall (active last one), we add to it.
                // Or start a new one if we use a keyboard shortcut or button.
                // Simplified: All walls are one array for now or we use a "New Wall" button.
                // Better: Just one big polyline that we can "break" with a button?
                // Let's use the simplest: clicks add points to the LAST wall.
                if (deathWalls.length === 0) deathWalls.push([]);
                deathWalls[deathWalls.length - 1].push([w.x, w.y]);
                render();
            }
        }
    }
});

sc.addEventListener('mousemove', function (e) {
    var m = getMousePos(e);
    var w = screenToWorld(m.x, m.y);

    if (view.panning) {
        view.x += m.x - view.lastX;
        view.y += m.y - view.lastY;
        view.lastX = m.x;
        view.lastY = m.y;
        render();
        return;
    }

    if (grabbedIdx !== -1) {
        if (editorMode === 'track') {
            pmpts[grabbedIdx] = [w.x, w.y];
            rebuild();
        } else if (editorMode === 'walls' && grabbedWallIdx !== -1) {
            deathWalls[grabbedWallIdx][grabbedIdx] = [w.x, w.y];
            render();
        }
    }
});

sc.addEventListener('mouseup', function () {
    view.panning = false;
    grabbedIdx = -1;
    grabbedWallIdx = -1;
});

sc.addEventListener('wheel', function (e) {
    e.preventDefault();
    var m = getMousePos(e);
    var wPre = screenToWorld(m.x, m.y);

    var factor = e.deltaY < 0 ? 1.1 : 0.9;
    view.zoom = Math.max(0.1, Math.min(10, view.zoom * factor));

    var wPost = screenToWorld(m.x, m.y);
    view.x += (wPost.x - wPre.x) * view.zoom;
    view.y += (wPost.y - wPre.y) * view.zoom;
    render();
}, { passive: false });

// Tab Management
document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        document.getElementById('panel-' + t.dataset.tab).classList.add('active');
        isEditing = (t.dataset.tab === 'editor');

        // Sidebar expansion logic
        var sidebar = document.querySelector('.sidebar');
        if (t.dataset.tab === 'auto') {
            sidebar.classList.add('expanded');
            updateAutoDashboard();
        } else {
            sidebar.classList.remove('expanded');
        }

        render();
    });
});

// Ranking Toggles
document.getElementById('btn-toggle-rk').addEventListener('click', function () {
    var win = document.getElementById('ranking-window');
    win.classList.toggle('open');
    var arrow = document.getElementById('rk-arrow');
    if (arrow) arrow.textContent = win.classList.contains('open') ? '▼' : '▲';
});
document.getElementById('rk-toggle-hud').addEventListener('click', function () {
    var win = document.getElementById('ranking-window');
    win.classList.toggle('open');
    var arrow = document.getElementById('rk-arrow');
    if (arrow) arrow.textContent = win.classList.contains('open') ? '▼' : '▲';
});

// Track Mechanics
var pmpts = [];

document.getElementById('tw').addEventListener('input', function () {
    TW = +this.value;
    document.getElementById('tw-v').textContent = this.value;
    rebuild();
});

// Mode Management
document.getElementById('btn-mode-track').addEventListener('click', function () {
    editorMode = 'track';
    this.classList.add('active');
    document.getElementById('btn-mode-walls').classList.remove('active');
    document.getElementById('editor-hint').innerHTML = 'Haz clic para agregar puntos.<br>Arrastra puntos para editar.<br>Doble clic para cerrar.';
});
document.getElementById('btn-mode-walls').addEventListener('click', function () {
    editorMode = 'walls';
    this.classList.add('active');
    document.getElementById('btn-mode-track').classList.remove('active');
    document.getElementById('editor-hint').innerHTML = 'Haz clic para crear un muro rojo.<br>Cualquier auto que lo toque morirá.<br>Presiona "Nuevo Muro" para empezar otro.';
});
document.getElementById('btn-clr-walls').addEventListener('click', function () {
    if (confirm('¿Borrar todos los muros de muerte?')) {
        deathWalls = [];
        render();
    }
});

document.getElementById('btn-new-wall').addEventListener('click', function () {
    deathWalls.push([]);
    editorMode = 'walls';
    document.getElementById('btn-mode-walls').classList.add('active');
    document.getElementById('btn-mode-track').classList.remove('active');
    document.getElementById('editor-hint').innerHTML = 'Iniciando nuevo muro... Haz clic en el mapa.';
});

document.getElementById('btn-undo').addEventListener('click', function () {
    if (editorMode === 'track') pmpts.pop();
    else if (deathWalls.length > 0) {
        var last = deathWalls[deathWalls.length - 1];
        if (last.length > 0) last.pop();
        if (last.length === 0) deathWalls.pop();
    }
    rebuild();
});
document.getElementById('btn-clr').addEventListener('click', function () { pmpts = []; CL = []; OUT = []; INN = []; loaded = false; startLine = null; render(); });
document.getElementById('btn-load').addEventListener('click', function () {
    if (CL.length < 20) { alert('Dibuja una pista mas grande primero (mínimo 20 segmentos)'); return; }
    buildStartLine(); loaded = true; resetTraining();
    isEditing = false;
    document.getElementById('ranking-window').classList.remove('hidden');
    buildHead();
    render();
});

// Save Track logic
document.getElementById('btn-save').addEventListener('click', function () {
    if (pmpts.length < 3) { alert('No hay pista para guardar.'); return; }
    var data = { pmpts: pmpts, TW: TW, deathWalls: deathWalls };
    var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'track_' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
});

// Load Track logic
document.getElementById('btn-import').addEventListener('click', function () {
    document.getElementById('track-file').click();
});

document.getElementById('track-file').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
        try {
            var data = JSON.parse(e.target.result);
            if (data.pmpts && Array.isArray(data.pmpts)) {
                pmpts = data.pmpts;
                if (data.TW) {
                    TW = data.TW;
                    document.getElementById('tw').value = TW;
                    document.getElementById('tw-v').textContent = TW;
                }
                if (data.deathWalls) {
                    deathWalls = data.deathWalls;
                }
                rebuild();
                alert('Pista cargada con éxito.');
            } else {
                alert('Archivo inválido.');
            }
        } catch (err) {
            alert('Error al leer el archivo.');
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset for next time
});

document.getElementById('btn-save-brain').addEventListener('click', function () {
    if (cars.length === 0) { alert('No hay entrenamiento activo.'); return; }
    var data = {
        gen: gen,
        gbl: gbl,
        currentLaps: currentLaps,
        currentMut: currentMut,
        staleCount: staleCount,
        prevBestFitness: prevBestFitness,
        phys: JSON.parse(JSON.stringify(phys)),
        train: JSON.parse(JSON.stringify(train)),
        genHistory: genHistory,
        weights: cars.map(function (c) { return c.net.w; })
    };
    var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'brain_gen' + gen + '_' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('btn-load-brain').addEventListener('click', function () {
    document.getElementById('brain-file').click();
});

document.getElementById('brain-file').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    if (!loaded) { alert('Carga primero una pista.'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
        try {
            var data = JSON.parse(e.target.result);
            if (data.weights && Array.isArray(data.weights)) {
                running = false;
                cancelAnimationFrame(animId);

                // Restore Core state
                gen = data.gen || 0;
                gbl = data.gbl || Infinity;
                currentLaps = data.currentLaps || train.lapStart;
                currentMut = data.currentMut || train.mutBase;
                staleCount = data.staleCount || 0;
                prevBestFitness = data.prevBestFitness || -Infinity;
                genHistory = data.genHistory || [];

                // Restore Physics
                if (data.phys) {
                    Object.keys(data.phys).forEach(function (k) { phys[k] = data.phys[k]; });
                    physMap.forEach(function (item) {
                        var el = document.getElementById(item[0]);
                        if (el) { el.value = phys[item[1]]; el.dispatchEvent(new Event('input')); }
                    });
                }

                // Restore Training Settings
                if (data.train) {
                    Object.keys(data.train).forEach(function (k) { train[k] = data.train[k]; });
                    trainMap.forEach(function (item) {
                        var el = document.getElementById(item[0]);
                        if (el) { el.value = train[item[1]]; el.dispatchEvent(new Event('input')); }
                    });
                }

                // Recreate Cars
                cars = data.weights.map(function (w, i) {
                    return new Car(new Net(w), i, CCOLS[i % CCOLS.length]);
                });

                render();
                updateLB();
                if (typeof drawChart === 'function') drawChart();

                alert('Cerebro y configuración cargados con éxito.\nGeneración: ' + gen + '\nVueltas objetivo: ' + currentLaps);
                document.getElementById('bstart').textContent = 'INICIAR';
            } else {
                alert('Archivo de cerebro inválido.');
            }
        } catch (err) {
            console.error(err);
            alert('Error al leer el archivo.');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
});

function catmull(pts) {
    if (pts.length < 2) return pts;
    var n = pts.length, res = [];
    for (var i = 0; i < n; i++) {
        var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
        for (var s = 0; s < 16; s++) {
            var t = s / 16, t2 = t * t, t3 = t2 * t;
            res.push([
                0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            ]);
        }
    }
    return res;
}
function simp(pts, d) { d = d || 9; if (pts.length < 2) return pts; var r = [pts[0]]; for (var i = 1; i < pts.length; i++) { var l = r[r.length - 1]; if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) >= d) r.push(pts[i]); } return r; }
function mkOff(center, hw) {
    var n = center.length, o = [], inn = [];
    for (var i = 0; i < n; i++) {
        var pv = center[(i - 1 + n) % n], nx_ = center[(i + 1) % n];
        var dx = nx_[0] - pv[0], dy = nx_[1] - pv[1], len = Math.hypot(dx, dy) || 1;
        var nrx = -dy / len, nry = dx / len;
        o.push([center[i][0] + nrx * hw, center[i][1] + nry * hw]);
        inn.push([center[i][0] - nrx * hw, center[i][1] - nry * hw]);
    }
    return { o: o, inn: inn };
}
function rebuild() {
    if (pmpts.length < 3) { CL = []; OUT = []; INN = []; render(); return; }
    CL = catmull(simp(pmpts, 10));
    var res = mkOff(CL, TW / 2); OUT = res.o; INN = res.inn;
    // Precompute cumulative distances along the centerline
    clDist = [0];
    for (var i = 1; i < CL.length; i++) {
        var dx = CL[i][0] - CL[i - 1][0], dy = CL[i][1] - CL[i - 1][1];
        clDist.push(clDist[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    // Close the loop: add distance from last point back to first
    var ldx = CL[0][0] - CL[CL.length - 1][0], ldy = CL[0][1] - CL[CL.length - 1][1];
    clTotalLen = clDist[clDist.length - 1] + Math.sqrt(ldx * ldx + ldy * ldy);
    if (loaded) buildStartLine();
    render();
}
function buildStartLine() {
    if (CL.length < 4) return;
    var idx = Math.floor(CL.length * 0.02);
    var p = CL[idx], next = CL[(idx + 2) % CL.length];
    var dx = next[0] - p[0], dy = next[1] - p[1], len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len, ny = dx / len;
    startLine = { x: p[0], y: p[1], idx: idx, nx: nx, ny: ny, ax: p[0] - nx * TW * 0.6, ay: p[1] - ny * TW * 0.6, bx: p[0] + nx * TW * 0.6, by: p[1] + ny * TW * 0.6, ang: Math.atan2(dy, dx) };
    _idealLineCacheKey = ''; // invalidar caché al cambiar el trazado
}

// ==================== TRAZADO IDEAL + TIEMPO TEÓRICO ====================
var _idealLineCache = null, _idealLineCacheKey = '';
var _teoCache = null, _teoCacheKey = '';

function calcIdealLine() {
    var key = CL.length + ',' + TW.toFixed(1);
    if (key === _idealLineCacheKey && _idealLineCache) return _idealLineCache;
    if (!loaded || CL.length < 10) { _idealLineCache = null; return null; }

    var n = CL.length;
    var pts = [];

    for (var i = 0; i < n; i++) {
        var prev = CL[(i - 1 + n) % n], curr = CL[i], next = CL[(i + 1) % n];
        var v1x = curr[0] - prev[0], v1y = curr[1] - prev[1];
        var v2x = next[0] - curr[0], v2y = next[1] - curr[1];
        var l1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1;
        var l2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1;
        var u1x = v1x / l1, u1y = v1y / l1;
        var u2x = v2x / l2, u2y = v2y / l2;

        // Curvatura con signo: positivo = giro izquierda, negativo = derecha
        var kSigned = u1x * u2y - u1y * u2x;
        // Curvatura física en 1/unidades-internas (para cálculo de velocidad máxima)
        var kPhys = Math.abs(kSigned) / ((l1 + l2) / 2 + 0.01);

        // Normal izquierda de la dirección media
        var adx = u1x + u2x, ady = u1y + u2y;
        var al = Math.sqrt(adx * adx + ady * ady) || 1;
        var lnx = -ady / al, lny = adx / al;

        // Desplazar hacia el interior de la curva
        var maxShift = TW * 0.42;
        var shift = Math.max(-maxShift, Math.min(maxShift, kSigned * TW * 1.2));
        pts.push([curr[0] + lnx * shift, curr[1] + lny * shift, kPhys]);
    }

    // Suavizado (60 pasadas): convierte el desplazamiento brusco en línea de trazado fluida
    for (var pass = 0; pass < 60; pass++) {
        var s = [];
        for (var i = 0; i < n; i++) {
            var p = pts[(i - 1 + n) % n], c = pts[i], nx = pts[(i + 1) % n];
            s.push([c[0] * 0.5 + p[0] * 0.25 + nx[0] * 0.25,
                    c[1] * 0.5 + p[1] * 0.25 + nx[1] * 0.25,
                    c[2]]);
        }
        pts = s;
    }

    _idealLineCache = pts;
    _idealLineCacheKey = key;
    return pts;
}

function drawIdealLine(ctx) {
    var il = calcIdealLine();
    if (!il) return;
    var n = il.length;

    // Normalizar curvatura para color: cyan (rápido) → verde → amarillo → rojo (lento)
    var maxK = 0;
    for (var i = 0; i < n; i++) if (il[i][2] > maxK) maxK = il[i][2];
    if (maxK < 1e-9) return;

    ctx.save();
    ctx.lineWidth = 2 / view.zoom;
    ctx.globalAlpha = 0.65;
    ctx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
        var a = il[i], b = il[(i + 1) % n];
        var t = Math.min(1, a[2] / maxK);              // 0=recto, 1=curva cerrada
        var hue = Math.round(180 - t * 180);           // 180(cyan) → 120(verde) → 60(amarillo) → 0(rojo)
        ctx.strokeStyle = 'hsl(' + hue + ',100%,55%)';
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}

function calcTheoreticalBestTime() {
    var key = _idealLineCacheKey + '|' + phys.vmax + '|' + phys.accel + '|' + phys.maneuver;
    if (key === _teoCacheKey && _teoCache !== null) return _teoCache;

    var il = calcIdealLine();
    if (!il || il.length < 10) return null;
    var n = il.length;

    var sm = phys.sm || 10;
    var vmax = phys.vmax / sm;
    // grip derivado de la misma fórmula que usa la simulación
    var grip = 0.2 + (phys.maneuver / 100) * 0.4;
    // fuerza de aceleración por frame (igual que internalAccelForce * dt)
    var accelF = ((100 / sm) / (Math.max(0.1, phys.accel) * 0.96)) * 0.016;
    var brakeF = accelF * 12;

    // Longitudes de segmento del trazado ideal
    var segLen = [];
    for (var i = 0; i < n; i++) {
        var a = il[i], b = il[(i + 1) % n];
        segLen.push(Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])));
    }

    // Velocidad máxima en cada punto: v = sqrt(grip / k_fisica)
    // Derivado de la condición de no-deslizamiento: |steer|*v ≤ grip → v_max = sqrt(grip/k)
    var vCap = il.map(function (pt) {
        return pt[2] > 1e-9 ? Math.min(vmax, Math.sqrt(grip / pt[2])) : vmax;
    });

    var v = vCap.slice();

    // Perfil de velocidad: 3 pasadas forward/backward para convergencia con wrap-around
    for (var pass = 0; pass < 3; pass++) {
        for (var i = 0; i < n; i++) {
            var ni = (i + 1) % n;
            var vReach = Math.sqrt(Math.max(0, v[i] * v[i] + 2 * accelF * segLen[i]));
            if (vReach < v[ni]) v[ni] = Math.min(vCap[ni], vReach);
        }
        for (var i = n - 1; i >= 0; i--) {
            var ni = (i + 1) % n;
            var vReach = Math.sqrt(Math.max(0, v[ni] * v[ni] + 2 * brakeF * segLen[i]));
            if (vReach < v[i]) v[i] = Math.min(vCap[i], vReach);
        }
    }

    // Integrar tiempo en frames
    var frames = 0;
    for (var i = 0; i < n; i++) {
        var avgV = (v[i] + v[(i + 1) % n]) / 2;
        frames += segLen[i] / Math.max(avgV, 0.001);
    }

    _teoCacheKey = key;
    _teoCache = frames;
    return frames;
}
function pp(ctx, poly) {
    if (!poly || poly.length < 2) return;
    ctx.beginPath(); poly.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }); ctx.closePath();
}

// Rendering
function render() {
    // Camera Tracking
    if (camFollow && cars.length > 0) {
        var aliveCars = cars.filter(function (c) { return c.alive; });
        var targetCars = aliveCars.length > 0 ? aliveCars : cars;
        var leader = targetCars.reduce(function (a, b) { return a.totalD > b.totalD ? a : b; }, targetCars[0]);
        if (leader) {
            var targetX = CW / 2 - leader.x * view.zoom;
            var targetY = CH / 2 - leader.y * view.zoom;
            view.x += (targetX - view.x) * 0.08;
            view.y += (targetY - view.y) * 0.08;
        }
    }

    sctx.clearRect(0, 0, CW, CH);
    sctx.fillStyle = '#050507';
    sctx.fillRect(0, 0, CW, CH);
    sctx.save();
    applyView(sctx);
    var gridS = 100;
    sctx.beginPath();
    sctx.strokeStyle = 'rgba(255,255,255,0.03)';
    for (var x = -5000; x < 5000; x += gridS) { sctx.moveTo(x, -5000); sctx.lineTo(x, 5000); }
    for (var y = -5000; y < 5000; y += gridS) { sctx.moveTo(-5000, y); sctx.lineTo(5000, y); }
    sctx.stroke();
    sctx.restore();
    if (isEditing) drawEditor();
    else drawSim();

    drawDeathWalls(sctx);

    if (!isEditing) drawCanvasHUD(sctx);
}
// Returns the CL index for zone z, distributed by real track distance
function zoneClIndex(z, ZONES) {
    if (clTotalLen <= 0 || clDist.length !== CL.length) {
        return Math.round((z / ZONES) * CL.length) % CL.length;
    }
    var target = (z / ZONES) * clTotalLen;
    var lo = 0, hi = CL.length - 1;
    while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (clDist[mid] < target) lo = mid + 1; else hi = mid;
    }
    return lo % CL.length;
}

function drawCheckpoints(ctx, ZONES, bestCar) {
    var n = CL.length;
    var czones = (typeof CURRICULUM_ZONES !== 'undefined') ? CURRICULUM_ZONES : ZONES;
    var cmode = (typeof curriculumMode !== 'undefined' && curriculumMode);
    var cSector = (typeof curriculumSector !== 'undefined') ? curriculumSector : -1;
    var hasMicro = cmode && czones > ZONES;

    var ratio = czones / ZONES; // 1 para 1×, 2/4/8 para micro

    // Dibujar micro-sectores cuando CURRICULUM_ZONES > 24
    if (hasMicro) {
        for (var s = 1; s < czones; s++) {
            if (s % ratio === 0) continue; // coincide con zona regular, la dibujará el loop de abajo
            var mci = zoneClIndex(s, czones);
            var mcp = CL[mci];
            var mcprev = CL[(mci - 1 + n) % n];
            var mcnext = CL[(mci + 1) % n];
            var mcdx = mcnext[0] - mcprev[0], mcdy = mcnext[1] - mcprev[1];
            var mclen = Math.sqrt(mcdx * mcdx + mcdy * mcdy) || 1;
            var mcnx = -mcdy / mclen, mcny = mcdx / mclen;
            var isMGoal = (s === cSector);
            var mchalf = isMGoal ? TW * 0.35 : TW * 0.12; // objetivo: más ancho; tick normal: pequeño
            ctx.beginPath();
            ctx.moveTo(mcp[0] + mcnx * mchalf, mcp[1] + mcny * mchalf);
            ctx.lineTo(mcp[0] - mcnx * mchalf, mcp[1] - mcny * mchalf);
            ctx.strokeStyle = isMGoal ? 'rgba(255, 152, 0, 0.95)' : 'rgba(180, 100, 255, 0.35)';
            ctx.lineWidth = isMGoal ? 3 : 1 / view.zoom;
            ctx.stroke();
            if (isMGoal) {
                ctx.beginPath();
                ctx.arc(mcp[0], mcp[1], TW * 0.2, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 152, 0, 0.3)';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fillStyle = 'rgba(255, 152, 0, 1)';
                ctx.font = 'bold ' + (8 / view.zoom) + 'px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('★' + s, mcp[0] + mcnx * (mchalf + 7 / view.zoom), mcp[1] + mcny * (mchalf + 7 / view.zoom));
            }
        }
    }

    // goalZone en zona regular:
    // - 1× mode: mapeo directo sector→zona
    // - micro mode: solo si el sector objetivo coincide con una zona regular (s % ratio === 0)
    var goalZone = -1;
    if (cmode) {
        if (!hasMicro) {
            goalZone = Math.min(Math.floor(cSector / czones * ZONES), ZONES - 1);
        } else if (cSector % ratio === 0) {
            goalZone = Math.min(cSector / ratio, ZONES - 1);
        }
    }
    for (var z = 0; z < ZONES; z++) {
        var ci = zoneClIndex(z, ZONES);
        var cp = CL[ci];
        var cprev = CL[(ci - 1 + n) % n];
        var cnext = CL[(ci + 1) % n];
        var cdx = cnext[0] - cprev[0], cdy = cnext[1] - cprev[1];
        var clen = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
        var cnx = -cdy / clen, cny = cdx / clen;
        var chalf = TW * 0.55;
        var hit = bestCar && bestCar.zonesHit && bestCar.zonesHit[z];
        var isGoal = (z === goalZone);
        var lineColor, labelColor, lw;
        if (isGoal) {
            lineColor = 'rgba(255, 152, 0, 0.95)';
            labelColor = 'rgba(255, 152, 0, 1)';
            lw = 3;
        } else if (hit) {
            lineColor = 'rgba(0, 230, 118, 0.7)';
            labelColor = 'rgba(0, 230, 118, 0.9)';
            lw = 2;
        } else {
            lineColor = 'rgba(100, 180, 255, 0.3)';
            labelColor = 'rgba(100, 180, 255, 0.55)';
            lw = 1 / view.zoom;
        }
        ctx.beginPath();
        ctx.moveTo(cp[0] + cnx * chalf, cp[1] + cny * chalf);
        ctx.lineTo(cp[0] - cnx * chalf, cp[1] - cny * chalf);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = lw;
        ctx.stroke();
        // Pulse ring on goal zone
        if (isGoal) {
            ctx.beginPath();
            ctx.arc(cp[0], cp[1], TW * 0.3, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 152, 0, 0.3)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.fillStyle = labelColor;
        ctx.font = (isGoal ? 'bold ' : '') + (8 / view.zoom) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isGoal ? '★' + z : z, cp[0] + cnx * (chalf + 7 / view.zoom), cp[1] + cny * (chalf + 7 / view.zoom));
    }
}

function drawEditor() {
    sctx.save(); applyView(sctx);
    if (CL.length > 3) {
        pp(sctx, OUT); sctx.fillStyle = '#141418'; sctx.fill();
        pp(sctx, INN); sctx.fillStyle = '#050507'; sctx.fill();
        sctx.strokeStyle = 'rgba(255,255,255,0.05)'; sctx.setLineDash([5, 9]); pp(sctx, CL); sctx.stroke(); sctx.setLineDash([]);
        sctx.strokeStyle = 'rgba(0, 230, 118, 0.4)'; sctx.lineWidth = 2; pp(sctx, OUT); sctx.stroke(); pp(sctx, INN); sctx.stroke();
        if (startLine) { sctx.strokeStyle = '#ffeb3b'; sctx.lineWidth = 3; sctx.beginPath(); sctx.moveTo(startLine.ax, startLine.ay); sctx.lineTo(startLine.bx, startLine.by); sctx.stroke(); }
        // Draw checkpoint zones in editor
        drawCheckpoints(sctx, 24, null);
    }
    pmpts.forEach(function (p, i) {
        sctx.beginPath(); sctx.arc(p[0], p[1], 5 / view.zoom, 0, Math.PI * 2);
        sctx.fillStyle = (i === 0) ? '#00e676' : '#ffb74d'; sctx.fill();
        if (grabbedIdx === i && grabbedWallIdx === -1) { sctx.strokeStyle = '#fff'; sctx.lineWidth = 2 / view.zoom; sctx.stroke(); }
    });
    sctx.restore();
}

function drawDeathWalls(ctx) {
    ctx.save();
    applyView(ctx);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    deathWalls.forEach(function (wall, wIdx) {
        if (wall.length < 2) return;

        ctx.beginPath();
        ctx.strokeStyle = '#ff5252';
        ctx.lineWidth = 6 / view.zoom;
        wall.forEach(function (p, i) {
            if (i === 0) ctx.moveTo(p[0], p[1]);
            else ctx.lineTo(p[0], p[1]);
        });
        ctx.stroke();

        // Inner white glow for the wall
        ctx.beginPath();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 / view.zoom;
        wall.forEach(function (p, i) {
            if (i === 0) ctx.moveTo(p[0], p[1]);
            else ctx.lineTo(p[0], p[1]);
        });
        ctx.stroke();

        // Nodes in editor mode
        if (isEditing && editorMode === 'walls') {
            wall.forEach(function (p, i) {
                ctx.beginPath();
                ctx.arc(p[0], p[1], 4 / view.zoom, 0, Math.PI * 2);
                ctx.fillStyle = (grabbedIdx === i && grabbedWallIdx === wIdx) ? '#fff' : '#ff5252';
                ctx.fill();
            });
        }
    });

    ctx.restore();
}
function drawSafetyZone(ctx) {
    if (!loaded || CL.length < 10) return;
    ctx.save();
    var limit = (TW / 2) * (train.safety || 2.0);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw several layers for a gradient effect
    var layers = [1.0, 0.8, 0.6];
    var opacities = [0.03, 0.05, 0.08];

    layers.forEach(function (factor, i) {
        ctx.beginPath();
        CL.forEach(function (p, idx) {
            if (idx === 0) ctx.moveTo(p[0], p[1]);
            else ctx.lineTo(p[0], p[1]);
        });
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255, 50, 50, ' + opacities[i] + ')';
        ctx.lineWidth = limit * 2 * factor;
        ctx.stroke();
    });

    ctx.restore();
}

function drawSim() {
    sctx.save(); applyView(sctx);
    if (!loaded || CL.length < 10) { sctx.restore(); return; }

    drawSafetyZone(sctx); // Draw the new safety gradient

    pp(sctx, OUT); sctx.fillStyle = '#141418'; sctx.fill();
    pp(sctx, INN); sctx.fillStyle = '#050507'; sctx.fill();
    sctx.strokeStyle = 'rgba(255,255,255,0.04)'; sctx.setLineDash([5, 9]); pp(sctx, CL); sctx.stroke(); sctx.setLineDash([]);
    sctx.strokeStyle = 'rgba(255,255,255,0.15)'; sctx.lineWidth = 1.5; pp(sctx, OUT); sctx.stroke(); pp(sctx, INN); sctx.stroke();
    if (startLine) { sctx.strokeStyle = 'rgba(255, 235, 59, 0.3)'; sctx.lineWidth = 3; sctx.beginPath(); sctx.moveTo(startLine.ax, startLine.ay); sctx.lineTo(startLine.bx, startLine.by); sctx.stroke(); }
    var showS = actF.has('sens');
    var alive = cars.filter(function (c) { return c.alive; });
    var bestA = alive.reduce(function (a, b) { return a && a._fitness > b._fitness ? a : b; }, null) || alive[0] || null;

    // Trazado ideal geométrico (sobre el asfalto, bajo los autos)
    drawIdealLine(sctx);

    // Draw checkpoint zones
    drawCheckpoints(sctx, 24, bestA);

    // En modo spawn distribuido: marcar el punto de inicio de cada auto
    if (typeof distributedSpawnMode !== 'undefined' && distributedSpawnMode && CL.length >= 10) {
        cars.forEach(function (c) {
            var idx = zoneClIndex(c.spawnZone || 0, 24);
            var pt = CL[idx];
            sctx.beginPath();
            sctx.arc(pt[0], pt[1], 4 / view.zoom, 0, Math.PI * 2);
            sctx.fillStyle = c.col;
            sctx.globalAlpha = 0.5;
            sctx.fill();
            sctx.globalAlpha = 1;
        });
    }

    cars.filter(function (c) { return !c.alive && !c.finished; }).forEach(function (c) { c.draw(false, false, false); });
    cars.filter(function (c) { return c.finished; }).forEach(function (c) { c.draw(false, top3ids.has(c.id), false); });
    alive.filter(function (c) { return c !== bestA; }).forEach(function (c) { c.draw(false, top3ids.has(c.id), showS); });
    if (bestA) bestA.draw(true, top3ids.has(bestA.id), showS);
    sctx.restore();
}

// Controller Mapping
var physMap = [
    ['pvmax', 'vmax'], ['paccel', 'accel'], ['pmaneuver', 'maneuver']
];

physMap.forEach(function (item) {
    var el = document.getElementById(item[0]);
    if (el) el.addEventListener('input', function () {
        var val = parseFloat(this.value);
        phys[item[1]] = val;
        var label = document.getElementById('v' + item[1]);
        if (label) label.textContent = (item[1] === 'accel') ? val.toFixed(1) : Math.round(val);
        updateAutoDashboard();
    });
});

// Drivetrain & Engine Position Selectors
document.querySelectorAll('.sel-dt').forEach(function (btn) {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.sel-dt').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        phys.drivetrain = this.dataset.dt;
        updateAutoDashboard();
    });
});

document.querySelectorAll('.sel-eng').forEach(function (btn) {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.sel-eng').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        phys.engine = this.dataset.eng;
        updateAutoDashboard();
    });
});

window.updateAutoDashboard = function () {
    document.getElementById('dash-vmax').textContent = Math.round(phys.vmax);
    document.getElementById('dash-accel').textContent = phys.accel.toFixed(1);
    document.getElementById('dash-maneuver').textContent = Math.round(phys.maneuver);
    document.getElementById('dash-traction').textContent = phys.drivetrain + " (" + phys.engine + ")";

    // Update labels if needed
    document.getElementById('vvmax').textContent = Math.round(phys.vmax);
    document.getElementById('vaccel').textContent = phys.accel.toFixed(1);
    document.getElementById('vmaneuver').textContent = Math.round(phys.maneuver);

    // Performance Class logic
    var pClass = "Prototype";
    if (phys.vmax > 320) pClass = "Hypercar";
    else if (phys.vmax > 260) pClass = "Supercar";
    else if (phys.vmax > 180) pClass = "Sport";
    else pClass = "Compact";
    document.getElementById('auto-class').textContent = "Performance Class: " + pClass;
};

var PSETS = {
    f1: { vmax: 340, accel: 2.4, maneuver: 95, drivetrain: 'RWD', engine: 'M' },
    f1_2026: { vmax: 365, accel: 2.1, maneuver: 98, drivetrain: 'AWD', engine: 'M' },
    gt: { vmax: 280, accel: 3.5, maneuver: 85, drivetrain: 'RWD', engine: 'M' },
    rally: { vmax: 210, accel: 4.2, maneuver: 75, drivetrain: '4WD', engine: 'F' },
    drift: { vmax: 190, accel: 4.8, maneuver: 65, drivetrain: 'RWD', engine: 'F' },
    kart: { vmax: 140, accel: 5.5, maneuver: 90, drivetrain: 'RWD', engine: 'R' }
};

document.querySelectorAll('.pre').forEach(function (b) {
    b.addEventListener('click', function () {
        var p = PSETS[b.dataset.p]; if (!p) return;
        Object.keys(p).forEach(function (k) { phys[k] = p[k]; });

        // Update Sliders
        document.getElementById('pvmax').value = phys.vmax;
        document.getElementById('paccel').value = phys.accel;
        document.getElementById('pmaneuver').value = phys.maneuver;

        // Update Button Groups
        document.querySelectorAll('.sel-dt').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.dt === phys.drivetrain);
        });
        document.querySelectorAll('.sel-eng').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.eng === phys.engine);
        });

        updateAutoDashboard();
    });
});

var trainMap = [
    ['tpop', 'pop'], ['telite', 'elite'], ['tinject', 'inject'], ['tmut', 'mutBase'],
    ['tmutmin', 'mutMin'], ['tmutmax', 'mutMax'], ['tstale', 'stale'],
    ['tftime', 'ftime'], ['tfpen', 'fpen'], ['tfbonus', 'fbonus'],
    ['tlapst', 'lapStart'], ['tlapmax', 'lapMax'], ['tlapvalid', 'lapValid'],
    ['tsfty', 'safety'], ['tstaglimit', 'stagLimit']
];
trainMap.forEach(function (item) {
    var el = document.getElementById(item[0]);
    if (el) el.addEventListener('input', function () {
        var val = parseFloat(this.value); train[item[1]] = val;
        var label = document.getElementById('v' + item[0]);
        if (label) {
            if (item[1].includes('inject') || item[1].includes('Valid')) label.textContent = Math.round(val * 100);
            else if (item[1].includes('Limit') || item[1] === 'pop' || item[1] === 'elite' || item[1] === 'stale' || item[1] === 'lapStart' || item[1] === 'lapMax') label.textContent = Math.round(val);
            else label.textContent = val.toFixed(2);
            if (item[0] === 'tmut') { var mutDisplay = document.getElementById('vtmut'); if (mutDisplay) mutDisplay.textContent = val.toFixed(2); }
        }
    });
});

document.getElementById('tstagconfirm').addEventListener('change', function () {
    train.stagConfirm = this.checked;
});

// Curriculum Learning controls
window.updateCurriculumUI = function () {
    var sd = document.getElementById('curr-sector-display');
    var hd = document.getElementById('curr-hit-display');
    if (sd) sd.textContent = curriculumMode ? (curriculumSector + ' / ' + CURRICULUM_ZONES) : '—';
    if (hd) {
        if (curriculumMode && cars.length > 0) {
            var h = cars.filter(function (c) { return c.curriculumGoalHit; }).length;
            hd.textContent = h + ' / ' + cars.length + ' (' + Math.round(h / cars.length * 100) + '%)';
        } else {
            hd.textContent = '—';
        }
    }
    var toggle = document.getElementById('curriculum-toggle');
    if (toggle) toggle.checked = curriculumMode;

    // Botones de navegación
    var prevBtn = document.getElementById('curr-sector-prev');
    var nextBtn = document.getElementById('curr-sector-next');
    if (prevBtn) prevBtn.disabled = !curriculumMode || curriculumSector <= 1;
    if (nextBtn) nextBtn.disabled = !curriculumMode || curriculumSector >= CURRICULUM_ZONES;

    // Toggle acumulativo/aislado
    var cumulBtn = document.getElementById('curr-mode-cumul');
    var isolBtn = document.getElementById('curr-mode-isol');
    var desc = document.getElementById('curr-mode-desc');
    if (cumulBtn && isolBtn) {
        if (curriculumIsolated) {
            cumulBtn.style.background = 'transparent'; cumulBtn.style.color = '#666';
            isolBtn.style.background = 'rgba(255,152,0,0.4)'; isolBtn.style.color = '#ff9800';
            if (desc) desc.textContent = 'Spawn sector ' + (curriculumSector - 1) + ' → llegar al sector ' + curriculumSector;
        } else {
            cumulBtn.style.background = 'rgba(255,152,0,0.4)'; cumulBtn.style.color = '#ff9800';
            isolBtn.style.background = 'transparent'; isolBtn.style.color = '#666';
            if (desc) desc.textContent = 'Spawn zona 0 → llegar al sector ' + curriculumSector;
        }
    }
};

// Selector de granularidad de sectores
document.querySelectorAll('.curr-zones-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var zones = parseInt(this.dataset.zones);
        CURRICULUM_ZONES = zones;
        // Actualizar UI activo
        document.querySelectorAll('.curr-zones-btn').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        // Descripción
        var desc = document.getElementById('curr-zones-desc');
        if (desc) desc.textContent = 'Cada sector = 1/' + zones + ' de pista (~' + (100 / zones).toFixed(1) + '%)';
        // Resetear curriculum si está activo
        if (curriculumMode) {
            curriculumSector = 1;
            if (typeof updateCurriculumUI === 'function') updateCurriculumUI();
        }
    });
});

// Auto-train UI
window.updateAutoTrainUI = function () {
    var box = document.getElementById('autotrain-phase-box');
    var nameEl = document.getElementById('autotrain-phase-name');
    var detailEl = document.getElementById('autotrain-phase-detail');
    if (!box || !nameEl || !detailEl) return;
    if (!autoTrain.active) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    nameEl.style.color = autoTrain.phaseColors[autoTrain.phase] || '#00e676';
    nameEl.textContent = autoTrain.phaseNames[autoTrain.phase];
    var stuckInfo = '';
    if (autoTrain.phase === 1 && autoTrain.sectorTotalStuck > 0) {
        var stage = autoTrain.sectorTotalStuck >= 55 ? 'etapa 4' :
                    autoTrain.sectorTotalStuck >= 35 ? 'etapa 3' :
                    autoTrain.sectorTotalStuck >= 18 ? 'etapa 2' :
                    autoTrain.sectorTotalStuck >= 5  ? 'etapa 1' : '';
        stuckInfo = ' · atascado ' + autoTrain.sectorTotalStuck + ' gens' + (stage ? ' (' + stage + ')' : '');
    }
    var cmaeSigStr = (typeof cmaes !== 'undefined' && cmaes.active) ? ' · σ=' + cmaes.sigma.toFixed(4) : '';
    var details = [
        'CMA-ES frío · explorando conducción básica' + cmaeSigStr,
        'Spawn distribuido · CMA-ES aprende todo el track' + cmaeSigStr,
        'CMA-ES vuelta completa · ' + autoTrain.lapReadyGens + '/2 gens ≥15%' + cmaeSigStr,
        'CMA-ES optimizando tiempo de vuelta' + cmaeSigStr
    ];
    detailEl.textContent = details[autoTrain.phase] || '';
    // Sincronizar checkboxes manuales con el estado real
    var distToggle = document.getElementById('distributed-toggle');
    var currToggle = document.getElementById('curriculum-toggle');
    var cmaesChk = document.getElementById('cmaes-toggle');
    if (distToggle) distToggle.checked = typeof distributedSpawnMode !== 'undefined' && distributedSpawnMode;
    if (currToggle) currToggle.checked = typeof curriculumMode !== 'undefined' && curriculumMode;
    if (cmaesChk) cmaesChk.checked = typeof cmaes !== 'undefined' && cmaes.active;
};

document.getElementById('autotrain-toggle').addEventListener('change', function () {
    autoTrain.active = this.checked;
    if (autoTrain.active) {
        // Determinar fase de entrada según estado actual
        var startPhase = (typeof gbl !== 'undefined' && gbl !== Infinity) ? 3 : 0;
        autoTrain.phase = startPhase;
        autoTrain.lastPhaseGen = typeof gen !== 'undefined' ? gen : 0;
        autoTrain.sectorStuckGens = 0;
        autoTrain.sectorTotalStuck = 0;
        autoTrain.prevSector = -1;
        autoTrain.lapReadyGens = 0;
        autoTrain.origThresh = typeof curriculumThresh !== 'undefined' ? curriculumThresh : 0.6;
        // Limpiar modos manuales residuales para que auto-train tome control limpio
        if (typeof distributedSpawnMode !== 'undefined') distributedSpawnMode = false;
        if (typeof curriculumMode !== 'undefined' && curriculumMode) {
            curriculumMode = false;
            if (typeof updateCurriculumUI === 'function') updateCurriculumUI();
        }
        if (typeof cmaes !== 'undefined' && cmaes.active && startPhase !== 3) {
            cmaes.active = false;
        }
    } else {
        var box = document.getElementById('autotrain-phase-box');
        if (box) box.style.display = 'none';
    }
    updateAutoTrainUI();
});

document.getElementById('cmaes-toggle').addEventListener('change', function () {
    cmaesToggle();
    var statusEl = document.getElementById('cmaes-status');
    if (statusEl) {
        statusEl.textContent = cmaes.active
            ? 'Activo — n=' + cmaes.n + ' dims, σ=' + cmaes.sigma.toFixed(3)
            : 'Desactivado — usa GA estándar';
        statusEl.style.color = cmaes.active ? '#ce93d8' : '#888';
    }
    // Actualizar el checkbox al estado real (por si cmaesToggle lo rechazó)
    this.checked = cmaes.active;
});

document.getElementById('distributed-toggle').addEventListener('change', function () {
    distributedSpawnMode = this.checked;
    if (distributedSpawnMode && curriculumMode) {
        // mutuamente excluyentes
        curriculumMode = false;
        document.getElementById('curriculum-toggle').checked = false;
        document.getElementById('curriculum-controls').style.display = 'none';
        updateCurriculumUI();
    }
});

document.getElementById('curriculum-toggle').addEventListener('change', function () {
    curriculumMode = this.checked;
    document.getElementById('curriculum-controls').style.display = curriculumMode ? 'block' : 'none';
    if (curriculumMode) {
        curriculumSector = 1;
        if (distributedSpawnMode) {
            distributedSpawnMode = false;
            document.getElementById('distributed-toggle').checked = false;
        }
    }
    updateCurriculumUI();
});

document.getElementById('curr-thresh').addEventListener('input', function () {
    curriculumThresh = parseFloat(this.value);
    document.getElementById('vcurr-thresh').textContent = Math.round(curriculumThresh * 100);
});

document.getElementById('curr-sector-prev').addEventListener('click', function () {
    if (curriculumSector > 1) { curriculumSector--; updateCurriculumUI(); }
});

document.getElementById('curr-sector-next').addEventListener('click', function () {
    if (curriculumSector < CURRICULUM_ZONES) { curriculumSector++; updateCurriculumUI(); }
});

document.getElementById('curr-mode-cumul').addEventListener('click', function () {
    curriculumIsolated = false; updateCurriculumUI();
});

document.getElementById('curr-mode-isol').addEventListener('click', function () {
    curriculumIsolated = true; updateCurriculumUI();
});

// Tooltip Logic
var PARAM_DESCS = {
    pvmax: "Velocidad Máxima: El límite de velocidad que el auto puede alcanzar en km/h. Afectado por la carga aerodinámica y la potencia disponible.",
    paccel: "Aceleración (0-100): El tiempo en segundos que tarda el vehículo en alcanzar los 100 km/h. Un valor menor significa un motor más potente.",
    pmaneuver: "Maniobrabilidad: Capacidad de giro y agarre lateral. Valores altos permiten curvas más cerradas, pero a alta velocidad el auto puede 'irse largo' si se supera el límite de fricción.",
    'sel-dt': "Tracción (Drivetrain): FWD (Delantera), RWD (Trasera), 4WD (4x4), AWD (Total). Afecta la estabilidad y capacidad de salida en curvas.",
    'sel-eng': "Posición del Motor: F (Frontal), M (Central), R (Trasero). Cambia el centro de gravedad y la inercia de rotación del vehículo.",
    tstaglimit: "Límite de Estancamiento: Número de generaciones sin romper un récord tras las cuales se activará la recuperación automática."
};

var tt = document.getElementById('param-tooltip');
document.querySelectorAll('.info-btn').forEach(function (btn) {
    btn.addEventListener('mouseenter', function (e) {
        var key = this.dataset.info;
        if (!PARAM_DESCS[key] || !tt) return;
        var parts = PARAM_DESCS[key].split(':');
        tt.innerHTML = '<strong>' + parts[0] + '</strong><p style="margin:0;color:var(--color-text-secondary)">' + parts.slice(1).join(':').trim() + '</p>';
        tt.classList.remove('hidden');
        tt.style.opacity = '1';

        var rect = this.getBoundingClientRect();
        var tw = tt.offsetWidth;
        var th = tt.offsetHeight;

        var tx = rect.right + 10;
        var ty = rect.top - th / 2 + rect.height / 2;

        if (tx + tw > window.innerWidth) {
            tx = rect.left - tw - 10;
        }

        tt.style.left = tx + 'px';
        tt.style.top = ty + 'px';
    });
    btn.addEventListener('mouseleave', function () {
        if (tt) {
            tt.style.opacity = '0';
            setTimeout(function () { if (tt.style.opacity === '0') tt.classList.add('hidden'); }, 200);
        }
    });
});

// Ranking & Pills
actF = new Set(['st', 'speed', 'laps', 'bl', 'fit']);

document.querySelectorAll('.ft').forEach(function (el) {
    el.addEventListener('click', function () {
        var c = el.dataset.c;
        if (actF.has(c)) { actF.delete(c); el.classList.remove('active'); }
        else { actF.add(c); el.classList.add('active'); }
        buildHead();
    });
});

function getCols() {
    var base = [{ k: 'pos', l: '#', w: '26px' }, { k: 'dot', l: '', w: '12px' }, { k: 'nm', l: 'Auto', w: '1fr' }];
    var dynamic = Array.from(actF).map(function (k) {
        var label = k.toUpperCase();
        var width = '50px';
        if (k === 'st') { label = 'ESTADO'; width = '60px'; }
        if (k === 'speed') { label = 'VEL'; width = '45px'; }
        if (k === 'laps') { label = 'V/P'; width = '65px'; }
        if (k === 'bl') { label = 'MEJOR'; width = '55px'; }
        if (k === 'fit') { label = 'FIT'; width = '50px'; }
        if (k === 'thr') { label = 'GAS'; width = '45px'; }
        if (k === 'brk') { label = 'BRK'; width = '45px'; }
        if (k === 'slip') { label = 'SLIP'; width = '45px'; }
        if (k === 'tyre') { label = 'TYRE'; width = '45px'; }
        if (k === 'sens') { label = 'SENS'; width = '45px'; }
        return { k: k, l: label, w: width };
    });
    return base.concat(dynamic);
}

function buildHead() {
    var cols = getCols(), h = document.getElementById('lbh');
    if (!h) return;
    h.style.gridTemplateColumns = cols.map(function (c) { return c.w; }).join(' ');
    h.innerHTML = cols.map(function (c) { return '<span>' + c.l + '</span>'; }).join('');
}
function fmtF(f) { if (!isFinite(f) || f === 0) return '--'; return (f / 60).toFixed(2) + 's'; }
var lbTick = 0;
function updateLB() {
    if (++lbTick % 10 !== 0 || isEditing) return;
    document.getElementById('sg').textContent = gen;
    document.getElementById('sa').textContent = cars.filter(function (c) { return c.alive; }).length + '/' + cars.length;
    var allBL = cars.map(function (c) { return c.bestLap(); }).filter(function (v) { return v > 0; });
    var bestBL = allBL.length ? Math.min.apply(null, allBL) : Infinity;
    document.getElementById('sbl').textContent = fmtF(bestBL);
    document.getElementById('srec').textContent = fmtF(gbl);
    var teo = calcTheoreticalBestTime();
    var steo = document.getElementById('steo');
    if (steo) steo.textContent = teo ? fmtF(teo) : '--';

    // Update Stagnation Counter in Main HUD
    var stagBox = document.getElementById('stag-hud-box');
    if (stagBox) {
        stagBox.classList.remove('hidden'); // Always show it
        var stagnation = 0, limit = 100, label = "Intento";

        if (gbl === Infinity) {
            stagnation = gen - lastDistRecordGen;
            limit = train.stagLimit || 100;
            label = "Exploración";
        } else {
            stagnation = gen - lastRecordGen;
            limit = train.stagLimit || 100;
            label = "Récord";
        }

        var sstag = document.getElementById('sstag');
        sstag.parentElement.innerHTML = label + ' <span id="sstag" style="color: var(--color-warning); font-weight: 700;">' + stagnation + '/' + limit + '</span>';

        // Refresh reference to the newly created span if needed, but innerHTML is enough for now.
        // Actually, just update textContent to avoid recreating the span every 10 frames.
        var sstagNew = document.getElementById('sstag');
        sstagNew.textContent = stagnation + '/' + limit;
        sstagNew.style.color = stagnation > (limit * 0.85) ? '#ff5252' : (stagnation > (limit * 0.5) ? '#ffb74d' : 'var(--color-warning)');
    }

    var cols = getCols();
    var sorted = cars.slice().sort(function (a, b) {
        if (a.finished && !b.finished) return -1;
        if (!a.finished && b.finished) return 1;
        if (a.finished && b.finished) return a.finishFrame - b.finishFrame;
        return b._fitness - a._fitness;
    });

    var lbb = document.getElementById('lbb');
    if (!lbb) return;
    lbb.innerHTML = sorted.map(function (c, i) {
        var cells = cols.map(function (col) {
            if (col.k === 'pos') return '<span style="color:var(--color-text-dim)">' + (i + 1) + '</span>';
            if (col.k === 'dot') return '<span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + c.col + '"></span></span>';
            if (col.k === 'nm') return '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Auto ' + (c.id + 1) + '</span>';
            if (col.k === 'st') {
                if (c.finished) return '<span style="color:var(--color-success)">FIN</span>';
                return '<span>' + (c.alive ? 'VIVO' : 'CRASH') + '</span>';
            }
            if (col.k === 'speed') return '<span>' + c.spd.toFixed(1) + '</span>';
            if (col.k === 'laps') {
                var pct = Math.round((c.lapCoverageOk ? c.lapProgress() : 0) * 100);
                return '<span>' + c.laps + ' <small style="color:var(--color-text-dim)">' + pct + '%</small></span>';
            }
            if (col.k === 'bl') {
                var bl = c.bestLap();
                var isRec = bl === gbl && isFinite(bl);
                return '<span style="color:' + (isRec ? 'var(--color-accent)' : 'inherit') + '">' + fmtF(bl) + '</span>';
            }
            if (col.k === 'fit') return '<span>' + Math.round(c._fitness || c.calcFitness()) + '</span>';
            if (col.k === 'thr') return '<span>' + Math.round(c.thrOut * 100) + '%</span>';
            if (col.k === 'brk') return '<span>' + Math.round(c.brkOut * 100) + '%</span>';
            if (col.k === 'slip') return '<span>' + c.slip.toFixed(0) + '°</span>';
            if (col.k === 'tyre') return '<span>' + Math.round(c.tw * 100) + '%</span>';
            if (col.k === 'sens') return '<span>' + Math.round(c.msens * 100) + '%</span>';
            return '<span></span>';
        });
        var isT3 = top3ids.has(c.id);
        var cls = 'lbr' + (i === 0 ? ' leader' : isT3 ? ' top3' : '') + (!c.alive && !c.finished ? ' dead' : '');
        return '<div class="' + cls + '" style="grid-template-columns:' + cols.map(function (c) { return c.w; }).join(' ') + '">' + cells.join('') + '</div>';
    }).join('');
}

// Loop
var sspd = 1, running = false, animId = null;
function loop() {
    for (var s = 0; s < sspd; s++) {
        if (finishTimer > 0) {
            finishTimer--;
            if (finishTimer === 0) {
                cars.forEach(function (c) { if (c.alive) { c.alive = false; c._fitness = c.calcFitness(); } });
                var info = document.getElementById('info-banner');
                if (info) { info.textContent = "TIEMPO LÍMITE AGOTADO"; info.style.background = "var(--color-danger)"; setTimeout(function () { info.style.background = ""; }, 2000); }
            }
        }
        cars.forEach(function (c) { c.upd(); });
        if (cars.length > 0 && cars.filter(function (c) { return c.alive; }).length === 0 && running) newGen();
    }
    render(); updateLB(); if (running) animId = requestAnimationFrame(loop);
}

document.getElementById('bstart').addEventListener('click', function () {
    if (!loaded) { alert('Carga una pista primero'); return; }
    if (running) { running = false; cancelAnimationFrame(animId); this.textContent = 'INICIAR'; }
    else {
        running = true;
        if (isCompareMode) {
            this.textContent = 'PAUSA'; animId = requestAnimationFrame(compareLoop);
        } else {
            if (cars.length === 0) newGen(); this.textContent = 'PAUSA'; animId = requestAnimationFrame(loop);
        }
    }
});
document.getElementById('bnext').addEventListener('click', function () { if (loaded) newGen(); });
document.getElementById('bsp').addEventListener('click', function () {
    var spds = [0.5, 1, 3, 10, 30]; sspd = spds[(spds.indexOf(sspd) + 1) % spds.length]; this.textContent = sspd + 'x';
});
document.getElementById('breset').addEventListener('click', function () {
    if (confirm('¿Reiniciar todo el progreso?')) { running = false; cancelAnimationFrame(animId); gen = 0; gbl = Infinity; cars = []; render(); updateLB(); document.getElementById('bstart').textContent = 'INICIAR'; }
});

// Viewport UI Buttons
var camFollow = false;
document.getElementById('btn-cam-follow').addEventListener('click', function () {
    camFollow = !camFollow;
    this.classList.toggle('active', camFollow);
});

document.getElementById('btn-toggle-chart').addEventListener('click', function () {
    document.getElementById('chart-window').classList.toggle('hidden');
    drawChart();
});

document.getElementById('btn-close-chart').addEventListener('click', function () {
    document.getElementById('chart-window').classList.add('hidden');
});

document.getElementById('btn-zoom-in').addEventListener('click', function () { view.zoom *= 1.2; render(); });
document.getElementById('btn-zoom-out').addEventListener('click', function () { view.zoom /= 1.2; render(); });
document.getElementById('btn-reset-view').addEventListener('click', function () { view.x = CW / 2 - 330; view.y = CH / 2 - 180; view.zoom = 1; render(); });
document.getElementById('btn-fs').addEventListener('click', function () { if (!document.fullscreenElement) container.requestFullscreen(); else document.exitFullscreen(); });

function drawCanvasHUD(ctx) {
    if (cars.length === 0) return;
    var leader = cars.reduce(function (a, b) { return a.totalD > b.totalD ? a : b; }, cars[0]);
    if (!leader) return;

    ctx.save();
    ctx.translate(20, CH - 120);

    // Background (using direct rgba as canvas fillStyle doesn't support CSS vars)
    ctx.fillStyle = 'rgba(10, 10, 12, 0.9)';
    ctx.beginPath();
    ctx.rect(0, 0, 260, 100);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Speed Section
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';

    var spd = leader.spd;
    var vmax_internal = (leader.phys ? leader.phys.vmax : phys.vmax) / (phys.sm || 10);
    var sm = phys.sm || 10;
    var kmh = spd * sm;
    ctx.fillText('VELOCIDAD', 12, 22);
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#00e676';
    ctx.fillText(kmh.toFixed(0) + ' km/h', 95, 22);

    // Animated Speed Bar
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(12, 30, 160, 8);

    var spdPct = Math.min(1, spd / vmax_internal);
    var gradient = ctx.createLinearGradient(12, 0, 172, 0);
    gradient.addColorStop(0, '#2196f3'); // var(--color-info)
    gradient.addColorStop(1, '#00e676'); // var(--color-accent)

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.fillRect(12, 30, 160 * spdPct, 8);

    // BRAKE INDICATOR
    var brkOut = leader.brkOut || 0;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(12, 42, 160, 4); // Brake bar background
    if (brkOut > 0.05) {
        ctx.fillStyle = '#ff5252';
        ctx.fillRect(12, 42, 160 * brkOut, 4);
        ctx.font = 'bold 8px sans-serif';
        ctx.fillText('FRENO', 175, 46);
    }

    // Stats Grid
    ctx.fillStyle = '#606070'; // var(--color-text-dim)
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('VUELTA', 12, 54);
    ctx.fillText('TIEMPO', 12, 69);
    ctx.fillText('MEJOR (GLOB)', 12, 84);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(leader.laps + ' / ' + currentLaps, 95, 54);

    var lapTime = (leader.fc - leader.lapStartFrame) / 60;
    ctx.fillText(lapTime.toFixed(2) + 's', 95, 69);

    var bestL = leader.bestLap();
    var globalBest = gbl === Infinity ? '--' : (gbl / 60).toFixed(2) + 's';
    var localBest = bestL === Infinity ? globalBest : bestL.toFixed(2) + 's';
    ctx.fillStyle = bestL === Infinity ? '#606070' : '#00e676';
    ctx.fillText(localBest, 95, 84);

    // Slip Angle (G-Force Visual)
    ctx.translate(215, 54);

    // Arc background
    ctx.beginPath();
    ctx.arc(0, 0, 28, Math.PI * 0.8, Math.PI * 2.2);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Active Slip
    var slipRatio = leader.slip / 40;
    ctx.beginPath();
    var startA = Math.PI * 1.5;
    var endA = startA + (slipRatio * Math.PI * 0.6);
    ctx.arc(0, 0, 28, Math.min(startA, endA), Math.max(startA, endA));
    ctx.strokeStyle = Math.abs(leader.slip) > 15 ? '#ff5252' : '#2196f3';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Label
    ctx.fillStyle = '#606070';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SLIP', 0, 5);

    ctx.restore();

    // Curriculum mode overlay badge
    if (typeof curriculumMode !== 'undefined' && curriculumMode) {
        var hitC = cars.filter(function (c) { return c.curriculumGoalHit; }).length;
        var hitPct = cars.length > 0 ? hitC / cars.length : 0;
        var stuckLabel = (typeof autoTrain !== 'undefined' && autoTrain.active && autoTrain.sectorTotalStuck > 0)
            ? ' [atascado ' + autoTrain.sectorTotalStuck + ']' : '';
        ctx.save();
        ctx.translate(20, CH - 145);
        ctx.fillStyle = 'rgba(10,10,12,0.92)';
        ctx.beginPath(); ctx.rect(0, 0, 260, 20); ctx.fill();
        ctx.strokeStyle = 'rgba(255,152,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#ff9800';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('CURRICULUM — Sector ' + curriculumSector + ' / 23' + stuckLabel, 8, 14);
        // progress bar
        ctx.fillStyle = 'rgba(255,152,0,0.15)';
        ctx.fillRect(0, 0, 260, 20);
        ctx.fillStyle = hitPct >= curriculumThresh ? 'rgba(0,230,118,0.5)' : 'rgba(255,152,0,0.4)';
        ctx.fillRect(0, 0, 260 * hitPct, 20);
        ctx.restore();
    }
}

window.drawChart = function () {
    var canvas = document.getElementById('chart-canvas');
    if (!canvas) return;

    // If hidden, wait for next frame to measure correctly
    if (document.getElementById('chart-window').classList.contains('hidden')) return;

    requestAnimationFrame(function () {
        var rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
        var c = canvas.getContext('2d');
        c.scale(2, 2);
        var W = rect.width;
        var H = rect.height;

        c.clearRect(0, 0, W, H);

        if (typeof genHistory === 'undefined' || genHistory.length === 0) {
            c.fillStyle = '#666';
            c.font = '12px sans-serif';
            c.textAlign = 'center';
            c.fillText('Esperando datos de la primera generación...', W / 2, H / 2);
            return;
        }

        var pad = { top: 30, right: 40, bottom: 30, left: 50 };
        var gw = W - pad.left - pad.right;
        var gh = H - pad.top - pad.bottom;

        var maxGen = genHistory[genHistory.length - 1].gen;
        var minGen = Math.max(0, maxGen - 50);
        var viewData = genHistory.filter(function (d) { return d.gen >= minGen; });
        if (viewData.length === 0) return;

        // Find ranges
        var maxLap = 10, minLap = 0;
        var validLaps = viewData.map(function (d) { return d.bestLap }).filter(function (v) { return v !== null });
        if (validLaps.length > 0) {
            maxLap = Math.max.apply(null, validLaps) * 1.1;
            minLap = Math.min.apply(null, validLaps) * 0.9;
        }

        var maxFit = Math.max.apply(null, viewData.map(function (d) { return d.avgFitness }));
        var minFit = Math.min.apply(null, viewData.map(function (d) { return d.avgFitness }));
        if (Math.abs(maxFit - minFit) < 1) { maxFit += 10; minFit -= 10; }

        function getX(g) {
            if (maxGen === minGen) return pad.left + gw / 2;
            return pad.left + ((g - minGen) / (maxGen - minGen)) * gw;
        }
        function getY_lap(v) { return pad.top + gh - ((v - minLap) / Math.max(1, maxLap - minLap)) * gh; }
        function getY_fit(v) { return pad.top + gh - ((v - minFit) / Math.max(1, maxFit - minFit)) * gh; }
        function getY_comp(v) { return pad.top + gh - (v * gh); }

        // Grid
        c.strokeStyle = 'rgba(255,255,255,0.05)';
        c.lineWidth = 1;
        for (var i = 0; i <= 4; i++) {
            var y = pad.top + (gh / 4) * i;
            c.beginPath(); c.moveTo(pad.left, y); c.lineTo(pad.left + gw, y); c.stroke();
        }

        // Data Lines
        viewData.forEach(function (d) {
            if (d.lapsIncreased) {
                var x = getX(d.gen);
                c.fillStyle = 'rgba(0,230,118,0.1)';
                c.fillRect(x - 5, pad.top, 10, gh);
            }
        });

        // Fitness Line
        c.beginPath();
        viewData.forEach(function (d, i) {
            var x = getX(d.gen), y = getY_fit(d.avgFitness);
            if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        });
        c.strokeStyle = '#2196f3'; c.lineWidth = 2; c.stroke();

        // Best Lap Line
        c.beginPath();
        var hasLap = false;
        viewData.forEach(function (d) {
            if (d.bestLap !== null) {
                var x = getX(d.gen), y = getY_lap(d.bestLap);
                if (!hasLap) { c.moveTo(x, y); hasLap = true; } else { c.lineTo(x, y); }
            }
        });
        if (hasLap) { c.strokeStyle = '#00e676'; c.lineWidth = 2.5; c.stroke(); }

        // Completion Rate
        c.beginPath();
        viewData.forEach(function (d, i) {
            var x = getX(d.gen), y = getY_comp(d.completionRate);
            if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        });
        c.strokeStyle = '#ffb74d'; c.lineWidth = 1.5; c.setLineDash([4, 2]); c.stroke(); c.setLineDash([]);

        // Axis Labels
        c.fillStyle = '#999'; c.font = '9px sans-serif';
        c.textAlign = 'right';
        c.fillText(Math.round(maxFit), pad.left - 5, pad.top + 5);
        c.fillText(Math.round(minFit), pad.left - 5, pad.top + gh);

        c.textAlign = 'left';
        c.fillStyle = '#00e676'; c.fillText('Lap Time (s)', pad.left + 5, pad.top - 10);
        c.fillStyle = '#2196f3'; c.fillText('Fitness', pad.left + 80, pad.top - 10);
        c.fillStyle = '#ffb74d'; c.fillText('Completion %', pad.left + 140, pad.top - 10);
    });
};

// --- PROFILES & COMPARISON MODE ---
var profiles = [];
var selectedForCompare = new Set();
var compareCars = [];

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function renderProfiles() {
    var list = document.getElementById('profiles-list');
    if (!list) return;
    if (profiles.length === 0) {
        list.innerHTML = '<div style="font-size: 11px; color: var(--color-text-dim); text-align: center; margin-top: 20px;">No hay perfiles guardados.</div>';
        return;
    }

    list.innerHTML = profiles.map(function (p) {
        var isSel = selectedForCompare.has(p.id);
        return '<div class="profile-card ' + (isSel ? 'selected' : '') + '">' +
            '<div class="profile-card-header">' +
            '<div style="display:flex; align-items:center;">' +
            '<input type="checkbox" class="compare-checkbox" data-id="' + p.id + '" ' + (isSel ? 'checked' : '') + '>' +
            '<input type="text" class="profile-name" data-id="' + p.id + '" value="' + p.name + '">' +
            '</div>' +
            '<button class="no btn-del-profile" data-id="' + p.id + '" style="padding:2px 6px; margin-left:8px;">X</button>' +
            '</div>' +
            '<div class="profile-stats">' +
            '<span>⏱ ' + (p.stats.bestLap === Infinity ? '--' : fmtF(p.stats.bestLap)) + '</span>' +
            '<span>🧬 Gen ' + p.stats.gen + '</span>' +
            '<span>🏎 ' + (p.derivedFrom ? 'Tuned' : 'Base') + '</span>' +
            '</div>' +
            '<div class="profile-actions">' +
            '<button class="btn-tune-profile" data-id="' + p.id + '">🛠 Fine-Tune</button>' +
            '<button class="btn-export-profile" data-id="' + p.id + '">⬇ Exportar</button>' +
            '</div>' +
            '</div>';
    }).join('');

    // Attach events
    document.querySelectorAll('.compare-checkbox').forEach(function (cb) {
        cb.addEventListener('change', function () {
            if (this.checked) selectedForCompare.add(this.dataset.id);
            else selectedForCompare.delete(this.dataset.id);
            renderProfiles();
            updateCompareButton();
        });
    });
    document.querySelectorAll('.profile-name').forEach(function (inp) {
        inp.addEventListener('change', function () {
            var id = this.dataset.id;
            var prof = profiles.find(function (p) { return p.id === id });
            if (prof) prof.name = this.value;
        });
    });
    document.querySelectorAll('.btn-del-profile').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id = this.dataset.id;
            profiles = profiles.filter(function (p) { return p.id !== id });
            selectedForCompare.delete(id);
            renderProfiles();
            updateCompareButton();
        });
    });
    document.querySelectorAll('.btn-export-profile').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id = this.dataset.id;
            var prof = profiles.find(function (p) { return p.id === id });
            if (!prof) return;
            var blob = new Blob([JSON.stringify(prof)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = prof.name.replace(/\s+/g, '_') + '.json';
            a.click(); URL.revokeObjectURL(url);
        });
    });
    document.querySelectorAll('.btn-tune-profile').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id = this.dataset.id;
            var prof = profiles.find(function (p) { return p.id === id });
            if (!prof) return;
            if (!confirm('¿Cargar este perfil como base para un nuevo entrenamiento (Fine-Tuning)? Esto reiniciará la sesión actual.')) return;

            // Apply physics
            Object.keys(prof.phys).forEach(function (k) { phys[k] = prof.phys[k]; });
            physMap.forEach(function (item) { var el = document.getElementById(item[0]); if (el) { el.value = phys[item[1]]; el.dispatchEvent(new Event('input')); } });

            fineTuneProfile = prof;
            resetTraining();
            alert('Perfil "' + prof.name + '" cargado para fine-tuning. Ajusta la pista o presiona INICIAR.');
            document.querySelector('[data-tab="train"]').click();
        });
    });
}

function updateCompareButton() {
    var btn = document.getElementById('btn-start-compare');
    var rbtn = document.getElementById('btn-open-race');
    if (!btn || !rbtn) return;

    var count = selectedForCompare.size;
    btn.textContent = 'INICIAR COMPARACIÓN (' + count + ')';
    rbtn.textContent = '🏁 MODO CARRERA (' + count + ')';

    var active = count >= 2;
    btn.disabled = !active;
    btn.style.opacity = active ? '1' : '0.5';
    btn.classList.toggle('ok', active);

    rbtn.disabled = !active;
    rbtn.style.opacity = active ? '1' : '0.5';
}

window.createProfileFromCar = function (car, isAuto = false, customName = null) {
    var bLap = car.bestLap();
    var blText = bLap === Infinity ? 'Incompleto' : fmtF(bLap);

    var prof = {
        id: generateUUID(),
        name: customName || ((isAuto ? '🏆 Record: ' : 'Perfil ') + 'Gen ' + gen + ' (' + blText + ')'),
        net: JSON.parse(JSON.stringify(car.net.w)),
        phys: JSON.parse(JSON.stringify(phys)),
        stats: {
            gen: gen,
            bestLap: bLap,
            lapsRequired: currentLaps
        },
        derivedFrom: fineTuneProfile ? fineTuneProfile.name : null
    };
    profiles.push(prof);
    saveProfilesToLocal();
    renderProfiles();

    if (isAuto) {
        var info = document.getElementById('info-box');
        if (info) {
            var oldHTML = info.innerHTML;
            info.innerHTML = '<span style="color:var(--color-accent); font-weight:bold;">¡NUEVO RECORD!</span> Perfil auto-guardado.';
            setTimeout(function () {
                // Only restore if it hasn't been changed by something else (like a new generation)
                if (info.innerHTML.includes('RECORD')) info.innerHTML = oldHTML;
            }, 3000);
        }
    }
};

document.getElementById('btn-capture-profile').addEventListener('click', function () {
    if (cars.length === 0) { alert('No hay autos para capturar.'); return; }
    var bestCar = cars.reduce(function (a, b) { return a._fitness > b._fitness ? a : b; });
    createProfileFromCar(bestCar, false);
});

document.getElementById('btn-import-profile').addEventListener('click', function () { document.getElementById('profile-file').click(); });
document.getElementById('profile-file').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (evt) {
        try {
            var data = JSON.parse(evt.target.result);
            if (data.net && data.phys) {
                if (!data.id) data.id = generateUUID();
                profiles.push(data);
                renderProfiles();
            } else if (data.net && data.gen !== undefined) {
                // Support loading older neural network exports as profiles
                var legacyProf = {
                    id: generateUUID(),
                    name: 'Cerebro Legado Gen ' + data.gen,
                    net: data.net,
                    phys: JSON.parse(JSON.stringify(phys)),
                    stats: { gen: data.gen, bestLap: Infinity, lapsRequired: 1 },
                    derivedFrom: 'Versión Anterior'
                };
                profiles.push(legacyProf);
                renderProfiles();
                alert('Cerebro antiguo importado como perfil. Se le asignaron las físicas actuales.');
            } else { alert('Archivo de perfil inválido.'); }
        } catch (err) { alert('Error al leer el perfil.'); }
    };
    reader.readAsText(file);
    e.target.value = '';
});

// Comparison Mode Logic
document.getElementById('btn-start-compare').addEventListener('click', function () {
    if (selectedForCompare.size < 2) return;
    if (!loaded) { alert('Carga una pista primero.'); return; }

    running = false;
    cancelAnimationFrame(animId);
    isCompareMode = true;

    compareCars = Array.from(selectedForCompare).map(function (id, idx) {
        var prof = profiles.find(function (p) { return p.id === id });
        var col = CCOLS[idx % CCOLS.length];
        var c = new Car(new Net(prof.net), idx, col, prof.phys, prof.name);
        return c;
    });

    document.getElementById('main-hud').classList.add('hidden');
    document.getElementById('compare-hud').classList.remove('hidden');
    document.getElementById('bstart').textContent = 'REANUDAR';

    // Set cars for rendering
    cars = compareCars;

    running = true;
    animId = requestAnimationFrame(compareLoop);
});

document.getElementById('btn-exit-compare').addEventListener('click', function () {
    isCompareMode = false;
    running = false;
    cancelAnimationFrame(animId);
    cars = [];
    document.getElementById('compare-hud').classList.add('hidden');
    document.getElementById('main-hud').classList.remove('hidden');
    render();
    resetTraining();
    document.getElementById('bstart').textContent = 'INICIAR';
});

var compareTick = 0;
function compareLoop() {
    if (!isCompareMode) return;

    for (var s = 0; s < sspd; s++) {
        compareCars.forEach(function (c) { c.upd(); });

        // Reloop dead/finished cars
        if (compareCars.length > 0 && compareCars.filter(function (c) { return c.alive }).length === 0) {
            compareCars.forEach(function (c) {
                c.x = startLine.x; c.y = startLine.y; c.ang = startLine.ang;
                c.spd = 0; c.slip = 0; c.alive = true; c.finished = false;
                c.fc = 0; c.prevIdx = startLine.idx; c.totalD = 0; c.stuck = 0;
                c.laps = 0; c.lapStartFrame = 0; c.finishFrame = 0; c.lapTimes = [];
                c.resetLapTracking(); c.crossCD = 0; c.tw = 1; c.totalSlip = 0;
                c.fuel = c.phys.fuelLiters || 50;
            });
        }
    }

    render();

    if (isRaceMode) {
        if (++compareTick % 10 === 0) updateRaceTV();
    } else {
        if (++compareTick % 10 === 0) {
            var clist = document.getElementById('compare-list');
            if (clist) {
                var sorted = compareCars.slice().sort(function (a, b) {
                    var bLa = a.bestLap(); var bLb = b.bestLap();
                    if (bLa === Infinity && bLb === Infinity) return b.totalD - a.totalD;
                    return bLa - bLb;
                });
                var leaderLap = sorted[0] ? sorted[0].bestLap() : Infinity;

                clist.innerHTML = sorted.map(function (c, i) {
                    var bL = c.bestLap();
                    var timeStr = bL === Infinity ? '--' : fmtF(bL);
                    var deltaStr = (i === 0 || bL === Infinity || leaderLap === Infinity) ? '' : '+' + fmtF(bL - leaderLap);

                    return '<div class="compare-row ' + (i === 0 ? 'leader' : '') + '">' +
                        '<span>' + (i + 1) + '</span>' +
                        '<span style="display:flex; align-items:center; gap:6px;">' +
                        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + c.col + '"></span>' +
                        '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + c.profileName + '</span>' +
                        '</span>' +
                        '<span>' + timeStr + '</span>' +
                        '<span style="color:var(--color-text-dim)">' + deltaStr + '</span>' +
                        '</div>';
                }).join('');
            }
        }
    }

    if (running) animId = requestAnimationFrame(compareLoop);
}

// Race Mode UI & Logic
var raceStrategy = {}; // Stores temp strategy: { id: { fuel, compound } }

document.getElementById('btn-open-race').addEventListener('click', function () {
    if (selectedForCompare.size < 2) return;
    var modal = document.getElementById('modal-race-setup');
    document.getElementById('race-track-name').textContent = loaded ? 'PISTA CARGADA' : 'SIN PISTA';
    renderRaceCompetitors();
    modal.classList.remove('hidden');
});

document.querySelectorAll('.close-modal').forEach(function (b) {
    b.addEventListener('click', function () {
        document.getElementById('modal-race-setup').classList.add('hidden');
    });
});

document.getElementById('btn-race-change-track').addEventListener('click', function () {
    document.getElementById('btrack').click();
    setTimeout(function () {
        document.getElementById('race-track-name').textContent = loaded ? 'PISTA ACTUALIZADA' : 'SIN PISTA';
    }, 500);
});

function renderRaceCompetitors() {
    var list = document.getElementById('race-competitors-list');
    var html = '';

    selectedForCompare.forEach(function (id) {
        var p = profiles.find(function (prof) { return prof.id === id });
        if (!p) return;

        if (!raceStrategy[id]) raceStrategy[id] = { fuel: 50, compound: 'M' };
        var s = raceStrategy[id];

        // Physics Summary
        var physHtml = '<div class="phys-mini-tag">' +
            '<span>V-MAX: ' + p.phys.vmax + ' km/h</span>' +
            '<span>0-100: ' + p.phys.accel + 's</span>' +
            '<span>MAN: ' + p.phys.maneuver + '%</span>' +
            '<span>' + p.phys.drivetrain + ' (' + p.phys.engine + ')</span>' +
            '</div>';

        html += '<div class="race-card">' +
            '<div>' +
            '<div style="font-size:11px; font-weight:700; color:#fff;">' + p.name + '</div>' +
            physHtml +
            '</div>' +
            '<div class="compound-selector">' +
            ['S', 'M', 'H'].map(function (c) {
                return '<button class="compound-btn ' + c + ' ' + (s.compound === c ? 'active' : '') + '" data-id="' + id + '" data-c="' + c + '">' + c + '</button>';
            }).join('') +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:8px;">' +
            '<span style="font-size:9px;">⛽</span>' +
            '<input type="range" class="race-fuel-input" data-id="' + id + '" min="5" max="100" value="' + s.fuel + '" style="width:100%">' +
            '<span style="font-size:10px; width:35px; color:#fff;">' + s.fuel + 'L</span>' +
            '</div>' +
            '</div>';
    });
    list.innerHTML = html;

    // Events
    list.querySelectorAll('.compound-btn').forEach(function (b) {
        b.addEventListener('click', function () {
            raceStrategy[this.dataset.id].compound = this.dataset.c;
            renderRaceCompetitors();
        });
    });
    list.querySelectorAll('.race-fuel-input').forEach(function (i) {
        i.addEventListener('input', function () {
            raceStrategy[this.dataset.id].fuel = parseInt(this.value);
            this.nextElementSibling.textContent = this.value + 'L';
        });
    });
}

document.getElementById('btn-launch-race').addEventListener('click', function () {
    if (!loaded) { alert('Carga una pista primero.'); return; }

    running = false;
    cancelAnimationFrame(animId);
    isCompareMode = true;
    isRaceMode = true;
    useFuel = document.getElementById('race-use-fuel').checked;

    var raceLaps = parseInt(document.getElementById('race-laps').value) || 5;
    currentLaps = raceLaps;

    compareCars = Array.from(selectedForCompare).map(function (id, idx) {
        var prof = profiles.find(function (p) { return p.id === id });
        var strat = raceStrategy[id] || { fuel: 50, compound: 'M' };

        var racePhys = JSON.parse(JSON.stringify(prof.phys));
        racePhys.fuelLiters = strat.fuel;
        racePhys.compound = strat.compound;
        racePhys.fpl = 2;

        var col = CCOLS[idx % CCOLS.length];
        var c = new Car(new Net(prof.net), idx, col, racePhys, prof.name);
        return c;
    });

    document.getElementById('modal-race-setup').classList.add('hidden');
    document.body.classList.add('screen-race-active');
    document.getElementById('screen-race').classList.remove('hidden');

    document.getElementById('race-tv-laps').textContent = '0 / ' + currentLaps;

    cars = compareCars;
    running = true;
    animId = requestAnimationFrame(compareLoop);
});

document.getElementById('btn-exit-race').addEventListener('click', function () {
    isRaceMode = false;
    isCompareMode = false;
    running = false;
    cancelAnimationFrame(animId);
    document.body.classList.remove('screen-race-active');
    document.getElementById('screen-race').classList.add('hidden');
    document.getElementById('main-hud').classList.remove('hidden');
    document.getElementById('compare-hud').classList.add('hidden');
    resetTraining();
    render();
});

document.getElementById('btn-race-pause').addEventListener('click', function () {
    running = !running;
    this.textContent = running ? '⏸' : '▶';
    if (running) animId = requestAnimationFrame(compareLoop);
});

document.getElementById('btn-race-speed').addEventListener('click', function () {
    var spds = [1, 3, 10, 30]; sspd = spds[(spds.indexOf(sspd) + 1) % spds.length];
    this.textContent = sspd + 'x';
});

function updateRaceTV() {
    if (!isRaceMode) return;

    var sorted = compareCars.slice().sort(function (a, b) {
        if (a.laps !== b.laps) return b.laps - a.laps;
        return b.totalD - a.totalD;
    });

    var tvList = document.getElementById('race-tv-list');
    var leader = sorted[0];
    document.getElementById('race-tv-laps').textContent = leader.laps + ' / ' + currentLaps;

    tvList.innerHTML = sorted.map(function (c, i) {
        var gap = i === 0 ? 'LÍDER' : '-' + ((leader.totalD - c.totalD) / 10).toFixed(1) + 'm';
        return '<div class="tv-row">' +
            '<span class="pos">' + (i + 1) + '</span>' +
            '<div class="color-dot" style="background:' + c.col + '"></div>' +
            '<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + c.profileName.toUpperCase() + '</span>' +
            '<span class="gap">' + gap + '</span>' +
            '</div>';
    }).join('');

    updateTelemetryUI(sorted);
}

function updateTelemetryUI(sorted) {
    var grid = document.getElementById('telemetry-grid');
    grid.innerHTML = sorted.slice(0, 4).map(function (c) {
        var tyreCol = c.tw > 0.6 ? '#00e676' : (c.tw > 0.3 ? '#ffb74d' : '#ff5252');
        var fuelHtml = useFuel ?
            '<div class="tel-stat"><span>NAFTA</span><span>' + c.fuel.toFixed(1) + 'L</span></div>' +
            '<div class="tel-bar"><div class="tel-bar-fill" style="width:' + (c.fuel) + '%; background:#2196f3;"></div></div>' : '';

        return '<div class="tel-card">' +
            '<h4>' + c.profileName + '</h4>' +
            '<div class="tel-stat"><span>NEUMÁTICOS (' + c.compound + ')</span><span>' + (c.tw * 100).toFixed(0) + '%</span></div>' +
            '<div class="tel-bar"><div class="tel-bar-fill" style="width:' + (c.tw * 100) + '%; background:' + tyreCol + ';"></div></div>' +
            fuelHtml +
            '</div>';
    }).join('');
}

// Update compareLoop to handle fuel subtraction (done in ai.js upd already, but we check here for HUD updates if needed)

// --- TUNING SYSTEM LOGIC ---
var tuningLibrary = [];
var currentAppliedTuningIds = new Set();
window.currentAppliedTuning = [];

function updateTuningUI() {
    var libList = document.getElementById('tuning-items-library');
    if (libList) {
        libList.innerHTML = tuningLibrary.length ? tuningLibrary.map(function (t) {
            return '<div class="tuning-lib-item">' +
                '<div class="tuning-lib-item-info">' +
                '<h4>' + t.name + '</h4>' +
                '<p>ΔV: ' + (t.vmax >= 0 ? '+' : '') + t.vmax + ' | Δ0-100: ' + (t.accel >= 0 ? '+' : '') + t.accel + 's | ΔM: ' + (t.maneuver >= 0 ? '+' : '') + t.maneuver + '%</p>' +
                '</div>' +
                '<button class="no" onclick="removeTuningFromLibrary(\'' + t.id + '\')">✕</button>' +
                '</div>';
        }).join('') : '<p style="text-align:center; font-size:11px; opacity:0.5;">No hay piezas creadas.</p>';
    }

    var checklist = document.getElementById('applied-tuning-list');
    if (checklist) {
        checklist.innerHTML = tuningLibrary.map(function (t) {
            var isChecked = currentAppliedTuningIds.has(t.id);
            return '<label class="tuning-item-row">' +
                '<input type="checkbox" data-id="' + t.id + '" ' + (isChecked ? 'checked' : '') + '> ' +
                '<span>' + t.name + '</span>' +
                '</label>';
        }).join('');

        checklist.querySelectorAll('input').forEach(function (inp) {
            inp.addEventListener('change', function () {
                if (this.checked) currentAppliedTuningIds.add(this.dataset.id);
                else currentAppliedTuningIds.delete(this.dataset.id);
                syncTuningToCars();
            });
        });
    }
}

function syncTuningToCars() {
    window.currentAppliedTuning = tuningLibrary.filter(function (t) { return currentAppliedTuningIds.has(t.id); });
    // In comparison mode, update cars immediately
    if (isCompareMode && cars.length > 0) {
        cars.forEach(function (c) { c.tuning = JSON.parse(JSON.stringify(window.currentAppliedTuning)); });
    }
}

window.removeTuningFromLibrary = function (id) {
    tuningLibrary = tuningLibrary.filter(function (t) { return t.id !== id; });
    currentAppliedTuningIds.delete(id);
    saveTuningToLocal();
    updateTuningUI();
    syncTuningToCars();
};

document.getElementById('btn-open-tuning-editor').addEventListener('click', function () {
    document.getElementById('modal-tuning-editor').classList.remove('hidden');
    updateTuningUI();
});

document.querySelectorAll('.close-modal-tune').forEach(function (b) {
    b.addEventListener('click', function () {
        document.getElementById('modal-tuning-editor').classList.add('hidden');
    });
});

document.getElementById('btn-save-tune').addEventListener('click', function () {
    var name = document.getElementById('tune-name').value;
    if (!name) { alert('Ingresa un nombre para la pieza'); return; }

    var item = {
        id: generateUUID(),
        name: name,
        vmax: parseFloat(document.getElementById('tune-vmax').value) || 0,
        accel: parseFloat(document.getElementById('tune-accel').value) || 0,
        maneuver: parseFloat(document.getElementById('tune-maneuver').value) || 0
    };

    tuningLibrary.push(item);
    document.getElementById('tune-name').value = '';
    saveTuningToLocal();
    updateTuningUI();
});

function saveTuningToLocal() {
    localStorage.setItem('airacer_tuning_library', JSON.stringify(tuningLibrary));
}

function loadTuningFromLocal() {
    var stored = localStorage.getItem('airacer_tuning_library');
    if (stored) {
        try {
            tuningLibrary = JSON.parse(stored);
            updateTuningUI();
        } catch (e) { console.error("Error loading tuning library", e); }
    }
}

function saveProfilesToLocal() {
    // Only save top 10 profiles to avoid quota issues
    var toSave = profiles.slice(0, 10);
    localStorage.setItem('airacer_profiles', JSON.stringify(toSave));
}

function loadProfilesFromLocal() {
    var stored = localStorage.getItem('airacer_profiles');
    if (stored) {
        try {
            profiles = JSON.parse(stored);
            renderProfiles();
        } catch (e) { console.error("Error loading profiles", e); }
    }
}

// Call loaders on Init
loadTuningFromLocal();
loadProfilesFromLocal();

// Init
resize(); buildHead(); renderProfiles(); updateTuningUI(); render();

// Call loaders on Init
loadTuningFromLocal();
loadProfilesFromLocal();

// Init
resize(); buildHead(); renderProfiles(); updateTuningUI(); render();
