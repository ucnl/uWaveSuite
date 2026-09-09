// dh-filter-xyz.js — DHTrackFilterXYZ 
// Портировано с C# UCNLNav.TrackFilters.DHTrackFilterCartesian

const DHTrackFilterXYZ = (() => {

    class Point3DTd {
        /**
         * @param {number} x - X координата (вперёд), м
         * @param {number} y - Y координата (вправо), м
         * @param {number} z - Z координата (глубина, положительная вниз), м
         * @param {Date} ts - временная метка
         * @param {Point3DTd|null} prevPoint - предыдущая точка для расчёта дистанции
         */
        constructor(x, y, z, ts, prevPoint = null) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.ts = ts;

            if (prevPoint) {
                const dx = x - prevPoint.x;
                const dy = y - prevPoint.y;
                const dz = z - prevPoint.z;
                this.dist2Prev = Math.sqrt(dx * dx + dy * dy + dz * dz);
                this.time2Prev = (ts - prevPoint.ts) / 1000; // в секундах
            } else {
                this.dist2Prev = NaN;
                this.time2Prev = NaN;
            }
        }
    }

    class DHTrackFilterXYZ {
        /**
         * @param {number} fifoSize - размер очереди (≥ 2)
         * @param {number} maxSpeedMps - максимальная скорость маяка, м/с
         * @param {number} dstThresholdM - порог дистанции, м
         */
        constructor(fifoSize = 8, maxSpeedMps = 1.0, dstThresholdM = 5.0) {
            if (fifoSize < 2) throw new Error('fifoSize must be >= 2');
            if (maxSpeedMps <= 0) throw new Error('maxSpeedMps must be > 0');
            if (dstThresholdM <= 0) throw new Error('dstThresholdM must be > 0');

            this.fifoSize = fifoSize;
            this._maxSpeedMps = maxSpeedMps;
            this.dstThreshold = dstThresholdM;

            this.sides = [[], []];  // две очереди: первичная и альтернативная
            this.pSideIdx = 0;      // индекс первичной очереди
        }

        /** Индекс альтернативной очереди */
        get sSideIdx() {
            return this.pSideIdx === 0 ? 1 : 0;
        }

        /** Добавление точки в указанную очередь */
        _addPoint(sideIdx, point) {
            const side = this.sides[sideIdx];
            if (side.length + 1 > this.fifoSize) {
                side.shift(); // удаляем самую старую точку
            }
            side.push(point);
        }

        /** Обновление статистики и выбор лучшей очереди */
        _updateStatistics() {
            const side0 = this.sides[0];
            const side1 = this.sides[1];

            if (side0.length !== this.fifoSize || side1.length !== this.fifoSize) {
                return; // недостаточно данных
            }

            // Средние дистанции
            const meanDst = [0, 0];
            for (let i = 0; i < this.fifoSize; i++) {
                meanDst[0] += side0[i].dist2Prev;
                meanDst[1] += side1[i].dist2Prev;
            }
            meanDst[0] /= this.fifoSize;
            meanDst[1] /= this.fifoSize;

            // Сигмы
            const sigmas = [0, 0];
            for (let i = 0; i < this.fifoSize; i++) {
                sigmas[0] += Math.pow(side0[i].dist2Prev - meanDst[0], 2);
                sigmas[1] += Math.pow(side1[i].dist2Prev - meanDst[1], 2);
            }
            sigmas[0] = Math.sqrt(sigmas[0]);
            sigmas[1] = Math.sqrt(sigmas[1]);

            // Выбираем очередь с меньшей сигмой
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

            // Обрезаем очереди до нового размера
            for (let i = 0; i < 2; i++) {
                while (this.sides[i].length > this.fifoSize) {
                    this.sides[i].shift();
                }
            }
        }

        /**
         * Обработка новой точки в декартовых координатах
         * @param {number} x - X, м (вперёд)
         * @param {number} y - Y, м (вправо)
         * @param {number} z - Z, м (глубина вниз)
         * @param {Date} ts - временная метка
         * @returns {{accepted: boolean, x: number, y: number, z: number, ts: Date|null}}
         */
        process(x, y, z, ts) {
            const primary = this.sides[this.pSideIdx];

            // Первая точка — всегда принимается
            if (primary.length === 0) {
                const point = new Point3DTd(x, y, z, ts);
                this._addPoint(this.pSideIdx, point);
                return { accepted: true, x, y, z, ts };
            }

            this._updateStatistics();

            const lastPoint = primary[primary.length - 1];
            const testPoint = new Point3DTd(x, y, z, ts, lastPoint);

            // Критерии принятия:
            // 1. Скорость не превышает максимальную (учёт времени)
            // 2. Дистанция меньше порога (защита от выбросов при малом времени)
            const speedOk = testPoint.dist2Prev < testPoint.time2Prev * this._maxSpeedMps;
            const thresholdOk = testPoint.dist2Prev < this.dstThreshold;

            if (speedOk || thresholdOk) {
                // Точка принята — в первичную очередь
                this._addPoint(this.pSideIdx, testPoint);
                return { accepted: true, x, y, z, ts };
            } else {
                // Точка отвергнута — в альтернативную очередь
                const altSide = this.sides[this.sSideIdx];
                const altLastPoint = altSide.length > 0 ? altSide[altSide.length - 1] : null;
                const altPoint = new Point3DTd(x, y, z, ts, altLastPoint);
                this._addPoint(this.sSideIdx, altPoint);
                return { accepted: false, x: NaN, y: NaN, z: NaN, ts: null };
            }
        }

        /** Сброс фильтра */
        reset() {
            this.sides = [[], []];
            this.pSideIdx = 0;
        }
    }

    // Экспорт в глобальную область
    window.DHTrackFilterXYZ = DHTrackFilterXYZ;

    return DHTrackFilterXYZ;

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DHTrackFilterXYZ;
}