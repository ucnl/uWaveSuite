// uw-usbl-solver.js — Решение USBL задачи для uWave
// Адаптировано из azm-manager.js (Zima2 USBL)
// Вычисление позиции маяка по азимуту, дальности и глубине

const UWUSBLsolver = (() => {

    // ========== КОНСТАНТЫ ==========
    
    const DEFAULT_SOUND_SPEED_MPS = 1480.0;
    
    const DEFAULT_USBL_DH_FIFO = 8;
    const DEFAULT_USBL_DH_FIFO_FAR = 4;
    const DEFAULT_USBL_DH_THRESHOLD = 5.0;
    const DEFAULT_USBL_DH_THRESHOLD_FAR = 200.0;      // дальность > 3000 м
    const DEFAULT_USBL_DH_THRESHOLD_MEDIUM = 100.0;    // дальность 1500–3000 м
    const DEFAULT_USBL_DH_THRESHOLD_NEAR = 15.0;       // дальность 500–1500 м
    const DEFAULT_USBL_DH_FAR_LIMIT = 3000.0;
    const DEFAULT_USBL_DH_MEDIUM_LIMIT = 1500.0;
    const DEFAULT_USBL_DH_NEAR_LIMIT = 500.0;
    const DEFAULT_USBL_S_FIFO = 4;
    const DEFAULT_USBL_S_THRESHOLD = 100.0;

    // ========== ЗАВИСИМОСТИ ==========
    
    const DHTrackFilter = window.DHTrackFilter;
    const DHTrackFilterXYZ = window.DHTrackFilterXYZ;
    const TrackMovingAverageSmoother = window.TrackMovingAverageSmoother;
    const TrackMedianFilter = window.TrackMedianFilter;
    const TrackMedianFilterXYZ = window.TrackMedianFilterXYZ;
    const vincentyDirect = Vincenty.vincentyDirect;
    const haversineDirect = Haversine.haversineDirect;
    const deg2rad = Vincenty.deg2rad;
    const rad2deg = Vincenty.rad2deg;
    const wrap2PI = Vincenty.wrap2PI;

    // ========== СОСТОЯНИЕ АНТЕННЫ ==========
    
    let state = {
        // Позиция антенны
        antennaLatDeg: NaN,
        antennaLonDeg: NaN,
        antennaHeadingDeg: NaN,
        antennaPitchDeg: NaN,
        antennaRollDeg: NaN,
        antennaDepthM: NaN,
        
        // Данные среды
        waterTempC: NaN,
        pressureMBar: NaN,
        salinityPSU: 0.0,
        soundSpeedMps: NaN,
        soundSpeedAuto: true,
        
        // Движение
        speedMps: NaN,
        courseDeg: NaN,
        
        // Коррекция
        phiDeg: 0.0,          // Угол разворота антенны
        offsetXM: 0.0,        // Смещение X (вправо)
        offsetYM: 0.0,        // Смещение Y (вперед)
        
        // Режим
        antennaMode: 'cartesian_fixed',  // 'cartesian_fixed' | 'geographic'
        
        // Ограничения
        maxBeaconSpeedMps: 1.0,
        maxDistM: 1000.0,
        
        // Время
        lastUpdateTime: 0
    };

    let timeProvider = () => new Date();

    // ========== МАТЕМАТИКА ==========
    
    /**
     * Вычисление проекции наклонной дальности
     */
    function slantRangeProjection(dAnt, dBcn, sRange) {
        const dd = Math.abs(dAnt - dBcn);
        return dd < sRange ? Math.sqrt(sRange * sRange - dd * dd) : sRange;
    }

    /**
     * Полярная система: смещение и поворот
     */
    function polarCS_ShiftRotate(hdg, phi, bng, rM, xt, yt) {
        const teta = wrap2PI(deg2rad(bng + phi));
        const xr = xt + rM * Math.sin(teta);
        const yr = yt + rM * Math.cos(teta);
        
        let a_r = Math.atan2(xr, yr);
        if (a_r < 0) a_r += 2 * Math.PI;
        
        a_r += deg2rad(hdg);
        a_r = wrap2PI(a_r);
        
        return {
            a_deg: rad2deg(a_r),
            r_a: Math.sqrt(xr * xr + yr * yr)
        };
    }

    /**
     * Прямая геодезическая задача
     */
    function directGeodetic(latRad, lonRad, azmRad, distM) {
        const v = vincentyDirect(latRad, lonRad, azmRad, distM);
        return v.converged ? v : haversineDirect(latRad, lonRad, distM, azmRad);
    }

    /**
     * Нормализация угла
     */
    function wrap360(a) {
        let r = a % 360;
        return r < 0 ? r + 360 : r;
    }

    // ========== ОБРАБОТКА ДАННЫХ ==========
    
    /**
     * Обновить данные станции (глубина, температура, курс)
     */
    function processStationData(data) {
        if (!isNaN(data.temperatureC)) state.waterTempC = data.temperatureC;
        
        if (!isNaN(data.pressureMbar)) {
            state.pressureMBar = data.pressureMbar;
            if (!isNaN(state.waterTempC)) {
                const pAtm = 1013.25, rho = 1000.0, g = 9.81;
                state.antennaDepthM = (state.pressureMBar - pAtm) * 100 / (rho * g);
                if (state.antennaDepthM < 0) state.antennaDepthM = 0;
            }
        }
        
        if (!isNaN(data.pitchDeg)) state.antennaPitchDeg = data.pitchDeg;
        if (!isNaN(data.rollDeg)) state.antennaRollDeg = data.rollDeg;
        if (!isNaN(data.headingDeg)) state.antennaHeadingDeg = data.headingDeg;
        
        // Автовычисление скорости звука
        if (state.soundSpeedAuto && !isNaN(state.waterTempC) && 
            !isNaN(state.salinityPSU) && state.salinityPSU > 0) {
            state.soundSpeedMps = SoundSpeed.calc(
                state.waterTempC,
                state.salinityPSU,
                state.antennaDepthM || 0
            );
        }
        
        state.lastUpdateTime = Date.now();
    }

    /**
     * Вычислить позицию маяка
     * @param {Object} beaconData - { address, azimuthDeg, slantRangeM, depthM, propTimeS, ... }
     * @returns {Object} - обновленные данные маяка
     */
    function solveUSBL(beacon) {
        if (!beacon) return null;
        
        try {
			// Проверяем обязательные данные.
			// propTimeS может быть отрицательным — это нормально (знаковое время
			// от модема относительно опорного момента).
			// Единственное невалидное значение — NaN (парсер не смог прочитать).
			if (!Number.isFinite(beacon.propTimeS)) {
				if (Number.isFinite(beacon.azimuthDeg)) {
					return beacon; // Только азимут, без дальности
				}
				return null;
			}
			
			// Дальность = |propTimeS| * скорость звука.
			// Знак времени не влияет на дальность (дальность — скаляр).
			const absPropTime = Math.abs(beacon.propTimeS);
			if (absPropTime === 0) {
				if (Number.isFinite(beacon.azimuthDeg)) {
					return beacon;
				}
				return null;
			}
			
			const sos = (state.soundSpeedMps > 0) ? state.soundSpeedMps : DEFAULT_SOUND_SPEED_MPS;
			beacon.slantRangeM = absPropTime * sos;
			
			// Вычисляем проекцию
			if (Number.isFinite(state.antennaDepthM) && Number.isFinite(beacon.depthM)) {
				const projection = slantRangeProjection(state.antennaDepthM, beacon.depthM, beacon.slantRangeM);
				beacon.slantRangeProjectionM = projection;
			} else {
				beacon.slantRangeProjectionM = beacon.slantRangeM;
			}
			
			let hasProjection = Number.isFinite(beacon.slantRangeProjectionM) && beacon.slantRangeProjectionM > 0;
			let projectionM = beacon.slantRangeProjectionM;
			
			if (!hasProjection && Number.isFinite(beacon.slantRangeM) && beacon.slantRangeM > 0) {
				projectionM = beacon.slantRangeM;
				beacon.slantRangeProjectionM = projectionM;
				hasProjection = true;
			}
			
			beacon.isTimeout = false;
			if (!Number.isFinite(beacon.succeededRequests)) beacon.succeededRequests = 0;
			beacon.succeededRequests++;
			beacon.dataAge = 0;
            
            // ========== ДЕКАРТОВ РЕЖИМ (НЕПОДВИЖНАЯ АНТЕННА) ==========
            if (state.antennaMode === 'cartesian_fixed') {
                if (!hasProjection || isNaN(beacon.azimuthDeg)) {
                    return beacon;
                }
                
                // Система координат: X → вправо (East), Y → вперёд (North), Z → вниз
                const azmRad = deg2rad(beacon.azimuthDeg);
                const distXY = projectionM;
                
                const xM = distXY * Math.sin(azmRad);  // +X = вправо
                const yM = distXY * Math.cos(azmRad);  // +Y = вперёд
                const zM = !isNaN(beacon.depthM) ? beacon.depthM : 0;
                
                // Фильтр Калмана XYZ
                if (!beacon.dhFilterXYZ && DHTrackFilterXYZ) {
                    beacon.dhFilterXYZ = new DHTrackFilterXYZ(
                        DEFAULT_USBL_DH_FIFO,
                        state.maxBeaconSpeedMps || 1.0,
                        DEFAULT_USBL_DH_THRESHOLD
                    );
                }
                
                if (beacon.dhFilterXYZ) {
                    // Адаптивные пороги
                    if (!isNaN(distXY)) {
                        if (distXY > DEFAULT_USBL_DH_FAR_LIMIT) {
                            beacon.dhFilterXYZ.dstThreshold = DEFAULT_USBL_DH_THRESHOLD_FAR;
                            beacon.dhFilterXYZ.setFifoSize(DEFAULT_USBL_DH_FIFO_FAR);
                        } else if (distXY > DEFAULT_USBL_DH_MEDIUM_LIMIT) {
                            beacon.dhFilterXYZ.dstThreshold = DEFAULT_USBL_DH_THRESHOLD_MEDIUM;
                            beacon.dhFilterXYZ.setFifoSize(DEFAULT_USBL_DH_FIFO_FAR);
                        } else if (distXY > DEFAULT_USBL_DH_NEAR_LIMIT) {
                            beacon.dhFilterXYZ.dstThreshold = DEFAULT_USBL_DH_THRESHOLD_NEAR;
                            beacon.dhFilterXYZ.setFifoSize(DEFAULT_USBL_DH_FIFO);
                        } else {
                            beacon.dhFilterXYZ.dstThreshold = DEFAULT_USBL_DH_THRESHOLD;
                            beacon.dhFilterXYZ.setFifoSize(DEFAULT_USBL_DH_FIFO);
                        }
                    }
                    
                    if (beacon.dhFilterXYZ.maxSpeedMps !== state.maxBeaconSpeedMps) {
                        beacon.dhFilterXYZ.maxSpeedMps = state.maxBeaconSpeedMps;
                    }
                    
                    const now = timeProvider();
                    const dhResult = beacon.dhFilterXYZ.process(xM, yM, zM, now);
                    
                    if (dhResult.accepted) {
                        beacon.absoluteAzimuthDeg = beacon.azimuthDeg;
                        beacon.absoluteDistanceM = distXY;
                        
                        // Сглаживание (до 1000м)
                        if (distXY <= 1000.0) {
                            if (!beacon.smootherXYZ && TrackMedianFilterXYZ) {
                                beacon.smootherXYZ = new TrackMedianFilterXYZ(
                                    DEFAULT_USBL_S_FIFO,
                                    DEFAULT_USBL_S_THRESHOLD
                                );
                            }
                            if (beacon.smootherXYZ) {
                                const smoothResult = beacon.smootherXYZ.process(
                                    dhResult.x, dhResult.y, dhResult.z, now
                                );
                                beacon.xM = smoothResult.x;
                                beacon.yM = smoothResult.y;
                                beacon.zM = smoothResult.z;
                            } else {
                                beacon.xM = dhResult.x;
                                beacon.yM = dhResult.y;
                                beacon.zM = dhResult.z;
                            }
                        } else {
                            beacon.xM = dhResult.x;
                            beacon.yM = dhResult.y;
                            beacon.zM = dhResult.z;
                        }
                        
                        // Географические координаты — NaN
                        beacon.latitudeDeg = NaN;
                        beacon.longitudeDeg = NaN;
                        
                    } else {
                        // Точка отвергнута
                        beacon.rejectedXM = xM;
                        beacon.rejectedYM = yM;
                        beacon.rejectedZM = zM;
                        beacon.rejectedDistanceM = distXY;
                        beacon.rejectedAzimuthDeg = beacon.azimuthDeg;
                    }
                }
                
                return beacon;
            }
            
            // ========== ГЕОГРАФИЧЕСКИЙ РЕЖИМ ==========
            if (hasProjection && !isNaN(beacon.azimuthDeg) &&
                !isNaN(state.antennaLatDeg) && !isNaN(state.antennaLonDeg) &&
                !isNaN(state.antennaHeadingDeg)) {
                
                const polarResult = polarCS_ShiftRotate(
                    state.antennaHeadingDeg, state.phiDeg,
                    beacon.azimuthDeg, projectionM,
                    state.offsetXM, state.offsetYM
                );
                const absRange = polarResult.r_a;
                
                if (!beacon.dhFilter && DHTrackFilter) {
                    beacon.dhFilter = new DHTrackFilter(
                        DEFAULT_USBL_DH_FIFO,
                        state.maxBeaconSpeedMps || 1.0,
                        DEFAULT_USBL_DH_THRESHOLD
                    );
                }
                
                const latRad = deg2rad(state.antennaLatDeg);
                const lonRad = deg2rad(state.antennaLonDeg);
                const absAzmRad = deg2rad(polarResult.a_deg);
                const geoResult = directGeodetic(latRad, lonRad, absAzmRad, absRange);
                
                if (isNaN(geoResult.lat) || isNaN(geoResult.lon)) {
                    return beacon;
                }
                
                if (beacon.dhFilter) {
                    // Адаптивные пороги
                    const distForThreshold = projectionM;
                    if (!isNaN(distForThreshold)) {
                        if (distForThreshold > DEFAULT_USBL_DH_FAR_LIMIT) {
                            beacon.dhFilter.dstThreshold = DEFAULT_USBL_DH_THRESHOLD_FAR;
                            beacon.dhFilter.setFifoSize(DEFAULT_USBL_DH_FIFO_FAR);
                        } else if (distForThreshold > DEFAULT_USBL_DH_MEDIUM_LIMIT) {
                            beacon.dhFilter.dstThreshold = DEFAULT_USBL_DH_THRESHOLD_MEDIUM;
                            beacon.dhFilter.setFifoSize(DEFAULT_USBL_DH_FIFO_FAR);
                        } else if (distForThreshold > DEFAULT_USBL_DH_NEAR_LIMIT) {
                            beacon.dhFilter.dstThreshold = DEFAULT_USBL_DH_THRESHOLD_NEAR;
                            beacon.dhFilter.setFifoSize(DEFAULT_USBL_DH_FIFO);
                        } else {
                            beacon.dhFilter.dstThreshold = DEFAULT_USBL_DH_THRESHOLD;
                            beacon.dhFilter.setFifoSize(DEFAULT_USBL_DH_FIFO);
                        }
                    }
                    
                    if (beacon.dhFilter.maxSpeedMps !== state.maxBeaconSpeedMps) {
                        beacon.dhFilter.maxSpeedMps = state.maxBeaconSpeedMps;
                    }
                    
                    const now = timeProvider();
                    const dhResult = beacon.dhFilter.process(
                        geoResult.lat, geoResult.lon,
                        !isNaN(beacon.depthM) ? beacon.depthM : 0,
                        now
                    );
                    
                    if (dhResult.accepted) {
                        beacon.absoluteAzimuthDeg = polarResult.a_deg;
                        beacon.absoluteDistanceM = absRange;
                        beacon.reverseAzimuthDeg = wrap360(polarResult.a_deg + 180);
                        
                        // Сглаживание (до 1000м)
                        const useSmoother = projectionM <= 1000.0;
                        
                        if (useSmoother) {
                            if (!beacon.smoother && TrackMedianFilter) {
                                beacon.smoother = new TrackMedianFilter(
                                    DEFAULT_USBL_S_FIFO,
                                    DEFAULT_USBL_S_THRESHOLD
                                );
                            }
                            if (beacon.smoother) {
                                const smoothResult = beacon.smoother.process(
                                    geoResult.lat, geoResult.lon,
                                    !isNaN(beacon.depthM) ? beacon.depthM : 0,
                                    now
                                );
                                beacon.latitudeDeg = rad2deg(smoothResult.lat);
                                beacon.longitudeDeg = rad2deg(smoothResult.lon);
                            } else {
                                beacon.latitudeDeg = rad2deg(geoResult.lat);
                                beacon.longitudeDeg = rad2deg(geoResult.lon);
                            }
                        } else {
                            beacon.latitudeDeg = rad2deg(geoResult.lat);
                            beacon.longitudeDeg = rad2deg(geoResult.lon);
                        }
                    } else {
                        beacon.rejectedLatitudeDeg = rad2deg(geoResult.lat);
                        beacon.rejectedLongitudeDeg = rad2deg(geoResult.lon);
                        beacon.rejectedDistanceM = absRange;
                        beacon.rejectedAzimuthDeg = polarResult.a_deg;
                    }
                } else {
                    beacon.absoluteAzimuthDeg = polarResult.a_deg;
                    beacon.absoluteDistanceM = absRange;
                    beacon.reverseAzimuthDeg = wrap360(polarResult.a_deg + 180);
                    beacon.latitudeDeg = rad2deg(geoResult.lat);
                    beacon.longitudeDeg = rad2deg(geoResult.lon);
                }
            } else if (!isNaN(beacon.azimuthDeg)) {
                beacon.reverseAzimuthDeg = wrap360(beacon.azimuthDeg + 180);
            }
            
            return beacon;
            
        } catch (e) {
            console.error('[UW USBL Solver] Ошибка:', e.message);
            return null;
        }
    }

    // ========== НАСТРОЙКИ ==========
    
    function setAntennaPosition(latDeg, lonDeg, headingDeg) {
        state.antennaLatDeg = latDeg;
        state.antennaLonDeg = lonDeg;
        state.antennaHeadingDeg = headingDeg;
    }

    function setAntennaDepth(depthM) {
        state.antennaDepthM = depthM;
    }

    function setSalinity(psu) {
        state.salinityPSU = psu;
    }

    function setSoundSpeed(mps) {
        state.soundSpeedMps = mps;
    }

    function setSoundSpeedAuto(auto) {
        state.soundSpeedAuto = !!auto;
    }

    function setAntennaOffsets(xM, yM, phiDeg) {
        state.offsetXM = xM;
        state.offsetYM = yM;
        state.phiDeg = phiDeg;
    }

    function setAntennaMode(mode) {
        if (mode === 'geographic' || mode === 'cartesian_fixed') {
            state.antennaMode = mode;
        }
    }

    function setMaxBeaconSpeed(maxSpeedMps) {
        if (!isNaN(maxSpeedMps) && maxSpeedMps >= 0.5 && maxSpeedMps <= 5) {
            state.maxBeaconSpeedMps = maxSpeedMps;
        }
    }

    function setMaxDistance(m) {
        state.maxDistM = m;
    }

    function setSpeedCourse(speedMps, courseDeg) {
        state.speedMps = speedMps;
        state.courseDeg = courseDeg;
    }

    function setTimeProvider(fn) {
        timeProvider = fn;
    }

    function getState() {
        return state;
    }

    // ========== ПУБЛИЧНЫЙ API ==========
    
    return {
        solveUSBL,
        processStationData,
        slantRangeProjection,
        setAntennaPosition,
        setAntennaDepth,
        setSalinity,
        setSoundSpeed,
        setSoundSpeedAuto,
        setAntennaOffsets,
        setAntennaMode,
        setMaxBeaconSpeed,
        setMaxDistance,
        setSpeedCourse,
        setTimeProvider,
        getState,
        DEFAULT_SOUND_SPEED_MPS
    };

})();

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UWUSBLsolver;
}