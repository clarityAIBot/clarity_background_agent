/**
 * Tests for SkillLoader - Skill loading functionality.
 *
 * These tests verify that skills are correctly loaded from source directories
 * to the agent-specific target directories.
 *
 * Run with: npm test -- --run skill-loader.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadSkills, listInstalledSkills } from '../src/skills/skill-loader.js';

// Test directories
const TEST_SKILLS_TARGET = path.join(os.homedir(), '.claude', 'skills');
const EXTERNAL_SKILLS_SOURCE = path.resolve(__dirname, '..', '..', 'external_modules', 'agent-skills', 'skills');
const LOCAL_SKILLS_SOURCE = path.resolve(__dirname, '..', 'skills');

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

describe('SkillLoader - Unit Tests', () => {
  describe('loadSkills', () => {
    it('should return an array of loaded skill names', async () => {
      const loadedSkills = await loadSkills('claude-code');

      expect(Array.isArray(loadedSkills)).toBe(true);
      console.log('Loaded skills:', loadedSkills);
    });

    it('should load skills for claude-code agent type', async () => {
      const loadedSkills = await loadSkills('claude-code');

      // Should return array (may be empty if no skills exist)
      expect(Array.isArray(loadedSkills)).toBe(true);

      // If external skills exist, react-native-best-practices should be loaded
      if (await exists(EXTERNAL_SKILLS_SOURCE)) {
        expect(loadedSkills).toContain('react-native-best-practices');
      }
    });

    it('should load skills for opencode agent type', async () => {
      const loadedSkills = await loadSkills('opencode');

      // Should return array (currently uses same path as claude-code)
      expect(Array.isArray(loadedSkills)).toBe(true);
    });

    it('should create target directory if it does not exist', async () => {
      await loadSkills('claude-code');

      // Target directory should exist after loading
      const targetExists = await exists(TEST_SKILLS_TARGET);
      expect(targetExists).toBe(true);
    });

    it('should not duplicate skills when called multiple times', async () => {
      const firstLoad = await loadSkills('claude-code');
      const secondLoad = await loadSkills('claude-code');

      // Both loads should return the same skills
      expect(firstLoad.sort()).toEqual(secondLoad.sort());
    });
  });

  describe('listInstalledSkills', () => {
    beforeAll(async () => {
      // Ensure skills are loaded before listing
      await loadSkills('claude-code');
    });

    it('should return an array of installed skill names', async () => {
      const installedSkills = await listInstalledSkills('claude-code');

      expect(Array.isArray(installedSkills)).toBe(true);
      console.log('Installed skills:', installedSkills);
    });

    it('should list skills that were loaded', async () => {
      const loadedSkills = await loadSkills('claude-code');
      const installedSkills = await listInstalledSkills('claude-code');

      // All loaded skills should be in installed list
      for (const skill of loadedSkills) {
        expect(installedSkills).toContain(skill);
      }
    });
  });

  describe('Source Directory Detection', () => {
    it('should detect external_modules/agent-skills source', async () => {
      const externalExists = await exists(EXTERNAL_SKILLS_SOURCE);
      console.log('External skills source exists:', externalExists);
      console.log('External skills path:', EXTERNAL_SKILLS_SOURCE);

      if (externalExists) {
        const entries = await fs.readdir(EXTERNAL_SKILLS_SOURCE);
        console.log('External skills available:', entries);
        expect(entries.length).toBeGreaterThan(0);
      }
    });

    it('should detect local skills source', async () => {
      const localExists = await exists(LOCAL_SKILLS_SOURCE);
      console.log('Local skills source exists:', localExists);
      console.log('Local skills path:', LOCAL_SKILLS_SOURCE);
    });
  });

  describe('Skill Content Verification', () => {
    beforeAll(async () => {
      await loadSkills('claude-code');
    });

    it('should copy SKILL.md file to target directory', async () => {
      const loadedSkills = await loadSkills('claude-code');

      if (loadedSkills.length > 0) {
        const firstSkill = loadedSkills[0];
        const skillMdPath = path.join(TEST_SKILLS_TARGET, firstSkill, 'SKILL.md');
        const skillMdExists = await exists(skillMdPath);

        expect(skillMdExists).toBe(true);
        console.log(`SKILL.md exists for ${firstSkill}:`, skillMdExists);
      }
    });

    it('should copy reference files if they exist', async () => {
      const loadedSkills = await loadSkills('claude-code');

      if (loadedSkills.includes('react-native-best-practices')) {
        const refsPath = path.join(TEST_SKILLS_TARGET, 'react-native-best-practices', 'references');
        const refsExists = await exists(refsPath);

        if (refsExists) {
          const refs = await fs.readdir(refsPath);
          console.log('Reference files copied:', refs.length);
          expect(refs.length).toBeGreaterThan(0);
        }
      }
    });
  });
});

describe('SkillLoader - Integration with External Skills', () => {
  it('should load react-native-best-practices skill from submodule', async () => {
    // Check if the submodule exists
    const submoduleExists = await exists(EXTERNAL_SKILLS_SOURCE);

    if (!submoduleExists) {
      console.log('Skipping: agent-skills submodule not found');
      return;
    }

    const loadedSkills = await loadSkills('claude-code');

    expect(loadedSkills).toContain('react-native-best-practices');

    // Verify the skill was copied correctly
    const targetSkillPath = path.join(TEST_SKILLS_TARGET, 'react-native-best-practices');
    const skillExists = await exists(targetSkillPath);
    expect(skillExists).toBe(true);

    // Verify SKILL.md content
    const skillMdPath = path.join(targetSkillPath, 'SKILL.md');
    const skillMdContent = await fs.readFile(skillMdPath, 'utf-8');

    expect(skillMdContent).toContain('react-native-best-practices');
    expect(skillMdContent).toContain('description:');

    console.log('react-native-best-practices skill loaded successfully');
  });
});

describe('SkillLoader - Environment Variable Override', () => {
  const originalEnv = process.env.SKILLS_SOURCE_DIR;

  afterAll(() => {
    // Restore original env
    if (originalEnv) {
      process.env.SKILLS_SOURCE_DIR = originalEnv;
    } else {
      delete process.env.SKILLS_SOURCE_DIR;
    }
  });

  it('should use SKILLS_SOURCE_DIR env var when set', async () => {
    // Create a temp directory with a test skill
    const tempDir = path.join(os.tmpdir(), 'test-skills-' + Date.now());
    const testSkillDir = path.join(tempDir, 'test-skill');

    await fs.mkdir(testSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(testSkillDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: A test skill\n---\n\n# Test Skill\n'
    );

    // Set env var
    process.env.SKILLS_SOURCE_DIR = tempDir;

    try {
      const loadedSkills = await loadSkills('claude-code');
      expect(loadedSkills).toContain('test-skill');

      console.log('Custom SKILLS_SOURCE_DIR loaded:', loadedSkills);
    } finally {
      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
