import { surfaceStorage } from '@apackdev/sdk/fe'
import { ref as featureRef } from '#generated/ref.ts'

/** This surface's window storage: the prefix is its ref, so these names are scoped to it. */
const storage = surfaceStorage(featureRef('code'))
/**
 * Utility for managing recently opened files
 */

interface RecentFile {
  path: string
  timestamp: number
}

const MAX_RECENT_FILES = 50

/**
 * Recent files are per project: opening a different directory must not rank the previous
 * project's files, and coming back must restore the list this project earned. An empty
 * base directory (before the backend reports one) keeps the unscoped key.
 */
function storedAs(baseDirectory: string): string {
  return baseDirectory ? `recent-files:${baseDirectory}` : 'recent-files'
}

/**
 * Load recently opened files from this surface's storage
 */
export function loadRecentFiles(baseDirectory: string): string[] {
  try {
    const stored = storage.get(storedAs(baseDirectory))
    if (!stored) return []
    
    const recentFiles: RecentFile[] = JSON.parse(stored)
    if (!Array.isArray(recentFiles)) return []
    
    // Sort by timestamp (most recent first) and return just paths
    return recentFiles
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(f => f.path)
      .slice(0, MAX_RECENT_FILES)
  } catch (error) {
    console.error('Failed to load recent files:', error)
    return []
  }
}

/**
 * Save recently opened files to this surface's storage
 */
function saveRecentFiles(recentFiles: string[], baseDirectory: string): void {
  try {
    const timestampedFiles: RecentFile[] = recentFiles.map((path, index) => ({
      path,
      // Use inverse index to maintain order (most recent = highest timestamp)
      timestamp: Date.now() - index
    }))
    
    storage.set(storedAs(baseDirectory), JSON.stringify(timestampedFiles))
  } catch (error) {
    console.error('Failed to save recent files:', error)
  }
}

/**
 * Add a file to the recent files list
 */
export function addRecentFile(recentFiles: string[], filePath: string, baseDirectory: string): string[] {
  // Remove the file if it already exists (we'll add it to the front)
  const filtered = recentFiles.filter(path => path !== filePath)
  
  // Add to the beginning and limit size
  const updated = [filePath, ...filtered].slice(0, MAX_RECENT_FILES)
  
  // Save to this surface's storage
  saveRecentFiles(updated, baseDirectory)
  
  return updated
}

/**
 * Get recency score for a file (higher = more recent)
 */
export function getRecencyScore(recentFiles: readonly string[], filePath: string): number {
  const index = recentFiles.indexOf(filePath)
  if (index === -1) return 0
  
  // Score from 100 (most recent) down to 2 (least recent)
  // This ensures recent files get a noticeable boost without overwhelming exact matches
  const maxScore = 100
  const minScore = 2
  const score = maxScore - (index * (maxScore - minScore) / Math.min(recentFiles.length - 1, MAX_RECENT_FILES - 1))
  
  return Math.max(score, minScore)
}