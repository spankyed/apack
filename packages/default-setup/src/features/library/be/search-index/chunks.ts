// The text a search index embeds for a document: the whole document, or what its segment rules pick, filled into its
// template, and with a rule marked `separate` one chunk per item. Each becomes an IndexedDoc row whose text the
// vector index embeds.
import type { SearchIndexConfig, Occurrence } from './types/search-index.ts'
import type { ContentSection } from '../types.ts'
import { fillSegments } from '../../segment-template.ts'

/**
 * Parse occurrence string to typed Occurrence
 */
function parseOccurrence(value: string): Occurrence {
  const trimmed = value.trim().toLowerCase()
  
  if (trimmed === 'first' || trimmed === 'last' || trimmed === 'all') {
    return trimmed as 'first' | 'last' | 'all'
  }
  
  const single = /^(\d+)$/.exec(trimmed)
  if (single) return { index: parseInt(single[1]) }
  
  const range = /^(\d+)-(\d+)$/.exec(trimmed)
  if (range) return { from: parseInt(range[1]), to: parseInt(range[2]) }
  
  return 'all'
}

/**
 * Apply occurrence filter to sections
 */
function applyOccurrence<T>(items: T[], occurrence: Occurrence): T[] {
  if (occurrence === 'first') return items.slice(0, 1)
  if (occurrence === 'last') return items.slice(-1)
  if (occurrence === 'all') return items
  
  if ('index' in occurrence) {
    const idx = occurrence.index - 1 // Convert to 0-indexed
    return idx >= 0 && idx < items.length ? [items[idx]] : []
  }
  
  if ('from' in occurrence && 'to' in occurrence) {
    return items.slice(occurrence.from - 1, occurrence.to)
  }
  
  return items
}

/**
 * Convert content section to text
 */
function sectionToText(section: ContentSection, key?: string): string {
  switch (section.type) {
    case 'markdown':
    case 'text':
      return section.text
    case 'list':
      return section.items.join(', ')
    case 'field':
      if (key) {
        const field = section.fields.find(f => f.key === key)
        return field?.value || ''
      }
      return section.fields.map(f => `${f.key}: ${f.value}`).join('; ')
    default:
      return ''
  }
}

/**
 * Extract matching sections based on criteria
 */
function extractMatchingSections(
  sections: ContentSection[],
  type: 'markdown' | 'text' | 'list' | 'field',
  occurrence: Occurrence,
  key?: string
): ContentSection[] {
  const matching = sections.filter(section => {
    if (section.type !== type) return false
    if (type === 'field' && key && section.type === 'field') {
      return section.fields.some(f => f.key === key)
    }
    return true
  })
  
  return applyOccurrence(matching, occurrence)
}

/**
 * Process document content for single indexing
 */
export function processDocumentContent(
  content: ContentSection[],
  config: SearchIndexConfig
): string {
  if (!config.enableSectionIndexing || !config.segmentRules.length) {
    const firstText = content.length > 0 ? sectionToText(content[0]) : ''
    const result = fillSegments(config.constructTemplate || '{{segment 1}}', n => (n === 1 ? firstText : undefined))
    return result.trim() || firstText
  }
  
  const segments = config.segmentRules.map(rule => {
    const occurrence = parseOccurrence(rule.occurrence)
    const sections = extractMatchingSections(content, rule.type, occurrence, rule.key)
    return sections.map(s => sectionToText(s, rule.key)).join(' ')
  })
  
  return fillSegments(config.constructTemplate, n => segments[n - 1])
}

/**
 * The text of the segment `{{segment n}}` names, 1-based, or nothing when no rule carries that number.
 *
 * Every item, not the first. A combined rule already arrives as one joined string, so this only shows for a
 * rule marked `separate` that is not the one being expanded — chunk identity is `seg<i>-item<j>`, so only one
 * rule can expand, and the rest have to be combined rather than silently reduced to their first item.
 */
function textOf(segments: { index: number, items: string[] }[], n: number): string | undefined {
  return segments.find(segment => segment.index + 1 === n)?.items.join(' ')
}

/**
 * Process document content for multi-indexing (separate chunks)
 */
export function processDocumentContentMultiIndex(
  content: ContentSection[],
  config: SearchIndexConfig
): Array<{text: string, segmentIndex: number, itemIndex?: number}> {
  if (!config.enableSectionIndexing || !config.segmentRules.length) {
    return [{text: processDocumentContent(content, config), segmentIndex: 0}]
  }
  
  const results: Array<{text: string, segmentIndex: number, itemIndex?: number}> = []
  const template = config.constructTemplate
  
  // Process rules and collect segment data
  const segmentData = config.segmentRules.map((rule, index) => {
    const occurrence = parseOccurrence(rule.occurrence)
    const sections = extractMatchingSections(content, rule.type, occurrence, rule.key)
    const shouldSeparate = (rule.type === 'list' || rule.type === 'field') && 
                          rule.indexMode === 'separate'
    
    if (!shouldSeparate) {
      return {
        index,
        items: [sections.map(s => sectionToText(s, rule.key)).join(' ')],
        separate: false
      }
    }
    
    // Extract individual items for separate indexing
    const items: string[] = []
    sections.forEach(section => {
      if (rule.type === 'list' && section.type === 'list') {
        items.push(...section.items)
      } else if (rule.type === 'field' && section.type === 'field') {
        if (rule.key) {
          const field = section.fields.find(f => f.key === rule.key)
          if (field) items.push(field.value)
        } else {
          items.push(...section.fields.map(f => `${f.key}: ${f.value}`))
        }
      }
    })
    
    return { index, items, separate: true }
  })
  
  // Find which segment should be separated
  const separateSegment = segmentData.find(s => s.separate && s.items.length > 0)
  
  if (!separateSegment) {
    // No separation needed, return single result
    const text = fillSegments(template, n => textOf(segmentData, n))
    return [{text, segmentIndex: 0}]
  }
  
  // Generate combinations for separated items
  separateSegment.items.forEach((item, itemIndex) => {
    const text = fillSegments(template, n =>
      (n === separateSegment.index + 1 ? item : textOf(segmentData, n)))
    results.push({
      text,
      segmentIndex: separateSegment.index,
      itemIndex
    })
  })
  
  return results.length ? results : [{text: processDocumentContent(content, config), segmentIndex: 0}]
}
