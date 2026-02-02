#!/usr/bin/env node

/**
 * Comprehensive endpoint comparison test
 * Compares production API vs local API responses
 */

const PROD_URL = 'https://api.ethfollow.xyz/api/v1';
const LOCAL_URL = 'http://localhost:3000/api/v1';

// Test addresses/tokens
const TEST_ADDRESS = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'; // vitalik
const TEST_ADDRESS_2 = '0x983110309620d911731ac0932219af06091b6744'; // brantly
const TEST_ENS = 'vitalik.eth';
const TEST_TOKEN_ID = '5';
const TEST_SLOT_CHAIN = '8453';
const TEST_SLOT_CONTRACT = '0x41Aa48Ef3c0446b46a5b1cc6337FF3d3716E2A33';
const TEST_SLOT = '0x0000000000000000000000000000000000000000000000000000000000000005';

// All endpoints to test
const ENDPOINTS = [
  // Health/Base
  { path: '/health', name: 'Health check' },
  { path: '/database/health', name: 'Database health' },

  // Stats
  { path: '/stats', name: 'Global stats' },

  // Debug
  { path: '/debug/num-events', name: 'Debug: num events' },
  { path: '/debug/num-list-ops', name: 'Debug: num list ops' },
  { path: '/debug/total-supply', name: 'Debug: total supply' },

  // Discover
  { path: '/discover', name: 'Discover' },

  // Leaderboard
  { path: '/leaderboard/count', name: 'Leaderboard count' },
  { path: '/leaderboard/followers?limit=3', name: 'Leaderboard followers' },
  { path: '/leaderboard/following?limit=3', name: 'Leaderboard following' },
  { path: '/leaderboard/mutuals?limit=3', name: 'Leaderboard mutuals' },
  { path: '/leaderboard/blocked?limit=3', name: 'Leaderboard blocked' },
  { path: '/leaderboard/blocks?limit=3', name: 'Leaderboard blocks' },
  { path: '/leaderboard/muted?limit=3', name: 'Leaderboard muted' },
  { path: '/leaderboard/mutes?limit=3', name: 'Leaderboard mutes' },
  { path: '/leaderboard/ranked?limit=3', name: 'Leaderboard ranked' },
  { path: '/leaderboard/search?term=vit&limit=3', name: 'Leaderboard search' },

  // Minters
  { path: '/minters', name: 'Minters' },

  // Token
  { path: `/token/metadata/${TEST_TOKEN_ID}`, name: 'Token metadata' },

  // Slots
  { path: `/slots/${TEST_SLOT_CHAIN}/${TEST_SLOT_CONTRACT}/${TEST_SLOT}/details`, name: 'Slot details' },

  // Export State
  { path: `/exportState/${TEST_TOKEN_ID}`, name: 'Export state' },

  // Users - Account/Details/Stats
  { path: `/users/${TEST_ADDRESS}/account`, name: 'User account' },
  { path: `/users/${TEST_ENS}/account`, name: 'User account (ENS)' },
  { path: `/users/${TEST_ADDRESS}/details`, name: 'User details' },
  { path: `/users/${TEST_ADDRESS}/stats`, name: 'User stats' },
  { path: `/users/${TEST_ADDRESS}/ens`, name: 'User ENS' },
  { path: `/users/${TEST_ADDRESS}/primary-list`, name: 'User primary list' },
  { path: `/users/${TEST_ADDRESS}/lists`, name: 'User lists' },

  // Users - Followers/Following
  { path: `/users/${TEST_ADDRESS}/followers?limit=3`, name: 'User followers' },
  { path: `/users/${TEST_ADDRESS}/following?limit=3`, name: 'User following' },
  { path: `/users/${TEST_ADDRESS}/allFollowers?limit=3`, name: 'User all followers' },
  { path: `/users/${TEST_ADDRESS}/allFollowing?limit=3`, name: 'User all following' },
  { path: `/users/${TEST_ADDRESS}/latestFollowers?limit=3`, name: 'User latest followers' },
  { path: `/users/${TEST_ADDRESS}/allFollowingAddresses`, name: 'User all following addresses' },

  // Users - Mutuals
  { path: `/users/${TEST_ADDRESS}/mutuals?limit=3`, name: 'User mutuals' },

  // Users - Tags
  { path: `/users/${TEST_ADDRESS}/tags`, name: 'User tags' },
  { path: `/users/${TEST_ADDRESS}/taggedAs`, name: 'User taggedAs' },

  // Users - Search
  { path: `/users/${TEST_ADDRESS}/searchFollowers?term=vit&limit=3`, name: 'User search followers' },
  { path: `/users/${TEST_ADDRESS}/searchFollowing?term=ens&limit=3`, name: 'User search following' },

  // Users - Recommended
  { path: `/users/${TEST_ADDRESS}/recommended?limit=3`, name: 'User recommended' },
  { path: `/users/${TEST_ADDRESS}/recommended/details?limit=3`, name: 'User recommended details' },

  // Users - Badges
  { path: `/users/${TEST_ADDRESS}/badges`, name: 'User badges' },

  // Users - Relationships
  { path: `/users/${TEST_ADDRESS}/${TEST_ADDRESS_2}/followerState`, name: 'User follower state' },
  { path: `/users/${TEST_ADDRESS}/relationships`, name: 'User relationships' },
  { path: `/users/${TEST_ADDRESS}/commonFollowers?leader=${TEST_ADDRESS_2}&limit=3`, name: 'User common followers' },

  // Users - Other
  { path: `/users/${TEST_ADDRESS}/list-records`, name: 'User list records' },
  { path: `/users/${TEST_ADDRESS}/notifications?limit=3`, name: 'User notifications' },
  { path: `/users/${TEST_ADDRESS}/blocks`, name: 'User blocks' },
  { path: `/users/${TEST_ADDRESS}/mutes`, name: 'User mutes' },

  // Lists - Account/Details/Stats
  { path: `/lists/${TEST_TOKEN_ID}/account`, name: 'List account' },
  { path: `/lists/${TEST_TOKEN_ID}/details`, name: 'List details' },
  { path: `/lists/${TEST_TOKEN_ID}/stats`, name: 'List stats' },
  { path: `/lists/${TEST_TOKEN_ID}/records`, name: 'List records' },

  // Lists - Followers/Following
  { path: `/lists/${TEST_TOKEN_ID}/followers?limit=3`, name: 'List followers' },
  { path: `/lists/${TEST_TOKEN_ID}/following?limit=3`, name: 'List following' },
  { path: `/lists/${TEST_TOKEN_ID}/allFollowers?limit=3`, name: 'List all followers' },
  { path: `/lists/${TEST_TOKEN_ID}/allFollowing?limit=3`, name: 'List all following' },
  { path: `/lists/${TEST_TOKEN_ID}/latestFollowers?limit=3`, name: 'List latest followers' },
  { path: `/lists/${TEST_TOKEN_ID}/allFollowingAddresses`, name: 'List all following addresses' },

  // Lists - Tags
  { path: `/lists/${TEST_TOKEN_ID}/tags`, name: 'List tags' },
  { path: `/lists/${TEST_TOKEN_ID}/taggedAs`, name: 'List taggedAs' },

  // Lists - Search
  { path: `/lists/${TEST_TOKEN_ID}/searchFollowers?term=eth&limit=3`, name: 'List search followers' },
  { path: `/lists/${TEST_TOKEN_ID}/searchFollowing?term=eth&limit=3`, name: 'List search following' },

  // Lists - Recommended
  { path: `/lists/${TEST_TOKEN_ID}/recommended?limit=3`, name: 'List recommended' },
  { path: `/lists/${TEST_TOKEN_ID}/recommended/details?limit=3`, name: 'List recommended details' },

  // Lists - Badges
  { path: `/lists/${TEST_TOKEN_ID}/badges`, name: 'List badges' },

  // Lists - Follower State
  { path: `/lists/${TEST_TOKEN_ID}/${TEST_ADDRESS_2}/followerState`, name: 'List follower state' },

  // Lists - Button State
  { path: `/lists/${TEST_TOKEN_ID}/${TEST_ADDRESS_2}/buttonState`, name: 'List button state' },
];

async function fetchWithTimeout(url, timeout = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(id);

    const text = await response.text();
    try {
      return { status: response.status, data: JSON.parse(text), raw: text };
    } catch {
      return { status: response.status, data: null, raw: text };
    }
  } catch (error) {
    clearTimeout(id);
    return { status: 'error', data: null, error: error.message };
  }
}

function compareObjects(prod, local, path = '') {
  const diffs = [];

  if (prod === local) return diffs;

  if (typeof prod !== typeof local) {
    diffs.push({ path: path || 'root', prod: typeof prod, local: typeof local, type: 'type_mismatch' });
    return diffs;
  }

  if (Array.isArray(prod) && Array.isArray(local)) {
    if (prod.length !== local.length) {
      diffs.push({ path: path || 'root', prod: prod.length, local: local.length, type: 'array_length' });
    }
    // Compare first few items
    const len = Math.min(prod.length, local.length, 3);
    for (let i = 0; i < len; i++) {
      diffs.push(...compareObjects(prod[i], local[i], `${path}[${i}]`));
    }
    return diffs;
  }

  if (typeof prod === 'object' && prod !== null && local !== null) {
    const allKeys = new Set([...Object.keys(prod), ...Object.keys(local)]);
    for (const key of allKeys) {
      if (!(key in prod)) {
        diffs.push({ path: `${path}.${key}`, type: 'missing_in_prod', local: local[key] });
      } else if (!(key in local)) {
        diffs.push({ path: `${path}.${key}`, type: 'missing_in_local', prod: prod[key] });
      } else {
        diffs.push(...compareObjects(prod[key], local[key], `${path}.${key}`));
      }
    }
    return diffs;
  }

  if (prod !== local) {
    // Ignore timestamp differences
    if (path.includes('created_at') || path.includes('updated_at') || path.includes('timestamp')) {
      return diffs;
    }
    diffs.push({ path: path || 'root', prod, local, type: 'value_mismatch' });
  }

  return diffs;
}

async function testEndpoint(endpoint) {
  const prodUrl = `${PROD_URL}${endpoint.path}`;
  const localUrl = `${LOCAL_URL}${endpoint.path}`;

  const [prodResult, localResult] = await Promise.all([
    fetchWithTimeout(prodUrl),
    fetchWithTimeout(localUrl),
  ]);

  const result = {
    name: endpoint.name,
    path: endpoint.path,
    prodStatus: prodResult.status,
    localStatus: localResult.status,
    match: false,
    diffs: [],
    prodError: prodResult.error,
    localError: localResult.error,
  };

  // Check if local endpoint exists
  if (localResult.status === 404) {
    result.diffs.push({ type: 'endpoint_missing', message: 'Endpoint not implemented in local API' });
    return result;
  }

  // Check if status codes match
  if (prodResult.status !== localResult.status) {
    result.diffs.push({
      type: 'status_mismatch',
      prod: prodResult.status,
      local: localResult.status
    });
  }

  // Compare response data
  if (prodResult.data && localResult.data) {
    const diffs = compareObjects(prodResult.data, localResult.data);
    result.diffs.push(...diffs);
  }

  result.match = result.diffs.length === 0;

  return result;
}

async function main() {
  console.log('='.repeat(80));
  console.log('EFP API Endpoint Comparison Test');
  console.log('='.repeat(80));
  console.log(`Production: ${PROD_URL}`);
  console.log(`Local:      ${LOCAL_URL}`);
  console.log('='.repeat(80));
  console.log('');

  // First check if local API is running
  try {
    const healthCheck = await fetchWithTimeout(`${LOCAL_URL}/health`, 5000);
    if (healthCheck.status === 'error') {
      console.error('ERROR: Local API is not running!');
      console.error('Please start the local API first with: npm run dev --workspace=@efp/api');
      process.exit(1);
    }
  } catch (e) {
    console.error('ERROR: Cannot connect to local API');
    process.exit(1);
  }

  const results = {
    passed: [],
    failed: [],
    missing: [],
    errors: [],
  };

  let completed = 0;
  const total = ENDPOINTS.length;

  for (const endpoint of ENDPOINTS) {
    completed++;
    process.stdout.write(`\rTesting ${completed}/${total}: ${endpoint.name.padEnd(40)}`);

    try {
      const result = await testEndpoint(endpoint);

      if (result.localError) {
        results.errors.push(result);
      } else if (result.localStatus === 404) {
        results.missing.push(result);
      } else if (result.match) {
        results.passed.push(result);
      } else {
        results.failed.push(result);
      }
    } catch (error) {
      results.errors.push({
        name: endpoint.name,
        path: endpoint.path,
        error: error.message,
      });
    }
  }

  console.log('\n\n');

  // Print summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total endpoints:  ${total}`);
  console.log(`Passed:           ${results.passed.length} ✓`);
  console.log(`Failed:           ${results.failed.length} ✗`);
  console.log(`Missing:          ${results.missing.length} ?`);
  console.log(`Errors:           ${results.errors.length} !`);
  console.log('');

  // Print passed
  if (results.passed.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('PASSED ENDPOINTS');
    console.log('='.repeat(80));
    for (const r of results.passed) {
      console.log(`  ✓ ${r.name}`);
    }
  }

  // Print missing endpoints
  if (results.missing.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('MISSING ENDPOINTS (not implemented in local API)');
    console.log('='.repeat(80));
    for (const r of results.missing) {
      console.log(`  ? ${r.name}`);
      console.log(`    Path: ${r.path}`);
    }
  }

  // Print failed endpoints with diffs
  if (results.failed.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('FAILED ENDPOINTS (response mismatch)');
    console.log('='.repeat(80));
    for (const r of results.failed) {
      console.log(`\n  ✗ ${r.name}`);
      console.log(`    Path: ${r.path}`);
      console.log(`    Status: prod=${r.prodStatus}, local=${r.localStatus}`);
      if (r.diffs.length > 0) {
        console.log('    Differences:');
        for (const diff of r.diffs.slice(0, 10)) {
          if (diff.type === 'missing_in_local') {
            console.log(`      - ${diff.path}: missing in local (prod has: ${JSON.stringify(diff.prod).slice(0, 50)})`);
          } else if (diff.type === 'missing_in_prod') {
            console.log(`      - ${diff.path}: extra in local (local has: ${JSON.stringify(diff.local).slice(0, 50)})`);
          } else if (diff.type === 'value_mismatch') {
            console.log(`      - ${diff.path}: prod=${JSON.stringify(diff.prod).slice(0, 30)} vs local=${JSON.stringify(diff.local).slice(0, 30)}`);
          } else if (diff.type === 'array_length') {
            console.log(`      - ${diff.path}: array length prod=${diff.prod} vs local=${diff.local}`);
          } else if (diff.type === 'status_mismatch') {
            console.log(`      - Status code: prod=${diff.prod} vs local=${diff.local}`);
          } else {
            console.log(`      - ${diff.path}: ${diff.type}`);
          }
        }
        if (r.diffs.length > 10) {
          console.log(`      ... and ${r.diffs.length - 10} more differences`);
        }
      }
    }
  }

  // Print errors
  if (results.errors.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('ERRORS');
    console.log('='.repeat(80));
    for (const r of results.errors) {
      console.log(`  ! ${r.name}`);
      console.log(`    Path: ${r.path}`);
      console.log(`    Error: ${r.error || r.localError}`);
    }
  }

  console.log('\n' + '='.repeat(80));

  // Exit with error code if there are failures
  if (results.failed.length > 0 || results.errors.length > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
