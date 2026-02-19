// Full flow test simulating container behavior
import { query } from '@anthropic-ai/claude-agent-sdk';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simulate the prompt template
const PROMPT_TEMPLATE = `You are working on GitHub issue #{{ISSUE_NUMBER}}: "{{ISSUE_TITLE}}"

Issue Description:
{{ISSUE_DESCRIPTION}}

Please analyze this issue and respond with a brief summary of what needs to be done.
Do not make any file changes - just analyze and summarize.`;

async function testFullFlow() {
  console.log('=== Full Flow Test ===\n');

  // Test data
  const issueContext = {
    issueNumber: '999',
    title: 'Test Issue - Add hello world function',
    description: 'Please add a simple hello world function to the codebase.',
    author: 'test-user',
    labels: ['clarity-ai', 'test']
  };

  // Build prompt
  let prompt = PROMPT_TEMPLATE
    .replace('{{ISSUE_NUMBER}}', issueContext.issueNumber)
    .replace('{{ISSUE_TITLE}}', issueContext.title)
    .replace('{{ISSUE_DESCRIPTION}}', issueContext.description);

  console.log('Prompt:', prompt.substring(0, 200) + '...\n');
  console.log('ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY);
  console.log('');

  try {
    let turnCount = 0;
    const results = [];

    console.log('Starting Claude Agent SDK query...\n');

    for await (const message of query({
      prompt,
      options: {
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 3
      }
    })) {
      turnCount++;
      results.push(message);

      console.log(`Turn ${turnCount}: type=${message.type}`);

      if (message.type === 'system') {
        console.log('  Session ID:', message.session_id);
        console.log('  Tools:', message.tools?.length || 0);
      } else if (message.type === 'assistant') {
        const preview = JSON.stringify(message.message?.content)?.substring(0, 200);
        console.log('  Content preview:', preview);
      } else if (message.type === 'result') {
        console.log('  Result:', message.result?.substring(0, 500));
        console.log('  Cost USD:', message.total_cost_usd);
        console.log('  Turns:', message.num_turns);
      }
      console.log('');
    }

    console.log('=== Test Completed Successfully ===');
    console.log('Total turns:', turnCount);

  } catch (error) {
    console.error('\n=== Test Failed ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testFullFlow();
