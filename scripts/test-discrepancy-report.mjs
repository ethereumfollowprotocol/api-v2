#!/usr/bin/env node

/**
 * EFP API Discrepancy Report Generator
 * Compares old API vs new API responses and generates a detailed markdown report
 *
 * Usage:
 *   node test-discrepancy-report.mjs \
 *     --old https://data.ethfollow.xyz/api/v1 \
 *     --new https://efp-api-v2.up.railway.app/api/v1 \
 *     --output DISCREPANCY_REPORT.md
 */

import { writeFileSync } from 'fs';

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    oldUrl: 'https://data.ethfollow.xyz/api/v1',
    newUrl: 'https://efp-api-v2.up.railway.app/api/v1',
    output: 'DISCREPANCY_REPORT.md',
    verbose: false,
    timeout: 30000,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--old':
        config.oldUrl = args[++i];
        break;
      case '--new':
        config.newUrl = args[++i];
        break;
      case '--output':
      case '-o':
        config.output = args[++i];
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--timeout':
        config.timeout = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`
EFP API Discrepancy Report Generator

Usage:
  node test-discrepancy-report.mjs [options]

Options:
  --old <url>      Old API base URL (default: https://data.ethfollow.xyz/api/v1)
  --new <url>      New API base URL (default: https://efp-api-v2.up.railway.app/api/v1)
  --output, -o     Output file path (default: DISCREPANCY_REPORT.md)
  --verbose, -v    Show verbose output during testing
  --timeout <ms>   Request timeout in milliseconds (default: 30000)
  --help, -h       Show this help message

Examples:
  # Compare deployed APIs
  node test-discrepancy-report.mjs \\
    --old https://data.ethfollow.xyz/api/v1 \\
    --new https://efp-api-v2.up.railway.app/api/v1

  # Compare production vs local
  node test-discrepancy-report.mjs \\
    --old https://data.ethfollow.xyz/api/v1 \\
    --new http://localhost:3000/api/v1
`);
        process.exit(0);
    }
  }

  return config;
}

// =============================================================================
// Test Data
// =============================================================================

const TEST_USERS = [
  { address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', name: 'vitalik', ens: 'vitalik.eth' },
  { address: '0x983110309620d911731ac0932219af06091b6744', name: 'brantly', ens: 'brantly.eth' },
  { address: '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72', name: 'ens-dao', ens: null },
  { address: '0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0', name: 'efp-team', ens: null },
  { address: '0x0000000000000000000000000000000000000000', name: 'zero-addr', ens: null },
];

const TEST_LIST_IDS = ['5', '1', '100', '1000'];

const TEST_SLOT = {
  chain: '8453',
  contract: '0x41Aa48Ef3c0446b46a5b1cc6337FF3d3716E2A33',
  slot: '0x0000000000000000000000000000000000000000000000000000000000000005',
};

// =============================================================================
// Endpoint Categories
// =============================================================================

const ENDPOINT_CATEGORIES = {
  'Core User Data': {
    priority: 'Critical',
    endpoints: (user) => [
      { path: `/users/${user.address}/account`, name: `${user.name}: account` },
      { path: `/users/${user.address}/details`, name: `${user.name}: details` },
      { path: `/users/${user.address}/stats`, name: `${user.name}: stats` },
      { path: `/users/${user.address}/ens`, name: `${user.name}: ens` },
      { path: `/users/${user.address}/primary-list`, name: `${user.name}: primary-list` },
      ...(user.ens ? [{ path: `/users/${user.ens}/account`, name: `${user.name}: account (ENS)` }] : []),
    ],
  },
  'Followers/Following': {
    priority: 'Critical',
    endpoints: (user) => [
      { path: `/users/${user.address}/followers?limit=5`, name: `${user.name}: followers` },
      { path: `/users/${user.address}/following?limit=5`, name: `${user.name}: following` },
      { path: `/users/${user.address}/allFollowers?limit=5`, name: `${user.name}: allFollowers` },
      { path: `/users/${user.address}/allFollowing?limit=5`, name: `${user.name}: allFollowing` },
      { path: `/users/${user.address}/latestFollowers?limit=5`, name: `${user.name}: latestFollowers` },
      { path: `/users/${user.address}/allFollowingAddresses`, name: `${user.name}: allFollowingAddresses` },
    ],
  },
  'Mutuals': {
    priority: 'High',
    endpoints: (user) => [
      { path: `/users/${user.address}/mutuals?limit=5`, name: `${user.name}: mutuals` },
    ],
  },
  'Relationships': {
    priority: 'Medium',
    endpoints: (user, otherUser) => [
      { path: `/users/${user.address}/${otherUser.address}/followerState`, name: `${user.name} -> ${otherUser.name}: followerState` },
      { path: `/users/${user.address}/relationships`, name: `${user.name}: relationships` },
      { path: `/users/${user.address}/commonFollowers?leader=${otherUser.address}&limit=3`, name: `${user.name}: commonFollowers with ${otherUser.name}` },
      { path: `/users/${user.address}/commonFollowers?limit=3`, name: `${user.name}: commonFollowers (no leader)` },
    ],
  },
  'Tags': {
    priority: 'Medium',
    endpoints: (user) => [
      { path: `/users/${user.address}/tags`, name: `${user.name}: tags` },
      { path: `/users/${user.address}/taggedAs`, name: `${user.name}: taggedAs` },
    ],
  },
  'Search': {
    priority: 'Medium',
    endpoints: (user) => [
      { path: `/users/${user.address}/searchFollowers?term=eth&limit=3`, name: `${user.name}: searchFollowers` },
      { path: `/users/${user.address}/searchFollowing?term=eth&limit=3`, name: `${user.name}: searchFollowing` },
    ],
  },
  'Recommendations': {
    priority: 'Low',
    endpoints: (user) => [
      { path: `/users/${user.address}/recommended?limit=3`, name: `${user.name}: recommended` },
      { path: `/users/${user.address}/recommended/details?limit=3`, name: `${user.name}: recommended/details` },
    ],
  },
  'Badges (POAP)': {
    priority: 'Low',
    endpoints: (user) => [
      { path: `/users/${user.address}/badges`, name: `${user.name}: badges` },
    ],
  },
  'User Other': {
    priority: 'Medium',
    endpoints: (user) => [
      { path: `/users/${user.address}/lists`, name: `${user.name}: lists` },
      { path: `/users/${user.address}/list-records`, name: `${user.name}: list-records` },
      { path: `/users/${user.address}/notifications?limit=3`, name: `${user.name}: notifications` },
      { path: `/users/${user.address}/blocks`, name: `${user.name}: blocks` },
      { path: `/users/${user.address}/mutes`, name: `${user.name}: mutes` },
    ],
  },
  'Lists Core': {
    priority: 'High',
    endpoints: (listId) => [
      { path: `/lists/${listId}/account`, name: `list ${listId}: account` },
      { path: `/lists/${listId}/details`, name: `list ${listId}: details` },
      { path: `/lists/${listId}/stats`, name: `list ${listId}: stats` },
      { path: `/lists/${listId}/records`, name: `list ${listId}: records` },
    ],
  },
  'Lists Followers': {
    priority: 'High',
    endpoints: (listId) => [
      { path: `/lists/${listId}/followers?limit=5`, name: `list ${listId}: followers` },
      { path: `/lists/${listId}/following?limit=5`, name: `list ${listId}: following` },
      { path: `/lists/${listId}/allFollowers?limit=5`, name: `list ${listId}: allFollowers` },
      { path: `/lists/${listId}/allFollowing?limit=5`, name: `list ${listId}: allFollowing` },
      { path: `/lists/${listId}/latestFollowers?limit=5`, name: `list ${listId}: latestFollowers` },
      { path: `/lists/${listId}/allFollowingAddresses`, name: `list ${listId}: allFollowingAddresses` },
    ],
  },
  'Lists Tags': {
    priority: 'Medium',
    endpoints: (listId) => [
      { path: `/lists/${listId}/tags`, name: `list ${listId}: tags` },
      { path: `/lists/${listId}/taggedAs`, name: `list ${listId}: taggedAs` },
    ],
  },
  'Lists Search': {
    priority: 'Medium',
    endpoints: (listId) => [
      { path: `/lists/${listId}/searchFollowers?term=eth&limit=3`, name: `list ${listId}: searchFollowers` },
      { path: `/lists/${listId}/searchFollowing?term=eth&limit=3`, name: `list ${listId}: searchFollowing` },
    ],
  },
  'Lists Recommendations': {
    priority: 'Low',
    endpoints: (listId) => [
      { path: `/lists/${listId}/recommended?limit=3`, name: `list ${listId}: recommended` },
      { path: `/lists/${listId}/recommended/details?limit=3`, name: `list ${listId}: recommended/details` },
    ],
  },
  'Lists Other': {
    priority: 'Medium',
    endpoints: (listId, user) => [
      { path: `/lists/${listId}/badges`, name: `list ${listId}: badges` },
      { path: `/lists/${listId}/${user.address}/followerState`, name: `list ${listId}: followerState (${user.name})` },
      { path: `/lists/${listId}/${user.address}/buttonState`, name: `list ${listId}: buttonState (${user.name})` },
    ],
  },
  'Leaderboard': {
    priority: 'High',
    endpoints: () => [
      { path: '/leaderboard/count', name: 'leaderboard: count' },
      { path: '/leaderboard/followers?limit=5', name: 'leaderboard: followers' },
      { path: '/leaderboard/following?limit=5', name: 'leaderboard: following' },
      { path: '/leaderboard/mutuals?limit=5', name: 'leaderboard: mutuals' },
      { path: '/leaderboard/blocked?limit=5', name: 'leaderboard: blocked' },
      { path: '/leaderboard/blocks?limit=5', name: 'leaderboard: blocks' },
      { path: '/leaderboard/muted?limit=5', name: 'leaderboard: muted' },
      { path: '/leaderboard/mutes?limit=5', name: 'leaderboard: mutes' },
      { path: '/leaderboard/ranked?limit=5', name: 'leaderboard: ranked' },
      { path: '/leaderboard/search?term=vit&limit=5', name: 'leaderboard: search' },
    ],
  },
  'Global': {
    priority: 'High',
    endpoints: () => [
      { path: '/health', name: 'health' },
      { path: '/database/health', name: 'database/health' },
      { path: '/stats', name: 'stats' },
      { path: '/discover', name: 'discover' },
      { path: '/minters', name: 'minters' },
    ],
  },
  'Debug': {
    priority: 'Low',
    endpoints: () => [
      { path: '/debug/num-events', name: 'debug: num-events' },
      { path: '/debug/num-list-ops', name: 'debug: num-list-ops' },
      { path: '/debug/total-supply', name: 'debug: total-supply' },
    ],
  },
  'Slots': {
    priority: 'Medium',
    endpoints: () => [
      { path: `/slots/${TEST_SLOT.chain}/${TEST_SLOT.contract}/${TEST_SLOT.slot}/details`, name: 'slot: details' },
    ],
  },
  'Token': {
    priority: 'Medium',
    endpoints: (listId) => [
      { path: `/token/metadata/${listId}`, name: `token ${listId}: metadata` },
      { path: `/token/metadata/99999999`, name: `token non-existent: metadata` },
      { path: `/token/image/${listId}`, name: `token ${listId}: image` },
      { path: `/token/image/99999999`, name: `token non-existent: image` },
      { path: `/exportState/${listId}`, name: `token ${listId}: exportState` },
    ],
  },
};

// =============================================================================
// Fetch Helper
// =============================================================================

async function fetchWithTimeout(url, timeout = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
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
    if (error.name === 'AbortError') {
      return { status: 'timeout', data: null, error: 'Request timed out' };
    }
    return { status: 'error', data: null, error: error.message };
  }
}

// =============================================================================
// Comparison Logic
// =============================================================================

// Fields to ignore in comparison (timestamps, cache-related, etc.)
const IGNORED_FIELDS = new Set([
  'created_at',
  'updated_at',
  'timestamp',
  'cached_at',
  'cache_time',
  'last_updated',
  'fetched_at',
]);

// Fields where ordering doesn't matter
const UNORDERED_ARRAY_FIELDS = new Set([
  'followers',
  'following',
  'mutuals',
  'tags',
  'records',
]);

function shouldIgnoreField(path) {
  const parts = path.split('.');
  const lastPart = parts[parts.length - 1].replace(/\[\d+\]$/, '');
  return IGNORED_FIELDS.has(lastPart);
}

function normalizeValue(value) {
  if (typeof value === 'string') {
    // Normalize addresses to lowercase
    if (value.match(/^0x[a-fA-F0-9]{40}$/)) {
      return value.toLowerCase();
    }
    // Normalize ENS names to lowercase
    if (value.endsWith('.eth')) {
      return value.toLowerCase();
    }
  }
  return value;
}

function sortArrayForComparison(arr, keyField = 'address') {
  if (!Array.isArray(arr) || arr.length === 0) return arr;

  // Try to sort by a key field if objects
  if (typeof arr[0] === 'object' && arr[0] !== null) {
    const sortKey = keyField in arr[0] ? keyField : Object.keys(arr[0])[0];
    return [...arr].sort((a, b) => {
      const aVal = String(a[sortKey] || '');
      const bVal = String(b[sortKey] || '');
      return aVal.localeCompare(bVal);
    });
  }

  // Sort primitives
  return [...arr].sort();
}

function compareObjects(oldData, newData, path = '', options = {}) {
  const diffs = [];
  const { ignoreOrder = true } = options;

  // Handle null/undefined
  if (oldData === null && newData === null) return diffs;
  if (oldData === undefined && newData === undefined) return diffs;

  if (oldData === null || oldData === undefined) {
    if (newData !== null && newData !== undefined) {
      diffs.push({ path: path || 'root', type: 'missing_in_old', newValue: newData });
    }
    return diffs;
  }

  if (newData === null || newData === undefined) {
    diffs.push({ path: path || 'root', type: 'missing_in_new', oldValue: oldData });
    return diffs;
  }

  // Normalize values
  const normalizedOld = normalizeValue(oldData);
  const normalizedNew = normalizeValue(newData);

  if (normalizedOld === normalizedNew) return diffs;

  // Type mismatch
  if (typeof oldData !== typeof newData) {
    // Special case: number vs string representation
    if (String(oldData) === String(newData)) {
      return diffs; // Acceptable difference
    }
    diffs.push({
      path: path || 'root',
      type: 'type_mismatch',
      oldType: typeof oldData,
      newType: typeof newData,
      oldValue: oldData,
      newValue: newData,
    });
    return diffs;
  }

  // Array comparison
  if (Array.isArray(oldData) && Array.isArray(newData)) {
    if (oldData.length !== newData.length) {
      diffs.push({
        path: path || 'root',
        type: 'array_length',
        oldLength: oldData.length,
        newLength: newData.length,
      });
    }

    // Check if this is an unordered array
    const pathKey = path.split('.').pop()?.replace(/\[\d+\]$/, '') || '';
    const shouldSort = ignoreOrder && UNORDERED_ARRAY_FIELDS.has(pathKey);

    const sortedOld = shouldSort ? sortArrayForComparison(oldData) : oldData;
    const sortedNew = shouldSort ? sortArrayForComparison(newData) : newData;

    // Compare items
    const len = Math.min(sortedOld.length, sortedNew.length, 5); // Limit comparison
    for (let i = 0; i < len; i++) {
      diffs.push(...compareObjects(sortedOld[i], sortedNew[i], `${path}[${i}]`, options));
    }
    return diffs;
  }

  // Object comparison
  if (typeof oldData === 'object' && oldData !== null && newData !== null) {
    const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);

    for (const key of allKeys) {
      const newPath = path ? `${path}.${key}` : key;

      // Skip ignored fields
      if (shouldIgnoreField(newPath)) continue;

      if (!(key in oldData)) {
        diffs.push({ path: newPath, type: 'missing_in_old', newValue: newData[key] });
      } else if (!(key in newData)) {
        diffs.push({ path: newPath, type: 'missing_in_new', oldValue: oldData[key] });
      } else {
        diffs.push(...compareObjects(oldData[key], newData[key], newPath, options));
      }
    }
    return diffs;
  }

  // Primitive comparison
  if (normalizedOld !== normalizedNew) {
    // Skip if ignored field
    if (shouldIgnoreField(path)) return diffs;

    diffs.push({
      path: path || 'root',
      type: 'value_mismatch',
      oldValue: oldData,
      newValue: newData,
    });
  }

  return diffs;
}

// =============================================================================
// Test Runner
// =============================================================================

async function testEndpoint(oldUrl, newUrl, endpoint, timeout) {
  const oldFullUrl = `${oldUrl}${endpoint.path}`;
  const newFullUrl = `${newUrl}${endpoint.path}`;

  const [oldResult, newResult] = await Promise.all([
    fetchWithTimeout(oldFullUrl, timeout),
    fetchWithTimeout(newFullUrl, timeout),
  ]);

  const result = {
    name: endpoint.name,
    path: endpoint.path,
    oldStatus: oldResult.status,
    newStatus: newResult.status,
    oldError: oldResult.error,
    newError: newResult.error,
    match: false,
    diffs: [],
    category: null,
    severity: 'info',
  };

  // Determine status
  if (newResult.status === 404) {
    result.category = 'not_implemented';
    result.severity = 'warning';
    result.diffs.push({ type: 'endpoint_not_implemented', message: 'Endpoint returns 404 in new API' });
    return result;
  }

  if (newResult.status === 501) {
    result.category = 'not_implemented';
    result.severity = 'warning';
    result.diffs.push({ type: 'endpoint_not_implemented', message: 'Endpoint returns 501 Not Implemented' });
    return result;
  }

  if (newResult.error) {
    result.category = 'error';
    result.severity = 'critical';
    result.diffs.push({ type: 'new_api_error', message: newResult.error });
    return result;
  }

  if (oldResult.error) {
    result.category = 'error';
    result.severity = 'info';
    result.diffs.push({ type: 'old_api_error', message: oldResult.error });
    // If old API errors but new works, that's actually good
    if (newResult.status === 200) {
      result.match = true;
      result.category = 'improved';
    }
    return result;
  }

  // Status code mismatch
  if (oldResult.status !== newResult.status) {
    result.diffs.push({
      type: 'status_mismatch',
      oldStatus: oldResult.status,
      newStatus: newResult.status,
    });
    result.severity = 'warning';
  }

  // Compare response data
  if (oldResult.data && newResult.data) {
    const diffs = compareObjects(oldResult.data, newResult.data);
    result.diffs.push(...diffs);
  } else if (oldResult.data && !newResult.data) {
    result.diffs.push({ type: 'missing_response_data', message: 'New API returned no parseable data' });
  }

  // Classify result
  if (result.diffs.length === 0) {
    result.match = true;
    result.category = 'matching';
  } else {
    result.category = 'data_mismatch';

    // Determine severity
    const hasCritical = result.diffs.some(d =>
      d.type === 'missing_in_new' ||
      d.type === 'status_mismatch' ||
      (d.type === 'value_mismatch' && (
        d.path.includes('count') ||
        d.path.includes('address') ||
        d.path === 'root'
      ))
    );
    result.severity = hasCritical ? 'critical' : 'warning';
  }

  return result;
}

function generateEndpoints() {
  const endpoints = [];
  const primaryUser = TEST_USERS[0];
  const secondaryUser = TEST_USERS[1];
  const primaryListId = TEST_LIST_IDS[0];

  for (const [categoryName, category] of Object.entries(ENDPOINT_CATEGORIES)) {
    let categoryEndpoints = [];

    if (categoryName.startsWith('Core User') || categoryName.startsWith('Followers') ||
        categoryName === 'Mutuals' || categoryName.startsWith('Tags') ||
        categoryName === 'Search' || categoryName === 'Recommendations' ||
        categoryName === 'Badges (POAP)' || categoryName === 'User Other') {
      // User endpoints - test with primary user only for speed
      categoryEndpoints = category.endpoints(primaryUser);
    } else if (categoryName === 'Relationships') {
      categoryEndpoints = category.endpoints(primaryUser, secondaryUser);
    } else if (categoryName.startsWith('Lists')) {
      if (categoryName === 'Lists Other') {
        categoryEndpoints = category.endpoints(primaryListId, secondaryUser);
      } else {
        categoryEndpoints = category.endpoints(primaryListId);
      }
    } else if (categoryName === 'Token') {
      categoryEndpoints = category.endpoints(primaryListId);
    } else {
      categoryEndpoints = category.endpoints();
    }

    for (const ep of categoryEndpoints) {
      endpoints.push({
        ...ep,
        categoryName,
        priority: category.priority,
      });
    }
  }

  return endpoints;
}

// =============================================================================
// Report Generator
// =============================================================================

function generateMarkdownReport(results, config, startTime) {
  const endTime = new Date();
  const duration = ((endTime - startTime) / 1000).toFixed(1);

  // Categorize results
  const matching = results.filter(r => r.category === 'matching');
  const dataMismatch = results.filter(r => r.category === 'data_mismatch');
  const notImplemented = results.filter(r => r.category === 'not_implemented');
  const errors = results.filter(r => r.category === 'error');
  const improved = results.filter(r => r.category === 'improved');

  const criticalIssues = dataMismatch.filter(r => r.severity === 'critical');
  const warningIssues = dataMismatch.filter(r => r.severity === 'warning');

  let md = `# EFP API Discrepancy Report

Generated: ${endTime.toISOString()}
Duration: ${duration}s

## Configuration

| Setting | Value |
|---------|-------|
| Old API | ${config.oldUrl} |
| New API | ${config.newUrl} |
| Timeout | ${config.timeout}ms |

## Summary

| Status | Count |
|--------|-------|
| Matching | ${matching.length} |
| Data Mismatch | ${dataMismatch.length} |
| Not Implemented | ${notImplemented.length} |
| Errors | ${errors.length} |
| Improved | ${improved.length} |
| **Total** | **${results.length}** |

### By Severity

| Severity | Count |
|----------|-------|
| Critical | ${criticalIssues.length} |
| Warning | ${warningIssues.length} |
| Info | ${matching.length + improved.length} |

`;

  // Critical Issues Section
  if (criticalIssues.length > 0) {
    md += `## Critical Issues

These issues likely indicate missing data or incorrect implementations that will break clients.

`;
    for (const result of criticalIssues) {
      md += `### ${result.name}

- **Path:** \`${result.path}\`
- **Priority:** ${result.priority}
- **Old Status:** ${result.oldStatus}
- **New Status:** ${result.newStatus}

**Differences:**

`;
      for (const diff of result.diffs.slice(0, 10)) {
        md += formatDiffMarkdown(diff);
      }
      if (result.diffs.length > 10) {
        md += `\n*...and ${result.diffs.length - 10} more differences*\n`;
      }
      md += '\n---\n\n';
    }
  }

  // Warning Issues Section
  if (warningIssues.length > 0) {
    md += `## Warning Issues

These issues indicate minor differences that may be acceptable or cosmetic.

`;
    for (const result of warningIssues) {
      md += `### ${result.name}

- **Path:** \`${result.path}\`
- **Priority:** ${result.priority}

**Differences:**

`;
      for (const diff of result.diffs.slice(0, 5)) {
        md += formatDiffMarkdown(diff);
      }
      if (result.diffs.length > 5) {
        md += `\n*...and ${result.diffs.length - 5} more differences*\n`;
      }
      md += '\n---\n\n';
    }
  }

  // Not Implemented Section
  if (notImplemented.length > 0) {
    md += `## Not Implemented Endpoints

These endpoints return 404 or 501 in the new API.

| Endpoint | Priority |
|----------|----------|
`;
    for (const result of notImplemented) {
      md += `| \`${result.path}\` | ${result.priority} |\n`;
    }
    md += '\n';
  }

  // Errors Section
  if (errors.length > 0) {
    md += `## Errors

These endpoints encountered errors during testing.

| Endpoint | Old Error | New Error |
|----------|-----------|-----------|
`;
    for (const result of errors) {
      md += `| \`${result.path}\` | ${result.oldError || '-'} | ${result.newError || '-'} |\n`;
    }
    md += '\n';
  }

  // Matching Section
  if (matching.length > 0) {
    md += `## Matching Endpoints

These endpoints return identical responses (ignoring timestamps and ordering).

<details>
<summary>Click to expand (${matching.length} endpoints)</summary>

| Endpoint | Priority |
|----------|----------|
`;
    for (const result of matching) {
      md += `| \`${result.path}\` | ${result.priority} |\n`;
    }
    md += `
</details>

`;
  }

  // Improved Section
  if (improved.length > 0) {
    md += `## Improved Endpoints

These endpoints work in the new API but failed in the old API.

| Endpoint | Old Error |
|----------|-----------|
`;
    for (const result of improved) {
      md += `| \`${result.path}\` | ${result.oldError || 'Unknown'} |\n`;
    }
    md += '\n';
  }

  // Category Breakdown
  md += `## Results by Category

`;
  const byCategory = {};
  for (const result of results) {
    const cat = result.categoryName || 'Unknown';
    if (!byCategory[cat]) {
      byCategory[cat] = { matching: 0, mismatch: 0, notImpl: 0, error: 0 };
    }
    if (result.category === 'matching' || result.category === 'improved') byCategory[cat].matching++;
    else if (result.category === 'data_mismatch') byCategory[cat].mismatch++;
    else if (result.category === 'not_implemented') byCategory[cat].notImpl++;
    else if (result.category === 'error') byCategory[cat].error++;
  }

  md += `| Category | Matching | Mismatch | Not Impl | Error |
|----------|----------|----------|----------|-------|
`;
  for (const [cat, counts] of Object.entries(byCategory)) {
    md += `| ${cat} | ${counts.matching} | ${counts.mismatch} | ${counts.notImpl} | ${counts.error} |\n`;
  }

  md += `
---

*Report generated by test-discrepancy-report.mjs*
`;

  return md;
}

function formatDiffMarkdown(diff) {
  switch (diff.type) {
    case 'value_mismatch':
      return `- **\`${diff.path}\`**: Value mismatch
  - Old: \`${JSON.stringify(diff.oldValue)?.slice(0, 100)}\`
  - New: \`${JSON.stringify(diff.newValue)?.slice(0, 100)}\`
`;
    case 'missing_in_new':
      return `- **\`${diff.path}\`**: Missing in new API
  - Old value: \`${JSON.stringify(diff.oldValue)?.slice(0, 100)}\`
`;
    case 'missing_in_old':
      return `- **\`${diff.path}\`**: Extra field in new API
  - New value: \`${JSON.stringify(diff.newValue)?.slice(0, 100)}\`
`;
    case 'array_length':
      return `- **\`${diff.path}\`**: Array length mismatch
  - Old: ${diff.oldLength} items
  - New: ${diff.newLength} items
`;
    case 'type_mismatch':
      return `- **\`${diff.path}\`**: Type mismatch
  - Old type: ${diff.oldType} (\`${JSON.stringify(diff.oldValue)?.slice(0, 50)}\`)
  - New type: ${diff.newType} (\`${JSON.stringify(diff.newValue)?.slice(0, 50)}\`)
`;
    case 'status_mismatch':
      return `- **Status code mismatch**: Old=${diff.oldStatus}, New=${diff.newStatus}
`;
    case 'endpoint_not_implemented':
      return `- ${diff.message}
`;
    case 'new_api_error':
    case 'old_api_error':
      return `- **Error**: ${diff.message}
`;
    default:
      return `- **\`${diff.path}\`**: ${diff.type}
`;
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();
  const startTime = new Date();

  console.log('='.repeat(80));
  console.log('EFP API Discrepancy Report Generator');
  console.log('='.repeat(80));
  console.log(`Old API: ${config.oldUrl}`);
  console.log(`New API: ${config.newUrl}`);
  console.log(`Output:  ${config.output}`);
  console.log('='.repeat(80));
  console.log('');

  // Generate endpoints to test
  const endpoints = generateEndpoints();
  console.log(`Testing ${endpoints.length} endpoints...`);
  console.log('');

  const results = [];
  let completed = 0;

  for (const endpoint of endpoints) {
    completed++;
    const progress = `[${completed}/${endpoints.length}]`;
    process.stdout.write(`\r${progress} Testing: ${endpoint.name.padEnd(50).slice(0, 50)}`);

    try {
      const result = await testEndpoint(config.oldUrl, config.newUrl, endpoint, config.timeout);
      result.categoryName = endpoint.categoryName;
      result.priority = endpoint.priority;
      results.push(result);

      if (config.verbose && !result.match) {
        console.log(`\n  -> ${result.category}: ${result.diffs.length} differences`);
      }
    } catch (error) {
      results.push({
        name: endpoint.name,
        path: endpoint.path,
        categoryName: endpoint.categoryName,
        priority: endpoint.priority,
        category: 'error',
        severity: 'critical',
        match: false,
        diffs: [{ type: 'test_error', message: error.message }],
      });
    }
  }

  console.log('\n\n');

  // Print summary
  const matching = results.filter(r => r.category === 'matching');
  const dataMismatch = results.filter(r => r.category === 'data_mismatch');
  const notImplemented = results.filter(r => r.category === 'not_implemented');
  const errors = results.filter(r => r.category === 'error');

  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Matching:        ${matching.length}`);
  console.log(`Data Mismatch:   ${dataMismatch.length}`);
  console.log(`Not Implemented: ${notImplemented.length}`);
  console.log(`Errors:          ${errors.length}`);
  console.log('');

  // Generate and write report
  const report = generateMarkdownReport(results, config, startTime);
  writeFileSync(config.output, report);
  console.log(`Report written to: ${config.output}`);
  console.log('='.repeat(80));

  // Exit with error code if there are critical issues
  const criticalIssues = dataMismatch.filter(r => r.severity === 'critical');
  if (criticalIssues.length > 0 || errors.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
