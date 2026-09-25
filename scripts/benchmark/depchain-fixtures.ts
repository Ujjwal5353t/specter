// DepChain ground truth: npm packages pinned to a version with a known,
// published advisory, paired with the release that fixed it.
//
// `advisory` is the hand-labelled GHSA id the vulnerable version is known for
// and the patched version fixed. It was checked against OSV.dev when the
// fixture was written, so the benchmark doesn't rely only on OSV's live answer
// to decide what "correct" is.
//
// Note that a "patched" release can still carry *other*, later advisories
// (e.g. lodash 4.17.21, ws 7.4.6). Those are real findings, not false
// positives, which is why the benchmark checks the labelled advisory
// specifically and cross-checks everything else against OSV for that exact
// version.

export interface DepFixture {
  name: string;
  vulnerable: string;
  patched: string;
  advisory: string;
  what: string;
}

export const DEP_FIXTURES: DepFixture[] = [
  { name: 'minimist',     vulnerable: '1.2.5',   patched: '1.2.6',   advisory: 'GHSA-xvch-5gv4-984h', what: 'prototype pollution (CVE-2021-44906)' },
  { name: 'lodash',       vulnerable: '4.17.20', patched: '4.17.21', advisory: 'GHSA-35jh-r3h4-6jhm', what: 'command injection in template (CVE-2021-23337)' },
  { name: 'event-stream', vulnerable: '3.3.6',   patched: '4.0.1',   advisory: 'GHSA-mh6f-8j2x-4483', what: 'malicious flatmap-stream payload (2018)' },
  { name: 'ua-parser-js', vulnerable: '0.7.29',  patched: '0.7.30',  advisory: 'GHSA-pjwm-rvh2-c87w', what: 'hijacked release ships cryptominer (CVE-2021-4229)' },
  { name: 'node-ipc',     vulnerable: '10.1.1',  patched: '10.1.3',  advisory: 'GHSA-97m3-w2cp-4xx6', what: 'protestware overwrites files (CVE-2022-23812)' },
  { name: 'axios',        vulnerable: '0.21.0',  patched: '0.21.1',  advisory: 'GHSA-4w2v-q235-vp99', what: 'SSRF via redirect (CVE-2020-28168)' },
  { name: 'node-fetch',   vulnerable: '2.6.0',   patched: '2.6.7',   advisory: 'GHSA-r683-j2x4-v87g', what: 'forwards secure headers on redirect (CVE-2022-0235)' },
  { name: 'jsonwebtoken', vulnerable: '8.5.1',   patched: '9.0.0',   advisory: 'GHSA-8cf7-32gw-wr33', what: 'unrestricted key type (CVE-2022-23539)' },
  { name: 'semver',       vulnerable: '7.5.1',   patched: '7.5.2',   advisory: 'GHSA-c2qf-rxjj-qqgw', what: 'ReDoS in range parsing (CVE-2022-25883)' },
  { name: 'ws',           vulnerable: '7.4.5',   patched: '7.4.6',   advisory: 'GHSA-6fc8-4gx4-v693', what: 'ReDoS in Sec-Websocket-Protocol (CVE-2021-32640)' },
  { name: 'json5',        vulnerable: '2.2.1',   patched: '2.2.2',   advisory: 'GHSA-9c47-m6qq-7p4h', what: 'prototype pollution in parse (CVE-2022-46175)' },
  { name: 'qs',           vulnerable: '6.10.2',  patched: '6.10.3',  advisory: 'GHSA-hrpp-h998-j3pp', what: 'prototype pollution (CVE-2022-24999)' },
];
