/**
 * Recent Items Tracking Utility
 * Manages recently accessed projects and rundowns in localStorage
 */

const RECENT_ITEMS_KEY = 'ol-grafik-recent-items';
const MAX_RECENT_ITEMS = 10;

export interface RecentItem {
  type: 'rundown' | 'project';
  projectId: string;
  projectName: string;
  rundownId?: string;
  rundownName?: string;
  lastAccessed: number;
  itemCount?: number; // for rundowns
}

/**
 * Get all recent items, sorted by last accessed (newest first)
 * Returns only rundowns (filters out project-only entries)
 */
export function getRecentItems(): RecentItem[] {
  try {
    const stored = localStorage.getItem(RECENT_ITEMS_KEY);
    if (!stored) {
      return [];
    }

    const items: RecentItem[] = JSON.parse(stored);

    // Filter to only show rundowns (not standalone projects)
    const rundownsOnly = items.filter(item => item.type === 'rundown');

    // Sort by lastAccessed descending
    return rundownsOnly.sort((a, b) => b.lastAccessed - a.lastAccessed);
  } catch (error) {
    console.error('Failed to load recent items:', error);
    return [];
  }
}

/**
 * Add or update a recent project access
 */
export function trackProjectAccess(projectId: string, projectName: string): void {
  try {
    const items = getRecentItems();
    
    // Remove existing entry for this project
    const filtered = items.filter(item => 
      !(item.type === 'project' && item.projectId === projectId)
    );
    
    // Add new entry at the top
    const newItem: RecentItem = {
      type: 'project',
      projectId,
      projectName,
      lastAccessed: Date.now()
    };
    
    filtered.unshift(newItem);
    
    // Keep only MAX_RECENT_ITEMS
    const trimmed = filtered.slice(0, MAX_RECENT_ITEMS);
    
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error('Failed to track project access:', error);
  }
}

/**
 * Add or update a recent rundown access
 */
export function trackRundownAccess(
  projectId: string,
  projectName: string,
  rundownId: string,
  rundownName: string,
  itemCount?: number
): void {
  try {
    const items = getRecentItems();
    
    // Remove existing entry for this rundown
    const filtered = items.filter(item => 
      !(item.type === 'rundown' && item.projectId === projectId && item.rundownId === rundownId)
    );
    
    // Add new entry at the top
    const newItem: RecentItem = {
      type: 'rundown',
      projectId,
      projectName,
      rundownId,
      rundownName,
      itemCount,
      lastAccessed: Date.now()
    };
    
    filtered.unshift(newItem);
    
    // Keep only MAX_RECENT_ITEMS
    const trimmed = filtered.slice(0, MAX_RECENT_ITEMS);
    
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error('Failed to track rundown access:', error);
  }
}

/**
 * Clear all recent items
 */
export function clearRecentItems(): void {
  try {
    localStorage.removeItem(RECENT_ITEMS_KEY);
  } catch (error) {
    console.error('Failed to clear recent items:', error);
  }
}

/**
 * Format a timestamp as a relative time string
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  
  if (seconds < 60) {
    return 'Just now';
  } else if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  } else if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  } else if (days < 7) {
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  } else if (weeks < 4) {
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  } else if (months < 12) {
    return `${months} month${months !== 1 ? 's' : ''} ago`;
  } else {
    const years = Math.floor(months / 12);
    return `${years} year${years !== 1 ? 's' : ''} ago`;
  }
}

