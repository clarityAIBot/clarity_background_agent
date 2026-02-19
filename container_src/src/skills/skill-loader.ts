/**
 * Skill Loader - Copies skills to agent-specific locations
 *
 * Claude Agent SDK loads skills from:
 * - ~/.claude/skills/ (user-level)
 * - .claude/skills/ (project-level)
 *
 * OpenCode may have different paths (TBD).
 *
 * This module copies skills from bundled locations to the appropriate
 * directory based on the agent type.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { createLogger } from '../logger.js';
import type { AgentType } from '../agents/types.js';

const logger = createLogger('SkillLoader');

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the target skills directory for a specific agent type
 */
function getTargetSkillsDir(agentType: AgentType): string {
  switch (agentType) {
    case 'claude-code':
      // Claude SDK expects skills in ~/.claude/skills/
      return path.join(os.homedir(), '.claude', 'skills');
    case 'opencode':
      // OpenCode - placeholder, update when OpenCode skill path is known
      // For now, use same as Claude Code
      return path.join(os.homedir(), '.claude', 'skills');
    default:
      return path.join(os.homedir(), '.claude', 'skills');
  }
}

/**
 * Get skill source directories
 * Uses environment variable or falls back to relative paths from compiled code
 */
function getSkillSourceDirs(): string[] {
  const sources: string[] = [];

  // 1. Environment variable override (highest priority)
  if (process.env.SKILLS_SOURCE_DIR) {
    sources.push(process.env.SKILLS_SOURCE_DIR);
  }

  // 2. Local skills in container_src/skills/
  // Compiled path: dist/skills/skill-loader.js -> ../.. to get to container_src root
  const localSkillsPath = path.resolve(__dirname, '..', '..', 'skills');
  sources.push(localSkillsPath);

  // 3. External skills from agent-skills submodule
  // Path: container_src/../external_modules/agent-skills/skills
  const externalSkillsPath = path.resolve(__dirname, '..', '..', '..', 'external_modules', 'agent-skills', 'skills');
  sources.push(externalSkillsPath);

  return sources;
}

/**
 * Copy a directory recursively
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Check if a path exists
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load all skills from source directories to agent-specific target directory
 *
 * Optimization: If skills already exist in target (e.g., from Docker build),
 * skip loading and return the existing skills list.
 *
 * @param agentType - The type of agent to load skills for
 * @param forceReload - Force reload even if skills exist (default: false)
 * @returns List of loaded/existing skill names
 */
export async function loadSkills(agentType: AgentType = 'claude-code', forceReload = false): Promise<string[]> {
  const targetDir = getTargetSkillsDir(agentType);

  // Check if skills already exist (e.g., from Docker build)
  const existingSkills = await listInstalledSkills(agentType);
  if (existingSkills.length > 0 && !forceReload) {
    logger.log('SKILLS', 'Skills already installed, skipping load', {
      agentType,
      targetDir,
      existingCount: existingSkills.length,
      skills: existingSkills
    });
    return existingSkills;
  }

  const loadedSkills: string[] = [];
  const loadedSkillSet = new Set<string>(); // Prevent duplicates
  const skillSources = getSkillSourceDirs();

  // Ensure target directory exists
  await fs.mkdir(targetDir, { recursive: true });

  logger.log('SKILLS', 'Loading skills', {
    agentType,
    targetDir,
    sources: skillSources
  });

  for (const sourceDir of skillSources) {
    if (!(await exists(sourceDir))) {
      logger.log('SKILLS', 'Source directory not found, skipping', { sourceDir });
      continue;
    }

    try {
      const entries = await fs.readdir(sourceDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillName = entry.name;

        // Skip if already loaded (prevents duplicates)
        if (loadedSkillSet.has(skillName)) {
          continue;
        }

        const srcPath = path.join(sourceDir, skillName);
        const destPath = path.join(targetDir, skillName);
        const skillMdPath = path.join(srcPath, 'SKILL.md');

        // Only copy if it has a SKILL.md file
        if (!(await exists(skillMdPath))) {
          continue;
        }

        // Copy skill directory
        await copyDir(srcPath, destPath);
        loadedSkills.push(skillName);
        loadedSkillSet.add(skillName);

        logger.log('SKILLS', 'Loaded skill', {
          name: skillName,
          from: srcPath,
          to: destPath
        });
      }
    } catch (error) {
      logger.log('SKILLS', 'Error loading skills from source', {
        sourceDir,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  logger.log('SKILLS', 'Skills loading complete', {
    totalLoaded: loadedSkills.length,
    skills: loadedSkills
  });

  return loadedSkills;
}

/**
 * List currently installed skills for an agent type
 */
export async function listInstalledSkills(agentType: AgentType = 'claude-code'): Promise<string[]> {
  const targetDir = getTargetSkillsDir(agentType);

  try {
    if (!(await exists(targetDir))) {
      return [];
    }

    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
}
