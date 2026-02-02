#!/usr/bin/env node

/**
 * EFP API V2 Compatibility Fixes Test
 * Tests specific fixes for API compatibility between old and new API
 *
 * Usage:
 *   node test-compatibility-fixes.mjs [--new <url>] [--old <url>]
 */

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    oldUrl: 'https://data.ethfollow.xyz/api/v1',
    newUrl: 'http://localhost:3000/api/v1',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--old':
        config.oldUrl = args[++i];
        break;
      case '--new':
        config.newUrl = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`
EFP API V2 Compatibility Fixes Test

Usage:
  node test-compatibility-fixes.mjs [options]

Options:
  --old <url>    Old API base URL (default: https://data.ethfollow.xyz/api/v1)
  --new <url>    New API base URL (default: http://localhost:3000/api/v1)
  --help, -h     Show this help message
`);
        process.exit(0);
    }
  }

  return config;
}

// =============================================================================
// Test Helpers
// =============================================================================

async function fetchJSON(url, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(id);

    const text = await response.text();
    try {
      return { status: response.status, data: JSON.parse(text), contentType: response.headers.get('content-type') };
    } catch {
      return { status: response.status, data: null, raw: text, contentType: response.headers.get('content-type') };
    }
  } catch (error) {
    clearTimeout(id);
    return { status: 'error', error: error.message };
  }
}

function pass(msg) {
  console.log(`  ✅ ${msg}`);
}

function fail(msg, details = null) {
  console.log(`  ❌ ${msg}`);
  if (details) {
    console.log(`     ${JSON.stringify(details, null, 2).split('\n').join('\n     ')}`);
  }
}

function skip(msg) {
  console.log(`  ⏭️  ${msg}`);
}

// =============================================================================
// Test Cases
// =============================================================================

const TEST_USER = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'; // vitalik.eth
const TEST_LEADER = '0x983110309620d911731ac0932219af06091b6744'; // brantly.eth

async function testCommonFollowersDefaultLimit(config) {
  console.log('\n📋 CommonFollowers: Default limit should be 10');

  const oldRes = await fetchJSON(`${config.oldUrl}/users/${TEST_USER}/commonFollowers?leader=${TEST_LEADER}`);
  const newRes = await fetchJSON(`${config.newUrl}/users/${TEST_USER}/commonFollowers?leader=${TEST_LEADER}`);

  if (newRes.status === 'error') {
    fail(`New API error: ${newRes.error}`);
    return false;
  }

  if (!newRes.data?.results) {
    fail('Missing results in response', newRes.data);
    return false;
  }

  // Check limit (should default to 10, not 20)
  if (newRes.data.results.length <= 10) {
    pass(`Default limit is correct (got ${newRes.data.results.length} results)`);
  } else {
    fail(`Default limit should be 10, got ${newRes.data.results.length}`, { count: newRes.data.results.length });
    return false;
  }

  return true;
}

async function testCommonFollowersNoLeader(config) {
  console.log('\n📋 CommonFollowers: Should work without leader param (fallback to self)');

  const newRes = await fetchJSON(`${config.newUrl}/users/${TEST_USER}/commonFollowers?limit=3`);

  if (newRes.status === 'error') {
    fail(`New API error: ${newRes.error}`);
    return false;
  }

  // Should not return 400 error
  if (newRes.status === 400) {
    fail('Should not require leader param', newRes.data);
    return false;
  }

  if (newRes.status === 200) {
    pass('Works without leader param');
    return true;
  }

  fail(`Unexpected status ${newRes.status}`, newRes.data);
  return false;
}

async function testCommonFollowersTypes(config) {
  console.log('\n📋 CommonFollowers: Response types should be correct');

  const newRes = await fetchJSON(`${config.newUrl}/users/${TEST_USER}/commonFollowers?leader=${TEST_LEADER}&limit=1`);

  if (newRes.status === 'error') {
    fail(`New API error: ${newRes.error}`);
    return false;
  }

  if (!newRes.data?.results?.[0]) {
    skip('No results to check types');
    return true;
  }

  const result = newRes.data.results[0];
  let allPassed = true;

  // name should be string (empty string if null)
  if (typeof result.name !== 'string') {
    fail(`name should be string, got ${typeof result.name}`, { name: result.name });
    allPassed = false;
  } else {
    pass('name is string');
  }

  // avatar should be string (empty string if null)
  if (typeof result.avatar !== 'string') {
    fail(`avatar should be string, got ${typeof result.avatar}`, { avatar: result.avatar });
    allPassed = false;
  } else {
    pass('avatar is string');
  }

  // header should be string (empty string if null)
  if (typeof result.header !== 'string') {
    fail(`header should be string, got ${typeof result.header}`, { header: result.header });
    allPassed = false;
  } else {
    pass('header is string');
  }

  // mutuals_rank should be number
  if (typeof result.mutuals_rank !== 'number') {
    fail(`mutuals_rank should be number, got ${typeof result.mutuals_rank}`, { mutuals_rank: result.mutuals_rank });
    allPassed = false;
  } else {
    pass('mutuals_rank is number');
  }

  return allPassed;
}

async function testTokenMetadataNonExistent(config) {
  console.log('\n📋 Token Metadata: Should accept any numeric ID (not check DB)');

  const newRes = await fetchJSON(`${config.newUrl}/token/metadata/99999999`);

  if (newRes.status === 'error') {
    fail(`New API error: ${newRes.error}`);
    return false;
  }

  // Should return 200, not 404
  if (newRes.status === 200) {
    pass('Returns 200 for non-existent token');

    if (newRes.data?.name === 'EFP List #99999999') {
      pass('Correct name format');
    } else {
      fail('Wrong name format', { name: newRes.data?.name });
      return false;
    }

    return true;
  }

  if (newRes.status === 404) {
    fail('Should not return 404 for non-existent token', newRes.data);
    return false;
  }

  fail(`Unexpected status ${newRes.status}`, newRes.data);
  return false;
}

async function testTokenMetadataInvalidId(config) {
  console.log('\n📋 Token Metadata: Should return 400 for invalid (non-numeric) ID');

  const newRes = await fetchJSON(`${config.newUrl}/token/metadata/invalid`);

  if (newRes.status === 'error') {
    fail(`New API error: ${newRes.error}`);
    return false;
  }

  if (newRes.status === 400) {
    pass('Returns 400 for invalid token ID');

    if (newRes.data?.response) {
      pass('Error format uses "response" key');
    } else {
      fail('Error format should use "response" key, not "error"', newRes.data);
      return false;
    }

    return true;
  }

  fail(`Should return 400, got ${newRes.status}`, newRes.data);
  return false;
}

async function testTokenImageSVG(config) {
  console.log('\n📋 Token Image: Should return SVG with EFP branding');

  const newRes = await fetchJSON(`${config.newUrl}/token/image/5`);

  if (newRes.status === 'error') {
    fail(`New API error: ${newRes.error}`);
    return false;
  }

  if (newRes.status !== 200) {
    fail(`Should return 200, got ${newRes.status}`);
    return false;
  }

  // Check content type
  if (newRes.contentType?.includes('image/svg')) {
    pass('Returns SVG content type');
  } else {
    fail(`Wrong content type: ${newRes.contentType}`);
  }

  // Check SVG content
  const svg = newRes.raw || '';

  if (svg.includes('Ethereum Follow Protocol') || svg.includes('EFP')) {
    pass('Contains EFP branding');
  } else {
    fail('Missing EFP branding in SVG');
    return false;
  }

  return true;
}

async function testTokenImageCommaFormat(config) {
  console.log('\n📋 Token Image: Should format token ID with commas');

  const newRes = await fetchJSON(`${config.newUrl}/token/image/1234567`);

  if (newRes.status === 'error') {
    fail(`New API error: ${newRes.error}`);
    return false;
  }

  const svg = newRes.raw || '';

  if (svg.includes('1,234,567')) {
    pass('Token ID formatted with commas');
    return true;
  }

  if (svg.includes('1234567')) {
    fail('Token ID not formatted with commas');
    return false;
  }

  skip('Could not verify comma formatting');
  return true;
}

async function testRecommendedBasic(config) {
  console.log('\n📋 Recommended: Basic response shape');

  const newRes = await fetchJSON(`${config.newUrl}/users/${TEST_USER}/recommended?limit=2`);

  if (newRes.status === 'error') {
    fail(`New API error: ${newRes.error}`);
    return false;
  }

  if (!newRes.data?.recommended) {
    fail('Missing recommended array', newRes.data);
    return false;
  }

  if (newRes.data.recommended.length === 0) {
    skip('No recommended accounts (table may be empty)');
    return true;
  }

  const item = newRes.data.recommended[0];
  let allPassed = true;

  // Check required fields
  if (!item.address) {
    fail('Missing address');
    allPassed = false;
  } else {
    pass('Has address');
  }

  if (typeof item.name !== 'string') {
    fail(`name should be string, got ${typeof item.name}`);
    allPassed = false;
  } else {
    pass('name is string');
  }

  if (typeof item.avatar !== 'string') {
    fail(`avatar should be string, got ${typeof item.avatar}`);
    allPassed = false;
  } else {
    pass('avatar is string');
  }

  // class field should exist
  if (!item.class) {
    fail('Missing class field');
    allPassed = false;
  } else {
    pass('Has class field');
  }

  return allPassed;
}

async function testRecommendedDetailsTypes(config) {
  console.log('\n📋 Recommended Details: Response types (numbers, stringified records)');

  const newRes = await fetchJSON(`${config.newUrl}/users/${TEST_USER}/recommended/details?limit=1`);

  if (newRes.status === 'error') {
    fail(`New API error: ${newRes.error}`);
    return false;
  }

  if (!newRes.data?.recommended?.[0]) {
    skip('No recommended accounts (table may be empty)');
    return true;
  }

  const item = newRes.data.recommended[0];
  let allPassed = true;

  // Stats should be numbers
  if (typeof item.stats?.followers_count !== 'number') {
    fail(`followers_count should be number, got ${typeof item.stats?.followers_count}`);
    allPassed = false;
  } else {
    pass('followers_count is number');
  }

  if (typeof item.stats?.following_count !== 'number') {
    fail(`following_count should be number, got ${typeof item.stats?.following_count}`);
    allPassed = false;
  } else {
    pass('following_count is number');
  }

  // Ranks should be numbers
  if (typeof item.ranks?.mutuals_rank !== 'number') {
    fail(`mutuals_rank should be number, got ${typeof item.ranks?.mutuals_rank}`);
    allPassed = false;
  } else {
    pass('mutuals_rank is number');
  }

  // Records should be stringified JSON
  if (typeof item.ens?.records !== 'string') {
    fail(`ens.records should be stringified JSON, got ${typeof item.ens?.records}`);
    allPassed = false;
  } else {
    pass('ens.records is stringified JSON');
    try {
      JSON.parse(item.ens.records);
      pass('ens.records is valid JSON');
    } catch {
      fail('ens.records is not valid JSON');
      allPassed = false;
    }
  }

  return allPassed;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();

  console.log('='.repeat(60));
  console.log('EFP API V2 Compatibility Fixes Test');
  console.log('='.repeat(60));
  console.log(`Old API: ${config.oldUrl}`);
  console.log(`New API: ${config.newUrl}`);
  console.log('='.repeat(60));

  const results = [];

  // CommonFollowers tests
  results.push({ name: 'CommonFollowers: Default limit', passed: await testCommonFollowersDefaultLimit(config) });
  results.push({ name: 'CommonFollowers: No leader param', passed: await testCommonFollowersNoLeader(config) });
  results.push({ name: 'CommonFollowers: Types', passed: await testCommonFollowersTypes(config) });

  // Token tests
  results.push({ name: 'Token Metadata: Non-existent ID', passed: await testTokenMetadataNonExistent(config) });
  results.push({ name: 'Token Metadata: Invalid ID', passed: await testTokenMetadataInvalidId(config) });
  results.push({ name: 'Token Image: SVG', passed: await testTokenImageSVG(config) });
  results.push({ name: 'Token Image: Comma format', passed: await testTokenImageCommaFormat(config) });

  // Recommended tests
  results.push({ name: 'Recommended: Basic', passed: await testRecommendedBasic(config) });
  results.push({ name: 'Recommended Details: Types', passed: await testRecommendedDetailsTypes(config) });

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('');

  if (failed > 0) {
    console.log('Failed tests:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}`);
    }
    process.exit(1);
  }

  console.log('All tests passed!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
