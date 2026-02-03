# EFP API Discrepancy Report

Generated: 2026-02-02T06:57:49.827Z
Duration: 71.9s

## Configuration

| Setting | Value |
|---------|-------|
| Old API | https://data.ethfollow.xyz/api/v1 |
| New API | https://efp-api-v2.up.railway.app/api/v1 |
| Timeout | 30000ms |

## Summary

| Status | Count |
|--------|-------|
| Matching | 15 |
| Data Mismatch | 53 |
| Not Implemented | 4 |
| Errors | 0 |
| Improved | 0 |
| **Total** | **72** |

### By Severity

| Severity | Count |
|----------|-------|
| Critical | 36 |
| Warning | 17 |
| Info | 15 |

## Critical Issues

These issues likely indicate missing data or incorrect implementations that will break clients.

### vitalik: stats

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/stats`
- **Priority:** Critical
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`followers_count`**: Value mismatch
  - Old: `5269`
  - New: `5263`

---

### vitalik: followers

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/followers?limit=5`
- **Priority:** Critical
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`followers[0].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53473"`
  - New: `"9907"`
- **`followers[0].address`**: Value mismatch
  - Old: `"0x00a4911eb29e83b59b2b02acb94705d38cb4679b"`
  - New: `"0x1592923d399fc2f6a7ee416e776d5158e6d13b25"`
- **`followers[1].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53468"`
  - New: `"9887"`
- **`followers[1].address`**: Value mismatch
  - Old: `"0x0a232511b97877c3c7c256ca9356a81ecea32d57"`
  - New: `"0x1b5b4fcedf1252cd92496a2fd5c593b39ac49b01"`
- **`followers[2].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53654"`
  - New: `"9966"`
- **`followers[2].address`**: Value mismatch
  - Old: `"0x2812a098a6d9dec80f7cb90ff9088231d31d83a9"`
  - New: `"0x770bebe5946907cee4dfe004f1648ac435a9d5bb"`
- **`followers[3].efp_list_nft_token_id`**: Value mismatch
  - Old: `"27484"`
  - New: `"9897"`
- **`followers[3].address`**: Value mismatch
  - Old: `"0x8e5ecd9737f8094c629c4001af9d708d5720ab1f"`
  - New: `"0xb40a0b4b6c4534768291e1af3467e65692666666"`
- **`followers[4].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53689"`
  - New: `"9932"`
- **`followers[4].address`**: Value mismatch
  - Old: `"0xece76c007de61d05de2d2998786ce7a19ee27203"`
  - New: `"0xbdcf4b0d81e4647a6aeb18815a3ea442d95329ce"`

---

### vitalik: following

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/following?limit=5`
- **Priority:** Critical
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`following[1].data`**: Value mismatch
  - Old: `"0x2b888954421b424c5d3d9ce9bb67c9bd47537d12"`
  - New: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
- **`following[1].address`**: Value mismatch
  - Old: `"0x2b888954421b424c5d3d9ce9bb67c9bd47537d12"`
  - New: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
- **`following[2].data`**: Value mismatch
  - Old: `"0x50ec05ade8280758e2077fcbc08d878d4aef79c3"`
  - New: `"0x648aa14e4424e0825a5ce739c8c68610e143fb79"`
- **`following[2].address`**: Value mismatch
  - Old: `"0x50ec05ade8280758e2077fcbc08d878d4aef79c3"`
  - New: `"0x648aa14e4424e0825a5ce739c8c68610e143fb79"`
- **`following[3].data`**: Value mismatch
  - Old: `"0x54becc7560a7be76d72ed76a1f5fee6c5a2a7ab6"`
  - New: `"0xb8c2c29ee19d8307cb7255e1cd9cbde883a267d5"`
- **`following[3].address`**: Value mismatch
  - Old: `"0x54becc7560a7be76d72ed76a1f5fee6c5a2a7ab6"`
  - New: `"0xb8c2c29ee19d8307cb7255e1cd9cbde883a267d5"`
- **`following[4].data`**: Value mismatch
  - Old: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
  - New: `"0xd7029bdea1c17493893aafe29aad69ef892b8ff2"`
- **`following[4].address`**: Value mismatch
  - Old: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
  - New: `"0xd7029bdea1c17493893aafe29aad69ef892b8ff2"`

---

### vitalik: allFollowers

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/allFollowers?limit=5`
- **Priority:** Critical
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`followers[0].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53473"`
  - New: `"9907"`
- **`followers[0].address`**: Value mismatch
  - Old: `"0x00a4911eb29e83b59b2b02acb94705d38cb4679b"`
  - New: `"0x1592923d399fc2f6a7ee416e776d5158e6d13b25"`
- **`followers[1].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53468"`
  - New: `"9887"`
- **`followers[1].address`**: Value mismatch
  - Old: `"0x0a232511b97877c3c7c256ca9356a81ecea32d57"`
  - New: `"0x1b5b4fcedf1252cd92496a2fd5c593b39ac49b01"`
- **`followers[2].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53654"`
  - New: `"9966"`
- **`followers[2].address`**: Value mismatch
  - Old: `"0x2812a098a6d9dec80f7cb90ff9088231d31d83a9"`
  - New: `"0x770bebe5946907cee4dfe004f1648ac435a9d5bb"`
- **`followers[3].efp_list_nft_token_id`**: Value mismatch
  - Old: `"27484"`
  - New: `"9897"`
- **`followers[3].address`**: Value mismatch
  - Old: `"0x8e5ecd9737f8094c629c4001af9d708d5720ab1f"`
  - New: `"0xb40a0b4b6c4534768291e1af3467e65692666666"`
- **`followers[4].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53689"`
  - New: `"9932"`
- **`followers[4].address`**: Value mismatch
  - Old: `"0xece76c007de61d05de2d2998786ce7a19ee27203"`
  - New: `"0xbdcf4b0d81e4647a6aeb18815a3ea442d95329ce"`

---

### vitalik: allFollowing

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/allFollowing?limit=5`
- **Priority:** Critical
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`following[1].data`**: Value mismatch
  - Old: `"0x2b888954421b424c5d3d9ce9bb67c9bd47537d12"`
  - New: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
- **`following[1].address`**: Value mismatch
  - Old: `"0x2b888954421b424c5d3d9ce9bb67c9bd47537d12"`
  - New: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
- **`following[2].data`**: Value mismatch
  - Old: `"0x50ec05ade8280758e2077fcbc08d878d4aef79c3"`
  - New: `"0x648aa14e4424e0825a5ce739c8c68610e143fb79"`
- **`following[2].address`**: Value mismatch
  - Old: `"0x50ec05ade8280758e2077fcbc08d878d4aef79c3"`
  - New: `"0x648aa14e4424e0825a5ce739c8c68610e143fb79"`
- **`following[3].data`**: Value mismatch
  - Old: `"0x54becc7560a7be76d72ed76a1f5fee6c5a2a7ab6"`
  - New: `"0xb8c2c29ee19d8307cb7255e1cd9cbde883a267d5"`
- **`following[3].address`**: Value mismatch
  - Old: `"0x54becc7560a7be76d72ed76a1f5fee6c5a2a7ab6"`
  - New: `"0xb8c2c29ee19d8307cb7255e1cd9cbde883a267d5"`
- **`following[4].data`**: Value mismatch
  - Old: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
  - New: `"0xd7029bdea1c17493893aafe29aad69ef892b8ff2"`
- **`following[4].address`**: Value mismatch
  - Old: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
  - New: `"0xd7029bdea1c17493893aafe29aad69ef892b8ff2"`

---

### vitalik: latestFollowers

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/latestFollowers?limit=5`
- **Priority:** Critical
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`followers[0].address`**: Value mismatch
  - Old: `"0x00a4911eb29e83b59b2b02acb94705d38cb4679b"`
  - New: `"0x1592923d399fc2f6a7ee416e776d5158e6d13b25"`
- **`followers[0].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53473"`
  - New: `"9907"`
- **`followers[0].tags`**: Extra field in new API
  - New value: `[]`
- **`followers[0].is_following`**: Extra field in new API
  - New value: `false`
- **`followers[0].is_blocked`**: Extra field in new API
  - New value: `false`
- **`followers[0].is_muted`**: Extra field in new API
  - New value: `false`
- **`followers[1].address`**: Value mismatch
  - Old: `"0x0a232511b97877c3c7c256ca9356a81ecea32d57"`
  - New: `"0x1b5b4fcedf1252cd92496a2fd5c593b39ac49b01"`
- **`followers[1].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53468"`
  - New: `"9887"`
- **`followers[1].tags`**: Extra field in new API
  - New value: `[]`
- **`followers[1].is_following`**: Extra field in new API
  - New value: `false`

*...and 20 more differences*

---

### vitalik: allFollowingAddresses

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/allFollowingAddresses`
- **Priority:** Critical
- **Old Status:** 404
- **New Status:** 200

**Differences:**

- **Status code mismatch**: Old=404, New=200
- **`error`**: Missing in new API
  - Old value: `"http://efp-us-east-1.ethfollow.xyz/api/v1/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/allFollo`
- **`0`**: Extra field in new API
  - New value: `"0x648aa14e4424e0825a5ce739c8c68610e143fb79"`
- **`1`**: Extra field in new API
  - New value: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
- **`2`**: Extra field in new API
  - New value: `"0x1b63142628311395ceafeea5667e7c9026c862ca"`
- **`3`**: Extra field in new API
  - New value: `"0xd7029bdea1c17493893aafe29aad69ef892b8ff2"`
- **`4`**: Extra field in new API
  - New value: `"0xb8c2c29ee19d8307cb7255e1cd9cbde883a267d5"`
- **`5`**: Extra field in new API
  - New value: `"0x2b888954421b424c5d3d9ce9bb67c9bd47537d12"`
- **`6`**: Extra field in new API
  - New value: `"0x983110309620d911731ac0932219af06091b6744"`
- **`7`**: Extra field in new API
  - New value: `"0x54becc7560a7be76d72ed76a1f5fee6c5a2a7ab6"`

*...and 2 more differences*

---

### vitalik: relationships

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/relationships`
- **Priority:** Medium
- **Old Status:** 500
- **New Status:** 400

**Differences:**

- **Status code mismatch**: Old=500, New=400

---

### vitalik: commonFollowers with brantly

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/commonFollowers?leader=0x983110309620d911731ac0932219af06091b6744&limit=3`
- **Priority:** Medium
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`results[0].avatar`**: Value mismatch
  - Old: `""`
  - New: `"https://raw2.seadn.io/ethereum/0x495f947276749ce646f68ac8c248420045cb7b5e/15052159453d56bd039c6374c`
- **`results[0].header`**: Extra field in new API
  - New value: `""`
- **`results[0].mutuals_rank`**: Type mismatch
  - Old type: string (`"1633"`)
  - New type: number (`1403`)
- **`results[1].header`**: Extra field in new API
  - New value: `""`
- **`results[1].mutuals_rank`**: Type mismatch
  - Old type: string (`"3011"`)
  - New type: number (`2586`)
- **`results[2].address`**: Value mismatch
  - Old: `"0x648aa14e4424e0825a5ce739c8c68610e143fb79"`
  - New: `"0x2b888954421b424c5d3d9ce9bb67c9bd47537d12"`
- **`results[2].name`**: Value mismatch
  - Old: `"sassal.eth"`
  - New: `"lefteris.eth"`
- **`results[2].avatar`**: Value mismatch
  - Old: `"https://metadata.ens.domains/mainnet/avatar/sassal.eth"`
  - New: `"https://s.gravatar.com/avatar/9c124c1f38e3df30d0c582beec001257?s=420"`
- **`results[2].header`**: Extra field in new API
  - New value: `""`
- **`results[2].mutuals_rank`**: Type mismatch
  - Old type: string (`"5755"`)
  - New type: number (`2781`)

---

### vitalik: commonFollowers (no leader)

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/commonFollowers?limit=3`
- **Priority:** Medium
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`results[0].address`**: Value mismatch
  - Old: `"0x54becc7560a7be76d72ed76a1f5fee6c5a2a7ab6"`
  - New: `"0x983110309620d911731ac0932219af06091b6744"`
- **`results[0].name`**: Value mismatch
  - Old: `"simona.eth"`
  - New: `"brantly.eth"`
- **`results[0].avatar`**: Value mismatch
  - Old: `""`
  - New: `"https://euc.li/brantly.eth"`
- **`results[0].header`**: Extra field in new API
  - New value: `"https://euc.li/brantly.eth/h"`
- **`results[0].mutuals_rank`**: Type mismatch
  - Old type: string (`"1633"`)
  - New type: number (`57`)
- **`results[1].address`**: Value mismatch
  - Old: `"0x983110309620d911731ac0932219af06091b6744"`
  - New: `"0x54becc7560a7be76d72ed76a1f5fee6c5a2a7ab6"`
- **`results[1].name`**: Value mismatch
  - Old: `"brantly.eth"`
  - New: `"simona.eth"`
- **`results[1].avatar`**: Value mismatch
  - Old: `"https://euc.li/brantly.eth"`
  - New: `"https://raw2.seadn.io/ethereum/0x495f947276749ce646f68ac8c248420045cb7b5e/15052159453d56bd039c6374c`
- **`results[1].header`**: Value mismatch
  - Old: `"https://euc.li/brantly.eth/h"`
  - New: `""`
- **`results[1].mutuals_rank`**: Type mismatch
  - Old type: string (`"66"`)
  - New type: number (`1403`)

*...and 5 more differences*

---

### vitalik: taggedAs

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/taggedAs`
- **Priority:** Medium
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`tags`**: Array length mismatch
  - Old: 12 items
  - New: 10 items
- **`tags[4]`**: Value mismatch
  - Old: `"dev"`
  - New: `"eth"`
- **`tagCounts`**: Array length mismatch
  - Old: 12 items
  - New: 10 items
- **`tagCounts[0].count`**: Value mismatch
  - Old: `181`
  - New: `167`
- **`tagCounts[1].tag`**: Value mismatch
  - Old: `"degen"`
  - New: `"based"`
- **`tagCounts[1].count`**: Value mismatch
  - Old: `6`
  - New: `7`
- **`tagCounts[2].tag`**: Value mismatch
  - Old: `"based"`
  - New: `"mute"`
- **`tagCounts[2].count`**: Value mismatch
  - Old: `7`
  - New: `1`
- **`tagCounts[3].tag`**: Value mismatch
  - Old: `"eth"`
  - New: `"bff"`
- **`tagCounts[3].count`**: Value mismatch
  - Old: `2`
  - New: `3`

*...and 9 more differences*

---

### vitalik: searchFollowers

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/searchFollowers?term=eth&limit=3`
- **Priority:** Medium
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`followers[0].efp_list_nft_token_id`**: Value mismatch
  - Old: `"13635"`
  - New: `"9907"`
- **`followers[0].address`**: Value mismatch
  - Old: `"0x00000066ced4c62a0f740de74eb08bc2a1552764"`
  - New: `"0x1592923d399fc2f6a7ee416e776d5158e6d13b25"`
- **`followers[0].ens`**: Missing in new API
  - Old value: `{"name":"0xamun.eth","avatar":""}`
- **`followers[1].efp_list_nft_token_id`**: Value mismatch
  - Old: `"52302"`
  - New: `"9990"`
- **`followers[1].address`**: Value mismatch
  - Old: `"0x000000dcf1190af44f7149b85299f18ce7221024"`
  - New: `"0x19da4d36184dd9022e87423d009ebf8fdebd1133"`
- **`followers[1].ens`**: Missing in new API
  - Old value: `{"name":"blackkey.eth","avatar":"https://euc.li/blackkey.eth"}`
- **`followers[2].efp_list_nft_token_id`**: Value mismatch
  - Old: `"43711"`
  - New: `"9932"`
- **`followers[2].address`**: Value mismatch
  - Old: `"0x000066b5a8e1e35b7e2f64e24715829647f80000"`
  - New: `"0xbdcf4b0d81e4647a6aeb18815a3ea442d95329ce"`
- **`followers[2].ens`**: Missing in new API
  - Old value: `{"name":"0.coa.eth","avatar":"https://arweave.net/du1YApNYypeENNWsr2YtI38ZxSmxapj6US3-Gl2Z3Ak"}`

---

### vitalik: searchFollowing

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/searchFollowing?term=eth&limit=3`
- **Priority:** Medium
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`following[0].ens`**: Missing in new API
  - Old value: `{"name":"tgerring.eth","avatar":"https://raw2.seadn.io/ethereum/0x495f947276749ce646f68ac8c248420045`
- **`following[1].data`**: Value mismatch
  - Old: `"0x2b888954421b424c5d3d9ce9bb67c9bd47537d12"`
  - New: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
- **`following[1].address`**: Value mismatch
  - Old: `"0x2b888954421b424c5d3d9ce9bb67c9bd47537d12"`
  - New: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
- **`following[1].ens`**: Missing in new API
  - Old value: `{"name":"lefteris.eth","avatar":"https://s.gravatar.com/avatar/9c124c1f38e3df30d0c582beec001257?s=42`
- **`following[2].data`**: Value mismatch
  - Old: `"0x50ec05ade8280758e2077fcbc08d878d4aef79c3"`
  - New: `"0x648aa14e4424e0825a5ce739c8c68610e143fb79"`
- **`following[2].address`**: Value mismatch
  - Old: `"0x50ec05ade8280758e2077fcbc08d878d4aef79c3"`
  - New: `"0x648aa14e4424e0825a5ce739c8c68610e143fb79"`
- **`following[2].ens`**: Missing in new API
  - Old value: `{"name":"hayden.eth","avatar":"https://metadata.ens.domains/mainnet/avatar/hayden.eth"}`

---

### vitalik: recommended

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/recommended?limit=3`
- **Priority:** Low
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`recommended[0].name`**: Value mismatch
  - Old: `"timbeiko.eth"`
  - New: `"barmstrong.eth"`
- **`recommended[0].address`**: Value mismatch
  - Old: `"0x10f5d45854e038071485ac9e402308cf80d2d2fe"`
  - New: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
- **`recommended[0].avatar`**: Value mismatch
  - Old: `"https://metadata.ens.domains/mainnet/avatar/timbeiko.eth"`
  - New: `"https://euc.li/barmstrong.eth"`
- **`recommended[0].header`**: Missing in new API
  - Old value: `null`
- **`recommended[1].name`**: Value mismatch
  - Old: `"balajis.eth"`
  - New: `"jda.eth"`
- **`recommended[1].address`**: Value mismatch
  - Old: `"0x0916c04994849c676ab2667ce5bbdf7ccc94310a"`
  - New: `"0x7aba4f721610816d08cf059d347de8d74406fed7"`
- **`recommended[1].avatar`**: Value mismatch
  - Old: `"https://metadata.ens.domains/mainnet/avatar/balajis.eth"`
  - New: `"https://euc.li/jda.eth"`
- **`recommended[1].header`**: Missing in new API
  - Old value: `null`
- **`recommended[2].name`**: Value mismatch
  - Old: `"ericakang.eth"`
  - New: `"jacob.eth"`
- **`recommended[2].address`**: Value mismatch
  - Old: `"0x092ad3842dced68b5b6ef9cc602be66924baecdd"`
  - New: `"0x17cd072cbd45031efc21da538c783e0ed3b25dcc"`

*...and 2 more differences*

---

### vitalik: recommended/details

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/recommended/details?limit=3`
- **Priority:** Low
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`recommended[0].address`**: Value mismatch
  - Old: `"0x10f5d45854e038071485ac9e402308cf80d2d2fe"`
  - New: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
- **`recommended[0].ens.name`**: Value mismatch
  - Old: `"timbeiko.eth"`
  - New: `"barmstrong.eth"`
- **`recommended[0].ens.avatar`**: Value mismatch
  - Old: `"https://metadata.ens.domains/mainnet/avatar/timbeiko.eth"`
  - New: `"https://euc.li/barmstrong.eth"`
- **`recommended[0].ens.records`**: Type mismatch
  - Old type: object (`{"com.discord":"timbeiko#4247","com.twitter":"@tim`)
  - New type: string (`"{\"url\":\"https://www.brianarmstrong.org/\",\"av`)
- **`recommended[0].stats.followers_count`**: Type mismatch
  - Old type: string (`"706"`)
  - New type: number (`2448`)
- **`recommended[0].ranks.mutuals_rank`**: Extra field in new API
  - New value: `11605`
- **`recommended[0].ranks.followers_rank`**: Type mismatch
  - Old type: string (`"119"`)
  - New type: number (`7`)
- **`recommended[0].ranks.following_rank`**: Extra field in new API
  - New value: `32668`
- **`recommended[0].ranks.top8_rank`**: Type mismatch
  - Old type: string (`"271"`)
  - New type: number (`4`)
- **`recommended[0].ranks.blocks_rank`**: Extra field in new API
  - New value: `22`

*...and 20 more differences*

---

### list 5: stats

- **Path:** `/lists/5/stats`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`followers_count`**: Value mismatch
  - Old: `1118`
  - New: `1104`
- **`following_count`**: Value mismatch
  - Old: `1416`
  - New: `6`

---

### list 5: followers

- **Path:** `/lists/5/followers?limit=5`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`followers[0].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53731"`
  - New: `"9673"`
- **`followers[0].address`**: Value mismatch
  - Old: `"0x18480a75f76bb1968a9ef28b809fab2ca9c2d154"`
  - New: `"0x255749ce8ab1dd14c09787e7405a15ff17c24459"`
- **`followers[1].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53506"`
  - New: `"9648"`
- **`followers[1].address`**: Value mismatch
  - Old: `"0x5b7c8397eaa5f29796515b44aab9ab0a92029380"`
  - New: `"0x54ccbb5c380f2543bf210bebb0784878784868f7"`
- **`followers[2].efp_list_nft_token_id`**: Value mismatch
  - Old: `"39903"`
  - New: `"9932"`
- **`followers[2].address`**: Value mismatch
  - Old: `"0x5eb626cc0a4e04239accbdaec3bd8ab3a665a0d6"`
  - New: `"0xbdcf4b0d81e4647a6aeb18815a3ea442d95329ce"`
- **`followers[3].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53531"`
  - New: `"6732"`
- **`followers[3].address`**: Value mismatch
  - Old: `"0x9eae5a3819ad2bd007b7cf5c40b26b80a5aaad73"`
  - New: `"0xd283ac6b8dd58cde7ede41002219d976115dca36"`
- **`followers[4].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53557"`
  - New: `"6694"`
- **`followers[4].address`**: Value mismatch
  - Old: `"0xa552fd4da895a720ba6d939396479d650faece47"`
  - New: `"0xe1832796ad095e1bcc0deecabdbcba9e26a88466"`

---

### list 5: allFollowers

- **Path:** `/lists/5/allFollowers?limit=5`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`followers[0].efp_list_nft_token_id`**: Value mismatch
  - Old: `"44"`
  - New: `"9673"`
- **`followers[0].address`**: Value mismatch
  - Old: `"0x111111176b0b13ffc31d387d08726772a0492948"`
  - New: `"0x255749ce8ab1dd14c09787e7405a15ff17c24459"`
- **`followers[0].is_following`**: Value mismatch
  - Old: `true`
  - New: `false`
- **`followers[1].efp_list_nft_token_id`**: Value mismatch
  - Old: `"22"`
  - New: `"9648"`
- **`followers[1].address`**: Value mismatch
  - Old: `"0x3570958b8dcbc4f663f508efcedb454ee9af9516"`
  - New: `"0x54ccbb5c380f2543bf210bebb0784878784868f7"`
- **`followers[1].is_following`**: Value mismatch
  - Old: `true`
  - New: `false`
- **`followers[2].efp_list_nft_token_id`**: Value mismatch
  - Old: `"35"`
  - New: `"9932"`
- **`followers[2].address`**: Value mismatch
  - Old: `"0x8f004f5a2b12eb26cc77291aa879c42a4af1ae6d"`
  - New: `"0xbdcf4b0d81e4647a6aeb18815a3ea442d95329ce"`
- **`followers[2].is_following`**: Value mismatch
  - Old: `true`
  - New: `false`
- **`followers[3].efp_list_nft_token_id`**: Value mismatch
  - Old: `"3"`
  - New: `"6732"`

*...and 6 more differences*

---

### list 5: latestFollowers

- **Path:** `/lists/5/latestFollowers?limit=5`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`followers[0].address`**: Value mismatch
  - Old: `"0x18480a75f76bb1968a9ef28b809fab2ca9c2d154"`
  - New: `"0x255749ce8ab1dd14c09787e7405a15ff17c24459"`
- **`followers[0].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53731"`
  - New: `"9673"`
- **`followers[0].tags`**: Extra field in new API
  - New value: `[]`
- **`followers[0].is_following`**: Extra field in new API
  - New value: `false`
- **`followers[0].is_blocked`**: Extra field in new API
  - New value: `false`
- **`followers[0].is_muted`**: Extra field in new API
  - New value: `false`
- **`followers[1].address`**: Value mismatch
  - Old: `"0x5b7c8397eaa5f29796515b44aab9ab0a92029380"`
  - New: `"0x54ccbb5c380f2543bf210bebb0784878784868f7"`
- **`followers[1].efp_list_nft_token_id`**: Value mismatch
  - Old: `"53506"`
  - New: `"9648"`
- **`followers[1].tags`**: Extra field in new API
  - New value: `[]`
- **`followers[1].is_following`**: Extra field in new API
  - New value: `false`

*...and 20 more differences*

---

### list 5: tags

- **Path:** `/lists/5/tags`
- **Priority:** Medium
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`tags`**: Array length mismatch
  - Old: 9 items
  - New: 8 items
- **`tagCounts`**: Array length mismatch
  - Old: 9 items
  - New: 8 items
- **`tagCounts[0].tag`**: Value mismatch
  - Old: `"bff"`
  - New: `"mute"`
- **`tagCounts[1].count`**: Value mismatch
  - Old: `6`
  - New: `3`
- **`tagCounts[2].tag`**: Value mismatch
  - Old: `"based"`
  - New: `"fren"`
- **`tagCounts[2].count`**: Value mismatch
  - Old: `3`
  - New: `1`
- **`tagCounts[3].tag`**: Value mismatch
  - Old: `"irl"`
  - New: `"bff"`
- **`tagCounts[4].tag`**: Value mismatch
  - Old: `"fren"`
  - New: `"friend"`
- **`taggedAddresses`**: Array length mismatch
  - Old: 17 items
  - New: 10 items
- **`taggedAddresses[3].address`**: Value mismatch
  - Old: `"0x983110309620d911731ac0932219af06091b6744"`
  - New: `"0xa8b4756959e1192042fc2a8a103dfe2bddf128e8"`

*...and 3 more differences*

---

### list 5: taggedAs

- **Path:** `/lists/5/taggedAs`
- **Priority:** Medium
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`tags`**: Array length mismatch
  - Old: 7 items
  - New: 3 items
- **`tags[1]`**: Value mismatch
  - Old: `"bro"`
  - New: `"irl"`
- **`tags[2]`**: Value mismatch
  - Old: `"bruh"`
  - New: `"top8"`
- **`tagCounts`**: Array length mismatch
  - Old: 7 items
  - New: 3 items
- **`tagCounts[0].count`**: Value mismatch
  - Old: `6`
  - New: `4`
- **`tagCounts[1].tag`**: Value mismatch
  - Old: `"irl"`
  - New: `"bff"`
- **`tagCounts[2].tag`**: Value mismatch
  - Old: `"bff"`
  - New: `"irl"`
- **`taggedAddresses`**: Array length mismatch
  - Old: 12 items
  - New: 6 items
- **`taggedAddresses[1].address`**: Value mismatch
  - Old: `"0x871b4be6ec08a847c94a86c41ad449ef9d507b34"`
  - New: `"0xcac3fddb461d20c6cdcf0244e38d0184969b08b7"`
- **`taggedAddresses[2].address`**: Value mismatch
  - Old: `"0xc983ebc9db969782d994627bdffec0ae6efee1b3"`
  - New: `"0x19439fcdb55a5a16f44d9adeea68670414b3a5c6"`

*...and 2 more differences*

---

### list 5: searchFollowers

- **Path:** `/lists/5/searchFollowers?term=eth&limit=3`
- **Priority:** Medium
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`followers[0].efp_list_nft_token_id`**: Value mismatch
  - Old: `"3096"`
  - New: `"9673"`
- **`followers[0].address`**: Value mismatch
  - Old: `"0x20309eb9080288e31ab1161366af6639f04d593e"`
  - New: `"0x255749ce8ab1dd14c09787e7405a15ff17c24459"`
- **`followers[0].ens`**: Missing in new API
  - Old value: `{"name":"0xskas.eth","avatar":"https://metadata.ens.domains/mainnet/avatar/0xskas.eth"}`
- **`followers[0].is_following`**: Value mismatch
  - Old: `true`
  - New: `false`
- **`followers[1].efp_list_nft_token_id`**: Value mismatch
  - Old: `"3025"`
  - New: `"9648"`
- **`followers[1].address`**: Value mismatch
  - Old: `"0x481c0121be626ed5544249c9fe88fef7c78e53dd"`
  - New: `"0x54ccbb5c380f2543bf210bebb0784878784868f7"`
- **`followers[1].ens`**: Missing in new API
  - Old value: `{"name":"yenargy.eth","avatar":"https://arweave.net/gjAzfpcJcHqviSnYuUI5ElEQT9b934ShxrUQ-WVolZ0/1479`
- **`followers[1].is_following`**: Value mismatch
  - Old: `true`
  - New: `false`
- **`followers[2].efp_list_nft_token_id`**: Value mismatch
  - Old: `"28540"`
  - New: `"9932"`
- **`followers[2].address`**: Value mismatch
  - Old: `"0xab9523915c43ab8c58673099d602ae2b78df2b6d"`
  - New: `"0xbdcf4b0d81e4647a6aeb18815a3ea442d95329ce"`

*...and 2 more differences*

---

### list 5: recommended

- **Path:** `/lists/5/recommended?limit=3`
- **Priority:** Low
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`recommended[0].name`**: Value mismatch
  - Old: `"tacha.eth"`
  - New: `"barmstrong.eth"`
- **`recommended[0].address`**: Value mismatch
  - Old: `"0x47395de5d90b8a3c767006a9e5ba1c2a56bb805a"`
  - New: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
- **`recommended[0].avatar`**: Value mismatch
  - Old: `"https://euc.li/tacha.eth"`
  - New: `"https://euc.li/barmstrong.eth"`
- **`recommended[0].header`**: Missing in new API
  - Old value: `null`
- **`recommended[0].class`**: Value mismatch
  - Old: `"B"`
  - New: `"A"`
- **`recommended[1].name`**: Value mismatch
  - Old: `"jesse.xyz"`
  - New: `"jda.eth"`
- **`recommended[1].address`**: Value mismatch
  - Old: `"0x2211d1d0020daea8039e46cf1367962070d77da9"`
  - New: `"0x7aba4f721610816d08cf059d347de8d74406fed7"`
- **`recommended[1].avatar`**: Value mismatch
  - Old: `"https://s.gravatar.com/avatar/905fd6810cd184a461697d811a319272.jpg"`
  - New: `"https://euc.li/jda.eth"`
- **`recommended[1].header`**: Missing in new API
  - Old value: `null`
- **`recommended[2].name`**: Value mismatch
  - Old: `"tetranode.eth"`
  - New: `"jacob.eth"`

*...and 4 more differences*

---

### list 5: recommended/details

- **Path:** `/lists/5/recommended/details?limit=3`
- **Priority:** Low
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`recommended[0].address`**: Value mismatch
  - Old: `"0x47395de5d90b8a3c767006a9e5ba1c2a56bb805a"`
  - New: `"0x5b76f5b8fc9d700624f78208132f91ad4e61a1f0"`
- **`recommended[0].ens.name`**: Value mismatch
  - Old: `"tacha.eth"`
  - New: `"barmstrong.eth"`
- **`recommended[0].ens.avatar`**: Value mismatch
  - Old: `"https://euc.li/tacha.eth"`
  - New: `"https://euc.li/barmstrong.eth"`
- **`recommended[0].ens.records`**: Type mismatch
  - Old type: object (`{"avatar":"https://euc.li/tacha.eth","description"`)
  - New type: string (`"{\"url\":\"https://www.brianarmstrong.org/\",\"av`)
- **`recommended[0].stats.followers_count`**: Type mismatch
  - Old type: string (`"50"`)
  - New type: number (`2448`)
- **`recommended[0].ranks.mutuals_rank`**: Extra field in new API
  - New value: `11605`
- **`recommended[0].ranks.followers_rank`**: Type mismatch
  - Old type: string (`"3077"`)
  - New type: number (`7`)
- **`recommended[0].ranks.following_rank`**: Extra field in new API
  - New value: `32668`
- **`recommended[0].ranks.top8_rank`**: Extra field in new API
  - New value: `4`
- **`recommended[0].ranks.blocks_rank`**: Extra field in new API
  - New value: `22`

*...and 19 more differences*

---

### leaderboard: followers

- **Path:** `/leaderboard/followers?limit=5`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`[0].followers_count`**: Value mismatch
  - Old: `"5269"`
  - New: `"5263"`
- **`[1].followers_count`**: Value mismatch
  - Old: `"3499"`
  - New: `"3473"`
- **`[2].followers_count`**: Value mismatch
  - Old: `"3199"`
  - New: `"3195"`
- **`[3].followers_count`**: Value mismatch
  - Old: `"2641"`
  - New: `"2607"`
- **`[4].followers_count`**: Value mismatch
  - Old: `"2590"`
  - New: `"2561"`

---

### leaderboard: following

- **Path:** `/leaderboard/following?limit=5`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`[4].following_count`**: Value mismatch
  - Old: `"8269"`
  - New: `"8267"`

---

### leaderboard: mutuals

- **Path:** `/leaderboard/mutuals?limit=5`
- **Priority:** High
- **Old Status:** 404
- **New Status:** 200

**Differences:**

- **Status code mismatch**: Old=404, New=200
- **`error`**: Missing in new API
  - Old value: `"http://efp-us-east-1.ethfollow.xyz/api/v1/leaderboard/mutuals?limit=5 is not a valid path. Visit ht`
- **`0`**: Extra field in new API
  - New value: `{"rank":1,"address":"0x2332a02fea96b42fc3095ae7c73963980db9331b","mutuals_count":"1911"}`
- **`1`**: Extra field in new API
  - New value: `{"rank":2,"address":"0xcbb2534c6898655d50fdac79d6e4b23b18a25b97","mutuals_count":"1524"}`
- **`2`**: Extra field in new API
  - New value: `{"rank":3,"address":"0x111111176b0b13ffc31d387d08726772a0492948","mutuals_count":"1479"}`
- **`3`**: Extra field in new API
  - New value: `{"rank":4,"address":"0x2f3a773365ff85353e1d4bb5a88f62dfd478a24d","mutuals_count":"1377"}`
- **`4`**: Extra field in new API
  - New value: `{"rank":5,"address":"0x52ac12480565555257a77c9f79f5b7ac770cfa09","mutuals_count":"1205"}`

---

### leaderboard: blocked

- **Path:** `/leaderboard/blocked?limit=5`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`[0].blocked_by_count`**: Missing in new API
  - Old value: `"4"`
- **`[0].blocked_count`**: Extra field in new API
  - New value: `"4"`
- **`[1].rank`**: Value mismatch
  - Old: `1`
  - New: `2`
- **`[1].blocked_by_count`**: Missing in new API
  - Old value: `"4"`
- **`[1].blocked_count`**: Extra field in new API
  - New value: `"4"`
- **`[2].address`**: Value mismatch
  - Old: `"0x4d982788c01402c4e0f657e1192d7736084ae5a8"`
  - New: `"0x311ef08626709a0de3aa84d396437773340e022d"`
- **`[2].blocked_by_count`**: Missing in new API
  - Old value: `"3"`
- **`[2].blocked_count`**: Extra field in new API
  - New value: `"2"`
- **`[3].address`**: Value mismatch
  - Old: `"0x311ef08626709a0de3aa84d396437773340e022d"`
  - New: `"0x4d982788c01402c4e0f657e1192d7736084ae5a8"`
- **`[3].blocked_by_count`**: Missing in new API
  - Old value: `"2"`

*...and 4 more differences*

---

### leaderboard: blocks

- **Path:** `/leaderboard/blocks?limit=5`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`[2].address`**: Value mismatch
  - Old: `"0xa8b4756959e1192042fc2a8a103dfe2bddf128e8"`
  - New: `"0x44ad9228a6146c0669fab9d40db0af62a83e7db9"`
- **`[2].blocks_count`**: Value mismatch
  - Old: `"7"`
  - New: `"5"`
- **`[3].address`**: Value mismatch
  - Old: `"0x44ad9228a6146c0669fab9d40db0af62a83e7db9"`
  - New: `"0x8d5fe65f1e78244972af4106cdf8e559247491ae"`
- **`[3].blocks_count`**: Value mismatch
  - Old: `"5"`
  - New: `"2"`
- **`[4].rank`**: Value mismatch
  - Old: `5`
  - New: `4`
- **`[4].address`**: Value mismatch
  - Old: `"0x752884ee848f108f0da3a8543fa306c5018e36d9"`
  - New: `"0xc7427f23c55a980cd2ceea25edb3b372af70af0e"`

---

### leaderboard: muted

- **Path:** `/leaderboard/muted?limit=5`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`[0].muted_by_count`**: Missing in new API
  - Old value: `"1"`
- **`[0].muted_count`**: Extra field in new API
  - New value: `"1"`
- **`[1].rank`**: Value mismatch
  - Old: `1`
  - New: `2`
- **`[1].muted_by_count`**: Missing in new API
  - Old value: `"1"`
- **`[1].muted_count`**: Extra field in new API
  - New value: `"1"`
- **`[2].rank`**: Value mismatch
  - Old: `1`
  - New: `3`
- **`[2].muted_by_count`**: Missing in new API
  - Old value: `"1"`
- **`[2].muted_count`**: Extra field in new API
  - New value: `"1"`
- **`[3].rank`**: Value mismatch
  - Old: `1`
  - New: `4`
- **`[3].muted_by_count`**: Missing in new API
  - Old value: `"1"`

*...and 4 more differences*

---

### leaderboard: mutes

- **Path:** `/leaderboard/mutes?limit=5`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`[3].rank`**: Value mismatch
  - Old: `3`
  - New: `4`
- **`[4].rank`**: Value mismatch
  - Old: `3`
  - New: `5`
- **`[4].address`**: Value mismatch
  - Old: `"0x5b0f3dbdd49614476e4f5ff5db6fe13d41fcb516"`
  - New: `"0xb3a29e6bee26663772e4d9d38b453a5add44433e"`

---

### leaderboard: ranked

- **Path:** `/leaderboard/ranked?limit=5`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`results[0].header`**: Missing in new API
  - Old value: `null`
- **`results[0].following_rank`**: Value mismatch
  - Old: `"8"`
  - New: `"7"`
- **`results[0].blocks_rank`**: Extra field in new API
  - New value: `"22"`
- **`results[0].mutuals`**: Value mismatch
  - Old: `"2329"`
  - New: `"1911"`
- **`results[0].followers`**: Value mismatch
  - Old: `"2584"`
  - New: `"2557"`
- **`results[1].address`**: Value mismatch
  - Old: `"0x111111176b0b13ffc31d387d08726772a0492948"`
  - New: `"0xcbb2534c6898655d50fdac79d6e4b23b18a25b97"`
- **`results[1].name`**: Value mismatch
  - Old: `"2⃣2⃣.eth"`
  - New: `"👁‍🗨.eth"`
- **`results[1].avatar`**: Value mismatch
  - Old: `"https://euc.li/2⃣2⃣.eth"`
  - New: `"https://euc.li/👁‍🗨.eth"`
- **`results[1].header`**: Missing in new API
  - Old value: `"https://i.imgur.com/cGod3Ci.png"`
- **`results[1].followers_rank`**: Value mismatch
  - Old: `"10"`
  - New: `"9"`

*...and 44 more differences*

---

### leaderboard: search

- **Path:** `/leaderboard/search?term=vit&limit=5`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`results`**: Array length mismatch
  - Old: 54 items
  - New: 5 items
- **`results[0].address`**: Value mismatch
  - Old: `"0x1af1cfa18c95c45346023d09a359b6840c2e16a9"`
  - New: `"0xd8da6bf26964af9d7eed9e03e53415d37aa96045"`
- **`results[0].name`**: Value mismatch
  - Old: `"privity.eth"`
  - New: `"vitalik.eth"`
- **`results[0].avatar`**: Value mismatch
  - Old: `"http://media.botto.com/pipes/images/pipe_v2_1973.jpg"`
  - New: `"https://euc.li/vitalik.eth"`
- **`results[0].header`**: Extra field in new API
  - New value: `"https://pbs.twimg.com/profile_banners/295218901/1638557376/1500x500"`
- **`results[0].mutuals_rank`**: Extra field in new API
  - New value: `"2986"`
- **`results[0].followers_rank`**: Value mismatch
  - Old: `"11007"`
  - New: `"1"`
- **`results[0].following_rank`**: Value mismatch
  - Old: `"21602"`
  - New: `"10402"`
- **`results[0].blocks_rank`**: Extra field in new API
  - New value: `"22"`
- **`results[0].top8_rank`**: Extra field in new API
  - New value: `"1"`

*...and 42 more differences*

---

### stats

- **Path:** `/stats`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`stats.address_count`**: Value mismatch
  - Old: `"50575"`
  - New: `"58285"`
- **`stats.list_count`**: Value mismatch
  - Old: `"54643"`
  - New: `"54649"`
- **`stats.list_op_count`**: Value mismatch
  - Old: `"1069321"`
  - New: `"997986"`
- **`stats.user_count`**: Value mismatch
  - Old: `"35612"`
  - New: `"35460"`

---

### discover

- **Path:** `/discover`
- **Priority:** High
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`latestFollows[0].address`**: Value mismatch
  - Old: `"0xdc190d7cea8e8bf0b381617062200c10cfff0a91"`
  - New: `"0x3ad226427d6c1d8a53fb1948efcd7a98890fe8c1"`
- **`latestFollows[0].name`**: Value mismatch
  - Old: `"ongod.eth"`
  - New: `"77luka.eth"`
- **`latestFollows[0].avatar`**: Missing in new API
  - Old value: `""`
- **`latestFollows[0].followers`**: Value mismatch
  - Old: `"78"`
  - New: `"531"`
- **`latestFollows[0].following`**: Value mismatch
  - Old: `"219"`
  - New: `"0"`
- **`latestFollows[1].address`**: Value mismatch
  - Old: `"0x5f778baac9d11fe88a1939884c2fd1b3d2b50655"`
  - New: `"0x1d3c5a8781d0bcda568730734d787d8f16fc9533"`
- **`latestFollows[1].name`**: Extra field in new API
  - New value: `"zoorb.eth"`
- **`latestFollows[1].avatar`**: Extra field in new API
  - New value: `"https://euc.li/zoorb.eth"`
- **`latestFollows[1].followers`**: Value mismatch
  - Old: `"6"`
  - New: `"903"`
- **`latestFollows[1].following`**: Value mismatch
  - Old: `"54"`
  - New: `"0"`

*...and 11 more differences*

---

### token 5: exportState

- **Path:** `/exportState/5`
- **Priority:** Medium
- **Old Status:** 200
- **New Status:** 200

**Differences:**

- **`following`**: Array length mismatch
  - Old: 1417 items
  - New: 1403 items
- **`following[0].address`**: Missing in new API
  - Old value: `"0x0000000000000000000000000000000000000000"`
- **`following[1].address`**: Missing in new API
  - Old value: `"0x000066b5a8e1e35b7e2f64e24715829647f80000"`
- **`following[2].address`**: Missing in new API
  - Old value: `"0x00007c6cf9bf9b62b663f35542f486747a86d9d1"`
- **`following[3].address`**: Missing in new API
  - Old value: `"0x0000ce08fa224696a819877070bf378e8b131acf"`
- **`following[4].address`**: Missing in new API
  - Old value: `"0x0016f085357b97898a68d71b11666b704b03b025"`

---

## Warning Issues

These issues indicate minor differences that may be acceptable or cosmetic.

### vitalik: details

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/details`
- **Priority:** Critical

**Differences:**

- **`ranks.mutuals_rank`**: Value mismatch
  - Old: `"3500"`
  - New: `"2986"`
- **`ranks.following_rank`**: Value mismatch
  - Old: `"10427"`
  - New: `"10402"`
- **`ranks.blocks_rank`**: Value mismatch
  - Old: `0`
  - New: `22`

---

### vitalik: lists

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/lists`
- **Priority:** Medium

**Differences:**

- **`lists[0]`**: Value mismatch
  - Old: `"6509"`
  - New: `"10383"`
- **`lists[1]`**: Value mismatch
  - Old: `"6512"`
  - New: `"10462"`
- **`lists[2]`**: Value mismatch
  - Old: `"7095"`
  - New: `"12843"`
- **`lists[3]`**: Value mismatch
  - Old: `"7132"`
  - New: `"15271"`
- **`lists[4]`**: Value mismatch
  - Old: `"7144"`
  - New: `"15783"`

---

### vitalik: notifications

- **Path:** `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/notifications?limit=3`
- **Priority:** Medium

**Differences:**

- **`summary.total`**: Value mismatch
  - Old: `0`
  - New: `3`
- **`summary.total_follows`**: Value mismatch
  - Old: `0`
  - New: `3`

---

### list 5: account

- **Path:** `/lists/5/account`
- **Priority:** High

**Differences:**

- **`ens.records.description`**: Value mismatch
  - Old: `"Software developer & UI/UX Designer | Building the web3 social graph @efp.eth"`
  - New: `"Software developer & UI/UX Designer | Bringing identity onchain @efp.eth @identitykit.eth @siwe.eth`
- **`ens.records.status`**: Value mismatch
  - Old: `"Building the Ethereum Follow Protocol"`
  - New: `"Building the Ethereum identity stack"`
- **`ens.records.url`**: Value mismatch
  - Old: `"https://efp.app"`
  - New: `"https://ethid.org"`

---

### list 5: details

- **Path:** `/lists/5/details`
- **Priority:** High

**Differences:**

- **`ens.records.description`**: Value mismatch
  - Old: `"Software developer & UI/UX Designer | Building the web3 social graph @efp.eth"`
  - New: `"Software developer & UI/UX Designer | Bringing identity onchain @efp.eth @identitykit.eth @siwe.eth`
- **`ens.records.status`**: Value mismatch
  - Old: `"Building the Ethereum Follow Protocol"`
  - New: `"Building the Ethereum identity stack"`
- **`ens.records.url`**: Value mismatch
  - Old: `"https://efp.app"`
  - New: `"https://ethid.org"`
- **`ranks.mutuals_rank`**: Value mismatch
  - Old: `"18"`
  - New: `"11605"`
- **`ranks.followers_rank`**: Value mismatch
  - Old: `"46"`
  - New: `"45"`

*...and 3 more differences*

---

### list 5: records

- **Path:** `/lists/5/records`
- **Priority:** High

**Differences:**

- **`records`**: Array length mismatch
  - Old: 1417 items
  - New: 1403 items

---

### list 5: following

- **Path:** `/lists/5/following?limit=5`
- **Priority:** High

**Differences:**

- **`following`**: Array length mismatch
  - Old: 5 items
  - New: 0 items

---

### list 5: allFollowing

- **Path:** `/lists/5/allFollowing?limit=5`
- **Priority:** High

**Differences:**

- **`following`**: Array length mismatch
  - Old: 5 items
  - New: 0 items

---

### list 5: allFollowingAddresses

- **Path:** `/lists/5/allFollowingAddresses`
- **Priority:** High

**Differences:**

- **`root`**: Array length mismatch
  - Old: 1417 items
  - New: 0 items

---

### list 5: searchFollowing

- **Path:** `/lists/5/searchFollowing?term=eth&limit=3`
- **Priority:** Medium

**Differences:**

- **`following`**: Array length mismatch
  - Old: 3 items
  - New: 0 items

---

### list 5: buttonState (brantly)

- **Path:** `/lists/5/0x983110309620d911731ac0932219af06091b6744/buttonState`
- **Priority:** Medium

**Differences:**

- **`state.follow`**: Value mismatch
  - Old: `true`
  - New: `false`

---

### leaderboard: count

- **Path:** `/leaderboard/count`
- **Priority:** High

**Differences:**

- **`leaderboardCount`**: Value mismatch
  - Old: `"56893"`
  - New: `"56666"`

---

### debug: num-events

- **Path:** `/debug/num-events`
- **Priority:** Low

**Differences:**

- **`num_events`**: Value mismatch
  - Old: `1364524`
  - New: `997986`

---

### debug: num-list-ops

- **Path:** `/debug/num-list-ops`
- **Priority:** Low

**Differences:**

- **`num_list_ops`**: Value mismatch
  - Old: `1069321`
  - New: `997986`

---

### debug: total-supply

- **Path:** `/debug/total-supply`
- **Priority:** Low

**Differences:**

- **`total_supply`**: Value mismatch
  - Old: `54643`
  - New: `54649`

---

### token 5: metadata

- **Path:** `/token/metadata/5`
- **Priority:** Medium

**Differences:**

- **`image`**: Value mismatch
  - Old: `"http://efp-us-east-1.ethfollow.xyz/api/v1/token/image/5"`
  - New: `"https://api.ethfollow.xyz/api/v1/token/image/5"`
- **`external_url`**: Value mismatch
  - Old: `"https://testing.ethfollow.xyz/5"`
  - New: `"https://ethfollow.xyz/5"`

---

### token non-existent: metadata

- **Path:** `/token/metadata/99999999`
- **Priority:** Medium

**Differences:**

- **`image`**: Value mismatch
  - Old: `"http://efp-us-east-1.ethfollow.xyz/api/v1/token/image/99999999"`
  - New: `"https://api.ethfollow.xyz/api/v1/token/image/99999999"`
- **`external_url`**: Value mismatch
  - Old: `"https://testing.ethfollow.xyz/99999999"`
  - New: `"https://ethfollow.xyz/99999999"`

---

## Not Implemented Endpoints

These endpoints return 404 or 501 in the new API.

| Endpoint | Priority |
|----------|----------|
| `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/mutuals?limit=5` | High |
| `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/blocks` | Medium |
| `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/mutes` | Medium |
| `/slots/8453/0x41Aa48Ef3c0446b46a5b1cc6337FF3d3716E2A33/0x0000000000000000000000000000000000000000000000000000000000000005/details` | Medium |

## Matching Endpoints

These endpoints return identical responses (ignoring timestamps and ordering).

<details>
<summary>Click to expand (15 endpoints)</summary>

| Endpoint | Priority |
|----------|----------|
| `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/account` | Critical |
| `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/ens` | Critical |
| `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/primary-list` | Critical |
| `/users/vitalik.eth/account` | Critical |
| `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/0x983110309620d911731ac0932219af06091b6744/followerState` | Medium |
| `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/tags` | Medium |
| `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/badges` | Low |
| `/users/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/list-records` | Medium |
| `/lists/5/badges` | Medium |
| `/lists/5/0x983110309620d911731ac0932219af06091b6744/followerState` | Medium |
| `/health` | High |
| `/database/health` | High |
| `/minters` | High |
| `/token/image/5` | Medium |
| `/token/image/99999999` | Medium |

</details>

## Results by Category

| Category | Matching | Mismatch | Not Impl | Error |
|----------|----------|----------|----------|-------|
| Core User Data | 4 | 2 | 0 | 0 |
| Followers/Following | 0 | 6 | 0 | 0 |
| Mutuals | 0 | 0 | 1 | 0 |
| Relationships | 1 | 3 | 0 | 0 |
| Tags | 1 | 1 | 0 | 0 |
| Search | 0 | 2 | 0 | 0 |
| Recommendations | 0 | 2 | 0 | 0 |
| Badges (POAP) | 1 | 0 | 0 | 0 |
| User Other | 1 | 2 | 2 | 0 |
| Lists Core | 0 | 4 | 0 | 0 |
| Lists Followers | 0 | 6 | 0 | 0 |
| Lists Tags | 0 | 2 | 0 | 0 |
| Lists Search | 0 | 2 | 0 | 0 |
| Lists Recommendations | 0 | 2 | 0 | 0 |
| Lists Other | 2 | 1 | 0 | 0 |
| Leaderboard | 0 | 10 | 0 | 0 |
| Global | 3 | 2 | 0 | 0 |
| Debug | 0 | 3 | 0 | 0 |
| Slots | 0 | 0 | 1 | 0 |
| Token | 2 | 3 | 0 | 0 |

---

*Report generated by test-discrepancy-report.mjs*
