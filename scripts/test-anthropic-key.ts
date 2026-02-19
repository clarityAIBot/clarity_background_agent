#!/usr/bin/env npx tsx
/**
 * Test script to verify Anthropic API key from .env is working
 * Run with: npx tsx scripts/test-anthropic-key.ts
 */

import 'dotenv/config';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY not found in environment variables');
  console.error('   Make sure you have a .env file with ANTHROPIC_API_KEY set');
  process.exit(1);
}

console.log('🔑 Found API key:', ANTHROPIC_API_KEY.slice(0, 20) + '...' + ANTHROPIC_API_KEY.slice(-4));
console.log('📡 Testing connection to Anthropic API...\n');

async function testApiKey() {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: 'Say "API key is working!" and nothing else.',
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ API request failed:');
      console.error('   Status:', response.status);
      console.error('   Error:', JSON.stringify(error, null, 2));
      process.exit(1);
    }

    const data = await response.json();
    const reply = data.content[0]?.text || 'No response';

    console.log('✅ API Key is valid!');
    console.log('📝 Model response:', reply);
    console.log('\n📊 Usage:');
    console.log('   Input tokens:', data.usage?.input_tokens);
    console.log('   Output tokens:', data.usage?.output_tokens);
    console.log('   Model:', data.model);
  } catch (error) {
    console.error('❌ Error testing API key:');
    console.error('  ', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

testApiKey();
