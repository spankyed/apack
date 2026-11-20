import * as fs from 'fs/promises'
import * as path from 'path'
import { spawn, execFile } from 'child_process'
import { rgPath } from '@vscode/ripgrep'
import type { FileInfo, DirectoryContent, FileContent, CodeSystemError, SearchOptions, SearchResult, QuickOpenResult } from '../types.ts'
import { createLogger } from '@apackdev/sdk/logger'
import { decodeNdjson } from './claude-code/ndjson.ts'

const logger = createLogger('filesystem')

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v'])

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
}

export class FileSystemRepository {
  private projectRoot: string
  
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }
  private validatePath(filePath: string): string {
    const normalizedPath = path.normalize(filePath)
    const absolutePath = path.isAbsolute(normalizedPath) 
      ? normalizedPath 
      : path.join(this.projectRoot, normalizedPath)
    
    // const relativePath = path.relative(PROJECT_ROOT, absolutePath)

    // if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    //   throw this.createError('INVALID_PATH', 'Access denied: Path is outside project directory', filePath)
    // }

    // Allow access to any path on the system
    return absolutePath
  }

  private createError(code: CodeSystemError['code'], message: string, filePath?: string): Error {
    const error = new Error(message) as Error & { code: string; path?: string }
    error.code = code
    if (filePath) error.path = filePath
    return error
  }

  async listDirectory(dirPath: string): Promise<DirectoryContent> {
    try {
      const validPath = this.validatePath(dirPath)
      const entries = await fs.readdir(validPath, { withFileTypes: true })
      
      const files: FileInfo[] = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(validPath, entry.name)
          
          if (entry.isDirectory()) {
            return {
              name: entry.name,
              path: fullPath,
              type: 'directory' as const,
            }
          } else {
            const stats = await fs.stat(fullPath)
            return {
              name: entry.name,
              path: fullPath,
              type: 'file' as const,
              size: stats.size,
              modifiedAt: stats.mtime,
              extension: path.extname(entry.name).slice(1),
            }
          }
        })
      )
      
      files.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
      
      return {
        path: validPath,
        files,
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw this.createError('NOT_FOUND', 'Directory not found', dirPath)
      }
      if (error.code === 'EACCES') {
        throw this.createError('PERMISSION_DENIED', 'Permission denied', dirPath)
      }
      if (error.code === 'INVALID_PATH') {
        throw error
      }
      throw this.createError('IO_ERROR', error.message, dirPath)
    }
  }

  async readFile(filePath: string): Promise<FileContent> {
    try {
      const validPath = this.validatePath(filePath)
      const stats = await fs.stat(validPath)
      
      if (stats.isDirectory()) {
        throw this.createError('IO_ERROR', 'Cannot read directory as file', filePath)
      }
      
      const ext = path.extname(validPath).slice(1).toLowerCase()

      if (VIDEO_EXTENSIONS.has(ext)) {
        return {
          path: validPath,
          content: '',
          encoding: 'utf-8',
          size: stats.size,
          isVideo: true,
        }
      }

      if (stats.size > MAX_FILE_SIZE) {
        throw this.createError('FILE_TOO_LARGE', `File size exceeds ${MAX_FILE_SIZE} bytes`, filePath)
      }

      const mimeType = IMAGE_MIME_TYPES[ext]

      if (mimeType) {
        const buffer = await fs.readFile(validPath)
        const base64 = buffer.toString('base64')
        return {
          path: validPath,
          content: `data:${mimeType};base64,${base64}`,
          encoding: 'base64',
          size: stats.size,
        }
      }

      const content = await fs.readFile(validPath, 'utf-8')
      const isBinary = content.includes('\0')

      return {
        path: validPath,
        content: isBinary ? '' : content,
        encoding: 'utf-8',
        size: stats.size,
        ...(isBinary && { isBinary: true }),
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw this.createError('NOT_FOUND', 'File not found', filePath)
      }
      if (error.code === 'EACCES') {
        throw this.createError('PERMISSION_DENIED', 'Permission denied', filePath)
      }
      if (error.code === 'EISDIR') {
        throw this.createError('IO_ERROR', 'Path is a directory, not a file', filePath)
      }
      if (error.code === 'FILE_TOO_LARGE' || error.code === 'INVALID_PATH' || error.code === 'IO_ERROR') {
        throw error
      }
      throw this.createError('IO_ERROR', error.message, filePath)
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      const validPath = this.validatePath(filePath)
      await fs.mkdir(path.dirname(validPath), { recursive: true })
      await fs.writeFile(validPath, content, 'utf-8')
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw this.createError('PERMISSION_DENIED', 'Permission denied', filePath)
      }
      if (error.code === 'INVALID_PATH') {
        throw error
      }
      throw this.createError('IO_ERROR', error.message, filePath)
    }
  }

  async createDirectory(dirPath: string): Promise<void> {
    try {
      const validPath = this.validatePath(dirPath)
      await fs.mkdir(validPath, { recursive: true })
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw this.createError('PERMISSION_DENIED', 'Permission denied', dirPath)
      }
      if (error.code === 'INVALID_PATH') {
        throw error
      }
      throw this.createError('IO_ERROR', error.message, dirPath)
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      const validPath = this.validatePath(filePath)
      const stats = await fs.stat(validPath)
      
      if (stats.isDirectory()) {
        await fs.rm(validPath, { recursive: true, force: true })
      } else {
        await fs.unlink(validPath)
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw this.createError('NOT_FOUND', 'File not found', filePath)
      }
      if (error.code === 'EACCES') {
        throw this.createError('PERMISSION_DENIED', 'Permission denied', filePath)
      }
      if (error.code === 'INVALID_PATH') {
        throw error
      }
      throw this.createError('IO_ERROR', error.message, filePath)
    }
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    try {
      const validOldPath = this.validatePath(oldPath)
      const validNewPath = this.validatePath(newPath)
      await fs.rename(validOldPath, validNewPath)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw this.createError('NOT_FOUND', 'File not found', oldPath)
      }
      if (error.code === 'EACCES') {
        throw this.createError('PERMISSION_DENIED', 'Permission denied', oldPath)
      }
      if (error.code === 'INVALID_PATH') {
        throw error
      }
      throw this.createError('IO_ERROR', error.message, oldPath)
    }
  }

  async moveFile(sourcePath: string, targetDir: string): Promise<string> {
    try {
      const validSource = this.validatePath(sourcePath)
      const validTarget = this.validatePath(targetDir)
      const fileName = path.basename(validSource)
      const destPath = path.join(validTarget, fileName)

      // Prevent moving a directory into itself or its descendants
      const normalizedSource = path.normalize(validSource) + path.sep
      const normalizedDest = path.normalize(destPath) + path.sep
      if (normalizedDest.startsWith(normalizedSource)) {
        throw this.createError('IO_ERROR', 'Cannot move a directory into itself or its descendants', sourcePath)
      }

      await fs.mkdir(validTarget, { recursive: true })
      await fs.rename(validSource, destPath)
      return destPath
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw this.createError('NOT_FOUND', 'File not found', sourcePath)
      }
      if (error.code === 'EACCES') {
        throw this.createError('PERMISSION_DENIED', 'Permission denied', sourcePath)
      }
      if (error.code === 'INVALID_PATH' || error.code === 'IO_ERROR') {
        throw error
      }
      throw this.createError('IO_ERROR', error.message, sourcePath)
    }
  }

  async copyFileInto(sourcePath: string, targetDir: string): Promise<string> {
    try {
      const validTarget = this.validatePath(targetDir)
      const fileName = path.basename(sourcePath)
      let destPath = path.join(validTarget, fileName)

      // Handle name conflicts by appending (1), (2), etc.
      const ext = path.extname(fileName)
      const baseName = path.basename(fileName, ext)
      let counter = 1
      while (true) {
        try {
          await fs.access(destPath)
          destPath = path.join(validTarget, `${baseName} (${counter})${ext}`)
          counter++
        } catch {
          break // File doesn't exist, safe to use
        }
      }

      await fs.copyFile(sourcePath, destPath)
      return destPath
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw this.createError('NOT_FOUND', 'File not found', sourcePath)
      }
      if (error.code === 'EACCES') {
        throw this.createError('PERMISSION_DENIED', 'Permission denied', sourcePath)
      }
      if (error.code === 'INVALID_PATH') {
        throw error
      }
      throw this.createError('IO_ERROR', error.message, sourcePath)
    }
  }

  async getFileInfo(filePath: string): Promise<FileInfo> {
    try {
      const validPath = this.validatePath(filePath)
      const stats = await fs.stat(validPath)
      const name = path.basename(validPath)
      
      return {
        name,
        path: validPath,
        type: stats.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        modifiedAt: stats.mtime,
        extension: stats.isFile() ? path.extname(name).slice(1) : undefined,
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw this.createError('NOT_FOUND', 'File not found', filePath)
      }
      if (error.code === 'EACCES') {
        throw this.createError('PERMISSION_DENIED', 'Permission denied', filePath)
      }
      if (error.code === 'INVALID_PATH') {
        throw error
      }
      throw this.createError('IO_ERROR', error.message, filePath)
    }
  }

  async searchFiles(
    options: SearchOptions,
    onProgress?: (filesSearched: number, totalFiles: number, currentFile?: string) => void,
    onResult?: (result: SearchResult) => void,
    /** Ends the search when it aborts: ripgrep is stopped, and the search rejects with the signal's reason */
    signal?: AbortSignal
  ): Promise<SearchResult[]> {
    try {
      const validPath = this.validatePath(options.path)
      const results: SearchResult[] = []
      
      // Build ripgrep command arguments
      const args: string[] = []
      
      // Add search pattern
      if (options.useRegex) {
        args.push('-e', options.query)
      } else {
        args.push('-F', options.query)
      }
      
      // Add options
      if (!options.caseSensitive) args.push('-i')
      if (options.wholeWord) args.push('-w')
      
      // Add line numbers and column info
      args.push('--line-number', '--column', '--with-filename')
      
      // JSON output for easier parsing
      args.push('--json')
      
      // Include/exclude patterns - support comma-separated values
      if (options.includePattern) {
        const patterns = options.includePattern.split(',').map(p => p.trim()).filter(Boolean)
        for (const pattern of patterns) {
          const glob = pattern.includes('/') && !pattern.includes('*') ? `${pattern}/**` : pattern
          args.push('-g', glob)
        }
      }
      if (options.excludePattern) {
        const patterns = options.excludePattern.split(',').map(p => p.trim()).filter(Boolean)
        for (const pattern of patterns) {
          const glob = pattern.includes('/') && !pattern.includes('*') ? `${pattern}/**` : pattern
          args.push('-g', `!${glob}`)
        }
      }
      
      // Limit results if specified
      if (options.maxResults) {
        args.push('--max-count', options.maxResults.toString())
      }
      
      // Search path
      args.push(validPath)
      
      return new Promise((resolve, reject) => {
        const rg = spawn(rgPath, args, { signal })
        
        let currentResult: SearchResult | null = null
        let filesSearched = 0
        let errorOutput = ''
        
        // One JSON value a line, read as lines: a read ends wherever the pipe did, in the middle of a line and
        // of a character as often as not, so what is parsed is what the decoder has put back together
        const read = (async () => {
          for await (const line of decodeNdjson(rg.stdout)) {
            if (!line.ok) continue
            const json = line.value as { type?: string; data?: any }
            if (json.type !== 'match') continue

            const filePath = json.data.path.text
            const lineNum = json.data.line_number
            const lineText = json.data.lines.text.trimEnd()
            const match = json.data.submatches[0]

            if (!currentResult || currentResult.path !== filePath) {
              if (currentResult) {
                results.push(currentResult)
                onResult?.(currentResult)
              }

              currentResult = {
                path: filePath,
                matches: []
              }

              filesSearched++
              onProgress?.(filesSearched, -1, filePath)
            }

            currentResult.matches.push({
              line: lineNum,
              column: match.start + 1,
              lineText: lineText,
              matchStart: match.start,
              matchEnd: match.end
            })
          }
        })()

        rg.stderr.on('data', (data) => {
          errorOutput += data.toString()
        })
        
        rg.on('close', async (code) => {
          // The process is gone, and what it wrote may still be on its way through the decoder
          // Stopped by its caller: whatever it had found is not an answer to anything still asked
          if (signal?.aborted) { reject(signal.reason); return }
          try { await read } catch (error) {
            reject(this.createError('SEARCH_ERROR', `Search output could not be read: ${(error as Error).message}`))
            return
          }
          if (currentResult) {
            results.push(currentResult)
            onResult?.(currentResult)
          }
          
          if (code === 0 || code === 1) {
            // Code 0: matches found, Code 1: no matches found
            resolve(results)
          } else {
            // Check if ripgrep is not installed
            if (errorOutput.includes('command not found') || errorOutput.includes('not recognized')) {
              reject(this.createError('SEARCH_ERROR', 'ripgrep (rg) is not installed. Please install it to use search functionality.'))
            } else {
              reject(this.createError('SEARCH_ERROR', `Search failed: ${errorOutput}`))
            }
          }
        })
        
        rg.on('error', (err) => {
          // The abort itself, which the exit that follows it answers
          if (signal?.aborted) return
          if (err.message.includes('ENOENT')) {
            reject(this.createError('SEARCH_ERROR', 'ripgrep (rg) is not installed. Please install it to use search functionality.'))
          } else {
            reject(this.createError('SEARCH_ERROR', `Failed to start search: ${err.message}`))
          }
        })
      })
    } catch (error: any) {
      if (error.code === 'SEARCH_ERROR' || signal?.aborted) {
        throw error
      }
      throw this.createError('SEARCH_ERROR', error.message)
    }
  }

  // Get all files for quick open, respecting .gitignore
  async getAllFiles(rootPath: string): Promise<QuickOpenResult[]> {
    const validPath = this.validatePath(rootPath)

    // Try git ls-files first (respects all gitignore rules)
    try {
      const files = await this.getFilesViaGit(validPath)
      if (files.length > 0) return files
    } catch {
      // Not a git repo or git not available — fall back
    }

    return this.getFilesViaWalk(validPath)
  }

  private getFilesViaGit(rootPath: string): Promise<QuickOpenResult[]> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard'],
        { cwd: rootPath, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          if (error) return reject(error)

          const results: QuickOpenResult[] = stdout
            .split('\n')
            .filter(Boolean)
            .map(relativePath => ({
              path: path.join(rootPath, relativePath),
              relativePath,
              name: path.basename(relativePath),
              type: 'file' as const,
              extension: path.extname(relativePath).slice(1),
            }))

          resolve(results)
        },
      )
    })
  }

  private async getFilesViaWalk(
    rootPath: string,
    excludePatterns: string[] = [
      'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
      '.turbo', '.cache', '.vscode', '.idea', '*.log', '*.lock',
    ],
  ): Promise<QuickOpenResult[]> {
    const results: QuickOpenResult[] = []

    const shouldExclude = (filePath: string): boolean => {
      const relativePath = path.relative(rootPath, filePath)
      return excludePatterns.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'))
          return regex.test(relativePath)
        }
        return relativePath.split(path.sep).some(part => part === pattern)
      })
    }

    const walk = async (dir: string) => {
      if (shouldExclude(dir)) return

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (shouldExclude(fullPath)) continue

          if (entry.isDirectory()) {
            await walk(fullPath)
          } else {
            const relativePath = path.relative(rootPath, fullPath)
            results.push({
              path: fullPath,
              relativePath,
              name: entry.name,
              type: 'file',
              extension: path.extname(entry.name).slice(1),
            })
          }
        }
      } catch (error) {
        if ((error as any).code !== 'EACCES') {
          logger.error(`Error reading directory ${dir}`, { error })
        }
      }
    }

    await walk(rootPath)
    return results
  }

}