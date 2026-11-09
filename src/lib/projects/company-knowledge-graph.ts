import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  canViewerAccessScope,
  HISTORICAL_YEAR_GROUPS,
  type AccessScopeLevel,
  type DriveItemKind,
  type HistoricalDriveItem,
  type HistoricalProject,
  type ProjectViewerContext,
} from './historical-projects-data';
import { STARTER_COAUTHOR_DOCUMENTS } from './project-coauthor-seed';

export type GraphNodeKind =
  | 'project'
  | 'file'
  | 'folder'
  | 'concept'
  | 'standard'
  | 'department'
  | 'year';

export type KnowledgeGraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  projectCode?: string;
  projectId?: string;
  year?: number;
  department?: string;
  fileKind?: DriveItemKind;
  driveUrl?: string;
  updatedAt?: string;
  summary: string;
  keywords: string[];
  accessScope?: AccessScopeLevel;
  allowedDepartments?: string[];
  allowedRoles?: string[];
  /** Centrality / importance weight computed during graph optimization */
  centralityScore: number;
  /** Community cluster ID assigned during graph optimization */
  communityId: string;
  sourceOrigin: 'historical_seed' | 'live_drive_sync' | 'user_upload' | 'coauthor_doc' | 'domain_ontology';
  ingestedAt: string;
};

export type KnowledgeGraphEdge = {
  source: string;
  target: string;
  relation:
    | 'BELONGS_TO_PROJECT'
    | 'PARENT_FOLDER'
    | 'IN_YEAR'
    | 'OWNED_BY_DEPT'
    | 'IMPLEMENTS_CONCEPT'
    | 'COMPLIES_WITH_STANDARD'
    | 'SHARES_DOMAIN_TOPIC'
    | 'REFERENCED_IN_DOC';
  weight: number;
  confidence: 'EXTRACTED' | 'INFERRED';
};

export type KnowledgeGraphCommunity = {
  id: string;
  label: string;
  nodeCount: number;
  topKeywords: string[];
  cohesionScore: number;
};

export type CompanyKnowledgeGraphState = {
  version: number;
  lastOptimizedAt: string;
  contentFingerprint: string;
  totalNodes: number;
  totalEdges: number;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  communities: KnowledgeGraphCommunity[];
  godNodes: Array<{ id: string; label: string; kind: GraphNodeKind; degree: number }>;
  idfWeights: Record<string, number>;
};

export type GraphSearchResultItem = {
  node: KnowledgeGraphNode;
  score: number;
  matchedTerms: string[];
  connectedConcepts: string[];
  projectContext?: {
    id: string;
    code: string;
    name: string;
    period: string;
    department: string;
    summary: string;
  };
};

export type GraphQueryResult = {
  query: string;
  expandedTerms: string[];
  matchedFiles: GraphSearchResultItem[];
  matchedProjects: GraphSearchResultItem[];
  matchedStandardsAndConcepts: KnowledgeGraphNode[];
  traversalPaths: string[];
  graphStats: {
    totalNodes: number;
    totalEdges: number;
    communitiesCount: number;
    lastOptimizedAt: string;
    autoOptimizedOnNewFiles: boolean;
  };
};

/**
 * Core domain concepts & international standards ontology for Turing Drive Inc.
 * Used for semantic edge extraction when indexing historical or newly uploaded files.
 */
const DOMAIN_CONCEPTS: Array<{
  id: string;
  kind: 'concept' | 'standard';
  label: string;
  communityId: string;
  summary: string;
  patterns: RegExp;
  keywords: string[];
}> = [
  {
    id: 'std:iso-26262',
    kind: 'standard',
    label: 'ISO 26262 道路車輛功能安全 (Functional Safety ASIL-D)',
    communityId: 'comm-safety-iso',
    summary:
      '車載自動駕駛控制單元 (ADU) 與底盤線控系統 (DBW 轉向、煞車、動力) 雙迴路硬體冗餘、安全連鎖與即時故障診斷機制。',
    patterns: /iso\s*26262|功能安全|functional\s*safety|asil|雙迴路|線控|dbw|煞車連鎖|冗餘/i,
    keywords: ['iso 26262', '功能安全', 'asil-d', '雙迴路', '線控', 'dbw', '安全連鎖'],
  },
  {
    id: 'std:iso-21448',
    kind: 'standard',
    label: 'ISO 21448 預期功能安全 (SOTIF & MRM 最小風險操作)',
    communityId: 'comm-safety-iso',
    summary:
      '針對強光、暴雨、颱風或地下廊道遮蔽等邊界場景 (Corner Cases)，透過多感測器融合與最小風險操作 (MRM) 執行安全降級停靠。',
    patterns: /iso\s*21448|sotif|預期功能安全|最小風險|mrm|降級|天候|暴雨|颱風|緊急接管|緊急應變/i,
    keywords: ['iso 21448', 'sotif', '最小風險操作', 'mrm', '降級運行', '緊急應變'],
  },
  {
    id: 'std:iso-21434',
    kind: 'standard',
    label: 'ISO/SAE 21434 車聯網資安規範 (Cybersecurity & mTLS 1.3)',
    communityId: 'comm-safety-iso',
    summary:
      '車對地 (V2X) 5G 專網與行控中心 (OCC) 採用 TLS 1.3 雙向憑證認證、硬體安全模組 (HSM) ECDSA 簽章與不可竄改稽核日誌。',
    patterns: /iso.*21434|資安|cybersecurity|tls|mtls|hsm|加密|憑證|簽章|弱點掃描|滲透測試/i,
    keywords: ['iso 21434', '資安', 'tls 1.3', 'hsm', '加密', '車聯網資安'],
  },
  {
    id: 'concept:lidar-localization',
    kind: 'concept',
    label: '3D LiDAR 點雲配準與多感測器融合定位 (NDT + RTK-GNSS + IMU)',
    communityId: 'comm-perception-loc',
    summary:
      '結合主 3D LiDAR NDT 點雲配準、雙天線 RTK-GNSS、車輪里程計與六軸 IMU，於高架與無衛星訊號地下廊道維持 ±5 cm 橫向定位精度。',
    patterns: /lidar|光達|點雲|ndt|rtk|gnss|imu|定位|外參|calibration|感知|autoware/i,
    keywords: ['lidar', '光達', '點雲', 'ndt', 'rtk-gnss', 'imu', '高精定位', '外參標定', 'autoware'],
  },
  {
    id: 'concept:fms-occ-teleop',
    kind: 'concept',
    label: '中央行控系統 (OCC / FMS) 與 5G 低延遲遠端接管 (Teleoperation)',
    communityId: 'comm-fms-occ',
    summary:
      '車隊班距動態調度、SOC 低電量自動派發充電、5G 企業專網 (≤50 ms) 多視角串流與 NSC Remote 遠端控制接管。',
    patterns: /fms|occ|行控|調度|班距|遠端接管|teleop|nsc|5g|圖台|監控|充電/i,
    keywords: ['fms', 'occ', '行控中心', '車隊調度', '遠端接管', 'teleoperation', '5g專網'],
  },
  {
    id: 'concept:psd-v2x-icd',
    kind: 'concept',
    label: '月台門 (PSD) 安全連鎖、V2X 號誌連動與跨標案介面控制 (ICD)',
    communityId: 'comm-transit-infra',
    summary:
      '車站月台門 (PSD) ±10 cm 精準停靠對位連鎖、路側 RSU 智慧號誌優先通行，以及跨標案電力／通訊／機電介面控制文件 (ICD)。',
    patterns: /psd|月台門|v2x|rsu|號誌|icd|介面|施工協調|套繪|廊道|航廈|t3/i,
    keywords: ['psd', '月台門', 'v2x', 'rsu', '號誌連動', 'icd', '介面控制', 't3', '第三航廈'],
  },
  {
    id: 'concept:hil-fat-sat-kpi',
    kind: 'concept',
    label: 'V-Model 測試驗證體系 (HIL 模擬 / FAT 出廠測試 / SAT 72hr 現場連測)',
    communityId: 'comm-testing-qa',
    summary:
      '涵蓋硬體迴路模擬 (HIL)、出廠測試 (FAT)、現場整合測試 (SAT 連續 72 小時無重大故障運行) 與量化驗收 KPI 門檻。',
    patterns: /hil|fat|sat|驗收|測試|72\s*小時|kpi|查核|wbs|時程|里程碑/i,
    keywords: ['hil', 'fat', 'sat', '驗收標準', '72小時連測', 'kpi', 'wbs', '里程碑'],
  },
  {
    id: 'concept:golf-maas-overseas',
    kind: 'concept',
    label: '智慧高爾夫球車 (Golface)、園區接駁與海外場域實績 (日本／泰國／新加坡)',
    communityId: 'comm-maas-global',
    summary:
      '涵蓋揚昇／Golface 自駕高爾夫球車、青埔高鐵接駁、桃園農博、雙北自駕巴士，以及日本 (Tokyo Drift / ADAWARP)、泰國、新加坡海外落地實績。',
    patterns: /球車|高爾夫|golface|綠通|青埔|農博|日本|東京|tokyo|adawarp|泰國|新加坡|海外/i,
    keywords: ['高爾夫球車', 'golface', '青埔', '日本專案', 'adawarp', '新加坡', '泰國', '海外實績'],
  },
];

const COMMUNITY_DEFINITIONS: Record<string, string> = {
  'comm-safety-iso': '國際安全標準與資安合規 (ISO 26262 / 21448 / 21434)',
  'comm-perception-loc': 'Autoware 感知融合與 3D LiDAR 高精定位',
  'comm-fms-occ': 'FMS 行控中心、車隊調度與 5G 遠端接管',
  'comm-transit-infra': 'T3 機場廊道、月台門 (PSD) 與跨標案 ICD 介面',
  'comm-testing-qa': '工程驗證 (HIL/FAT/SAT)、WBS 時程與驗收指標',
  'comm-maas-global': '自駕巴士、智慧球車與國內外場域實績 (2019–2026)',
};

const GRAPH_CACHE_PATH = path.join(process.cwd(), 'graphify-out', 'company-files-graph.json');

// In-memory singleton so subsequent queries in the same process are sub-millisecond
// and dynamically ingested files immediately optimize the live graph.
let cachedGraphState: CompanyKnowledgeGraphState | null = null;
const dynamicIngestedNodes = new Map<string, KnowledgeGraphNode>();

function tokenizeText(text: string): string[] {
  const clean = text.toLowerCase();
  const tokens = new Set<string>();

  // Extract English / alphanumeric / ISO / code tokens
  for (const m of clean.matchAll(/[a-z0-9_.-]{2,}/g)) {
    tokens.add(m[0]);
  }

  // Extract meaningful Chinese 2-grams and 3-grams + domain terms
  const cjkRuns = clean.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length <= 6) tokens.add(run);
    for (let i = 0; i < run.length - 1; i++) {
      tokens.add(run.slice(i, i + 2));
      if (i < run.length - 2) {
        tokens.add(run.slice(i, i + 3));
      }
    }
  }

  return Array.from(tokens);
}

function assignBestCommunity(text: string, year?: number): string {
  for (const c of DOMAIN_CONCEPTS) {
    if (c.patterns.test(text)) {
      return c.communityId;
    }
  }
  if (year && year >= 2025) return 'comm-transit-infra';
  return 'comm-maas-global';
}

/**
 * Builds and optimizes the full Company Knowledge Graph from:
 * 1. Domain Ontology & ISO Standards
 * 2. All 2019–2026 Historical Projects & recursively nested Google Drive files/folders
 * 3. Active Co-Authoring Starter Documents (Word chapters, Excel WBS sheets, PPT slides)
 * 4. Dynamically ingested files (from live Drive sync, sidebar drops, or reference uploads)
 */
export function buildAndOptimizeCompanyKnowledgeGraph(
  forceRebuild = false
): CompanyKnowledgeGraphState {
  if (cachedGraphState && !forceRebuild) {
    return cachedGraphState;
  }

  const nodesMap = new Map<string, KnowledgeGraphNode>();
  const edges: KnowledgeGraphEdge[] = [];
  const nowIso = new Date().toISOString();

  // 1. Add Domain Concept & Standard Nodes
  for (const concept of DOMAIN_CONCEPTS) {
    nodesMap.set(concept.id, {
      id: concept.id,
      kind: concept.kind,
      label: concept.label,
      summary: concept.summary,
      keywords: concept.keywords,
      accessScope: 'company_wide',
      centralityScore: 1,
      communityId: concept.communityId,
      sourceOrigin: 'domain_ontology',
      ingestedAt: nowIso,
    });
  }

  // 2. Walk all Historical Year Groups, Projects, and nested Drive Items
  for (const group of HISTORICAL_YEAR_GROUPS) {
    const yearNodeId = `year:${group.year}`;
    nodesMap.set(yearNodeId, {
      id: yearNodeId,
      kind: 'year',
      label: `${group.year} 年度專案群組（${group.tagline}）`,
      year: group.year,
      summary: group.projectOverview,
      keywords: tokenizeText(`${group.year} ${group.tagline} ${group.projectOverview}`).slice(0, 40),
      accessScope: 'company_wide',
      centralityScore: 1,
      communityId: 'comm-maas-global',
      sourceOrigin: 'historical_seed',
      ingestedAt: nowIso,
    });

    for (const proj of group.projects) {
      const projNodeId = `project:${proj.id}`;
      const projFullText = `${proj.code} ${proj.name} ${proj.department} ${proj.summary} ${proj.highlights.join(' ')}`;
      const projCommunity = assignBestCommunity(projFullText, proj.startYear);

      nodesMap.set(projNodeId, {
        id: projNodeId,
        kind: 'project',
        label: `[${proj.code}] ${proj.name}`,
        projectCode: proj.code,
        projectId: proj.id,
        year: proj.startYear,
        department: proj.department,
        driveUrl: proj.driveFolderUrl,
        updatedAt: proj.period,
        summary: `${proj.summary}｜代表檔案與亮點：${proj.highlights.join('、')}`,
        keywords: tokenizeText(projFullText).slice(0, 60),
        accessScope: proj.accessScope ?? 'company_wide',
        allowedDepartments: proj.allowedDepartments,
        allowedRoles: proj.allowedRoles,
        centralityScore: 2,
        communityId: projCommunity,
        sourceOrigin: 'historical_seed',
        ingestedAt: nowIso,
      });

      edges.push({
        source: projNodeId,
        target: yearNodeId,
        relation: 'IN_YEAR',
        weight: 1.0,
        confidence: 'EXTRACTED',
      });

      // Link project to matching domain concepts/standards
      for (const concept of DOMAIN_CONCEPTS) {
        if (concept.patterns.test(projFullText)) {
          edges.push({
            source: projNodeId,
            target: concept.id,
            relation:
              concept.kind === 'standard' ? 'COMPLIES_WITH_STANDARD' : 'IMPLEMENTS_CONCEPT',
            weight: 1.5,
            confidence: 'INFERRED',
          });
        }
      }

      // Recursively index all nested folders and files inside the project
      const walkDriveItems = (
        items: HistoricalDriveItem[],
        parentNodeId: string,
        inheritedScope?: AccessScopeLevel,
        inheritedDepts?: string[],
        inheritedRoles?: string[]
      ) => {
        for (const item of items) {
          const itemNodeId = `file:${item.id}`;
          const effectiveScope = item.accessScope ?? inheritedScope ?? proj.accessScope ?? 'company_wide';
          const effectiveDepts = item.allowedDepartments ?? inheritedDepts ?? proj.allowedDepartments;
          const effectiveRoles = item.allowedRoles ?? inheritedRoles ?? proj.allowedRoles;
          const takeawaysText = (item.keyTakeaways ?? []).join('；');
          const itemFullText = `${proj.code} ${proj.name} ${item.name} ${item.sizeOrNote ?? ''} ${takeawaysText}`;
          const itemComm = assignBestCommunity(itemFullText, proj.startYear);

          nodesMap.set(itemNodeId, {
            id: itemNodeId,
            kind: item.kind === 'folder' ? 'folder' : 'file',
            label: item.name,
            projectCode: proj.code,
            projectId: proj.id,
            year: proj.startYear,
            department: proj.department,
            fileKind: item.kind,
            driveUrl: item.driveUrl,
            updatedAt: item.updatedAt ?? proj.period,
            summary: [
              `所屬專案：${proj.code} ${proj.name}（${proj.period}）`,
              item.sizeOrNote ? `規格／類型：${item.sizeOrNote}` : '',
              takeawaysText ? `關鍵內容摘要：${takeawaysText}` : '',
            ]
              .filter(Boolean)
              .join('｜'),
            keywords: tokenizeText(itemFullText).slice(0, 50),
            accessScope: effectiveScope,
            allowedDepartments: effectiveDepts,
            allowedRoles: effectiveRoles,
            centralityScore: item.keyTakeaways?.length ? 1.8 : 1.0,
            communityId: itemComm,
            sourceOrigin: 'historical_seed',
            ingestedAt: nowIso,
          });

          edges.push({
            source: itemNodeId,
            target: projNodeId,
            relation: 'BELONGS_TO_PROJECT',
            weight: 1.2,
            confidence: 'EXTRACTED',
          });

          if (parentNodeId !== projNodeId) {
            edges.push({
              source: itemNodeId,
              target: parentNodeId,
              relation: 'PARENT_FOLDER',
              weight: 1.0,
              confidence: 'EXTRACTED',
            });
          }

          for (const concept of DOMAIN_CONCEPTS) {
            if (concept.patterns.test(itemFullText)) {
              edges.push({
                source: itemNodeId,
                target: concept.id,
                relation:
                  concept.kind === 'standard' ? 'COMPLIES_WITH_STANDARD' : 'IMPLEMENTS_CONCEPT',
                weight: 1.4,
                confidence: 'INFERRED',
              });
            }
          }

          if (item.children && item.children.length > 0) {
            walkDriveItems(
              item.children,
              itemNodeId,
              effectiveScope,
              effectiveDepts,
              effectiveRoles
            );
          }
        }
      };

      walkDriveItems(
        proj.files,
        projNodeId,
        proj.accessScope,
        proj.allowedDepartments,
        proj.allowedRoles
      );
    }
  }

  // 3. Index Starter Co-Authoring Documents (Word sections, Excel sheets, PPT slides)
  for (const doc of STARTER_COAUTHOR_DOCUMENTS) {
    const docNodeId = `coauthor:${doc.id}`;
    const bodyText = [
      doc.title,
      ...(doc.wordSections ?? []).map((s) => `${s.code} ${s.title} ${s.content}`),
      ...(doc.excelSheets ?? []).map(
        (sh) => `${sh.name} ${sh.columns.join(' ')} ${sh.rows.map((r) => r.join(' ')).join(' ')}`
      ),
      ...(doc.pptSlides ?? []).map((sl) => `${sl.title} ${sl.subtitle} ${sl.bullets.join(' ')}`),
    ].join('\n');

    nodesMap.set(docNodeId, {
      id: docNodeId,
      kind: 'file',
      label: doc.title,
      projectCode: doc.projectCode,
      projectId: doc.projectId,
      year: 2026,
      summary: `共同編輯範本檔案（${doc.docType.toUpperCase()}）：${bodyText.slice(0, 260)}`,
      keywords: tokenizeText(bodyText).slice(0, 70),
      accessScope: 'company_wide',
      centralityScore: 1.6,
      communityId: assignBestCommunity(bodyText, 2026),
      sourceOrigin: 'coauthor_doc',
      ingestedAt: nowIso,
    });

    const targetProjNodeId = `project:${doc.projectId}`;
    if (nodesMap.has(targetProjNodeId)) {
      edges.push({
        source: docNodeId,
        target: targetProjNodeId,
        relation: 'BELONGS_TO_PROJECT',
        weight: 1.3,
        confidence: 'EXTRACTED',
      });
    }

    for (const concept of DOMAIN_CONCEPTS) {
      if (concept.patterns.test(bodyText)) {
        edges.push({
          source: docNodeId,
          target: concept.id,
          relation: 'IMPLEMENTS_CONCEPT',
          weight: 1.5,
          confidence: 'EXTRACTED',
        });
      }
    }
  }

  // 4. Merge any dynamically ingested nodes (new files from Drive sync, drag-drop, or reference uploads)
  for (const [dynId, dynNode] of dynamicIngestedNodes.entries()) {
    nodesMap.set(dynId, dynNode);
    const fullText = `${dynNode.label} ${dynNode.summary} ${dynNode.keywords.join(' ')}`;
    if (dynNode.projectId && nodesMap.has(`project:${dynNode.projectId}`)) {
      edges.push({
        source: dynId,
        target: `project:${dynNode.projectId}`,
        relation: 'BELONGS_TO_PROJECT',
        weight: 1.4,
        confidence: 'EXTRACTED',
      });
    }
    for (const concept of DOMAIN_CONCEPTS) {
      if (concept.patterns.test(fullText)) {
        edges.push({
          source: dynId,
          target: concept.id,
          relation:
            concept.kind === 'standard' ? 'COMPLIES_WITH_STANDARD' : 'IMPLEMENTS_CONCEPT',
          weight: 1.6,
          confidence: 'INFERRED',
        });
      }
    }
  }

  // 5. Graph Optimization Step:
  //    - Recompute node degree centrality (God Nodes)
  //    - Recompute inverse document frequency (IDF) weights across the corpus
  //    - Summarize Community Clusters & Cohesion scores
  const degreeMap = new Map<string, number>();
  for (const e of edges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + e.weight);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + e.weight);
  }

  const allNodes = Array.from(nodesMap.values());
  const docFreq = new Map<string, number>();

  for (const node of allNodes) {
    const deg = degreeMap.get(node.id) ?? 1;
    node.centralityScore = Number((1 + Math.log1p(deg) * 0.45).toFixed(3));
    const uniqueKw = new Set(node.keywords);
    for (const kw of uniqueKw) {
      docFreq.set(kw, (docFreq.get(kw) ?? 0) + 1);
    }
  }

  const totalDocs = Math.max(1, allNodes.length);
  const idfWeights: Record<string, number> = {};
  for (const [term, df] of docFreq.entries()) {
    idfWeights[term] = Number((Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5))).toFixed(3));
  }

  const godNodes = [...allNodes]
    .sort((a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0))
    .slice(0, 12)
    .map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      degree: Math.round(degreeMap.get(n.id) ?? 0),
    }));

  const communities: KnowledgeGraphCommunity[] = Object.entries(COMMUNITY_DEFINITIONS).map(
    ([commId, commLabel]) => {
      const members = allNodes.filter((n) => n.communityId === commId);
      const kwCounts = new Map<string, number>();
      for (const m of members) {
        for (const kw of m.keywords.slice(0, 15)) {
          if (kw.length >= 2) kwCounts.set(kw, (kwCounts.get(kw) ?? 0) + 1);
        }
      }
      const topKeywords = Array.from(kwCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k]) => k);

      return {
        id: commId,
        label: commLabel,
        nodeCount: members.length,
        topKeywords,
        cohesionScore: Number(Math.min(0.98, 0.72 + members.length * 0.004).toFixed(2)),
      };
    }
  );

  const fingerprint = crypto
    .createHash('sha1')
    .update(`${allNodes.length}:${edges.length}:${dynamicIngestedNodes.size}`)
    .digest('hex')
    .slice(0, 12);

  const state: CompanyKnowledgeGraphState = {
    version: (cachedGraphState?.version ?? 0) + 1,
    lastOptimizedAt: nowIso,
    contentFingerprint: fingerprint,
    totalNodes: allNodes.length,
    totalEdges: edges.length,
    nodes: allNodes,
    edges,
    communities,
    godNodes,
    idfWeights,
  };

  cachedGraphState = state;

  // Persist snapshot to graphify-out/company-files-graph.json asynchronously
  try {
    const dir = path.dirname(GRAPH_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      GRAPH_CACHE_PATH,
      JSON.stringify(
        {
          version: state.version,
          lastOptimizedAt: state.lastOptimizedAt,
          contentFingerprint: state.contentFingerprint,
          totalNodes: state.totalNodes,
          totalEdges: state.totalEdges,
          communities: state.communities,
          godNodes: state.godNodes,
          nodes: state.nodes,
          edges: state.edges,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // Ignore read-only filesystem errors in restricted environments
  }

  return state;
}

/**
 * Automatically ingests newly discovered or uploaded files (from live Google Drive sync,
 * sidebar drag-and-drop, or reference attachments) into the Knowledge Graph and triggers
 * an immediate incremental graph re-optimization (updating edges, centrality, and IDF weights).
 */
export function ingestNewFilesAndOptimizeGraph(
  files: Array<{
    id: string;
    name: string;
    projectCode?: string;
    projectId?: string;
    year?: number;
    department?: string;
    kindLabel?: string;
    extractedText?: string;
    driveUrl?: string;
    accessScope?: AccessScopeLevel;
    allowedDepartments?: string[];
    allowedRoles?: string[];
    sourceOrigin?: KnowledgeGraphNode['sourceOrigin'];
  }>
): { addedOrUpdated: number; totalNodes: number; totalEdges: number; lastOptimizedAt: string } {
  if (!files || files.length === 0) {
    const g = buildAndOptimizeCompanyKnowledgeGraph(false);
    return {
      addedOrUpdated: 0,
      totalNodes: g.totalNodes,
      totalEdges: g.totalEdges,
      lastOptimizedAt: g.lastOptimizedAt,
    };
  }

  let changed = 0;
  const nowIso = new Date().toISOString();

  for (const f of files) {
    const nodeId = f.id.startsWith('file:') || f.id.startsWith('upload:') ? f.id : `file:${f.id}`;
    const fullText = `${f.name} ${f.projectCode ?? ''} ${f.kindLabel ?? ''} ${f.extractedText ?? ''}`;
    const existing = dynamicIngestedNodes.get(nodeId);
    const summaryText = f.extractedText
      ? `新索引檔案（${f.kindLabel ?? '文件'}）：${f.extractedText.slice(0, 360)}`
      : `動態索引檔案（${f.kindLabel ?? '專案檔案'}）：${f.name}`;

    if (!existing || existing.summary !== summaryText) {
      dynamicIngestedNodes.set(nodeId, {
        id: nodeId,
        kind: 'file',
        label: f.name,
        projectCode: f.projectCode,
        projectId: f.projectId,
        year: f.year ?? new Date().getFullYear(),
        department: f.department,
        driveUrl: f.driveUrl,
        updatedAt: nowIso.slice(0, 10),
        summary: summaryText,
        keywords: tokenizeText(fullText).slice(0, 65),
        accessScope: f.accessScope ?? 'company_wide',
        allowedDepartments: f.allowedDepartments,
        allowedRoles: f.allowedRoles,
        centralityScore: 1.5,
        communityId: assignBestCommunity(fullText, f.year),
        sourceOrigin: f.sourceOrigin ?? 'user_upload',
        ingestedAt: nowIso,
      });
      changed++;
    }
  }

  const state = buildAndOptimizeCompanyKnowledgeGraph(changed > 0);
  return {
    addedOrUpdated: changed,
    totalNodes: state.totalNodes,
    totalEdges: state.totalEdges,
    lastOptimizedAt: state.lastOptimizedAt,
  };
}

/**
 * Syncs a live Google Drive folder subtree into the Knowledge Graph so any new files
 * added on Google Shared Drives are immediately indexed and searchable.
 */
export function ingestDriveTreeIntoKnowledgeGraph(
  projectId: string,
  projectCode: string,
  items: HistoricalDriveItem[]
): void {
  const flat: Parameters<typeof ingestNewFilesAndOptimizeGraph>[0] = [];
  const walk = (list: HistoricalDriveItem[]) => {
    for (const item of list) {
      flat.push({
        id: item.id,
        name: item.name,
        projectId,
        projectCode,
        kindLabel: item.sizeOrNote ?? item.kind,
        extractedText: (item.keyTakeaways ?? []).join('；'),
        driveUrl: item.driveUrl,
        accessScope: item.accessScope,
        allowedDepartments: item.allowedDepartments,
        allowedRoles: item.allowedRoles,
        sourceOrigin: 'live_drive_sync',
      });
      if (item.children?.length) walk(item.children);
    }
  };
  walk(items);
  if (flat.length > 0) {
    ingestNewFilesAndOptimizeGraph(flat);
  }
}

/**
 * Multi-hop GraphRAG search across the Company Knowledge Graph.
 * 1. Filters all nodes strictly by viewer access permissions (`canViewerAccessScope`).
 * 2. Matches query tokens + domain ontology concepts using IDF-weighted scoring.
 * 3. Performs 1-hop and 2-hop graph traversal along `IMPLEMENTS_CONCEPT`,
 *    `COMPLIES_WITH_STANDARD`, and `BELONGS_TO_PROJECT` edges to surface related
 *    historical files and projects even when exact keywords differ.
 */
export function searchCompanyKnowledgeGraph(
  query: string,
  viewer: ProjectViewerContext,
  options?: {
    activeProjectCode?: string;
    topKFiles?: number;
    topKProjects?: number;
    autoOptimizedOnNewFiles?: boolean;
  }
): GraphQueryResult {
  const graph = buildAndOptimizeCompanyKnowledgeGraph(false);
  const topKFiles = options?.topKFiles ?? 8;
  const topKProjects = options?.topKProjects ?? 6;

  // Map project metadata for fast lookup
  const projectMap = new Map<string, HistoricalProject>();
  for (const g of HISTORICAL_YEAR_GROUPS) {
    for (const p of g.projects) {
      projectMap.set(p.id, p);
    }
  }

  // Filter nodes by viewer's security / confidential permissions
  const authorizedNodeIds = new Set<string>();
  const nodeById = new Map<string, KnowledgeGraphNode>();

  for (const node of graph.nodes) {
    const access = canViewerAccessScope(viewer, {
      accessScope: node.accessScope,
      allowedDepartments: node.allowedDepartments,
      allowedRoles: node.allowedRoles,
    });
    if (!access.allowed) continue;
    authorizedNodeIds.add(node.id);
    nodeById.set(node.id, node);
  }

  // Build adjacency list for authorized nodes
  const adjacency = new Map<string, Array<{ neighborId: string; relation: string; weight: number }>>();
  for (const e of graph.edges) {
    if (!authorizedNodeIds.has(e.source) || !authorizedNodeIds.has(e.target)) continue;
    const srcList = adjacency.get(e.source) ?? [];
    srcList.push({ neighborId: e.target, relation: e.relation, weight: e.weight });
    adjacency.set(e.source, srcList);

    const tgtList = adjacency.get(e.target) ?? [];
    tgtList.push({ neighborId: e.source, relation: e.relation, weight: e.weight });
    adjacency.set(e.target, tgtList);
  }

  // Step 1: Identify activated Domain Concepts / Standards from the query
  const activatedConcepts: KnowledgeGraphNode[] = [];
  const expandedTermSet = new Set<string>(tokenizeText(query));

  for (const c of DOMAIN_CONCEPTS) {
    if (c.patterns.test(query)) {
      const cNode = nodeById.get(c.id);
      if (cNode) {
        activatedConcepts.push(cNode);
        for (const kw of c.keywords) {
          for (const t of tokenizeText(kw)) expandedTermSet.add(t);
        }
      }
    }
  }

  const expandedTerms = Array.from(expandedTermSet);

  // Step 2: Score every authorized node via BM25/IDF lexical match + Graph Concept Propagation
  const nodeScores = new Map<string, { score: number; matchedTerms: Set<string>; concepts: Set<string> }>();

  for (const node of nodeById.values()) {
    let score = 0;
    const matched = new Set<string>();
    const nodeTextLower = `${node.label} ${node.summary} ${node.projectCode ?? ''}`.toLowerCase();

    for (const term of expandedTerms) {
      if (term.length < 2) continue;
      if (node.keywords.includes(term) || nodeTextLower.includes(term)) {
        const idf = graph.idfWeights[term] ?? 1.2;
        score += idf * (node.label.toLowerCase().includes(term) ? 2.2 : 1.0);
        matched.add(term);
      }
    }

    // Boost active project context slightly ONLY when there is already a lexical match
    if (score > 0 && options?.activeProjectCode && node.projectCode === options.activeProjectCode) {
      score += 0.8;
    }

    // Multiply by node centrality score (God Node authority boost)
    score *= node.centralityScore;

    if (score > 0) {
      nodeScores.set(node.id, { score, matchedTerms: matched, concepts: new Set() });
    }
  }

  // Step 3: Multi-hop Graph Propagation from Activated Concepts & High-Scoring Seed Nodes
  const traversalPaths: string[] = [];
  for (const conceptNode of activatedConcepts) {
    const neighbors = adjacency.get(conceptNode.id) ?? [];
    for (const { neighborId, relation, weight } of neighbors) {
      const neighbor = nodeById.get(neighborId);
      if (!neighbor) continue;
      const entry = nodeScores.get(neighborId) ?? {
        score: 0,
        matchedTerms: new Set<string>(),
        concepts: new Set<string>(),
      };
      entry.score += 3.5 * weight * neighbor.centralityScore;
      entry.concepts.add(conceptNode.label);
      nodeScores.set(neighborId, entry);

      if (traversalPaths.length < 10) {
        traversalPaths.push(`${conceptNode.label} ──[${relation}]──> ${neighbor.label}`);
      }
    }
  }

  // Propagate 1 hop from matched Projects to their key Files and vice versa
  const initialScoredEntries = Array.from(nodeScores.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 15);

  for (const [seedId, seedData] of initialScoredEntries) {
    const seedNode = nodeById.get(seedId);
    if (!seedNode) continue;
    const neighbors = adjacency.get(seedId) ?? [];
    for (const { neighborId, relation, weight } of neighbors) {
      const nb = nodeById.get(neighborId);
      if (!nb) continue;
      if (nb.kind === 'concept' || nb.kind === 'standard') {
        seedData.concepts.add(nb.label);
        if (!activatedConcepts.some((c) => c.id === nb.id)) {
          activatedConcepts.push(nb);
        }
      } else if (nb.kind === 'file' || nb.kind === 'project') {
        const nbEntry = nodeScores.get(neighborId) ?? {
          score: 0,
          matchedTerms: new Set<string>(),
          concepts: new Set<string>(),
        };
        nbEntry.score += seedData.score * 0.25 * weight;
        nodeScores.set(neighborId, nbEntry);
        if (traversalPaths.length < 12 && relation === 'BELONGS_TO_PROJECT') {
          traversalPaths.push(`${seedNode.label} ──[${relation}]──> ${nb.label}`);
        }
      }
    }
  }

  // Step 4: Rank and package top Files and top Projects
  const matchedFiles: GraphSearchResultItem[] = [];
  const matchedProjects: GraphSearchResultItem[] = [];

  const sortedAll = Array.from(nodeScores.entries()).sort((a, b) => b[1].score - a[1].score);

  for (const [id, data] of sortedAll) {
    const node = nodeById.get(id);
    if (!node) continue;
    const proj = node.projectId ? projectMap.get(node.projectId) : undefined;
    const item: GraphSearchResultItem = {
      node,
      score: Number(data.score.toFixed(2)),
      matchedTerms: Array.from(data.matchedTerms).slice(0, 8),
      connectedConcepts: Array.from(data.concepts).slice(0, 4),
      projectContext: proj
        ? {
            id: proj.id,
            code: proj.code,
            name: proj.name,
            period: proj.period,
            department: proj.department,
            summary: proj.summary,
          }
        : undefined,
    };

    if ((node.kind === 'file' || node.kind === 'folder') && matchedFiles.length < topKFiles) {
      matchedFiles.push(item);
    } else if (node.kind === 'project' && matchedProjects.length < topKProjects) {
      matchedProjects.push(item);
    }
  }

  // Never populate arbitrary fallback projects when nothing matched the query
  return {
    query,
    expandedTerms: expandedTerms.slice(0, 20),
    matchedFiles,
    matchedProjects,
    matchedStandardsAndConcepts: activatedConcepts.slice(0, 6),
    traversalPaths: traversalPaths.slice(0, 8),
    graphStats: {
      totalNodes: graph.totalNodes,
      totalEdges: graph.totalEdges,
      communitiesCount: graph.communities.length,
      lastOptimizedAt: graph.lastOptimizedAt,
      autoOptimizedOnNewFiles: Boolean(options?.autoOptimizedOnNewFiles),
    },
  };
}
