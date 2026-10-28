const LEVEL_COLOR = { CRITICAL: '#e03434', HIGH: '#e07a1a', MEDIUM: '#c9a84c', LOW: '#16a870' };
export const gnnColor = (level) => LEVEL_COLOR[level] || 'var(--text-3)';
