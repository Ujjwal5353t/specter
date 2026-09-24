export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CVE {
  id: string;
  severity: Severity;
  score: number;
  summary: string;
  fixed_in?: string;
}

export type RiskSignalType =
  | 'new_publisher'
  | 'new_dependency'
  | 'young_dependency'
  | 'young_package'
  | 'fresh_release'
  | 'install_script'
  | 'provenance_dropped'
  | 'typosquat';

/** A supply-chain yellow flag derived from npm registry metadata — not proof of malice. */
export interface RiskSignal {
  type: RiskSignalType;
  severity: Severity;
  title: string;
  detail: string;
}

export interface DepNode {
  id: string;
  name: string;
  version: string;
  cves: CVE[];
  signals?: RiskSignal[];
  ecosystem: string;
  isDirect?: boolean;
  isRoot?: boolean;
}

export interface DepEdge {
  from: string;
  to: string;
}

export interface DepChainResult {
  nodes: DepNode[];
  edges: DepEdge[];
  vulnCount: number;
  /** Nodes carrying at least one medium-or-worse risk signal. Absent on older cached results. */
  riskCount?: number;
}

export interface SecretFinding {
  commit_sha: string;
  commit_message: string;
  author: string;
  date: string;
  file: string;
  line: number;
  type: string;
  entropy: number;
  preview: string;
}

export interface GhostCommitResult {
  findings: SecretFinding[];
  totalCommitsScanned: number;
}

export interface DockerFinding {
  layer: number;
  instruction: string;
  issue: string;
  severity: Severity;
  fix: string;
}

export interface LayerScanResult {
  findings: DockerFinding[];
  baseImage: string;
}

export interface ApiEndpoint {
  path: string;
  method: string;
  file: string;
  hasAuth: boolean;
  issues: string[];
  severity: Severity;
}

export interface APIBleedResult {
  endpoints: ApiEndpoint[];
  unsecuredCount: number;
}

export interface EnvFinding {
  file: string;
  type: string;
  severity: Severity;
  detail: string;
  line?: number;
}

export interface EnvTraceResult {
  findings: EnvFinding[];
}

export interface ScanResult {
  scanId: string;
  repoUrl: string;
  status: 'pending' | 'scanning' | 'completed' | 'failed';
  threatScore: number;
  depchain?: DepChainResult;
  ghostcommit?: GhostCommitResult;
  layerscan?: LayerScanResult;
  apibleed?: APIBleedResult;
  envtrace?: EnvTraceResult;
  aiExplanation?: AIExplanation;
  /** Served from the 6h scan cache rather than a fresh scanner run. */
  fromCache?: boolean;
  /** When the scanners actually ran (ISO string); differs from now for cached results. */
  scannedAt?: string;
}

export type ScannerKey = 'depchain' | 'ghostcommit' | 'layerscan' | 'apibleed' | 'envtrace';

/** One scanner's live state during a scan, from the scan_progress table. */
export interface ScannerProgress {
  scanner: ScannerKey;
  status: 'running' | 'done' | 'failed';
  detail: string | null;
  finding_count: number | null;
  started_at: string;
  duration_ms: number | null;
}

export interface AIExplanation {
  summary: string;
  items: {
    title: string;
    why_dangerous: string;
    exact_fix: string;
    attack_pattern: string;
  }[];
}