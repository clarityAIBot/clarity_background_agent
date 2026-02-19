// Quick test of Claude Agent SDK
import { query } from '@anthropic-ai/claude-agent-sdk';

console.log('Testing Claude Agent SDK...');
console.log('ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY);

try {
  let turnCount = 0;

  for await (const message of query({
    prompt: 'Say "Hello from SDK test" and nothing else.',
    options: {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 1
    }
  })) {
    turnCount++;
    console.log(`Turn ${turnCount}:`, message.type);
    if (message.type === 'result') {
      console.log('Result:', message.result?.substring(0, 200));
    }
  }

  console.log('Test completed successfully!');
} catch (error) {
  console.error('Test failed:', error.message);
  console.error('Stack:', error.stack);
}
