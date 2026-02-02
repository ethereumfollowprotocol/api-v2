#!/usr/bin/env node

/**
 * Import Recommended Accounts Script
 *
 * Reads ENS names from a JSON file and populates the efp_recommended table
 * by joining with ens_metadata to get addresses, avatars, etc.
 *
 * Usage:
 *   node scripts/import-recommended.mjs --file ~/work/ethfollow/recommended-list/recommended.json
 *   node scripts/import-recommended.mjs --file recommended.json --database-url postgresql://...
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Pool } = pg;

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    file: null,
    databaseUrl: process.env.DATABASE_URL,
    dryRun: false,
    shuffle: true,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
      case '-f':
        config.file = args[++i];
        break;
      case '--database-url':
      case '-d':
        config.databaseUrl = args[++i];
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--no-shuffle':
        config.shuffle = false;
        break;
      case '--help':
      case '-h':
        console.log(`
Import Recommended Accounts Script

Reads ENS names from a JSON file and populates the efp_recommended table
by joining with ens_metadata to get addresses, avatars, etc.

Usage:
  node scripts/import-recommended.mjs [options]

Options:
  --file, -f <path>       Path to recommended.json file (required)
  --database-url, -d      PostgreSQL connection string (default: DATABASE_URL env)
  --dry-run               Show what would be imported without making changes
  --no-shuffle            Don't shuffle after import (keeps original order)
  --help, -h              Show this help message

Example:
  node scripts/import-recommended.mjs -f ~/work/ethfollow/recommended-list/recommended.json
`);
        process.exit(0);
    }
  }

  if (!config.file) {
    console.error('Error: --file is required');
    process.exit(1);
  }

  if (!config.databaseUrl) {
    console.error('Error: DATABASE_URL environment variable or --database-url is required');
    process.exit(1);
  }

  return config;
}

// =============================================================================
// Database Operations
// =============================================================================

async function importRecommended(config) {
  const pool = new Pool({ connectionString: config.databaseUrl });

  try {
    // Read JSON file
    const filePath = resolve(config.file);
    console.log(`Reading file: ${filePath}`);

    const jsonContent = readFileSync(filePath, 'utf-8');
    const lists = JSON.parse(jsonContent);

    const listA = lists.List_A || [];
    const listB = lists.List_B || [];
    const listC = lists.List_C || [];

    console.log(`Found ${listA.length} List_A, ${listB.length} List_B, ${listC.length} List_C entries`);
    console.log(`Total: ${listA.length + listB.length + listC.length} ENS names`);

    // Build list of all names with their class
    const allNames = [
      ...listA.map(name => ({ name: name.toLowerCase(), class: 'A' })),
      ...listB.map(name => ({ name: name.toLowerCase(), class: 'B' })),
      ...listC.map(name => ({ name: name.toLowerCase(), class: 'C' })),
    ];

    // Query ens_metadata to get addresses and avatars
    console.log('\nQuerying ens_metadata for matching records...');

    const nameList = allNames.map(n => n.name);
    const result = await pool.query(
      `SELECT LOWER(name) as name, address, avatar, header, records
       FROM ens_metadata
       WHERE LOWER(name) = ANY($1)`,
      [nameList]
    );

    console.log(`Found ${result.rows.length} matching records in ens_metadata`);

    // Create a map of name -> metadata
    const metadataMap = new Map();
    for (const row of result.rows) {
      metadataMap.set(row.name.toLowerCase(), row);
    }

    // Build records to insert
    const records = [];
    const notFound = [];

    for (const { name, class: ensClass } of allNames) {
      const metadata = metadataMap.get(name);
      if (metadata) {
        // Extract header from records if available
        let header = metadata.header;
        if (!header && metadata.records?.header) {
          header = metadata.records.header;
        }

        records.push({
          name: metadata.name || name,
          address: metadata.address.toLowerCase(),
          avatar: metadata.avatar || `https://metadata.ens.domains/mainnet/avatar/${name}`,
          header: header || null,
          class: ensClass,
        });
      } else {
        notFound.push(name);
      }
    }

    console.log(`\nReady to import ${records.length} records`);

    if (notFound.length > 0) {
      console.log(`\nWarning: ${notFound.length} names not found in ens_metadata:`);
      // Group by class for display
      const notFoundA = notFound.filter(n => listA.map(x => x.toLowerCase()).includes(n));
      const notFoundB = notFound.filter(n => listB.map(x => x.toLowerCase()).includes(n));
      const notFoundC = notFound.filter(n => listC.map(x => x.toLowerCase()).includes(n));

      if (notFoundA.length > 0) console.log(`  List_A: ${notFoundA.slice(0, 10).join(', ')}${notFoundA.length > 10 ? ` ... and ${notFoundA.length - 10} more` : ''}`);
      if (notFoundB.length > 0) console.log(`  List_B: ${notFoundB.slice(0, 10).join(', ')}${notFoundB.length > 10 ? ` ... and ${notFoundB.length - 10} more` : ''}`);
      if (notFoundC.length > 0) console.log(`  List_C: ${notFoundC.slice(0, 10).join(', ')}${notFoundC.length > 10 ? ` ... and ${notFoundC.length - 10} more` : ''}`);
    }

    if (config.dryRun) {
      console.log('\n[DRY RUN] Would insert the following records:');
      console.log(`  List_A: ${records.filter(r => r.class === 'A').length}`);
      console.log(`  List_B: ${records.filter(r => r.class === 'B').length}`);
      console.log(`  List_C: ${records.filter(r => r.class === 'C').length}`);
      console.log('\nSample records:');
      for (const record of records.slice(0, 5)) {
        console.log(`  ${record.class}: ${record.name} (${record.address.slice(0, 10)}...)`);
      }
      return;
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Clear existing records
      console.log('\nClearing existing efp_recommended records...');
      await client.query('TRUNCATE efp_recommended');

      // Shuffle if requested
      let finalRecords = records;
      if (config.shuffle) {
        console.log('Shuffling with weighted randomization...');
        finalRecords = shuffleWithWeights(records);
      }

      // Insert records with index
      console.log('Inserting records...');

      for (let i = 0; i < finalRecords.length; i++) {
        const record = finalRecords[i];
        await client.query(
          `INSERT INTO efp_recommended (index, address, name, avatar, header, class)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (address) DO UPDATE SET
             index = EXCLUDED.index,
             name = EXCLUDED.name,
             avatar = EXCLUDED.avatar,
             header = EXCLUDED.header,
             class = EXCLUDED.class`,
          [i, record.address, record.name, record.avatar, record.header, record.class]
        );
      }

      await client.query('COMMIT');
      console.log(`\nSuccessfully imported ${finalRecords.length} records!`);

      // Show breakdown
      const countA = finalRecords.filter(r => r.class === 'A').length;
      const countB = finalRecords.filter(r => r.class === 'B').length;
      const countC = finalRecords.filter(r => r.class === 'C').length;
      console.log(`  List_A: ${countA}`);
      console.log(`  List_B: ${countB}`);
      console.log(`  List_C: ${countC}`);

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } finally {
    await pool.end();
  }
}

/**
 * Shuffles records using weighted randomization
 * Class A: 50% weight (top priority)
 * Class B: 35% weight + 10% offset
 * Class C: 20% weight
 */
function shuffleWithWeights(records) {
  return records
    .map((record) => {
      let weight;
      switch (record.class) {
        case 'A':
          weight = Math.random() * 0.5;
          break;
        case 'B':
          weight = 0.1 + Math.random() * 0.35;
          break;
        case 'C':
        default:
          weight = Math.random() * 0.2;
          break;
      }
      return { ...record, weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .map(({ weight, ...record }) => record);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();

  console.log('='.repeat(60));
  console.log('Import Recommended Accounts');
  console.log('='.repeat(60));

  try {
    await importRecommended(config);
  } catch (err) {
    console.error('\nError:', err.message);
    process.exit(1);
  }
}

main();
