# Package verdict engine — evaluation (issue #26)

Generated 2026-09-25 by `npm run eval-verdicts`. Known-malicious versions are discovered live from OSV.dev each run, so exact case counts vary as OSV's malicious-packages database grows.

## Catch rate — known-malicious versions

19 versions, across 16 candidate package names (9 had no OSV malicious-package advisory at run time: colors, faker, getcookies, crossenv, electron-native-notify, ionic-plugin-alpha, jqueryv3, http-fetch-dns, mongose).

| Metric | Result |
| --- | --- |
| Caught (warn or block) | **19/19 (100.0%)** |
| Blocked outright | 19/19 (100.0%) |
| Still had a live registry manifest | 19/19 |

| Package@version | Advisory | Verdict | Signals |
| --- | --- | --- | --- |
| event-stream@3.3.6 | GHSA-mh6f-8j2x-4483 | block | osv_malicious |
| flatmap-stream@0.1.1 | GHSA-9x64-5r7x-2q53 | block | osv_malicious, osv_malicious, osv_malicious |
| node-ipc@10.1.1 | GHSA-97m3-w2cp-4xx6 | block | osv_malicious |
| node-ipc@9.1.6 | MAL-2026-3744 | block | osv_malicious |
| node-ipc@9.2.3 | MAL-2026-3744 | block | osv_malicious |
| node-ipc@12.0.1 | MAL-2026-3744 | block | osv_malicious |
| ua-parser-js@0.7.29 | GHSA-pjwm-rvh2-c87w | block | osv_malicious |
| ua-parser-js@0.8.0 | GHSA-pjwm-rvh2-c87w | block | osv_malicious, osv_advisory |
| ua-parser-js@1.0.0 | GHSA-pjwm-rvh2-c87w | block | osv_malicious, osv_advisory |
| coa@2.0.3 | GHSA-73qr-pfmq-6rp8 | block | osv_malicious |
| coa@2.0.4 | GHSA-73qr-pfmq-6rp8 | block | osv_malicious |
| coa@2.1.1 | GHSA-73qr-pfmq-6rp8 | block | osv_malicious |
| coa@2.1.3 | GHSA-73qr-pfmq-6rp8 | block | osv_malicious |
| coa@3.0.1 | GHSA-73qr-pfmq-6rp8 | block | osv_malicious |
| coa@3.1.3 | GHSA-73qr-pfmq-6rp8 | block | osv_malicious |
| rc@1.2.9 | GHSA-g2q5-5433-rhrf | block | osv_malicious |
| rc@1.3.9 | GHSA-g2q5-5433-rhrf | block | osv_malicious |
| rc@2.3.9 | GHSA-g2q5-5433-rhrf | block | osv_malicious |
| eslint-scope@3.7.2 | GHSA-hxxf-q3w9-4xgw | block | osv_malicious |

## False-alarm rate — popular packages (latest version)

208 packages from the app's own popular-package list, each at its current `latest` release.

| Metric | Result |
| --- | --- |
| Wrongly flagged (warn or block) | **3/208 (1.4%)** |
| Wrongly blocked | 0/208 |

Sample false alarms, for tuning:

| Package@version | Verdict | Signals |
| --- | --- | --- |
| angular@1.8.3 | warn | new_publisher (low), osv_advisory (high), osv_advisory (high), osv_advisory (medium) |
| hapi@18.1.0 | warn | osv_advisory (high) |
| apollo-server@3.13.0 | warn | osv_advisory (high) |

## Signals fired, across both sets

| Signal | Count |
| --- | --- |
| fresh_release | 32 |
| osv_malicious | 21 |
| install_script | 10 |
| new_dependency | 9 |
| osv_advisory | 8 |
| new_publisher | 8 |

## Tiers active in this run

Only the **metadata** tier exists so far (#27 registry heuristics + #28 OSV malicious/provenance checks). The diff, LLM and sandbox tiers (#39/#43/#45) are separate, not-yet-built work — re-run this script after each one lands to see its incremental effect on the numbers above.
