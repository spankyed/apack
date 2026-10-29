/** Synthetic structured context, matching the verified native response contract. */
export const nativeContextUsage = {
  model: 'fixture-model', totalTokens: 250, maxTokens: 1000, percentage: 25,
  categories: [
    { name: 'System prompt', tokens: 100, kind: 'used' },
    { name: 'Messages', tokens: 150, kind: 'used' },
    { name: 'Reserved capacity', tokens: 200, kind: 'buffer' },
    { name: 'Available capacity', tokens: 550, kind: 'free' },
  ],
  memoryFiles: [{ type: 'Project', path: '/fixture/CLAUDE.md', tokens: 20 }],
  skills: { totalSkills: 1, includedSkills: 1, tokens: 25,
    skillFrontmatter: [{ name: 'fixture-skill', source: 'project', tokens: 25 }] },
};
