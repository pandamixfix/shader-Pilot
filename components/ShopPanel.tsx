






/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { WEAPON_STATS, UPGRADE_COSTS, UPGRADE_META, PlayerStats, WeaponType } from '../types';

export const ShopTab: React.FC = () => {
    const { playerStats, buyWeapon, buyUpgrade, equipWeapon } = useAppContext();
    const [shopSection, setShopSection] = useState<'weapons' | 'upgrades'>('weapons');

    // Calculate Discount Factor once
    const discountFactor = 1.0 - (playerStats.upgrades.discountLevel - 1) * 0.05;

    return (
        <div className="space-y-6">
             {/* Header Info */}
             <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700">
                <div>
                    <h3 className="text-sm font-semibold text-gray-300">Арсенал</h3>
                    <p className="text-xs text-gray-500">Тратьте кредиты на улучшение корабля.</p>
                </div>
                <div className="px-3 py-1 bg-yellow-900/40 border border-yellow-700/50 rounded-full">
                    <span className="text-yellow-400 font-mono font-bold text-sm">{playerStats.credits} CR</span>
                </div>
            </div>

            {/* Sub Tabs */}
            <div className="flex p-1 bg-gray-900/50 rounded-lg border border-gray-700">
                <button 
                    onClick={() => setShopSection('weapons')}
                    className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${shopSection === 'weapons' ? 'bg-cyan-900/40 text-cyan-300 shadow-sm' : 'text-gray-400 hover:text-white'}`}
                >
                    Оружие
                </button>
                <button 
                    onClick={() => setShopSection('upgrades')}
                    className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${shopSection === 'upgrades' ? 'bg-purple-900/40 text-purple-300 shadow-sm' : 'text-gray-400 hover:text-white'}`}
                >
                    Улучшения
                </button>
            </div>

            {/* Content Area */}
            <div className="min-h-[300px]">
                {shopSection === 'weapons' ? (
                    <div className="grid grid-cols-1 gap-3 animate-fadeIn">
                        {(Object.keys(WEAPON_STATS) as WeaponType[]).map(type => {
                            const stats = WEAPON_STATS[type];
                            const isOwned = playerStats.unlockedWeapons.includes(type);
                            const isEquipped = playerStats.currentWeapon === type;
                            const finalCost = Math.floor(stats.cost * discountFactor);
                            const canAfford = playerStats.credits >= finalCost;

                            return (
                                <div key={type} className={`relative p-3 rounded-lg border transition-all ${isEquipped ? 'bg-cyan-900/20 border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.15)]' : 'bg-gray-800/50 border-gray-700'}`}>
                                    <div className="flex justify-between items-start mb-1">
                                        <h4 className={`font-bold text-sm ${isEquipped ? 'text-cyan-300' : 'text-gray-200'}`}>{stats.name}</h4>
                                        {isOwned && isEquipped && <span className="text-[10px] font-bold bg-cyan-600 text-white px-1.5 py-0.5 rounded">АКТИВНО</span>}
                                    </div>
                                    <p className="text-xs text-gray-400 mb-3">{stats.description}</p>
                                    
                                    <div className="space-y-1 mb-3 text-xs font-mono text-gray-500">
                                        <div className="flex justify-between"><span>Урон</span> <span className="text-gray-300">{stats.baseDamage}</span></div>
                                        <div className="flex justify-between"><span>Скор.</span> <span className="text-gray-300">{(1/stats.fireRate).toFixed(1)}/s</span></div>
                                    </div>

                                    {isOwned ? (
                                        <button 
                                            onClick={() => equipWeapon(type)}
                                            disabled={isEquipped}
                                            className={`w-full py-1.5 rounded font-semibold text-xs transition-colors ${isEquipped ? 'bg-gray-700 text-gray-500 cursor-default' : 'bg-cyan-700 hover:bg-cyan-600 text-white'}`}
                                        >
                                            {isEquipped ? 'В руках' : 'Взять'}
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={() => buyWeapon(type)}
                                            disabled={!canAfford}
                                            className={`w-full py-1.5 rounded font-semibold text-xs transition-colors flex justify-between px-3 ${canAfford ? 'bg-green-700 hover:bg-green-600 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                        >
                                            <span>Купить</span>
                                            <span className={finalCost < stats.cost ? "text-yellow-300" : ""}>{finalCost} CR</span>
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fadeIn pb-4">
                        {(Object.keys(UPGRADE_META) as Array<keyof PlayerStats['upgrades']>).map((key) => {
                            const meta = UPGRADE_META[key];
                            const currentLevel = playerStats.upgrades[key];
                            const baseCost = UPGRADE_COSTS[key](currentLevel);
                            const finalCost = Math.floor(baseCost * discountFactor);

                            return (
                                <UpgradeCard 
                                    key={key}
                                    label={meta.name} 
                                    level={currentLevel} 
                                    maxLevel={meta.max} 
                                    cost={finalCost} 
                                    credits={playerStats.credits}
                                    onBuy={() => buyUpgrade(key)}
                                    description={meta.description}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

const UpgradeCard: React.FC<{
    label: string;
    level: number;
    maxLevel: number;
    cost: number;
    credits: number;
    onBuy: () => void;
    description: string;
}> = ({ label, level, maxLevel, cost, credits, onBuy, description }) => {
    const isMaxed = level >= maxLevel;
    const canAfford = credits >= cost;

    return (
        <div className="bg-gray-800/50 border border-gray-700 p-3 rounded-lg flex flex-col h-full">
            <div className="flex justify-between items-start mb-1">
                <h4 className="font-bold text-sm text-gray-200 truncate pr-2" title={label}>{label}</h4>
                <span className="text-xs font-mono text-purple-400 whitespace-nowrap">Ур {level}</span>
            </div>
            <p className="text-xs text-gray-500 mb-3 flex-grow leading-tight">{description}</p>
            
            <div className="w-full bg-gray-700 h-1.5 rounded-full mb-3 overflow-hidden">
                <div className="bg-purple-500 h-full transition-all" style={{ width: `${(level / maxLevel) * 100}%` }} />
            </div>

            <button
                onClick={onBuy}
                disabled={isMaxed || !canAfford}
                className={`w-full py-1.5 rounded font-semibold text-xs transition-colors flex justify-between px-3 mt-auto ${
                    isMaxed 
                        ? 'bg-gray-700 text-gray-400 cursor-default' 
                        : canAfford 
                            ? 'bg-purple-700 hover:bg-purple-600 text-white' 
                            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
            >
                {isMaxed ? (
                    <span className="mx-auto">МАКС</span>
                ) : (
                    <>
                        <span>Улучшить</span>
                        <span>{cost} CR</span>
                    </>
                )}
            </button>
        </div>
    );
}