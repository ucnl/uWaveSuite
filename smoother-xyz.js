// smoother-xyz.js — Сглаживатели для декартовых координат (XYZ)

const TrackMovingAverageSmootherXYZ = (() => {
    
    class TrackMovingAverageSmootherXYZ {
        constructor(fifoSize = 4, thresholdM = 100.0) {
            this.fifoSize = fifoSize;
            this.thresholdM = thresholdM;
            this.buffer = []; // [{x, y, z, ts}]
        }

        process(x, y, z, ts) {
            // Если буфер пуст — просто добавляем
            if (this.buffer.length === 0) {
                this.buffer.push({ x, y, z, ts });
                return { x, y, z, ts };
            }

            const last = this.buffer[this.buffer.length - 1];
            const dx = x - last.x;
            const dy = y - last.y;
            const dz = z - last.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // Если скачок больше порога — сбрасываем буфер
            if (dist > this.thresholdM) {
                this.buffer = [{ x, y, z, ts }];
                return { x: last.x, y: last.y, z: last.z, ts: last.ts }; // возвращаем последнюю валидную
            }

            // Добавляем в буфер
            this.buffer.push({ x, y, z, ts });
            if (this.buffer.length > this.fifoSize) {
                this.buffer.shift();
            }

            // Скользящее среднее
            let sumX = 0, sumY = 0, sumZ = 0;
            for (const p of this.buffer) {
                sumX += p.x;
                sumY += p.y;
                sumZ += p.z;
            }
            const n = this.buffer.length;
            return { x: sumX / n, y: sumY / n, z: sumZ / n, ts };
        }

        reset() {
            this.buffer = [];
        }
    }

    window.TrackMovingAverageSmootherXYZ = TrackMovingAverageSmootherXYZ;
    return TrackMovingAverageSmootherXYZ;

})();


const TrackMedianFilterXYZ = (() => {
    
    class TrackMedianFilterXYZ {
        constructor(fifoSize = 4, thresholdM = 100.0) {
            this.fifoSize = (fifoSize % 2 === 0) ? fifoSize + 1 : fifoSize;
			this.thresholdM = thresholdM;
			this.buffer = [];
        }

        process(x, y, z, ts) {
            if (this.buffer.length === 0) {
                this.buffer.push({ x, y, z, ts });
                return { x, y, z, ts };
            }

            const last = this.buffer[this.buffer.length - 1];
            const dx = x - last.x;
            const dy = y - last.y;
            const dz = z - last.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist > this.thresholdM) {
                this.buffer = [{ x, y, z, ts }];
				return { x, y, z, ts };
            }

            this.buffer.push({ x, y, z, ts });
            if (this.buffer.length > this.fifoSize) {
                this.buffer.shift();
            }

            // Медиана по каждой координате отдельно
            const sortedX = [...this.buffer].sort((a, b) => a.x - b.x);
            const sortedY = [...this.buffer].sort((a, b) => a.y - b.y);
            const sortedZ = [...this.buffer].sort((a, b) => a.z - b.z);
            
            const mid = Math.floor(this.buffer.length / 2);
            
            let medX, medY, medZ;
            if (this.buffer.length % 2 === 0) {
                medX = (sortedX[mid - 1].x + sortedX[mid].x) / 2;
                medY = (sortedY[mid - 1].y + sortedY[mid].y) / 2;
                medZ = (sortedZ[mid - 1].z + sortedZ[mid].z) / 2;
            } else {
                medX = sortedX[mid].x;
                medY = sortedY[mid].y;
                medZ = sortedZ[mid].z;
            }

            return { x: medX, y: medY, z: medZ, ts };
        }

        reset() {
            this.buffer = [];
        }
    }

    window.TrackMedianFilterXYZ = TrackMedianFilterXYZ;
    return TrackMedianFilterXYZ;

})();