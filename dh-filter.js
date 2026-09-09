// dh-filter.js — DHTrackFilter (Distance-Heading трек-фильтр)
// Портировано с C# UCNLNav.TrackFilters.DHTrackFilter

const DHTrackFilter = (() => {

    class GeoPoint3DTd {
        constructor(lat, lon, dpt, ts, prevPoint = null) {
            this.lat = lat;
            this.lon = lon;
            this.dpt = dpt;
            this.ts = ts;

            if (prevPoint) {
                this.dist2Prev = haversineInverse(
                    lat, lon,
                    prevPoint.lat, prevPoint.lon,
                    Haversine.WGS84_A
                );
                this.time2Prev = (ts - prevPoint.ts) / 1000;
            } else {
                this.dist2Prev = NaN;
                this.time2Prev = NaN;
            }
        }
    }

    class DHTrackFilter {
        constructor(fifoSize = 8, maxSpeedMps = 1.0, dstThresholdM = 5.0) {
            if (fifoSize < 2) throw new Error('fifoSize must be >= 2');
            if (maxSpeedMps <= 0) throw new Error('maxSpeedMps must be > 0');
            if (dstThresholdM <= 0) throw new Error('dstThresholdM must be > 0');

            this.fifoSize = fifoSize;
            this._maxSpeedMps = maxSpeedMps;
            this.dstThreshold = dstThresholdM;

            this.sides = [[], []];
            this.pSideIdx = 0;
        }

        get sSideIdx() {
            return this.pSideIdx === 0 ? 1 : 0;
        }

        _addPoint(sideIdx, point) {
            const side = this.sides[sideIdx];
            if (side.length + 1 > this.fifoSize) {
                side.shift();
            }
            side.push(point);
        }

        _updateStatistics() {
            const side0 = this.sides[0];
            const side1 = this.sides[1];

            if (side0.length !== this.fifoSize || side1.length !== this.fifoSize) {
                return;
            }

            const meanDst = [0, 0];
            for (let i = 0; i < this.fifoSize; i++) {
                meanDst[0] += side0[i].dist2Prev;
                meanDst[1] += side1[i].dist2Prev;
            }
            meanDst[0] /= this.fifoSize;
            meanDst[1] /= this.fifoSize;

            const sigmas = [0, 0];
            for (let i = 0; i < this.fifoSize; i++) {
                sigmas[0] += Math.pow(side0[i].dist2Prev - meanDst[0], 2);
                sigmas[1] += Math.pow(side1[i].dist2Prev - meanDst[1], 2);
            }
            sigmas[0] = Math.sqrt(sigmas[0]);
            sigmas[1] = Math.sqrt(sigmas[1]);

            if (sigmas[this.sSideIdx] < sigmas[this.pSideIdx]) {
                this.pSideIdx = this.sSideIdx;
            }
        }
		
		get maxSpeedMps() {
			return this._maxSpeedMps;
		}
		
		set maxSpeedMps(value) {
			if (value > 0) {
				this._maxSpeedMps = value;
			}
		}
		
		setFifoSize(newSize) {
			if (newSize < 2) return;
			if (newSize === this.fifoSize) return;
			
			this.fifoSize = newSize;
			
			// Обрезаем обе очереди до нового размера
			for (let i = 0; i < 2; i++) {
				while (this.sides[i].length > this.fifoSize) {
					this.sides[i].shift();
				}
			}
		}

        process(lat, lon, dpt, ts) {
            const primary = this.sides[this.pSideIdx];

            if (primary.length === 0) {
                const point = new GeoPoint3DTd(lat, lon, dpt, ts);
                this._addPoint(this.pSideIdx, point);
                return { accepted: true, lat, lon, dpt, ts };
            }

            this._updateStatistics();

            const lastPoint = primary[primary.length - 1];
            const testPoint = new GeoPoint3DTd(lat, lon, dpt, ts, lastPoint);

            const speedOk = testPoint.dist2Prev < testPoint.time2Prev * this._maxSpeedMps;
            const thresholdOk = testPoint.dist2Prev < this.dstThreshold;

            if (speedOk || thresholdOk) {
                this._addPoint(this.pSideIdx, testPoint);
                return { accepted: true, lat, lon, dpt, ts };
            } else {
                const altSide = this.sides[this.sSideIdx];
                const altLastPoint = altSide.length > 0 ? altSide[altSide.length - 1] : null;
                const altPoint = new GeoPoint3DTd(lat, lon, dpt, ts, altLastPoint);
                this._addPoint(this.sSideIdx, altPoint);
                return { accepted: false, lat: NaN, lon: NaN, dpt: NaN, ts: null };
            }
        }

        reset() {
            this.sides = [[], []];
            this.pSideIdx = 0;
        }
    }

    // Экспорт в глобальную область
    window.DHTrackFilter = DHTrackFilter;

    return DHTrackFilter;

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DHTrackFilter;
} 