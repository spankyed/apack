/**
 * Fuzzy search implementation inspired by VS Code's fuzzy scoring algorithm
 * Rewards: word starts, camel-case boundaries, contiguous matches
 * Penalizes: gaps between matches, distance from start
 */

import { escapeHtml } from '@apackdev/sdk/utils/pure'

export interface FuzzyMatch {
  score: number
  positions: number[] // Character positions that matched
}

export interface FuzzySearchResult<T> {
  item: T
  score: number
  positions: number[]
  matchRanges: Array<[number, number]> // For highlighting
}

// Scoring constants (VS Code heuristics)
const SCORE_EXACT_PREFIX_SAME_CASE = 7
const SCORE_EXACT_PREFIX_DIFF_CASE = 5
const SCORE_WORD_BOUNDARY = 5
const SCORE_CAMEL_CASE = 7
const SCORE_UPPER_CASE = 5
const SCORE_CONSECUTIVE = 1
const SCORE_GAP_NICE = -3  // Gap at word boundary
const SCORE_GAP_OTHER = -5 // Gap elsewhere
const SCORE_FULL_MATCH = 2

/**
 * Check if a character is uppercase
 */
function isUpperCase(char: string): boolean {
  return char === char.toUpperCase() && char !== char.toLowerCase()
}

/**
 * Check if this is a word boundary
 */
function isWordBoundary(str: string, index: number): boolean {
  if (index === 0) return true
  
  const curr = str[index]
  const prev = str[index - 1]
  
  // Previous char is separator
  if (/[\s\-_./\\]/.test(prev)) return true
  
  // CamelCase boundary
  if (!isUpperCase(prev) && isUpperCase(curr)) return true
  
  return false
}


/**
 * Fuzzy match a pattern against a target string
 */
function fuzzyMatch(pattern: string, target: string, filename?: string): FuzzyMatch | null {
  if (!pattern || !target) return null
  
  const patternLower = pattern.toLowerCase()
  const targetLower = target.toLowerCase()
  
  let patternIndex = 0
  let targetIndex = 0
  let score = 0
  let lastMatchIndex = -1
  const positions: number[] = []
  let consecutiveCount = 0
  
  // Check for exact prefix match
  if (targetLower.startsWith(patternLower)) {
    // Bonus for exact prefix
    if (target.startsWith(pattern)) {
      score += SCORE_EXACT_PREFIX_SAME_CASE * pattern.length
    } else {
      score += SCORE_EXACT_PREFIX_DIFF_CASE * pattern.length
    }
  }
  
  // Also check filename for exact prefix if provided
  if (filename) {
    const filenameLower = filename.toLowerCase()
    if (filenameLower.startsWith(patternLower)) {
      // Even bigger bonus for filename prefix match
      if (filename.startsWith(pattern)) {
        score += SCORE_EXACT_PREFIX_SAME_CASE * pattern.length * 2
      } else {
        score += SCORE_EXACT_PREFIX_DIFF_CASE * pattern.length * 2
      }
    }
  }
  
  // Try to match all pattern characters
  while (patternIndex < pattern.length && targetIndex < target.length) {
    if (patternLower[patternIndex] === targetLower[targetIndex]) {
      positions.push(targetIndex)
      
      // Base score
      let charScore = 0
      
      // Word boundary bonus
      if (isWordBoundary(target, targetIndex)) {
        charScore += SCORE_WORD_BOUNDARY
      }
      
      // Camel case / uppercase bonus
      if (isUpperCase(target[targetIndex])) {
        if (targetIndex > 0 && !isUpperCase(target[targetIndex - 1])) {
          charScore += SCORE_CAMEL_CASE
        } else {
          charScore += SCORE_UPPER_CASE
        }
      }
      
      // Consecutive match bonus
      if (lastMatchIndex === targetIndex - 1) {
        consecutiveCount++
        charScore += SCORE_CONSECUTIVE * consecutiveCount
      } else if (lastMatchIndex !== -1) {
        // Gap penalty
        const gap = targetIndex - lastMatchIndex - 1
        if (isWordBoundary(target, lastMatchIndex + 1)) {
          charScore += SCORE_GAP_NICE * gap
        } else {
          charScore += SCORE_GAP_OTHER * gap
        }
        consecutiveCount = 0
      }
      
      score += charScore
      lastMatchIndex = targetIndex
      patternIndex++
    }
    targetIndex++
  }
  
  // Did we match all pattern characters?
  if (patternIndex !== pattern.length) {
    return null
  }
  
  // Full string match bonus
  if (pattern.length === target.length && patternLower === targetLower) {
    score += SCORE_FULL_MATCH
  }
  
  // Additional filename exact match bonus
  if (filename && patternLower === filename.toLowerCase()) {
    score += 100 // Big bonus for exact filename match
  }
  
  return { score, positions }
}

/**
 * Convert match positions to ranges for highlighting
 */
function positionsToRanges(positions: number[]): Array<[number, number]> {
  if (positions.length === 0) return []
  
  const ranges: Array<[number, number]> = []
  let start = positions[0]
  let end = positions[0]
  
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] === end + 1) {
      // Consecutive match, extend range
      end = positions[i]
    } else {
      // Gap in matches, close current range and start new one
      ranges.push([start, end + 1])
      start = positions[i]
      end = positions[i]
    }
  }
  
  // Close final range
  ranges.push([start, end + 1])
  
  return ranges
}

/**
 * Search through items using fuzzy matching
 */
export function fuzzySearch<T>(
  pattern: string,
  items: readonly T[],
  getText: (item: T) => string,
  maxResults: number = 100,
  getFilename?: (item: T) => string
): FuzzySearchResult<T>[] {
  if (!pattern.trim()) {
    // Return all items when pattern is empty
    return items.slice(0, maxResults).map(item => ({
      item,
      score: 0,
      positions: [],
      matchRanges: []
    }))
  }
  
  const results: FuzzySearchResult<T>[] = []
  
  for (const item of items) {
    const text = getText(item)
    const filename = getFilename ? getFilename(item) : undefined
    const match = fuzzyMatch(pattern, text, filename)
    
    if (match) {
      results.push({
        item,
        score: match.score,
        positions: match.positions,
        matchRanges: positionsToRanges(match.positions)
      })
    }
  }
  
  // Sort by score (descending)
  results.sort((a, b) => b.score - a.score)
  
  // Return top results
  return results.slice(0, maxResults)
}

/**
 * `text` as HTML, escaped, with the matched ranges wrapped in a highlight span
 */
export function highlightMatches(
  text: string,
  ranges: Array<[number, number]>,
  highlightClass: string = 'fuzzy-match-highlight'
): string {
  let result = ''
  let lastEnd = 0
  
  for (const [start, end] of ranges) {
    // Add text before match
    result += escapeHtml(text.slice(lastEnd, start))
    // Add highlighted match
    result += `<span class="${highlightClass}">${escapeHtml(text.slice(start, end))}</span>`
    lastEnd = end
  }
  
  // Add remaining text
  result += escapeHtml(text.slice(lastEnd))
  
  return result
}