/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import { useAppContext } from '../context/AppContext';

export const GameOverScreen: React.FC = () => {
    const { isGameOver, restartGame, playerStats } = useAppContext();

    if (!isGameOver) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fadeIn">
            <div className="bg-gray-900 border border-red-900/50 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center relative overflow-hidden">
                {/* Red pulse background effect */}
                <div className="absolute inset-0 bg-red-500/10 animate-pulse pointer-events-none"></div>
                
                <h2 className="text-4xl font-black text-red-500 mb-2 tracking-wider relative z-10">ИГРА ОКОНЧЕНА</h2>
                <p className="text-gray-400 mb-6 relative z-10">Ваш корабль был уничтожен.</p>
                
                <div className="bg-gray-800/50 rounded-lg p-4 mb-8 border border-gray-700 relative z-10">
                    <p className="text-sm text-gray-400 uppercase tracking-widest mb-1">Финальный счет (Кредиты)</p>
                    <p className="text-3xl font-mono text-yellow-400">{playerStats.credits}</p>
                </div>

                <button
                    onClick={restartGame}
                    className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg transition-all transform hover:scale-105 shadow-lg shadow-red-900/20 relative z-10"
                >
                    ВОЗРОДИТЬСЯ
                </button>
            </div>
        </div>
    );
};