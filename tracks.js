// tracks.js — Управление треками маяков и экспорт в KML
// v5: единая система координат (метры), станция в (0,0) при отсутствии GNSS

const TrackManager = (() => {

    // ========== ХРАНИЛИЩЕ ТРЕКОВ ==========
    let tracks = {};            // { [beaconAddress]: [{ x, y, lat, lon, ... }] }
    let stationTrack = [];     // [{ x, y, lat, lon, ts }]    
	const MAX_STORED_POINTS = 50000;      // для маяков
    const MAX_STORED_STATION = 50000;     // для станции

    // Якорь — первая точка станции с GNSS
    let anchorLat = NaN, anchorLon = NaN;

    // ========== НАСТРОЙКИ ==========
    let settings = {
        maxPointsPerTrack: 500,
        minPointDistanceM: 0.05,
        showTracks: true,
    };

    // ========== КООРДИНАТЫ ==========

    function setAnchor(lat, lon) {
        anchorLat = lat;
        anchorLon = lon;
    }

	function geoToMeters(lat, lon) {
		if (isNaN(anchorLat) || isNaN(anchorLon)) return { x: 0, y: 0 };
		const deltas = GeoUtils.deltasByDegrees(anchorLat, anchorLon, lat, lon);
		return {
			x: deltas.deltaLonM,   // Easting
			y: deltas.deltaLatM    // Northing
		};
	}

    function getAnchor() {
        return { lat: anchorLat, lon: anchorLon };
    }

    // ========== ТРЕК СТАНЦИИ ==========

	 function addStationPoint(lat, lon, headingDeg) {
		if (isNaN(lat) || isNaN(lon)) return;

		// Первая точка с GNSS — якорь
		if (stationTrack.length === 0 && !isNaN(lat)) {
			setAnchor(lat, lon);
		}

		const m = geoToMeters(lat, lon);

		// Не добавляем если координаты не изменились
		if (stationTrack.length > 0) {
			const last = stationTrack[stationTrack.length - 1];
			if (Math.abs(m.x - last.x) < 0.001 && Math.abs(m.y - last.y) < 0.001) return;
		}

		stationTrack.push({ 
			x: m.x, y: m.y, 
			lat, lon, 
			ts: Date.now(),
			heading: (!isNaN(headingDeg) ? headingDeg : null)
		});
		while (stationTrack.length > MAX_STORED_STATION) stationTrack.shift();
	}

    function clearStationTrack() {
        stationTrack = [];
        anchorLat = NaN;
        anchorLon = NaN;
    }

	function drawStationTrack(ctx, offsetX, offsetY, scale) {
		if (stationTrack.length < 2) return;

		const rootStyles = getComputedStyle(document.documentElement);
		const stationGlow = rootStyles.getPropertyValue('--track-station-glow').trim() || 'rgba(0, 255, 255, 0.2)';
		const stationLine = rootStyles.getPropertyValue('--track-station-line').trim() || 'rgba(0, 255, 255, 0.7)';

		const drawCount = settings.maxPointsPerTrack;
		const startIdx = Math.max(0, stationTrack.length - drawCount);

		// Свечение
		ctx.beginPath();
		let first = true;
		for (let i = startIdx; i < stationTrack.length; i++) {
			const point = stationTrack[i];
			const x = offsetX + point.x * scale;
			const y = offsetY - point.y * scale;
			if (first) { ctx.moveTo(x, y); first = false; }
			else { ctx.lineTo(x, y); }
		}
		if (!first) {
			ctx.strokeStyle = stationGlow;
			ctx.lineWidth = 6;
			ctx.stroke();
		}

		// Основная линия
		ctx.beginPath();
		first = true;
		for (let i = startIdx; i < stationTrack.length; i++) {
			const point = stationTrack[i];
			const x = offsetX + point.x * scale;
			const y = offsetY - point.y * scale;
			if (first) { ctx.moveTo(x, y); first = false; }
			else { ctx.lineTo(x, y); }
		}
		if (!first) {
			ctx.strokeStyle = stationLine;
			ctx.lineWidth = 2.5;
			ctx.stroke();
		}
	}

    // ========== ТРЕКИ МАЯКОВ ==========

	function addPoint(address, dist, azm, lat, lon, dpt, isTimeout, xM, yM, zM) {
		// Принимаем точку даже без dist/azm, если есть относительные координаты
		if (isNaN(dist) && isNaN(xM)) return;

		if (!tracks[address]) {
			tracks[address] = [];
		}

		const track = tracks[address];

		// Вычисляем метры от якоря: если есть абсолютные координаты — от якоря, иначе NaN
		let x, y;
		if (!isNaN(lat) && !isNaN(lon) && !isNaN(anchorLat)) {
			const m = geoToMeters(lat, lon);
			x = m.x;
			y = m.y;
		} else {
			x = NaN;
			y = NaN;
		}

		// Фильтрация по минимальной дистанции
		if (track.length > 0 && settings.minPointDistanceM > 0) {
			const last = track[track.length - 1];
			if (!last.isTimeout) {
				// Если есть относительные координаты — сравниваем по ним
				if (!isNaN(xM) && !isNaN(last.xM)) {
					const d = Math.sqrt((xM - last.xM) ** 2 + (yM - last.yM) ** 2);
					if (d < settings.minPointDistanceM) return;
				} else if (!isNaN(x) && !isNaN(last.x)) {
					const d = Math.sqrt((x - last.x) ** 2 + (y - last.y) ** 2);
					if (d < settings.minPointDistanceM) return;
				} else if (!isNaN(dist) && !isNaN(last.dist) && !isNaN(azm) && !isNaN(last.azm)) {
					const angDiff = (azm - last.azm) * Math.PI / 180;
					const d = Math.sqrt(dist * dist + last.dist * last.dist - 2 * dist * last.dist * Math.cos(angDiff));
					if (d < settings.minPointDistanceM) return;
				}
			}
		}

		track.push({
			dist: isNaN(dist) ? null : dist,
			azm: isNaN(azm) ? null : azm,
			x, y,
			lat: !isNaN(lat) ? lat : null,
			lon: !isNaN(lon) ? lon : null,
			dpt: isNaN(dpt) ? 0 : dpt,
			ts: Date.now(),
			isTimeout: !!isTimeout,
			xM: !isNaN(xM) ? xM : null,
			yM: !isNaN(yM) ? yM : null,
			zM: !isNaN(zM) ? zM : (!isNaN(dpt) ? dpt : null),
		});

		while (track.length > MAX_STORED_POINTS) track.shift();
	}

    // ========== ОЧИСТКА ==========

    function clearAll() {
        tracks = {};
        stationTrack = [];
        anchorLat = NaN;
        anchorLon = NaN;
    }

    function clearBeacon(address) {
        delete tracks[address];
    }

    function getTrack(address) { return tracks[address] || []; }
    function getTrackedAddresses() { return Object.keys(tracks).map(Number); }

    // ========== НАСТРОЙКИ ==========

    function setMaxPoints(n) {
        settings.maxPointsPerTrack = Math.max(10, Math.min(100000, n));
        for (const addr in tracks) {
            while (tracks[addr].length > settings.maxPointsPerTrack) tracks[addr].shift();
        }
    }

    function setMinDistance(m) { settings.minPointDistanceM = Math.max(0, Math.min(100, m)); }
    function setShowTracks(show) { settings.showTracks = !!show; }
    function toggleShowTracks() { settings.showTracks = !settings.showTracks; return settings.showTracks; }
    function getSettings() { return { ...settings }; }

    // ========== ОТРИСОВКА ТРЕКОВ МАЯКОВ ==========

	function drawTracks(ctx, offsetX, offsetY, scale) {
		if (!settings.showTracks) return;
		
		let isCartesian = false;
		try {
			if (typeof AZMManager !== 'undefined' && AZMManager.getState) {
				isCartesian = AZMManager.getState().antennaMode === 'cartesian_fixed';
			}
		} catch(e) {}

		const rootStyles = getComputedStyle(document.documentElement);
		const trackGlowAlpha = parseFloat(rootStyles.getPropertyValue('--track-beacon-glow-alpha').trim()) || 0.2;
		const trackLineAlpha = parseFloat(rootStyles.getPropertyValue('--track-beacon-line-alpha').trim()) || 0.8;

		for (const addr in tracks) {
			const track = tracks[addr];
			if (track.length < 2) continue;

			const hue = (parseInt(addr) * 60) % 360;
			const drawCount = settings.maxPointsPerTrack;
			const startIdx = Math.max(0, track.length - drawCount);

			// Свечение
			ctx.beginPath();
			let first = true;
			for (let i = startIdx; i < track.length; i++) {
				const point = track[i];
				if (point.isTimeout) continue;

				let x, y;
				if (isCartesian && !isNaN(point.xM) && !isNaN(point.yM)) {
					x = offsetX + point.xM * scale;
					y = offsetY - point.yM * scale;
				} else if (!isNaN(point.x)) {
					x = offsetX + point.x * scale;
					y = offsetY - point.y * scale;
				} else {
					const ang = point.azm * Math.PI / 180;
					x = offsetX + point.dist * Math.sin(ang) * scale;
					y = offsetY - point.dist * Math.cos(ang) * scale;
				}

				if (first) { ctx.moveTo(x, y); first = false; }
				else { ctx.lineTo(x, y); }
			}
			if (!first) {
				ctx.strokeStyle = `hsla(${hue}, 80%, 65%, ${trackGlowAlpha})`;
				ctx.lineWidth = 7;
				ctx.stroke();
			}

			// Основная линия
			ctx.beginPath();
			first = true;
			for (let i = startIdx; i < track.length; i++) {
				const point = track[i];
				if (point.isTimeout) continue;

				let x, y;
				if (isCartesian && !isNaN(point.xM) && !isNaN(point.yM)) {
					x = offsetX + point.xM * scale;
					y = offsetY - point.yM * scale;
				} else if (!isNaN(point.x)) {
					x = offsetX + point.x * scale;
					y = offsetY - point.y * scale;
				} else {
					const ang = point.azm * Math.PI / 180;
					x = offsetX + point.dist * Math.sin(ang) * scale;
					y = offsetY - point.dist * Math.cos(ang) * scale;
				}

				if (first) { ctx.moveTo(x, y); first = false; }
				else { ctx.lineTo(x, y); }
			}
			if (!first) {
				ctx.strokeStyle = `hsla(${hue}, 70%, 60%, ${trackLineAlpha})`;
				ctx.lineWidth = 3;
				ctx.stroke();
			}
		}
	}


    function getStats() {
        const stats = {};
        for (const addr in tracks) {
            const track = tracks[addr];
            const valid = track.filter(p => !p.isTimeout);
            if (valid.length === 0) continue;
            let totalDist = 0;
            for (let i = 1; i < valid.length; i++) {
                if (!isNaN(valid[i].x) && !isNaN(valid[i-1].x)) {
                    totalDist += Math.sqrt((valid[i].x - valid[i-1].x) ** 2 + (valid[i].y - valid[i-1].y) ** 2);
                } else {
                    const a1 = valid[i-1].azm * Math.PI / 180;
                    const a2 = valid[i].azm * Math.PI / 180;
                    totalDist += Math.sqrt(valid[i-1].dist ** 2 + valid[i].dist ** 2 - 2 * valid[i-1].dist * valid[i].dist * Math.cos(a2 - a1));
                }
            }
            stats[addr] = { totalPoints: track.length, validPoints: valid.length, totalDistanceM: totalDist };
        }
        return stats;
    }

    function deg2rad(d) { return d * Math.PI / 180; }
    function escapeXml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function hslToHex(h,s,l) {
        s/=100; l/=100;
        const k = n => (n + h/30) % 12;
        const a = s * Math.min(l, 1-l);
        const f = n => l - a * Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)));
        const toHex = x => Math.round(255*f(x)).toString(16).padStart(2,'0');
        return `${toHex(0)}${toHex(8)}${toHex(4)}`;
    }
	
    // ========== ПУБЛИЧНЫЙ API ==========

	 return {
		addPoint, clearAll, clearBeacon,
		getTrack, getTrackedAddresses,
		setMaxPoints, setMinDistance,
		setShowTracks, toggleShowTracks, getSettings,
		drawTracks, getStats,
		addStationPoint, clearStationTrack, drawStationTrack,
		setAnchor, getAnchor,
		get stationTrack() { return stationTrack; },
		getAll: () => tracks,
	};

})();

if (typeof module !== 'undefined' && module.exports) module.exports = TrackManager;

// Алиас для совместимости с uWaveSuite
const Tracks = TrackManager;