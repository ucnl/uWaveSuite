// export.js — Экспорт треков в различные форматы (CSV, NMEA, KML)

const ExportManager = (() => {
    
    // ========== ВСПОМОГАТЕЛЬНЫЕ ==========
    function getTimestamp() {
        return new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    }
    
    function downloadBlob(content, mimeType, filename) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function getAntennaMode() {
        try {
            return AZMManager.getState().antennaMode || 'geographic';
        } catch (e) {
            return 'geographic';
        }
    }

    // ========== CSV ==========
    function exportCSV() {
        const allTracks = TrackManager.getAll();
        const stTrack = TrackManager.stationTrack;
        const antennaMode = getAntennaMode();
        
        if (Object.keys(allTracks).length === 0 && stTrack.length === 0) {
            alert('Нет данных треков');
            return;
        }

        let lines;
        
        if (antennaMode === 'cartesian_fixed') {
            // Декартов режим: X,Y,Z вместо lat,lon
            // latitude,longitude — пустые, для возможности пост-фактум заполнения
            lines = ['time,type,address,x_m,y_m,z_m,distance_m,azimuth_deg,latitude,longitude'];
            
            for (const addr of Object.keys(allTracks)) {
                for (const point of allTracks[addr]) {
                    if (point.isTimeout) continue;
                    const ts = new Date(point.ts).toISOString();
                    const xM = (point.xM != null && !isNaN(point.xM)) ? point.xM.toFixed(2) : '';
                    const yM = (point.yM != null && !isNaN(point.yM)) ? point.yM.toFixed(2) : '';
                    const zM = (point.zM != null && !isNaN(point.zM)) ? point.zM.toFixed(2) : '';
                    const dist = !isNaN(point.dist) ? point.dist.toFixed(1) : '';
                    const azm = !isNaN(point.azm) ? point.azm.toFixed(1) : '';
                    lines.push(`${ts},BEACON,${parseInt(addr) + 1},${xM},${yM},${zM},${dist},${azm},,`);
                }
            }
        } else {
            // Географический режим (существующий формат)
            lines = ['time,type,address,latitude,longitude,depth_m,distance_m,azimuth_deg,msr_db,vcc_v,speed_mps,course_deg'];
            
            // Трек станции
            for (const point of stTrack) {
                const ts = new Date(point.ts).toISOString();
                const lat = (point.lat != null && !isNaN(point.lat)) ? point.lat.toFixed(6) : '';
                const lon = (point.lon != null && !isNaN(point.lon)) ? point.lon.toFixed(6) : '';
                lines.push(`${ts},STATION,,${lat},${lon},,,,,,`);
            }
            
            // Треки маяков
            for (const addr of Object.keys(allTracks)) {
                for (const point of allTracks[addr]) {
                    if (point.isTimeout) continue;
                    const ts = new Date(point.ts).toISOString();
                    const lat = (point.lat != null && !isNaN(point.lat)) ? point.lat.toFixed(6) : '';
                    const lon = (point.lon != null && !isNaN(point.lon)) ? point.lon.toFixed(6) : '';
                    const dpt = !isNaN(point.dpt) ? point.dpt.toFixed(1) : '';
                    const dist = !isNaN(point.dist) ? point.dist.toFixed(1) : '';
                    const azm = !isNaN(point.azm) ? point.azm.toFixed(1) : '';
                    lines.push(`${ts},BEACON,${parseInt(addr) + 1},${lat},${lon},${dpt},${dist},${azm},,,,`);
                }
            }
        }

        downloadBlob(lines.join('\n'), 'text/csv', `zima2_tracks_${getTimestamp()}.csv`);
    }

    // ========== NMEA GGA ==========
    function exportGGA() {
        if (getAntennaMode() === 'cartesian_fixed') {
            alert('Экспорт GGA недоступен в декартовом режиме.\nСначала выполните топопривязку и пересчёт координат.');
            return;
        }
        
        const allTracks = TrackManager.getAll();
        const trackAddresses = Object.keys(allTracks);
        if (trackAddresses.length === 0) {
            alert('Нет данных треков');
            return;
        }

        const lines = [];
        for (const addr of trackAddresses) {
            const hexAddr = parseInt(addr).toString(16).toUpperCase();
            for (const point of allTracks[addr]) {
                if (point.isTimeout || point.lat == null || point.lon == null || isNaN(point.lat) || isNaN(point.lon)) continue;
                
                const ts = new Date(point.ts);
                const hh = String(ts.getUTCHours()).padStart(2, '0');
                const mm = String(ts.getUTCMinutes()).padStart(2, '0');
                const ss = String(ts.getUTCSeconds()).padStart(2, '0');
                const ms = String(Math.floor(ts.getUTCMilliseconds() / 10)).padStart(2, '0');
                const timeStr = `${hh}${mm}${ss}.${ms}`;
                
                const lat = Math.abs(point.lat);
                const latDeg = Math.floor(lat);
                const latMin = (lat - latDeg) * 60;
                const latHemi = point.lat >= 0 ? 'N' : 'S';
                
                const lon = Math.abs(point.lon);
                const lonDeg = Math.floor(lon);
                const lonMin = (lon - lonDeg) * 60;
                const lonHemi = point.lon >= 0 ? 'E' : 'W';
                
                const depth = !isNaN(point.dpt) ? point.dpt : 0;
                
                const sentence = `B${hexAddr}GGA,${timeStr},${String(latDeg).padStart(2, '0')}${latMin.toFixed(4)},${latHemi},${String(lonDeg).padStart(3, '0')}${lonMin.toFixed(4)},${lonHemi},1,04,,${depth.toFixed(1)},M,,M,,`;
                const nmeaLine = '$' + sentence;
                let cs = 0;
                for (let i = 1; i < nmeaLine.length; i++) cs ^= nmeaLine.charCodeAt(i);
                lines.push(nmeaLine + '*' + cs.toString(16).toUpperCase().padStart(2, '0'));
            }
        }

        if (lines.length === 0) {
            alert('Нет точек с координатами');
            return;
        }
        
        downloadBlob(lines.join('\r\n'), 'text/plain', `gga_tracks_${getTimestamp()}.nmea`);
    }

    // ========== NMEA GGA для антенны ==========
    function exportAntennaGGA() {
        if (getAntennaMode() === 'cartesian_fixed') {
            alert('Экспорт GGA антенны недоступен в декартовом режиме.');
            return;
        }
        
        const stationTrack = TrackManager.stationTrack;
        if (stationTrack.length === 0) {
            alert('Нет данных трека антенны');
            return;
        }

        const lines = [];
        let prevLat = NaN, prevLon = NaN;
        let pointIndex = 0;
        
        for (const point of stationTrack) {
            if (point.lat == null || point.lon == null || isNaN(point.lat) || isNaN(point.lon)) continue;
            
            // Пропускаем дубликаты (слишком близкие точки)
            if (!isNaN(prevLat) && !isNaN(prevLon)) {
                const dist = GeoUtils.haversineDistance(prevLat, prevLon, point.lat, point.lon);
                if (dist < 0.1) continue; // меньше 10 см
            }
            
            const ts = new Date(point.ts);
            const hh = String(ts.getUTCHours()).padStart(2, '0');
            const mm = String(ts.getUTCMinutes()).padStart(2, '0');
            const ss = String(ts.getUTCSeconds()).padStart(2, '0');
            const ms = String(Math.floor(ts.getUTCMilliseconds() / 10)).padStart(2, '0');
            const timeStr = `${hh}${mm}${ss}.${ms}`;
            
            const lat = Math.abs(point.lat);
            const latDeg = Math.floor(lat);
            const latMin = (lat - latDeg) * 60;
            const latHemi = point.lat >= 0 ? 'N' : 'S';
            
            const lon = Math.abs(point.lon);
            const lonDeg = Math.floor(lon);
            const lonMin = (lon - lonDeg) * 60;
            const lonHemi = point.lon >= 0 ? 'E' : 'W';
            
            const sentence = `GNGGA,${timeStr},${String(latDeg).padStart(2, '0')}${latMin.toFixed(4)},${latHemi},${String(lonDeg).padStart(3, '0')}${lonMin.toFixed(4)},${lonHemi},1,04,,,M,,M,,`;
            const nmeaLine = '$' + sentence;
            let cs = 0;
            for (let i = 1; i < nmeaLine.length; i++) cs ^= nmeaLine.charCodeAt(i);
            lines.push(nmeaLine + '*' + cs.toString(16).toUpperCase().padStart(2, '0'));
            
            prevLat = point.lat;
            prevLon = point.lon;
            pointIndex++;
        }

        if (lines.length === 0) {
            alert('Нет точек с координатами');
            return;
        }
        
        downloadBlob(lines.join('\r\n'), 'text/plain', `antenna_gga_${getTimestamp()}.nmea`);
        console.log(`[Export] Экспортировано ${lines.length} точек антенны в GGA`);
    }

    // ========== NMEA PSIMSSB (Head-Up) ==========
    function exportPSIMSSB() {
        const allTracks = TrackManager.getAll();
        const trackAddresses = Object.keys(allTracks);
        if (trackAddresses.length === 0) {
            alert('Нет данных треков');
            return;
        }

        const lines = [];
        for (const addr of trackAddresses) {
            for (const point of allTracks[addr]) {
                if (point.isTimeout) continue;
                if (point.xM == null || point.yM == null || isNaN(point.xM) || isNaN(point.yM)) continue;

                const ts = new Date(point.ts);
                const hh = String(ts.getUTCHours()).padStart(2, '0');
                const mm = String(ts.getUTCMinutes()).padStart(2, '0');
                const ss = String(ts.getUTCSeconds()).padStart(2, '0');
                const timeStr = `${hh}${mm}${ss}`;
                
                const btpId = 'B' + String(parseInt(addr) + 1).padStart(2, '0');
                const zM = (point.zM != null && !isNaN(point.zM)) ? point.zM : (!isNaN(point.dpt) ? point.dpt : 0);

                const sentence = `PSIMSSB,${timeStr},${btpId},A,,C,H,M,${point.xM.toFixed(2)},${point.yM.toFixed(2)},${zM.toFixed(2)},0.0,N,,`;
                const nmeaLine = '$' + sentence;
                let cs = 0;
                for (let i = 1; i < nmeaLine.length; i++) cs ^= nmeaLine.charCodeAt(i);
                lines.push(nmeaLine + '*' + cs.toString(16).toUpperCase().padStart(2, '0'));
            }
        }

        if (lines.length === 0) {
            alert('Нет точек с относительными координатами. Нужна топопривязка.');
            return;
        }
        
        downloadBlob(lines.join('\r\n'), 'text/plain', `psimssb_tracks_${getTimestamp()}.nmea`);
    }

    // ========== NMEA PSIMSSB (UTM) ==========
    function exportPSIMSSB_NE() {
        if (getAntennaMode() === 'cartesian_fixed') {
            alert('Экспорт PSIMSSB UTM недоступен в декартовом режиме.\nСначала выполните топопривязку и пересчёт координат.');
            return;
        }
        
        const allTracks = TrackManager.getAll();
        const trackAddresses = Object.keys(allTracks);
        if (trackAddresses.length === 0) {
            alert('Нет данных треков');
            return;
        }

        const lines = [];
        for (const addr of trackAddresses) {
            for (const point of allTracks[addr]) {
                if (point.isTimeout) continue;
                if (point.lat == null || point.lon == null || isNaN(point.lat) || isNaN(point.lon)) continue;

                const ts = new Date(point.ts);
                const hh = String(ts.getUTCHours()).padStart(2, '0');
                const mm = String(ts.getUTCMinutes()).padStart(2, '0');
                const ss = String(ts.getUTCSeconds()).padStart(2, '0');
                const timeStr = `${hh}${mm}${ss}`;
                
                const btpId = 'B' + String(parseInt(addr) + 1).padStart(2, '0');
                
                const utm = UTM.fromLatLon(point.lat, point.lon);
                const easting = utm.easting;
                const northing = utm.northing;
                const zM = !isNaN(point.dpt) ? point.dpt : 0;

                const sentence = `PSIMSSB,${timeStr},${btpId},A,,C,E,M,${easting.toFixed(2)},${northing.toFixed(2)},${zM.toFixed(2)},0.0,N,,`;
                const nmeaLine = '$' + sentence;
                let cs = 0;
                for (let i = 1; i < nmeaLine.length; i++) cs ^= nmeaLine.charCodeAt(i);
                lines.push(nmeaLine + '*' + cs.toString(16).toUpperCase().padStart(2, '0'));
            }
        }

        if (lines.length === 0) {
            alert('Нет точек с координатами');
            return;
        }
        
        downloadBlob(lines.join('\r\n'), 'text/plain', `psimssb_utm_tracks_${getTimestamp()}.nmea`);
    }

	// ========== DXF ==========
	function exportDXF() {
		const allTracks = TrackManager.getAll();
		const stTrack = TrackManager.stationTrack;
		const st = AZMManager.getState();
		const isCartesian = st.antennaMode === 'cartesian_fixed';
		
		if (Object.keys(allTracks).length === 0 && stTrack.length === 0) {
			alert('Нет данных треков для экспорта');
			return;
		}
		
		const dxf = [];
		
		// R12 заголовок
		dxf.push('0'); dxf.push('SECTION');
		dxf.push('2'); dxf.push('HEADER');
		dxf.push('9'); dxf.push('$ACADVER');
		dxf.push('1'); dxf.push('AC1009');
		dxf.push('9'); dxf.push('$INSUNITS');
		dxf.push('70'); dxf.push('6');
		dxf.push('9'); dxf.push('$LIMMIN');
		dxf.push('10'); dxf.push('-10000.0');
		dxf.push('20'); dxf.push('-10000.0');
		dxf.push('9'); dxf.push('$LIMMAX');
		dxf.push('10'); dxf.push('10000.0');
		dxf.push('20'); dxf.push('10000.0');
		dxf.push('9'); dxf.push('$EXTMIN');
		dxf.push('10'); dxf.push('-10000.0');
		dxf.push('20'); dxf.push('-10000.0');
		dxf.push('30'); dxf.push('-10000.0');
		dxf.push('9'); dxf.push('$EXTMAX');
		dxf.push('10'); dxf.push('10000.0');
		dxf.push('20'); dxf.push('10000.0');
		dxf.push('30'); dxf.push('0.0');
		dxf.push('0'); dxf.push('ENDSEC');
		
		// Таблицы (пустые, но обязательные для R12)
		dxf.push('0'); dxf.push('SECTION');
		dxf.push('2'); dxf.push('TABLES');
		dxf.push('0'); dxf.push('ENDSEC');
		
		// Блоки (пустые, обязательные)
		dxf.push('0'); dxf.push('SECTION');
		dxf.push('2'); dxf.push('BLOCKS');
		dxf.push('0'); dxf.push('ENDSEC');
		
		// Сущности
		dxf.push('0'); dxf.push('SECTION');
		dxf.push('2'); dxf.push('ENTITIES');
		
		// Трек станции
		if (stTrack.length >= 2) {
			dxf.push('0'); dxf.push('POLYLINE');
			dxf.push('8'); dxf.push('STATION');
			dxf.push('66'); dxf.push('1');
			dxf.push('70'); dxf.push('8');
			dxf.push('10'); dxf.push('0.0');
			dxf.push('20'); dxf.push('0.0');
			dxf.push('30'); dxf.push('0.0');
			
			for (const p of stTrack) {
				if (isNaN(p.x)) continue;
				dxf.push('0'); dxf.push('VERTEX');
				dxf.push('8'); dxf.push('STATION');
				dxf.push('10'); dxf.push(p.x.toFixed(3));
				dxf.push('20'); dxf.push(p.y.toFixed(3));
				dxf.push('30'); dxf.push('0.0');
				dxf.push('70'); dxf.push('32');
			}
			
			dxf.push('0'); dxf.push('SEQEND');
		}
		
		// Треки маяков
		for (const addr in allTracks) {
			const track = allTracks[addr];
			const validPoints = track.filter(p => !p.isTimeout);
			if (validPoints.length < 2) continue;
			
			let hasDepth = false;
			for (const p of validPoints) {
				const z = isCartesian ? p.zM : p.dpt;
				if (!isNaN(z) && z !== 0) { hasDepth = true; break; }
			}
			
			if (hasDepth) {
				dxf.push('0'); dxf.push('POLYLINE');
				dxf.push('8'); dxf.push(`BEACON_${parseInt(addr)+1}`);
				dxf.push('66'); dxf.push('1');
				dxf.push('70'); dxf.push('8');
				dxf.push('10'); dxf.push('0.0');
				dxf.push('20'); dxf.push('0.0');
				dxf.push('30'); dxf.push('0.0');
				
				for (const p of validPoints) {
					const x = isCartesian ? p.xM : p.x;
					const y = isCartesian ? p.yM : p.y;
					const z = isCartesian ? (p.zM || 0) : (p.dpt || 0);
					if (x === null || isNaN(x)) continue;
					
					dxf.push('0'); dxf.push('VERTEX');
					dxf.push('8'); dxf.push(`BEACON_${parseInt(addr)+1}`);
					dxf.push('10'); dxf.push(x.toFixed(3));
					dxf.push('20'); dxf.push(y.toFixed(3));
					dxf.push('30'); dxf.push((-z).toFixed(3));
					dxf.push('70'); dxf.push('32');
				}
				
				dxf.push('0'); dxf.push('SEQEND');
			} else {
				const pts = validPoints.filter(p => {
					const x = isCartesian ? p.xM : p.x;
					return x !== null && !isNaN(x);
				});
				
				dxf.push('0'); dxf.push('POLYLINE');
				dxf.push('8'); dxf.push(`BEACON_${parseInt(addr)+1}`);
				dxf.push('66'); dxf.push('1');
				dxf.push('70'); dxf.push('0');
				dxf.push('10'); dxf.push('0.0');
				dxf.push('20'); dxf.push('0.0');
				dxf.push('30'); dxf.push('0.0');
				
				for (const p of pts) {
					const x = isCartesian ? p.xM : p.x;
					const y = isCartesian ? p.yM : p.y;
					
					dxf.push('0'); dxf.push('VERTEX');
					dxf.push('8'); dxf.push(`BEACON_${parseInt(addr)+1}`);
					dxf.push('10'); dxf.push(x.toFixed(3));
					dxf.push('20'); dxf.push(y.toFixed(3));
					dxf.push('30'); dxf.push('0.0');
					dxf.push('70'); dxf.push('32');
				}
				
				dxf.push('0'); dxf.push('SEQEND');
			}
		}
		
		dxf.push('0'); dxf.push('ENDSEC');
		dxf.push('0'); dxf.push('EOF');
		
		const dxfContent = dxf.join('\r\n') + '\r\n';
		downloadBlob(dxfContent, 'application/octet-stream', `zima2_tracks_${getTimestamp()}.dxf`);
	}


    // ========== KML ==========
    
    function escapeXml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    
    function generateKML() {
        const allTracks = TrackManager.getAll();
        const stationTrack = TrackManager.stationTrack;
        
        let kml = `<?xml version="1.0" encoding="UTF-8"?>
        <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document>
            <name>Zima2 Tracks</name>
            <Style id="stationStyle">
                <LineStyle><color>ff00ffff</color><width>3</width></LineStyle>
            </Style>
            <Style id="beaconStyle">
                <LineStyle><color>ff00ff00</color><width>2</width></LineStyle>
            </Style>
            <Style id="poiLoadedStyle">
            <IconStyle>
                <color>ff0080ff</color>
                <scale>1.0</scale>
                <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon>
            </IconStyle>
            </Style>
            <Style id="poiMarkedStyle">
                <IconStyle>
                    <color>ff00ffff</color>
                    <scale>1.0</scale>
                    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/star.png</href></Icon>
                </IconStyle>
            </Style>`;
        
        // Трек станции
        if (stationTrack && stationTrack.length > 0) {
            const validSt = stationTrack.filter(p => p.lat != null && p.lon != null && !isNaN(p.lat) && !isNaN(p.lon));
            if (validSt.length >= 2) {
                let coords = '';
                for (const point of validSt) {
                    coords += `${point.lon.toFixed(8)},${point.lat.toFixed(8)},0 `;
                }
                kml += `
                <Placemark>
                    <name>Station Track</name>
                    <styleUrl>#stationStyle</styleUrl>
                    <LineString>
                        <extrude>0</extrude>
                        <tessellate>1</tessellate>
                        <coordinates>${coords.trim()}</coordinates>
                    </LineString>
                </Placemark>`;
            }
        }
        
        // Треки маяков
        for (const addr in allTracks) {
            const track = allTracks[addr];
            const userAddr = parseInt(addr) + 1;
            
            const valid = track.filter(p => !p.isTimeout && p.lat != null && p.lon != null && !isNaN(p.lat) && !isNaN(p.lon));
            if (valid.length < 2) continue;
            
            let coords = '';
            for (const point of valid) {
                const altitude = (!isNaN(point.dpt) && point.dpt > 0) ? -point.dpt : 0;
                coords += `${point.lon.toFixed(8)},${point.lat.toFixed(8)},${altitude} `;
            }
            
            kml += `
            <Placemark>
                <name>Beacon #${userAddr}</name>
                <styleUrl>#beaconStyle</styleUrl>
                <LineString>
                    <extrude>0</extrude>
                    <tessellate>1</tessellate>
                    <coordinates>${coords.trim()}</coordinates>
                </LineString>
            </Placemark>`;
        }
        
        // POI точки
        if (typeof POIManager !== 'undefined') {
            const poiPoints = POIManager.getAll();
            for (const poi of poiPoints) {
                const alt = (poi.depth != null && !isNaN(poi.depth)) ? -poi.depth : 0;
                const style = poi.type === 'marked' ? '#poiMarkedStyle' : '#poiLoadedStyle';
                const ts = new Date(poi.timestamp).toISOString();
                
                kml += `
                <Placemark>
                    <name>${escapeXml(poi.name)}</name>
                    <description>Тип: ${poi.type === 'marked' ? 'Отмечена оператором' : 'Загружена из CSV'}
                    Время: ${ts}
                    Глубина: ${poi.depth != null ? poi.depth.toFixed(1) + ' м' : '--'}</description>
                            <styleUrl>${style}</styleUrl>
                    <Point>
                        <coordinates>${poi.lon.toFixed(8)},${poi.lat.toFixed(8)},${alt}</coordinates>
                    </Point>
                </Placemark>`;
            }
        }
        
        kml += `
        </Document>
        </kml>`;
        
        return kml;
    }

    function exportTracksKML() {
        if (getAntennaMode() === 'cartesian_fixed') {
            alert('Экспорт KML недоступен в декартовом режиме.\nСначала выполните топопривязку и пересчёт координат.');
            return;
        }
        
        const trackCount = TrackManager.getTrackedAddresses().length;
        const stationTrackLength = TrackManager.stationTrack.length;
        
        if (trackCount === 0 && stationTrackLength === 0) {
            alert('Нет данных треков для экспорта');
            return;
        }
        
        const kml = generateKML();
        downloadBlob(kml, 'application/vnd.google-earth.kml+xml', `zima2_tracks_${getTimestamp()}.kml`);
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    return {
        exportCSV,
        exportGGA,
        exportAntennaGGA,
        exportPSIMSSB,
        exportPSIMSSB_NE,
		exportDXF,
        exportTracksKML,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportManager;
}