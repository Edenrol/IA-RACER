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
isEditing = true;

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
        var found = -1;
        for (var i = 0; i < pmpts.length; i++) {
            if (Math.hypot(w.x - pmpts[i][0], w.y - pmpts[i][1]) < 12 / view.zoom) {
                found = i;
                break;
            }
        }

        if (found !== -1) {
            grabbedIdx = found;
        } else {
            if (pmpts.length > 2) {
                var f = pmpts[0];
                if (Math.hypot(w.x - f[0], w.y - f[1]) < 20 / view.zoom) {
                    rebuild();
                    return;
                }
            }
            pmpts.push([w.x, w.y]);
            rebuild();
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
        pmpts[grabbedIdx] = [w.x, w.y];
        rebuild();
    }
});

sc.addEventListener('mouseup', function () {
    view.panning = false;
    grabbedIdx = -1;
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

document.getElementById('btn-undo').addEventListener('click', function () { pmpts.pop(); rebuild(); });
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
    var data = { pmpts: pmpts, TW: TW };
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
                    Object.keys(data.phys).forEach(function(k) { phys[k] = data.phys[k]; });
                    physMap.forEach(function(item) {
                        var el = document.getElementById(item[0]);
                        if (el) { el.value = phys[item[1]]; el.dispatchEvent(new Event('input')); }
                    });
                }

                // Restore Training Settings
                if (data.train) {
                    Object.keys(data.train).forEach(function(k) { train[k] = data.train[k]; });
                    trainMap.forEach(function(item) {
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
}
function pp(ctx, poly) {
    if (!poly || poly.length < 2) return;
    ctx.beginPath(); poly.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }); ctx.closePath();
}

// Rendering
function render() {
    // Camera Tracking
    if (camFollow && cars.length > 0) {
        var aliveCars = cars.filter(function(c) { return c.alive; });
        var targetCars = aliveCars.length > 0 ? aliveCars : cars;
        var leader = targetCars.reduce(function(a, b) { return a.totalD > b.totalD ? a : b; }, targetCars[0]);
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
    
    if (!isEditing) drawCanvasHUD(sctx);
}
function drawEditor() {
    sctx.save(); applyView(sctx);
    if (CL.length > 3) {
        pp(sctx, OUT); sctx.fillStyle = '#141418'; sctx.fill();
        pp(sctx, INN); sctx.fillStyle = '#050507'; sctx.fill();
        sctx.strokeStyle = 'rgba(255,255,255,0.05)'; sctx.setLineDash([5, 9]); pp(sctx, CL); sctx.stroke(); sctx.setLineDash([]);
        sctx.strokeStyle = 'rgba(0, 230, 118, 0.4)'; sctx.lineWidth = 2; pp(sctx, OUT); sctx.stroke(); pp(sctx, INN); sctx.stroke();
        if (startLine) { sctx.strokeStyle = '#ffeb3b'; sctx.lineWidth = 3; sctx.beginPath(); sctx.moveTo(startLine.ax, startLine.ay); sctx.lineTo(startLine.bx, startLine.by); sctx.stroke(); }
    }
    pmpts.forEach(function (p, i) {
        sctx.beginPath(); sctx.arc(p[0], p[1], 5 / view.zoom, 0, Math.PI * 2);
        sctx.fillStyle = (i === 0) ? '#00e676' : '#ffb74d'; sctx.fill();
        if (grabbedIdx === i) { sctx.strokeStyle = '#fff'; sctx.lineWidth = 2 / view.zoom; sctx.stroke(); }
    });
    sctx.restore();
}
function drawSim() {
    sctx.save(); applyView(sctx);
    if (!loaded || CL.length < 10) { sctx.restore(); return; }
    pp(sctx, OUT); sctx.fillStyle = '#141418'; sctx.fill();
    pp(sctx, INN); sctx.fillStyle = '#050507'; sctx.fill();
    sctx.strokeStyle = 'rgba(255,255,255,0.04)'; sctx.setLineDash([5, 9]); pp(sctx, CL); sctx.stroke(); sctx.setLineDash([]);
    sctx.strokeStyle = 'rgba(255,255,255,0.15)'; sctx.lineWidth = 1.5; pp(sctx, OUT); sctx.stroke(); pp(sctx, INN); sctx.stroke();
    if (startLine) { sctx.strokeStyle = 'rgba(255, 235, 59, 0.3)'; sctx.lineWidth = 3; sctx.beginPath(); sctx.moveTo(startLine.ax, startLine.ay); sctx.lineTo(startLine.bx, startLine.by); sctx.stroke(); }
    var showS = actF.has('sens');
    var alive = cars.filter(function (c) { return c.alive; });
    var bestA = alive.reduce(function (a, b) { return a && a._fitness > b._fitness ? a : b; }, null) || alive[0] || null;
    cars.filter(function (c) { return !c.alive && !c.finished; }).forEach(function (c) { c.draw(false, false, false); });
    cars.filter(function (c) { return c.finished; }).forEach(function (c) { c.draw(false, top3ids.has(c.id), false); });
    alive.filter(function (c) { return c !== bestA; }).forEach(function (c) { c.draw(false, top3ids.has(c.id), showS); });
    if (bestA) bestA.draw(true, top3ids.has(bestA.id), showS);
    sctx.restore();
}

// Controller Mapping
var physMap = [
    ['pa', 'a'], ['pm', 'ms'], ['ptt', 'tt'], ['pb', 'br'], ['pbb', 'bb'], ['pabs', 'abs'],
    ['pd', 'dr'], ['pdf', 'df'], ['pms', 'ma'], ['pgr', 'gr'], ['po', 'ov'], ['pst', 'st'],
    ['pco', 'co'], ['pdg', 'dg'], ['ptg', 'tg'], ['psm', 'sm']
];
physMap.forEach(function (item) {
    var el = document.getElementById(item[0]);
    if (el) el.addEventListener('input', function () {
        var val = parseFloat(this.value); phys[item[1]] = val;
        var label = document.getElementById('v' + item[0]);
        if (label) {
            if (item[1] === 'abs') label.textContent = val > 0.5 ? 'on' : 'off';
            else if (item[1] === 'co') label.textContent = val < 0.3 ? 'blando' : val > 0.7 ? 'duro' : 'medio';
            else label.textContent = val.toFixed(3);
        }
        updateAutoDashboard();
    });
});

window.updateAutoDashboard = function() {
    var vmax = phys.ms * phys.sm;
    var power = phys.a * 100;
    var weight = phys.ma * 1000;
    
    // Estimate 0-100 time: Time = V / (Accel * dT)
    // 100 km/h is 10 units of speed in simulation (scaled by sm/10)
    var accelTime = (10 / (phys.sm/10)) / (phys.a * 0.016) / 60;
    
    document.getElementById('dash-vmax').textContent = Math.round(vmax);
    document.getElementById('dash-accel').textContent = accelTime.toFixed(2);
    document.getElementById('dash-power').textContent = Math.round(power);
    document.getElementById('dash-weight').textContent = Math.round(weight);
    
    // Determine class
    var pClass = "Prototype";
    if (vmax > 100) pClass = "Hypercar";
    else if (vmax > 80) pClass = "Supercar";
    else if (vmax > 60) pClass = "Sport";
    else pClass = "Compact";
    
    document.getElementById('auto-class').textContent = "Performance Class: " + pClass;
};

var PSETS = {
    f1: { a: 6.5, ms: 10.5, tt: 0.1, br: 10, bb: 0.55, abs: 0, dr: 0.98, df: 2.5, ma: 0.8, gr: 0.18, ov: 0.1, st: 0.09, co: 0.2, dg: 0.0005, tg: 1, sm: 10 },
    f1_2026: { a: 7.8, ms: 11.8, tt: 0.1, br: 11.5, bb: 0.55, abs: 1, dr: 0.985, df: 2.9, ma: 0.7, gr: 0.2, ov: 0.1, st: 0.08, co: 0.2, dg: 0.0004, tg: 1, sm: 30 },
    gt: { a: 4.5, ms: 8.5, tt: 0.2, br: 8, bb: 0.6, abs: 1, dr: 0.97, df: 1.5, ma: 1.3, gr: 0.12, ov: 0.15, st: 0.07, co: 0.5, dg: 0.0002, tg: 1, sm: 22 },
    rally: { a: 5.5, ms: 6.5, tt: 0.5, br: 6, bb: 0.65, abs: 0, dr: 0.96, df: 0.8, ma: 1.2, gr: 0.06, ov: 0.4, st: 0.12, co: 0.8, dg: 0.0008, tg: 0.6, sm: 20 },
    drift: { a: 4.0, ms: 6.0, tt: 0.1, br: 5, bb: 0.7, abs: 0, dr: 0.97, df: 0.3, ma: 1.1, gr: 0.03, ov: 0.8, st: 0.15, co: 0.9, dg: 0.001, tg: 0.8, sm: 18 },
    kart: { a: 3.0, ms: 4.5, tt: 0.0, br: 4, bb: 0.5, abs: 0, dr: 0.95, df: 0.1, ma: 0.5, gr: 0.1, ov: 0.3, st: 0.1, co: 0.5, dg: 0, tg: 1, sm: 12 }
};

document.querySelectorAll('.pre').forEach(function (b) {
    b.addEventListener('click', function () {
        var p = PSETS[b.dataset.p]; if (!p) return;
        Object.keys(p).forEach(function (k) { phys[k] = p[k]; });
        physMap.forEach(function (item) { var el = document.getElementById(item[0]); if (el) { el.value = phys[item[1]]; el.dispatchEvent(new Event('input')); } });
    });
});

var trainMap = [
    ['tpop', 'pop'], ['telite', 'elite'], ['tinject', 'inject'], ['tmut', 'mutBase'],
    ['tmutmin', 'mutMin'], ['tmutmax', 'mutMax'], ['tstale', 'stale'],
    ['tftime', 'ftime'], ['tfpen', 'fpen'], ['tfbonus', 'fbonus'],
    ['tlapst', 'lapStart'], ['tlapmax', 'lapMax'], ['tlapvalid', 'lapValid']
];
trainMap.forEach(function (item) {
    var el = document.getElementById(item[0]);
    if (el) el.addEventListener('input', function () {
        var val = parseFloat(this.value); train[item[1]] = val;
        var label = document.getElementById('v' + item[0]);
        if (label) {
            if (item[1].includes('inject') || item[1].includes('Valid')) label.textContent = Math.round(val * 100);
            else label.textContent = val.toFixed(2);
            if (item[0] === 'tmut') { var mutDisplay = document.getElementById('vtmut'); if (mutDisplay) mutDisplay.textContent = val.toFixed(2); }
        }
    });
});

// Tooltip Logic
var PARAM_DESCS = {
    pa: "Aceleración: Fuerza del motor. Valores altos permiten ganar velocidad rápidamente, ideal para circuitos con muchas frenadas y aceleraciones. Ojo con el derrape si superas el agarre disponible.",
    pm: "Velocidad Máx: El límite físico del motor. En F1 se busca lo más alto posible para las rectas largas.",
    ptt: "Tracción: 0=Trasera (clásico F1, sobrevira al acelerar), 1=Total (mejor tracción y estabilidad en salida de curva).",
    pb: "Fuerza Frenado: Capacidad de detención. Un valor alto permite frenar más tarde (late braking), pero requiere buen ABS o tacto para no bloquear.",
    pbb: "Bias Trasero: Distribución de frenado. >0.5 frena más atrás (ayuda a rotar el auto pero es inestable), <0.5 más adelante (más estable pero subvirador).",
    pabs: "ABS: Sistema antibloqueo. Permite frenar a fondo sin perder la dirección, vital a 300 km/h.",
    pd: "Drag: Resistencia al aire. Reduce la velocidad gradualmente. Autos aerodinámicos tienen valores cercanos a 1.0.",
    pdf: "Downforce: Carga aerodinámica. Empuja el auto hacia el piso a alta velocidad, aumentando el agarre lateral drásticamente en curvas rápidas.",
    pms: "Masa: El peso del vehículo. Mayor masa aumenta la inercia, haciendo que el auto sea más difícil de detener y girar (subviraje por inercia).",
    pgr: "Agarre Lateral: Calidad de los neumáticos en curva. Es el límite antes de que el auto empiece a deslizar.",
    po: "Oversteer: Sensibilidad de rotación. Determina qué tanto 'colea' el auto cuando pierde tracción.",
    pst: "Steering Max: Ángulo de giro de las ruedas. Más ángulo permite tomar curvas más cerradas (como en horquillas).",
    pco: "Compuesto: Blando (más agarre, más desgaste), Duro (menos agarre, eterno).",
    pdg: "Degradación: Qué tan rápido se gasta el neumático con el uso intenso.",
    ptg: "Adherencia Pista: Estado del asfalto. Modifica el agarre global (ej. pista mojada vs seca).",
    psm: "Multiplicador Velocidad: Ajuste visual para el Dashboard. Úsalo para calibrar qué tan 'real' se siente la velocidad mostrada en KM/H.",
    tpop: "Total: Cantidad de autos entrenados simultáneamente por generación.",
    telite: "Elite copias: Cantidad de los mejores autos que pasan tal cual a la siguiente generación.",
    tinject: "Inyección Aleatoria: Porcentaje de autos aleatorios nuevos insertados para mantener diversidad genética.",
    tmut: "Base: Probabilidad de que los pesos neuronales cambien al clonar.",
    tmutmin: "Mínima: Límite inferior de mutación cuando la red está aprendiendo con éxito.",
    tmutmax: "Máxima: Límite superior usado en estancamiento para forzar la búsqueda de nuevas soluciones.",
    tstale: "Gens estancado: Tolerancia de generaciones sin mejora antes de incrementar mutación.",
    tftime: "Peso Tiempo/Dist: Prioriza tiempo de vuelta vs distancia completada en la fórmula de Fitness.",
    tfpen: "Penalty Frame: Penalización de fitness por cada frame de vida, fomenta ir más rápido.",
    tfbonus: "Bonus Vuelta: Recompensa masiva en fitness por terminar la vuelta, clave para aprender el circuito.",
    tlapst: "Vueltas Start: Objetivo inicial de vueltas para el algoritmo genético.",
    tlapmax: "Vueltas Max: Límite donde se detiene la evaluación progresiva del entrenamiento.",
    tlapvalid: "Cobertura Mínima: Porcentaje del circuito que debe ser recorrido sin hacer atajos tramposos."
};

var tt = document.getElementById('param-tooltip');
document.querySelectorAll('.info-btn').forEach(function(btn) {
    btn.addEventListener('mouseenter', function(e) {
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
        var ty = rect.top - th/2 + rect.height/2;
        
        if (tx + tw > window.innerWidth) {
            tx = rect.left - tw - 10;
        }
        
        tt.style.left = tx + 'px';
        tt.style.top = ty + 'px';
    });
    btn.addEventListener('mouseleave', function() {
        if(tt) {
            tt.style.opacity = '0';
            setTimeout(function() { if(tt.style.opacity === '0') tt.classList.add('hidden'); }, 200);
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

    var cols = getCols();
    var sorted = cars.slice().sort(function (a, b) {
        if (a.finished && !b.finished) return -1;
        if (!a.finished && b.finished) return 1;
        if (a.finished && b.finished) return a.finishFrame - b.finishFrame;
        return b._fitness - a._fitness;
    });

    var lbb = document.getElementById('lbb');
    if (!lbb) return;
    lbb.innerHTML = sorted.slice(0, 15).map(function (c, i) {
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
                cars.forEach(function(c) { if(c.alive) { c.alive = false; c._fitness = c.calcFitness(); } });
                var info = document.getElementById('info-banner');
                if (info) { info.textContent = "TIEMPO LÍMITE AGOTADO"; info.style.background = "var(--color-danger)"; setTimeout(function(){ info.style.background = ""; }, 2000); }
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
    var spds = [1, 3, 10, 30]; sspd = spds[(spds.indexOf(sspd) + 1) % spds.length]; this.textContent = sspd + 'x';
});
document.getElementById('breset').addEventListener('click', function () {
    if (confirm('¿Reiniciar todo el progreso?')) { running = false; cancelAnimationFrame(animId); gen = 0; gbl = Infinity; cars = []; render(); updateLB(); document.getElementById('bstart').textContent = 'INICIAR'; }
});

// Viewport UI Buttons
var camFollow = false;
document.getElementById('btn-cam-follow').addEventListener('click', function() {
    camFollow = !camFollow;
    this.classList.toggle('active', camFollow);
});

document.getElementById('btn-toggle-chart').addEventListener('click', function() {
    document.getElementById('chart-window').classList.toggle('hidden');
    drawChart();
});

document.getElementById('btn-close-chart').addEventListener('click', function() {
    document.getElementById('chart-window').classList.add('hidden');
});

document.getElementById('btn-zoom-in').addEventListener('click', function () { view.zoom *= 1.2; render(); });
document.getElementById('btn-zoom-out').addEventListener('click', function () { view.zoom /= 1.2; render(); });
document.getElementById('btn-reset-view').addEventListener('click', function () { view.x = CW / 2 - 330; view.y = CH / 2 - 180; view.zoom = 1; render(); });
document.getElementById('btn-fs').addEventListener('click', function () { if (!document.fullscreenElement) container.requestFullscreen(); else document.exitFullscreen(); });

function drawCanvasHUD(ctx) {
    if (cars.length === 0) return;
    var leader = cars.reduce(function(a, b) { return a.totalD > b.totalD ? a : b; }, cars[0]);
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
    var ms = leader.phys ? leader.phys.ms : phys.ms;
    var sm = leader.phys ? (leader.phys.sm || 10) : (phys.sm || 10);
    var kmh = spd * sm;
    ctx.fillText('VELOCIDAD', 12, 22);
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#00e676'; // var(--color-accent)
    ctx.fillText(kmh.toFixed(0) + ' km/h', 95, 22);
    
    // Animated Speed Bar
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(12, 30, 160, 8);
    
    var spdPct = Math.min(1, spd/ms);
    var gradient = ctx.createLinearGradient(12, 0, 172, 0);
    gradient.addColorStop(0, '#2196f3'); // var(--color-info)
    gradient.addColorStop(1, '#00e676'); // var(--color-accent)
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.fillRect(12, 30, 160 * spdPct, 8);
    
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
}

window.drawChart = function() {
    var canvas = document.getElementById('chart-canvas');
    if (!canvas) return;
    
    // If hidden, wait for next frame to measure correctly
    if (document.getElementById('chart-window').classList.contains('hidden')) return;

    requestAnimationFrame(function() {
        var rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
        var c = canvas.getContext('2d');
        c.scale(2, 2);
        var W = rect.width;
        var H = rect.height;
        
        c.clearRect(0,0,W,H);
        
        if (typeof genHistory === 'undefined' || genHistory.length === 0) {
            c.fillStyle = '#666';
            c.font = '12px sans-serif';
            c.textAlign = 'center';
            c.fillText('Esperando datos de la primera generación...', W/2, H/2);
            return;
        }
        
        var pad = { top: 30, right: 40, bottom: 30, left: 50 };
        var gw = W - pad.left - pad.right;
        var gh = H - pad.top - pad.bottom;
        
        var maxGen = genHistory[genHistory.length-1].gen;
        var minGen = Math.max(0, maxGen - 50); 
        var viewData = genHistory.filter(function(d){ return d.gen >= minGen; });
        if(viewData.length === 0) return;
        
        // Find ranges
        var maxLap = 10, minLap = 0;
        var validLaps = viewData.map(function(d){return d.bestLap}).filter(function(v){return v!==null});
        if(validLaps.length > 0) {
            maxLap = Math.max.apply(null, validLaps) * 1.1;
            minLap = Math.min.apply(null, validLaps) * 0.9;
        }
        
        var maxFit = Math.max.apply(null, viewData.map(function(d){return d.avgFitness}));
        var minFit = Math.min.apply(null, viewData.map(function(d){return d.avgFitness}));
        if (Math.abs(maxFit - minFit) < 1) { maxFit += 10; minFit -= 10; }
        
        function getX(g) { 
            if (maxGen === minGen) return pad.left + gw/2;
            return pad.left + ((g - minGen) / (maxGen - minGen)) * gw; 
        }
        function getY_lap(v) { return pad.top + gh - ((v - minLap) / Math.max(1, maxLap - minLap)) * gh; }
        function getY_fit(v) { return pad.top + gh - ((v - minFit) / Math.max(1, maxFit - minFit)) * gh; }
        function getY_comp(v) { return pad.top + gh - (v * gh); }
        
        // Grid
        c.strokeStyle = 'rgba(255,255,255,0.05)';
        c.lineWidth = 1;
        for(var i=0; i<=4; i++) {
            var y = pad.top + (gh/4)*i;
            c.beginPath(); c.moveTo(pad.left, y); c.lineTo(pad.left+gw, y); c.stroke();
        }

        // Data Lines
        viewData.forEach(function(d) {
            if (d.lapsIncreased) {
                var x = getX(d.gen);
                c.fillStyle = 'rgba(0,230,118,0.1)';
                c.fillRect(x-5, pad.top, 10, gh);
            }
        });
        
        // Fitness Line
        c.beginPath();
        viewData.forEach(function(d, i) {
            var x = getX(d.gen), y = getY_fit(d.avgFitness);
            if(i === 0) c.moveTo(x,y); else c.lineTo(x,y);
        });
        c.strokeStyle = '#2196f3'; c.lineWidth = 2; c.stroke();
        
        // Best Lap Line
        c.beginPath();
        var hasLap = false;
        viewData.forEach(function(d) {
            if(d.bestLap !== null) {
                var x = getX(d.gen), y = getY_lap(d.bestLap);
                if(!hasLap) { c.moveTo(x,y); hasLap = true; } else { c.lineTo(x,y); }
            }
        });
        if(hasLap) { c.strokeStyle = '#00e676'; c.lineWidth = 2.5; c.stroke(); }
        
        // Completion Rate
        c.beginPath();
        viewData.forEach(function(d, i) {
            var x = getX(d.gen), y = getY_comp(d.completionRate);
            if(i === 0) c.moveTo(x,y); else c.lineTo(x,y);
        });
        c.strokeStyle = '#ffb74d'; c.lineWidth = 1.5; c.setLineDash([4,2]); c.stroke(); c.setLineDash([]);
        
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
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
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
    
    list.innerHTML = profiles.map(function(p) {
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
    document.querySelectorAll('.compare-checkbox').forEach(function(cb) {
        cb.addEventListener('change', function() {
            if(this.checked) selectedForCompare.add(this.dataset.id);
            else selectedForCompare.delete(this.dataset.id);
            renderProfiles();
            updateCompareButton();
        });
    });
    document.querySelectorAll('.profile-name').forEach(function(inp) {
        inp.addEventListener('change', function() {
            var id = this.dataset.id;
            var prof = profiles.find(function(p){return p.id === id});
            if(prof) prof.name = this.value;
        });
    });
    document.querySelectorAll('.btn-del-profile').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var id = this.dataset.id;
            profiles = profiles.filter(function(p){return p.id !== id});
            selectedForCompare.delete(id);
            renderProfiles();
            updateCompareButton();
        });
    });
    document.querySelectorAll('.btn-export-profile').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var id = this.dataset.id;
            var prof = profiles.find(function(p){return p.id === id});
            if(!prof) return;
            var blob = new Blob([JSON.stringify(prof)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = prof.name.replace(/\s+/g, '_') + '.json';
            a.click(); URL.revokeObjectURL(url);
        });
    });
    document.querySelectorAll('.btn-tune-profile').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var id = this.dataset.id;
            var prof = profiles.find(function(p){return p.id === id});
            if(!prof) return;
            if(!confirm('¿Cargar este perfil como base para un nuevo entrenamiento (Fine-Tuning)? Esto reiniciará la sesión actual.')) return;
            
            // Apply physics
            Object.keys(prof.phys).forEach(function(k) { phys[k] = prof.phys[k]; });
            physMap.forEach(function(item) { var el = document.getElementById(item[0]); if(el) { el.value = phys[item[1]]; el.dispatchEvent(new Event('input')); } });
            
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

window.createProfileFromCar = function(car, isAuto = false) {
    var bLap = car.bestLap();
    var blText = bLap === Infinity ? 'Incompleto' : fmtF(bLap);
    
    var prof = {
        id: generateUUID(),
        name: (isAuto ? '🏆 Record: ' : 'Perfil ') + 'Gen ' + gen + ' (' + blText + ')',
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
    renderProfiles();

    if (isAuto) {
        var info = document.getElementById('info-box');
        if (info) {
            var oldHTML = info.innerHTML;
            info.innerHTML = '<span style="color:var(--color-accent); font-weight:bold;">¡NUEVO RECORD!</span> Perfil auto-guardado.';
            setTimeout(function() {
                // Only restore if it hasn't been changed by something else (like a new generation)
                if (info.innerHTML.includes('RECORD')) info.innerHTML = oldHTML;
            }, 3000);
        }
    }
};

document.getElementById('btn-capture-profile').addEventListener('click', function() {
    if (cars.length === 0) { alert('No hay autos para capturar.'); return; }
    var bestCar = cars.reduce(function(a,b){ return a._fitness > b._fitness ? a : b; });
    createProfileFromCar(bestCar, false);
});

document.getElementById('btn-import-profile').addEventListener('click', function() { document.getElementById('profile-file').click(); });
document.getElementById('profile-file').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(evt) {
        try {
            var data = JSON.parse(evt.target.result);
            if (data.net && data.phys) {
                if(!data.id) data.id = generateUUID();
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
document.getElementById('btn-start-compare').addEventListener('click', function() {
    if (selectedForCompare.size < 2) return;
    if (!loaded) { alert('Carga una pista primero.'); return; }
    
    running = false;
    cancelAnimationFrame(animId);
    isCompareMode = true;
    
    compareCars = Array.from(selectedForCompare).map(function(id, idx) {
        var prof = profiles.find(function(p){return p.id === id});
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

document.getElementById('btn-exit-compare').addEventListener('click', function() {
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
        compareCars.forEach(function(c) { c.upd(); }); 
        
        // Reloop dead/finished cars
        if (compareCars.length > 0 && compareCars.filter(function(c){return c.alive}).length === 0) {
            compareCars.forEach(function(c) {
                c.x = startLine.x; c.y = startLine.y; c.ang = startLine.ang;
                c.spd = 0; c.slip = 0; c.alive = true; c.finished = false;
                c.fc = 0; c.prevIdx = startLine.idx; c.totalD = 0; c.stuck = 0;
                c.laps = 0; c.lapStartFrame = 0; c.finishFrame = 0; c.lapTimes = [];
                c.resetLapTracking(); c.crossCD = 0; c.tw = 1;
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
                var sorted = compareCars.slice().sort(function(a,b) {
                    var bLa = a.bestLap(); var bLb = b.bestLap();
                    if (bLa === Infinity && bLb === Infinity) return b.totalD - a.totalD;
                    return bLa - bLb;
                });
                var leaderLap = sorted[0] ? sorted[0].bestLap() : Infinity;
                
                clist.innerHTML = sorted.map(function(c, i) {
                    var bL = c.bestLap();
                    var timeStr = bL === Infinity ? '--' : fmtF(bL);
                    var deltaStr = (i === 0 || bL === Infinity || leaderLap === Infinity) ? '' : '+' + fmtF(bL - leaderLap);
                    
                    return '<div class="compare-row ' + (i===0 ? 'leader' : '') + '">' +
                        '<span>' + (i+1) + '</span>' +
                        '<span style="display:flex; align-items:center; gap:6px;">' +
                            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+c.col+'"></span>' +
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

document.getElementById('btn-open-race').addEventListener('click', function() {
    if (selectedForCompare.size < 2) return;
    var modal = document.getElementById('modal-race-setup');
    document.getElementById('race-track-name').textContent = loaded ? 'PISTA CARGADA' : 'SIN PISTA';
    renderRaceCompetitors();
    modal.classList.remove('hidden');
});

document.querySelectorAll('.close-modal').forEach(function(b) {
    b.addEventListener('click', function() {
        document.getElementById('modal-race-setup').classList.add('hidden');
    });
});

document.getElementById('btn-race-change-track').addEventListener('click', function() {
    document.getElementById('btrack').click();
    setTimeout(function() {
        document.getElementById('race-track-name').textContent = loaded ? 'PISTA ACTUALIZADA' : 'SIN PISTA';
    }, 500);
});

function renderRaceCompetitors() {
    var list = document.getElementById('race-competitors-list');
    var html = '';
    
    selectedForCompare.forEach(function(id) {
        var p = profiles.find(function(prof){return prof.id === id});
        if (!p) return;
        
        if (!raceStrategy[id]) raceStrategy[id] = { fuel: 50, compound: 'M' };
        var s = raceStrategy[id];
        
        // Physics Summary
        var physHtml = '<div class="phys-mini-tag">' +
            '<span>V-MAX: ' + (p.phys.ms * (p.phys.sm||10)).toFixed(0) + ' km/h</span>' +
            '<span>ACCEL: ' + p.phys.a.toFixed(1) + '</span>' +
            '<span>MASA: ' + p.phys.ma.toFixed(1) + 'kg</span>' +
            '<span>DRAG: ' + p.phys.dr.toFixed(3) + '</span>' +
        '</div>';
        
        html += '<div class="race-card">' +
            '<div>' +
                '<div style="font-size:11px; font-weight:700; color:#fff;">' + p.name + '</div>' +
                physHtml +
            '</div>' +
            '<div class="compound-selector">' +
                ['S','M','H'].map(function(c) {
                    return '<button class="compound-btn ' + c + ' ' + (s.compound === c ? 'active' : '') + '" data-id="'+id+'" data-c="'+c+'">'+c+'</button>';
                }).join('') +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:8px;">' +
                '<span style="font-size:9px;">⛽</span>' +
                '<input type="range" class="race-fuel-input" data-id="'+id+'" min="5" max="100" value="'+s.fuel+'" style="width:100%">' +
                '<span style="font-size:10px; width:35px; color:#fff;">'+s.fuel+'L</span>' +
            '</div>' +
        '</div>';
    });
    list.innerHTML = html;
    
    // Events
    list.querySelectorAll('.compound-btn').forEach(function(b) {
        b.addEventListener('click', function() {
            raceStrategy[this.dataset.id].compound = this.dataset.c;
            renderRaceCompetitors();
        });
    });
    list.querySelectorAll('.race-fuel-input').forEach(function(i) {
        i.addEventListener('input', function() {
            raceStrategy[this.dataset.id].fuel = parseInt(this.value);
            this.nextElementSibling.textContent = this.value + 'L';
        });
    });
}

document.getElementById('btn-launch-race').addEventListener('click', function() {
    if (!loaded) { alert('Carga una pista primero.'); return; }
    
    running = false;
    cancelAnimationFrame(animId);
    isCompareMode = true;
    isRaceMode = true; 
    useFuel = document.getElementById('race-use-fuel').checked;
    
    var raceLaps = parseInt(document.getElementById('race-laps').value) || 5;
    currentLaps = raceLaps; 
    
    compareCars = Array.from(selectedForCompare).map(function(id, idx) {
        var prof = profiles.find(function(p){return p.id === id});
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

document.getElementById('btn-exit-race').addEventListener('click', function() {
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

document.getElementById('btn-race-pause').addEventListener('click', function() {
    running = !running;
    this.textContent = running ? '⏸' : '▶';
    if (running) animId = requestAnimationFrame(compareLoop);
});

document.getElementById('btn-race-speed').addEventListener('click', function() {
    var spds = [1, 3, 10, 30]; sspd = spds[(spds.indexOf(sspd) + 1) % spds.length]; 
    this.textContent = sspd + 'x';
});

function updateRaceTV() {
    if (!isRaceMode) return;
    
    var sorted = compareCars.slice().sort(function(a,b) {
        if (a.laps !== b.laps) return b.laps - a.laps;
        return b.totalD - a.totalD;
    });
    
    var tvList = document.getElementById('race-tv-list');
    var leader = sorted[0];
    document.getElementById('race-tv-laps').textContent = leader.laps + ' / ' + currentLaps;
    
    tvList.innerHTML = sorted.map(function(c, i) {
        var gap = i === 0 ? 'LÍDER' : '-' + ((leader.totalD - c.totalD) / 10).toFixed(1) + 'm';
        return '<div class="tv-row">' +
            '<span class="pos">' + (i+1) + '</span>' +
            '<div class="color-dot" style="background:'+c.col+'"></div>' +
            '<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + c.profileName.toUpperCase() + '</span>' +
            '<span class="gap">' + gap + '</span>' +
        '</div>';
    }).join('');
    
    updateTelemetryUI(sorted);
}

function updateTelemetryUI(sorted) {
    var grid = document.getElementById('telemetry-grid');
    grid.innerHTML = sorted.slice(0, 4).map(function(c) {
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

// Init
resize(); buildHead(); renderProfiles(); render();
