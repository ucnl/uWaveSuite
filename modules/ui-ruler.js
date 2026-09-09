// modules/ui-ruler.js — Линейка для uWaveSuite
// Адаптировано под UIMap

const UIRuler = (() => {

    // ========== СОСТОЯНИЕ ==========
	let canvas = null;
	let ctx = null;
	let isActive = false;	
	let points = [];
	let listeners = [];
	let mouseX = null;
	let mouseY = null;
    
    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    
    function init(canvasId = 'map-canvas') {
        canvas = document.getElementById(canvasId);
        if (!canvas) return;
        
        ctx = canvas.getContext('2d');
    }
    
    // ========== УПРАВЛЕНИЕ ==========
    
    function toggle() {
        if (isActive) {
            stop();
        } else {
            start();
        }
    }
    
    function start() {
        isActive = true;
        points = [];
        notifyListeners('started');
    }
    
    function stop() {
        isActive = false;
        points = [];
        notifyListeners('stopped');
    }
    
    function clear() {
        points = [];
        notifyListeners('cleared');
    }
    
    function isRulerActive() {
        return isActive;
    }
    
    function getPoints() {
        return points;
    }
    
    function getPointsCount() {
        return points.length;
    }
    
    // ========== ОБРАБОТКА СОБЫТИЙ ==========
    
	function handleClick(e) {
		if (!isActive) return;
		
		if (points.length >= 2) {
			points = [];
		}
		
		const rect = canvas.getBoundingClientRect();
		const screenX = e.clientX - rect.left;
		const screenY = e.clientY - rect.top;
		
		if (typeof UIMap !== 'undefined' && UIMap.screenToWorld) {
			const world = UIMap.screenToWorld(screenX, screenY);
			points.push(world);
		} else {
			points.push({ x: screenX, y: screenY });
		}
		
		notifyListeners('pointAdded', points[points.length - 1]);
		
		if (points.length === 2) {
			const distance = calculateDistance();
			notifyListeners('measurementComplete', { points, distance });
		}
	}
    
	function handleMouseMove(e) {
		if (!isActive || points.length !== 1) {
			mouseX = null;
			mouseY = null;
			return;
		}
		
		const rect = canvas.getBoundingClientRect();
		mouseX = e.clientX - rect.left;
		mouseY = e.clientY - rect.top;
	}
    
    // ========== ВЫЧИСЛЕНИЯ ==========
    
    function calculateDistance() {
        if (points.length < 2) return 0;
        
        const p1 = points[0];
        const p2 = points[1];
        
        // Если есть мировые координаты (метры)
        if (p1.x !== undefined && p1.y !== undefined) {
            return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
        }
        
        return 0;
    }
    
    // ========== ОТРИСОВКА ==========
    
	function draw() {
		if (!ctx || points.length === 0) return;
		
		// Рисуем точки
		for (const point of points) {
			let screenX, screenY;
			
			if (typeof UIMap !== 'undefined' && UIMap.worldToScreen) {
				const screen = UIMap.worldToScreen(point.x, point.y);
				screenX = screen.x;
				screenY = screen.y;
			} else {
				screenX = point.x;
				screenY = point.y;
			}
			
			ctx.fillStyle = '#ff4444';
			ctx.beginPath();
			ctx.arc(screenX, screenY, 5, 0, Math.PI * 2);
			ctx.fill();
			
			ctx.strokeStyle = '#ffffff';
			ctx.lineWidth = 1;
			ctx.stroke();
		}
		
		// Рисуем линию
		if (points.length === 2) {
			let screen1, screen2;
			
			if (typeof UIMap !== 'undefined' && UIMap.worldToScreen) {
				screen1 = UIMap.worldToScreen(points[0].x, points[0].y);
				screen2 = UIMap.worldToScreen(points[1].x, points[1].y);
			} else {
				screen1 = points[0];
				screen2 = points[1];
			}
			
			ctx.strokeStyle = '#ff4444';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(screen1.x, screen1.y);
			ctx.lineTo(screen2.x, screen2.y);
			ctx.stroke();
			
			const distance = calculateDistance();
			const midX = (screen1.x + screen2.x) / 2;
			const midY = (screen1.y + screen2.y) / 2;
			
			ctx.fillStyle = '#ff4444';
			ctx.font = '12px monospace';
			ctx.fillText(`${distance.toFixed(1)} м`, midX + 10, midY - 10);
		}
		
		// Рисуем резиновую линию
		if (points.length === 1 && mouseX !== null && mouseY !== null) {
			let startScreen;
			
			if (typeof UIMap !== 'undefined' && UIMap.worldToScreen) {
				startScreen = UIMap.worldToScreen(points[0].x, points[0].y);
			} else {
				startScreen = points[0];
			}
			
			ctx.strokeStyle = '#ff8888';
			ctx.lineWidth = 1;
			ctx.setLineDash([5, 5]);
			ctx.beginPath();
			ctx.moveTo(startScreen.x, startScreen.y);
			ctx.lineTo(mouseX, mouseY);
			ctx.stroke();
			ctx.setLineDash([]);
		}
	}
	
    function drawRubberLine(e) {
        if (!ctx || points.length !== 1) return;
        
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        
        let startScreen;
        
        if (typeof UIMap !== 'undefined' && UIMap.worldToScreen) {
            startScreen = UIMap.worldToScreen(points[0].x, points[0].y);
        } else {
            startScreen = points[0];
        }
        
        ctx.strokeStyle = '#ff8888';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(startScreen.x, startScreen.y);
        ctx.lineTo(screenX, screenY);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // ========== ПОДПИСКА ==========
    
    function subscribe(listener) {
        listeners.push(listener);
        return () => {
            listeners = listeners.filter(l => l !== listener);
        };
    }
    
    function notifyListeners(event, data = {}) {
        for (const listener of listeners) {
            try {
                listener(event, data);
            } catch (e) {
                console.warn('[UIRuler] Ошибка слушателя:', e.message);
            }
        }
    }
    
    // ========== ПУБЛИЧНЫЙ API ==========
    
	 return {
		init,
		toggle,
		start,
		stop,
		clear,
		isRulerActive,
		getPoints,
		getPointsCount,
		draw,
		handleClick,
		handleMouseMove,
		subscribe
	};
    
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIRuler;
}