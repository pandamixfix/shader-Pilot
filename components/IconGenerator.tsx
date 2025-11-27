
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef } from 'react';

export const IconGenerator: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const generateIcon = (size: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Resize canvas for generation
        canvas.width = size;
        canvas.height = size;

        const cx = size / 2;
        const cy = size / 2;

        // 1. Background (Dark Tech)
        const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size);
        bgGrad.addColorStop(0, '#1f2937'); // Gray 800
        bgGrad.addColorStop(1, '#111827'); // Gray 900
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, size, size);

        // 2. Glow
        const glowGrad = ctx.createRadialGradient(cx, cy, size * 0.1, cx, cy, size * 0.6);
        glowGrad.addColorStop(0, 'rgba(6, 182, 212, 0.4)'); // Cyan glow
        glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glowGrad;
        ctx.fillRect(0, 0, size, size);

        // 3. Abstract Ship Shape (Triangle fractal-ish)
        ctx.save();
        ctx.translate(cx, cy);
        const scale = size * 0.5;
        
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = size * 0.05;
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = size * 0.03;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.beginPath();
        // Main body
        ctx.moveTo(0, -scale * 0.6);
        ctx.lineTo(scale * 0.5, scale * 0.4);
        ctx.lineTo(0, scale * 0.25);
        ctx.lineTo(-scale * 0.5, scale * 0.4);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = 'rgba(34, 211, 238, 0.2)';
        ctx.fill();

        // Inner detail
        ctx.beginPath();
        ctx.moveTo(0, -scale * 0.2);
        ctx.lineTo(scale * 0.15, scale * 0.3);
        ctx.lineTo(-scale * 0.15, scale * 0.3);
        ctx.closePath();
        ctx.fillStyle = '#cdfefe';
        ctx.fill();

        ctx.restore();

        // 4. Download
        const link = document.createElement('a');
        link.download = `icon-${size}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    return (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700 space-y-3">
            <h4 className="text-sm font-semibold text-gray-200">Генератор иконок (PWA)</h4>
            <p className="text-xs text-gray-400">
                Создайте иконки для manifest.json, чтобы установить игру как приложение.
            </p>
            <div className="flex gap-2">
                <button 
                    onClick={() => generateIcon(192)}
                    className="px-3 py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded transition-colors"
                >
                    Скачать 192x192
                </button>
                <button 
                    onClick={() => generateIcon(512)}
                    className="px-3 py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded transition-colors"
                >
                    Скачать 512x512
                </button>
            </div>
            {/* Hidden canvas for rendering */}
            <canvas ref={canvasRef} className="hidden" />
        </div>
    );
};
