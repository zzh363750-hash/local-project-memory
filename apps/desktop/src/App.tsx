import "./App.css";
import {
  FormEvent,
  KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import hljs from "highlight.js/lib/common";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ReactMarkdown, { type Components } from "react-markdown";
import "highlight.js/styles/github-dark.css";
import {
  buildProjectTimeline,
  groupProjectTimelineEntries,
  type ProjectTimelineEntry,
  type ProjectTimelineSection,
} from "./projectTimeline";
import {
  buildProgressAnalysisInput,
  buildProgressAnalysisPromptFromInput,
} from "./projectProgressAnalysis";
import {
  buildWeeklyReportInput,
  buildWeeklyReportPromptFromInput,
} from "./projectWeeklyReport";
import {
  buildMarkdownFilename,
  copyMarkdownToClipboard,
  downloadMarkdownFile,
} from "./reportExport";
import {
  analyzeProject,
  formatProjectFactsForPrompt,
  type ProjectFacts,
} from "./projectAnalyzer";

type Project = {
  id: number;
  name: string;
  path: string;
  description: string;
};

type ProjectForm = {
  name: string;
  path: string;
  description: string;
};

type ScannedFile = {
  name: string;
  relative_path: string;
  size: number;
  modified_time: number;
  has_test_marker?: boolean | null;
};

type SemanticChunkMatch = {
  chunk_id: string;
  relative_path: string;
  start_offset: number;
  end_offset: number;
  score: number;
  content: string;
};

type CodePreviewChunk = {
  type: string;
  name: string;
  language: string;
  calls: CodeCallRef[];
  content: string;
  startLine: number;
  endLine: number;
};

type CodeCallRef = {
  name: string;
  inSameFile: boolean;
};

type ConversationTurn = {
  question: string;
  answer: string;
};

type AppSection = "projects" | "reports" | "settings";
type ReportBoardMode = "project" | "weekly";
type AnswerMode = "strict" | "explain";

type MimoKeyStatus = {
  has_env_key: boolean;
  has_keychain_key: boolean;
  active_source: "keychain" | "env" | "missing";
};

type AnswerSourceEntry = {
  sourceLabel: string;
  fileLabel: string;
  segmentLabel: string;
  content?: string;
};

type EvidenceItem = {
  fileLabel: string;
  segmentLabel: string;
  sourceLabel: string;
  summary: string;
};

type DetailItem = {
  fileLabel: string;
  segmentLabel: string;
  sourceLabel: string;
  content: string;
};

type ParsedAnswerContent = {
  summary: string;
  evidences: EvidenceItem[];
  details: DetailItem[];
};

type SubmitQuestionOptions = {
  mode?: "replace" | "append";
};

type ReportData = {
  summary: string;
  flow: string;
  code: string;
};

type MarkdownCopyStatus = "idle" | "copying" | "copied" | "copy failed";
type MarkdownExportStatus =
  | "idle"
  | "exporting"
  | "exported"
  | "export failed";

type ProjectProgressAnalysisRecord = {
  content: string;
  status: "idle" | "loading" | "success" | "failure";
  error: string;
  updatedAt: number;
};

type ProjectProgressAnalysesById = Record<number, ProjectProgressAnalysisRecord>;

type ProjectWeeklyReportRecord = {
  content: string;
  status: "idle" | "loading" | "success" | "failure";
  error: string;
  updatedAt: number;
};

type ProjectWeeklyReportsById = Record<number, ProjectWeeklyReportRecord>;

type ProjectReportRecord = {
  content: string;
  status: "idle" | "loading" | "success" | "failure";
  error: string;
  updatedAt: number;
};

type ProjectReportsById = Record<number, ProjectReportRecord>;
type ProjectFactsById = Record<number, ProjectFacts>;

type ReportFavoriteTurn = ConversationTurn & {
  savedAt: number;
};

type ReportFavoritesByProjectId = Record<number, ReportFavoriteTurn[]>;

type GroupedAnswerItems<T> = {
  fileLabel: string;
  items: T[];
};

const emptyForm: ProjectForm = {
  name: "",
  path: "",
  description: "",
};

const projectsStorageKey = "local-project-memory-projects";
const answerModeStorageKey = "local-project-memory-answer-mode";
const localApiKeyStorageKey = "API_KEY";
const deviceIdStorageKey = "DEVICE_ID";
const hasTrackedStorageKey = "HAS_TRACKED";
const hasTrackedOpenStorageKey = "HAS_TRACKED_OPEN";
const hasTrackedScanStorageKey = "HAS_TRACKED_SCAN";
const projectReportsStorageKey = "local-project-memory-project-reports";
const projectProgressAnalysesStorageKey =
  "local-project-memory-project-progress-analyses";
const projectWeeklyReportsStorageKey =
  "local-project-memory-project-weekly-reports";
const reportBoardModeStorageKey = "local-project-memory-report-board-mode";
const reportFavoritesStorageKey = "local-project-memory-report-favorites";
const answerAppendSeparator = "\n\n----------------\n【函数解释】\n";
const MAX_PREVIEW_FILE_SIZE = 1024 * 1024;
const QUESTION_CONTEXT_FILE_LIMIT = 5;
const QUESTION_HISTORY_LIMIT = 3;
const QUESTION_CONTEXT_TOTAL_LIMIT = 5000;
const QUESTION_PLACEHOLDERS = [
  "这个项目是干嘛的？",
  "核心逻辑在哪？",
  "API 是怎么实现的？",
  "前端是怎么调用后端的？",
  "哪些文件最关键？",
  "搜索功能是怎么做的？",
];
const EMPTY_STATE_QUESTIONS = [
  "这个项目是做什么的？",
  "核心调用链是什么？",
  "主要模块有哪些？",
  "关键代码是怎么实现的？",
];
const FOLLOW_UP_QUESTIONS = ["看整体流程", "看关键模块", "看具体实现"];
type TauriInternals = {
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

const isTauriRuntime =
  typeof window !== "undefined" &&
  typeof (window as Window & { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__?.invoke === "function";

const runTauriCommand = async <T,>(
  command: string,
  args: Record<string, unknown>,
) => {
  if (!isTauriRuntime) {
    throw new Error("当前未在 Tauri 桌面环境中运行，请通过 pnpm tauri dev 打开应用");
  }

  return invoke<T>(command, args);
};

const loadLocalApiKey = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(localApiKeyStorageKey) || "";
};

const getDeviceId = () => {
  if (typeof window === "undefined") {
    return "";
  }

  let id = window.localStorage.getItem(deviceIdStorageKey);

  if (!id) {
    id = Math.random().toString(36).slice(2);
    window.localStorage.setItem(deviceIdStorageKey, id);
  }

  return id;
};

const track = (event: string) => {
  if (typeof window === "undefined") {
    return;
  }

  console.log("🔥 track fired:", event);

  const deviceId = getDeviceId();
  const payload = JSON.stringify({
    event,
    device_id: deviceId,
    time: Date.now(),
  });

  void fetch("https://local-item.zzh363750.workers.dev/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload,
    keepalive: true,
  }).catch(() => {});
};

function getQuestionTerms(question: string) {
  return question
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/g)
    .filter((term) => term.length >= 2)
    .slice(0, 12);
}

const lowValueSearchTerms = new Set([
  "这个",
  "那个",
  "这些",
  "那些",
  "这",
  "那",
  "它",
  "它们",
  "其",
  "该",
  "此",
  "如何",
  "怎么",
  "怎样",
  "什么",
  "为何",
  "为什么",
  "是否",
  "能否",
  "一个",
  "一些",
  "以及",
]);

function normalizeSearchTerm(term: string) {
  let normalized = term.toLowerCase().trim();

  normalized = normalized.replace(/^(这个|那个|这些|那些|这|那|它们|它|其|该|此)+/, "");
  normalized = normalized.replace(/^(如何|怎么|怎样|什么|为何|为什么|是否|能否|请问|帮我|麻烦|请帮我)+/, "");

  return normalized.trim();
}

function getSearchTerms(text: string) {
  return getQuestionTerms(text)
    .map(normalizeSearchTerm)
    .filter((term) => term.length >= 2 && !lowValueSearchTerms.has(term));
}

function isReadmeFallbackFile(file: ScannedFile) {
  const relativePath = file.relative_path.toLowerCase();
  const fileName = file.name.toLowerCase();

  return (
    fileName === "readme.md" ||
    fileName === "readme_cn.md" ||
    relativePath.endsWith("/readme.md") ||
    relativePath.endsWith("/readme_cn.md")
  );
}

function pickReadmeFallbackFiles(files: ScannedFile[]) {
  return [...files]
    .filter(isReadmeFallbackFile)
    .sort((current, next) => {
      const priority = (file: ScannedFile) => {
        const relativePath = file.relative_path.toLowerCase();
        const fileName = file.name.toLowerCase();

        if (fileName === "readme_cn.md" || relativePath.endsWith("/readme_cn.md")) {
          return 1000;
        }

        if (fileName === "readme.md" || relativePath.endsWith("/readme.md")) {
          return 980;
        }

        return 0;
      };

      const currentPriority = priority(current);
      const nextPriority = priority(next);

      if (nextPriority !== currentPriority) {
        return nextPriority - currentPriority;
      }

      return current.relative_path.localeCompare(next.relative_path);
    });
}

function buildReadmeFallbackExcerpt(content: string, maxLength = 900) {
  const normalizedContent = content.replace(/\r\n/g, "\n").trim();

  if (!normalizedContent) {
    return "";
  }

  return normalizedContent.length > maxLength
    ? `${normalizedContent.slice(0, maxLength)}...`
    : normalizedContent;
}

function extractSourceLabels(text: string) {
  const labels: string[] = [];
  const sourcePattern = /【来源：([^】]+)】/g;

  for (const match of text.matchAll(sourcePattern)) {
    const label = match[1]?.trim();

    if (label) {
      labels.push(label);
    }
  }

  return labels;
}

function getSourceFileSearchTerm(label: string) {
  const { fileLabel } = parseSourceLabel(label);
  const basename = getFileBasename(fileLabel).replace(/\.[^.]+$/, "");
  return normalizeSearchTerm(basename);
}

function getChunkFocusKeyword(
  chunkContent: string,
  preferredTerms: string[] = [],
) {
  const contentTerms = getSearchTerms(chunkContent);
  const mergedTerms = [...preferredTerms, ...contentTerms].filter(
    (term, index, terms) => term.length >= 2 && terms.indexOf(term) === index,
  );

  return mergedTerms[0] ?? "";
}

function buildChunkSummary(
  chunkContent: string,
  preferredTerms: string[] = [],
  maxLength = 28,
) {
  const compactContent = chunkContent.replace(/\s+/g, " ").trim();

  if (!compactContent) {
    return "";
  }

  const sentences = compactContent
    .split(/[。！？!?；;\n]/g)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const normalizedPreferredTerms = preferredTerms
    .map(normalizeSearchTerm)
    .filter((term) => term.length >= 2);

  const bestSentence =
    sentences.reduce(
      (best, sentence) => {
        const lowerSentence = sentence.toLowerCase();
        const matchScore = normalizedPreferredTerms.reduce(
          (score, term) => score + (lowerSentence.includes(term.toLowerCase()) ? 1 : 0),
          0,
        );
        const closenessScore = Math.max(0, 20 - Math.abs(sentence.length - maxLength));
        const totalScore = matchScore * 100 + closenessScore;

        if (totalScore > best.score) {
          return { score: totalScore, sentence };
        }

        return best;
      },
      {
        score: -1,
        sentence: sentences[0] ?? compactContent,
      },
    ).sentence ?? compactContent;

  return bestSentence.length > maxLength
    ? `${bestSentence.slice(0, maxLength)}...`
    : bestSentence;
}

function buildReadableEvidenceSummary(
  summaryText: string,
  fallbackText: string,
  preferredTerms: string[] = [],
) {
  const normalizedSummary = summaryText.trim();
  if (normalizedSummary && !normalizedSummary.includes("无法生成摘要")) {
    return normalizedSummary;
  }

  const normalizedFallback = fallbackText
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .trim();

  if (!normalizedFallback) {
    return "当前片段内容较短";
  }

  const candidateLines = normalizedFallback
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^【来源：/.test(line));

  const lineSnippet = candidateLines.slice(0, 2).join(" ");
  if (lineSnippet) {
    return lineSnippet.length > 120
      ? `${lineSnippet.slice(0, 120)}...`
      : lineSnippet;
  }

  const sentenceSnippet = buildChunkSummary(
    normalizedFallback,
    preferredTerms,
    72,
  );

  return sentenceSnippet || "当前片段内容较短";
}

function parseSourceLabel(label: string) {
  const normalizedLabel = label.trim();
  const segmentDelimiterMatch = normalizedLabel.match(/\s*[｜|]\s*片段[:：]\s*/);

  if (!segmentDelimiterMatch || segmentDelimiterMatch.index === undefined) {
    return {
      fileLabel: normalizedLabel,
      segmentLabel: "",
    };
  }

  const delimiterIndex = segmentDelimiterMatch.index;

  return {
    fileLabel: normalizedLabel.slice(0, delimiterIndex).trim(),
    segmentLabel: normalizedLabel
      .slice(delimiterIndex + segmentDelimiterMatch[0].length)
      .trim(),
  };
}

function stripLeadingLabel(text: string, label: string) {
  const labelPattern = new RegExp(
    `^\\s*(?:\\*\\*)?${label}[:：](?:\\*\\*)?\\s*`,
  );

  return text.replace(labelPattern, "").trim();
}

function normalizeAnswerSnippet(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function parseAnswerContent(answerText: string): ParsedAnswerContent {
  const normalizedText = answerText.trim();

  if (!normalizedText) {
    return {
      summary: "",
      evidences: [],
      details: [],
    };
  }

  const buildHeaderPattern = (label: string) =>
    new RegExp(
      `(?:^|\\n)\\s*(?:\\*\\*)?${label}[:：](?:\\*\\*)?\\s*`,
    );

  const summaryHeaderMatch = normalizedText.match(buildHeaderPattern("总结"));
  const evidenceHeaderMatch = normalizedText.match(buildHeaderPattern("关键依据"));
  const detailHeaderMatch = normalizedText.match(buildHeaderPattern("详细说明"));

  const sectionMatches = [
    summaryHeaderMatch ? { key: "summary", index: summaryHeaderMatch.index ?? 0 } : null,
    evidenceHeaderMatch
      ? { key: "evidences", index: evidenceHeaderMatch.index ?? 0 }
      : null,
    detailHeaderMatch ? { key: "details", index: detailHeaderMatch.index ?? 0 } : null,
  ].filter((match): match is { key: "summary" | "evidences" | "details"; index: number } => match !== null);

  sectionMatches.sort((current, next) => current.index - next.index);

  const getSectionText = (key: "summary" | "evidences" | "details") => {
    const currentMatch =
      key === "summary"
        ? summaryHeaderMatch
        : key === "evidences"
          ? evidenceHeaderMatch
          : detailHeaderMatch;

    if (!currentMatch) {
      return "";
    }

    const currentIndex = currentMatch.index ?? 0;
    const currentLength = currentMatch[0].length;
    const currentSectionOrder = sectionMatches.findIndex((item) => item.key === key);
    const nextSectionIndex =
      currentSectionOrder >= 0 && currentSectionOrder < sectionMatches.length - 1
        ? sectionMatches[currentSectionOrder + 1].index
        : normalizedText.length;

    return normalizedText
      .slice(currentIndex + currentLength, nextSectionIndex)
      .trim();
  };

  const summary = summaryHeaderMatch
    ? getSectionText("summary")
    : detailHeaderMatch
      ? normalizedText
          .slice(0, detailHeaderMatch.index ?? 0)
          .replace(/^\s*(?:\*\*)?总结[:：](?:\*\*)?\s*/, "")
          .trim()
      : normalizedText;

  const evidencesText = getSectionText("evidences");
  const detailText = getSectionText("details");

  const sourcePattern = /【来源：([^】]+)】/g;
  const collectSourceEntries = (text: string) => {
    const collectedEntries: AnswerSourceEntry[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(sourcePattern)) {
      const matchIndex = match.index ?? 0;
      const sourceLabel = match[1]?.trim() ?? "";
      const bodyText = text.slice(lastIndex, matchIndex).trim();
      const { fileLabel, segmentLabel } = parseSourceLabel(sourceLabel);

      if (sourceLabel) {
        collectedEntries.push({
          sourceLabel,
          fileLabel,
          segmentLabel,
          content: bodyText,
        });
      }

      lastIndex = matchIndex + match[0].length;
    }

    const trailingText = text.slice(lastIndex).trim();
    if (collectedEntries.length > 0 && trailingText) {
      collectedEntries[collectedEntries.length - 1].content = `${collectedEntries[collectedEntries.length - 1].content}\n${trailingText}`.trim();
    }

    return collectedEntries;
  };

  const evidenceEntries = collectSourceEntries(evidencesText);
  const detailEntries = collectSourceEntries(detailText);

  return {
    summary: stripLeadingLabel(summary, "总结"),
    evidences: evidenceEntries.map((entry) => ({
      fileLabel: entry.fileLabel,
      segmentLabel: entry.segmentLabel,
      sourceLabel: entry.sourceLabel,
      summary: entry.content?.trim() ?? "",
    })),
    details: detailEntries.map((entry) => ({
      fileLabel: entry.fileLabel,
      segmentLabel: entry.segmentLabel,
      sourceLabel: entry.sourceLabel,
      content: entry.content?.trim() ?? "",
    })),
  };
}

function splitAnswerBlocks(answerText: string) {
  return answerText
    .split(answerAppendSeparator)
    .map((block) => block.trim())
    .filter(Boolean);
}

function groupAnswerItemsByFile<T extends { fileLabel: string }>(
  items: T[],
): GroupedAnswerItems<T>[] {
  const groups: GroupedAnswerItems<T>[] = [];
  const groupIndex = new Map<string, GroupedAnswerItems<T>>();

  for (const item of items) {
    const existingGroup = groupIndex.get(item.fileLabel);

    if (existingGroup) {
      existingGroup.items.push(item);
      continue;
    }

    const nextGroup = {
      fileLabel: item.fileLabel,
      items: [item],
    };

    groupIndex.set(item.fileLabel, nextGroup);
    groups.push(nextGroup);
  }

  return groups;
}

function buildSearchQuery(
  question: string,
  previousTurn: ConversationTurn | null,
) {
  type SearchTermCandidate = {
    order: number;
    priority: number;
    term: string;
  };

  const candidates: SearchTermCandidate[] = [];
  let order = 0;

  const addCandidates = (terms: string[], priority: number, limit?: number) => {
    terms.slice(0, limit).forEach((term) => {
      candidates.push({ order: order++, priority, term });
    });
  };

  addCandidates(getSearchTerms(question), 3, 8);

  if (/(逻辑|怎么|如何|实现|流程)/.test(question)) {
    addCandidates(["实现", "函数", "流程", "入口"], 3);
  }

  if (previousTurn) {
    addCandidates(getSearchTerms(previousTurn.question), 2, 6);

    const sourceLabels = Array.from(
      new Set(extractSourceLabels(previousTurn.answer)),
    ).slice(0, 2);

    addCandidates(
      sourceLabels
        .map(getSourceFileSearchTerm)
        .filter((term) => term.length >= 2),
      1,
    );
  }

  const seenTerms = new Set<string>();

  return candidates
    .sort((currentCandidate, nextCandidate) => {
      if (nextCandidate.priority !== currentCandidate.priority) {
        return nextCandidate.priority - currentCandidate.priority;
      }

      return currentCandidate.order - nextCandidate.order;
    })
    .map((candidate) => candidate.term)
    .filter((term) => {
      if (seenTerms.has(term)) {
        return false;
      }

      seenTerms.add(term);
      return true;
    })
    .slice(0, 10)
    .join(" ");
}

const markdownPreviewStyle = {
  backgroundColor: "#ffffff",
  color: "#111827",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  whiteSpace: "normal" as const,
  overflowWrap: "anywhere" as const,
};

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 style={{ margin: "0 0 0.9rem", fontSize: "1.75rem", lineHeight: 1.25, fontWeight: 800 }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ margin: "1.3rem 0 0.9rem", fontSize: "1.45rem", lineHeight: 1.25, fontWeight: 800 }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ margin: "1.1rem 0 0.75rem", fontSize: "1.2rem", lineHeight: 1.25, fontWeight: 800 }}>
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p style={{ margin: "0 0 1rem", lineHeight: 1.75 }}>{children}</p>
  ),
  ul: ({ children }) => (
    <ul style={{ margin: "0 0 1rem", paddingLeft: "1.5rem" }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: "0 0 1rem", paddingLeft: "1.5rem" }}>{children}</ol>
  ),
  li: ({ children }) => <li style={{ margin: "0.35rem 0" }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: "0 0 1rem",
        padding: "0.25rem 0 0.25rem 1rem",
        borderLeft: "4px solid #cbd5e1",
        color: "#475569",
      }}
    >
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre
      style={{
        margin: "0 0 1rem",
        padding: "1rem",
        borderRadius: 12,
        backgroundColor: "#0f172a",
        color: "#e2e8f0",
        overflow: "auto",
        fontFamily:
          '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
        fontSize: "0.95rem",
        lineHeight: 1.7,
        whiteSpace: "pre-wrap",
      }}
    >
      {children}
    </pre>
  ),
  code: ({ inline, children, ...props }: any) =>
    inline ? (
      <code
        style={{
          padding: "0.12rem 0.35rem",
          borderRadius: 6,
          backgroundColor: "#e5e7eb",
          color: "#111827",
          fontFamily:
            '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
          fontSize: "0.95em",
        }}
        {...props}
      >
        {children}
      </code>
    ) : (
      <code {...props}>{children}</code>
    ),
  a: ({ children, href }) => (
    <a
      href={href}
      rel="noreferrer"
      target="_blank"
      style={{
        color: "#2563eb",
        textDecoration: "underline",
        textUnderlineOffset: 2,
      }}
    >
      {children}
    </a>
  ),
};

const isProject = (value: unknown): value is Project => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const project = value as Record<string, unknown>;

  return (
    typeof project.id === "number" &&
    typeof project.name === "string" &&
    typeof project.path === "string" &&
    typeof project.description === "string"
  );
};

const loadProjects = (): Project[] => {
  try {
    const storedProjects = localStorage.getItem(projectsStorageKey);

    if (!storedProjects) {
      return [];
    }

    const parsedProjects: unknown = JSON.parse(storedProjects);

    return Array.isArray(parsedProjects)
      ? parsedProjects.filter(isProject)
      : [];
  } catch {
    return [];
  }
};

const loadReportFavorites = (): ReportFavoritesByProjectId => {
  try {
    const storedFavorites = localStorage.getItem(reportFavoritesStorageKey);

    if (!storedFavorites) {
      return {};
    }

    const parsedFavorites: unknown = JSON.parse(storedFavorites);

    if (typeof parsedFavorites !== "object" || parsedFavorites === null) {
      return {};
    }

    const normalizedFavorites: ReportFavoritesByProjectId = {};

    for (const [projectIdText, value] of Object.entries(
      parsedFavorites as Record<string, unknown>,
    )) {
      if (!Array.isArray(value)) {
        continue;
      }

      const projectId = Number(projectIdText);
      if (!Number.isFinite(projectId)) {
        continue;
      }

      const turns = value
        .map((item): ReportFavoriteTurn | null => {
          if (
            typeof item !== "object" ||
            item === null ||
            typeof (item as Record<string, unknown>).question !== "string" ||
            typeof (item as Record<string, unknown>).answer !== "string"
          ) {
            return null;
          }

          const savedAtValue = (item as Record<string, unknown>).savedAt;

          return {
            question: (item as Record<string, unknown>).question as string,
            answer: (item as Record<string, unknown>).answer as string,
            savedAt:
              typeof savedAtValue === "number" ? savedAtValue : Date.now(),
          };
        })
        .filter((item): item is ReportFavoriteTurn => item !== null);

      if (turns.length > 0) {
        normalizedFavorites[projectId] = turns;
      }
    }

    return normalizedFavorites;
  } catch {
    return {};
  }
};

const loadProjectReports = (): ProjectReportsById => {
  try {
    const storedReports = localStorage.getItem(projectReportsStorageKey);

    if (!storedReports) {
      return {};
    }

    const parsedReports: unknown = JSON.parse(storedReports);

    if (typeof parsedReports !== "object" || parsedReports === null) {
      return {};
    }

    const normalizedReports: ProjectReportsById = {};

    for (const [projectIdText, value] of Object.entries(
      parsedReports as Record<string, unknown>,
    )) {
      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as Record<string, unknown>).content !== "string"
      ) {
        continue;
      }

      const projectId = Number(projectIdText);
      if (!Number.isFinite(projectId)) {
        continue;
      }

      const statusValue = (value as Record<string, unknown>).status;
      const errorValue = (value as Record<string, unknown>).error;
      const updatedAtValue = (value as Record<string, unknown>).updatedAt;

      normalizedReports[projectId] = {
        content: (value as Record<string, unknown>).content as string,
        status:
          statusValue === "loading" ||
          statusValue === "success" ||
          statusValue === "failure"
            ? statusValue
            : "idle",
        error: typeof errorValue === "string" ? errorValue : "",
        updatedAt:
          typeof updatedAtValue === "number" ? updatedAtValue : Date.now(),
      };
    }

    return normalizedReports;
  } catch {
    return {};
  }
};

const loadProjectProgressAnalyses = (): ProjectProgressAnalysesById => {
  try {
    const storedAnalyses = localStorage.getItem(
      projectProgressAnalysesStorageKey,
    );

    if (!storedAnalyses) {
      return {};
    }

    const parsedAnalyses: unknown = JSON.parse(storedAnalyses);

    if (typeof parsedAnalyses !== "object" || parsedAnalyses === null) {
      return {};
    }

    const normalizedAnalyses: ProjectProgressAnalysesById = {};

    for (const [projectIdText, value] of Object.entries(
      parsedAnalyses as Record<string, unknown>,
    )) {
      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as Record<string, unknown>).content !== "string"
      ) {
        continue;
      }

      const projectId = Number(projectIdText);
      if (!Number.isFinite(projectId)) {
        continue;
      }

      const statusValue = (value as Record<string, unknown>).status;
      const errorValue = (value as Record<string, unknown>).error;
      const updatedAtValue = (value as Record<string, unknown>).updatedAt;

      normalizedAnalyses[projectId] = {
        content: (value as Record<string, unknown>).content as string,
        status:
          statusValue === "loading" ||
          statusValue === "success" ||
          statusValue === "failure"
            ? statusValue
            : "idle",
        error: typeof errorValue === "string" ? errorValue : "",
        updatedAt:
          typeof updatedAtValue === "number" ? updatedAtValue : Date.now(),
      };
    }

    return normalizedAnalyses;
  } catch {
    return {};
  }
};

const loadProjectWeeklyReports = (): ProjectWeeklyReportsById => {
  try {
    const storedReports = localStorage.getItem(projectWeeklyReportsStorageKey);

    if (!storedReports) {
      return {};
    }

    const parsedReports: unknown = JSON.parse(storedReports);

    if (typeof parsedReports !== "object" || parsedReports === null) {
      return {};
    }

    const normalizedReports: ProjectWeeklyReportsById = {};

    for (const [projectIdText, value] of Object.entries(
      parsedReports as Record<string, unknown>,
    )) {
      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as Record<string, unknown>).content !== "string"
      ) {
        continue;
      }

      const projectId = Number(projectIdText);
      if (!Number.isFinite(projectId)) {
        continue;
      }

      const statusValue = (value as Record<string, unknown>).status;
      const errorValue = (value as Record<string, unknown>).error;
      const updatedAtValue = (value as Record<string, unknown>).updatedAt;

      normalizedReports[projectId] = {
        content: (value as Record<string, unknown>).content as string,
        status:
          statusValue === "loading" ||
          statusValue === "success" ||
          statusValue === "failure"
            ? statusValue
            : "idle",
        error: typeof errorValue === "string" ? errorValue : "",
        updatedAt:
          typeof updatedAtValue === "number" ? updatedAtValue : Date.now(),
      };
    }

    return normalizedReports;
  } catch {
    return {};
  }
};

const formatFileSize = (size: number) => {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getErrorMessage = (error: unknown) => {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "扫描文件失败";
};

const isMarkdownFile = (fileName: string) => /\.md$/i.test(fileName);

const getFileCacheKey = (projectId: number, filePath: string) =>
  `${projectId}:${filePath}`;

const isCodeFile = (fileName: string) =>
  /\.(ts|tsx|js|jsx|json|py)$/i.test(fileName);

const getFileBasename = (filePath: string) =>
  filePath.split(/[\\/]/).pop() ?? filePath;

const getFilePathSegments = (filePath: string) =>
  filePath
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

const getFilePathDepth = (filePath: string) => {
  const segments = getFilePathSegments(filePath);
  return Math.max(0, segments.length - 1);
};

const getFileStem = (fileName: string) =>
  getFileBasename(fileName).replace(/\.[^.]+$/, "").toLowerCase();

const reportGeneratedSegments = new Set([
  "gen",
  "generated",
  "schemas",
  "schema",
  "dist",
  "build",
  "target",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
]);

const reportDocumentationSegments = new Set([
  "readme",
  "docs",
  "doc",
  "wiki",
  "design",
  "spec",
  "specs",
  "requirements",
  "requirement",
  "changelog",
]);

const reportDocumentationNames = new Set([
  "readme",
  "readme_cn",
  "readme-en",
  "readme_en",
  "changelog",
  "changes",
  "overview",
  "architecture",
  "roadmap",
  "guide",
  "requirements",
  "spec",
]);

const reportConfigExactNames = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "cargo.toml",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
  "requirements.txt",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "tauri.conf.json",
  "app.json",
  "project.config.json",
  "project.private.config.json",
  "dockerfile",
  "makefile",
]);

const reportPrimaryConfigNames = new Set([
  "package.json",
  "cargo.toml",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
  "requirements.txt",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "tauri.conf.json",
  "app.json",
  "project.config.json",
  "project.private.config.json",
]);

const reportConfigExtensions = new Set([
  ".toml",
  ".yaml",
  ".yml",
  ".ini",
  ".cfg",
  ".conf",
  ".xml",
  ".env",
  ".properties",
]);

const reportSourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".kts",
  ".scala",
  ".lua",
  ".dart",
  ".vue",
  ".svelte",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".mdx",
]);

const reportSourceDirHints = new Set([
  "src",
  "app",
  "apps",
  "lib",
  "core",
  "services",
  "service",
  "pages",
  "page",
  "components",
  "component",
  "modules",
  "module",
  "models",
  "model",
  "controllers",
  "controller",
  "routes",
  "route",
  "views",
  "view",
  "backend",
  "frontend",
  "server",
  "client",
  "domain",
  "features",
  "feature",
  "hooks",
  "utils",
  "utils",
]);

const reportContextCategoryLabels = {
  documentation: "项目说明文件",
  config: "配置文件",
  source: "核心源码文件",
  other: "补充文件",
  generated: "生成文件",
} as const;

type ReportContextCategory = keyof typeof reportContextCategoryLabels;

type ReportContextFile = ScannedFile & {
  category: ReportContextCategory;
  baseScore: number;
  referenceScore: number;
  finalScore: number;
  content: string;
};

const REPORT_CONTEXT_FILE_LIMIT = 10;
const REPORT_CONTEXT_CANDIDATE_POOL = 40;
const REPORT_CONTEXT_DOC_LIMIT = 4;
const REPORT_CONTEXT_CONFIG_LIMIT = 3;
const REPORT_CONTEXT_SOURCE_LIMIT = 3;
const REPORT_CONTEXT_OTHER_LIMIT = 2;
const REPORT_CONTEXT_EXCERPT_LIMIT = 900;
const REPORT_CONTEXT_TOTAL_LIMIT = 9000;

const hasAnySegment = (segments: string[], targets: Set<string>) =>
  segments.some((segment) => targets.has(segment.toLowerCase()));

const isGeneratedReportFile = (file: ScannedFile) => {
  const lowerPathSegments = getFilePathSegments(file.relative_path).map((segment) =>
    segment.toLowerCase(),
  );
  const lowerFileName = file.name.toLowerCase();

  return (
    hasAnySegment(lowerPathSegments, reportGeneratedSegments) ||
    lowerFileName.includes(".generated.") ||
    lowerFileName.endsWith(".snap")
  );
};

const isDocumentationReportFile = (file: ScannedFile) => {
  const lowerPathSegments = getFilePathSegments(file.relative_path).map((segment) =>
    segment.toLowerCase(),
  );
  const lowerFileName = file.name.toLowerCase();
  const fileStem = getFileStem(file.name);

  return (
    reportDocumentationNames.has(fileStem) ||
    hasAnySegment(lowerPathSegments, reportDocumentationSegments) ||
    lowerFileName.startsWith("readme") ||
    lowerFileName.startsWith("changelog")
  );
};

const isConfigReportFile = (file: ScannedFile) => {
  const lowerFileName = file.name.toLowerCase();
  const fileStem = getFileStem(file.name);
  const lowerPathSegments = getFilePathSegments(file.relative_path).map((segment) =>
    segment.toLowerCase(),
  );
  const configDirectoryMatch = lowerPathSegments.some((segment) =>
    /(^|[-_.])(config|configs|configuration|settings|setting|manifest|manifests|env|envs)([-_.]|$)/.test(
      segment,
    ),
  );
  const configExtensionMatch = Array.from(reportConfigExtensions).some((extension) =>
    lowerFileName.endsWith(extension),
  );
  const configNameMatch =
    reportConfigExactNames.has(lowerFileName) ||
    reportConfigExactNames.has(fileStem) ||
    /(^|[-_.])(config|configs|configuration|settings|setting|manifest|manifests)([-_.]|$)/.test(
      lowerFileName,
    );

  return configNameMatch || configDirectoryMatch || configExtensionMatch;
};

const isSourceReportFile = (file: ScannedFile) => {
  const lowerFileName = file.name.toLowerCase();
  const lowerPathSegments = getFilePathSegments(file.relative_path).map((segment) =>
    segment.toLowerCase(),
  );
  const sourceExtensionMatch = Array.from(reportSourceExtensions).some((extension) =>
    lowerFileName.endsWith(extension),
  );
  const sourceDirMatch = lowerPathSegments.some((segment) =>
    reportSourceDirHints.has(segment),
  );

  return sourceExtensionMatch || sourceDirMatch;
};

const classifyReportFile = (file: ScannedFile): ReportContextCategory => {
  if (isGeneratedReportFile(file)) {
    return "generated";
  }

  if (isDocumentationReportFile(file)) {
    return "documentation";
  }

  if (isConfigReportFile(file)) {
    return "config";
  }

  if (isSourceReportFile(file)) {
    return "source";
  }

  return "other";
};

const getReportFileTypeScore = (category: ReportContextCategory) => {
  switch (category) {
    case "documentation":
      return 420;
    case "config":
      return 300;
    case "source":
      return 180;
    case "other":
      return 40;
    case "generated":
      return -500;
  }
};

const getReportFileNameScore = (file: ScannedFile, category: ReportContextCategory) => {
  const lowerFileName = file.name.toLowerCase();
  const fileStem = getFileStem(file.name);
  const lowerPathSegments = getFilePathSegments(file.relative_path).map((segment) =>
    segment.toLowerCase(),
  );
  let score = 0;

  if (category === "documentation") {
    if (reportDocumentationNames.has(fileStem)) {
      score += 220;
    }

    if (lowerFileName.startsWith("readme")) {
      score += 240;
    }

    if (hasAnySegment(lowerPathSegments, reportDocumentationSegments)) {
      score += 120;
    }

    if (lowerFileName.endsWith(".md") || lowerFileName.endsWith(".txt")) {
      score += 40;
    }
  } else if (category === "config") {
    if (reportConfigExactNames.has(lowerFileName) || reportConfigExactNames.has(fileStem)) {
      score += 240;
    }

    if (
      reportPrimaryConfigNames.has(lowerFileName) ||
      reportPrimaryConfigNames.has(fileStem)
    ) {
      score += 160;
    }

    if (
      lowerFileName.includes("lock") ||
      lowerFileName.endsWith(".lock") ||
      lowerFileName.endsWith(".lock.yaml") ||
      lowerFileName.endsWith(".lock.yml")
    ) {
      score -= 120;
    }

    if (lowerFileName.includes("config") || lowerFileName.includes("setting")) {
      score += 120;
    }

    if (lowerFileName.includes("manifest")) {
      score += 90;
    }
  } else if (category === "source") {
    if (lowerPathSegments.some((segment) => reportSourceDirHints.has(segment))) {
      score += 80;
    }

    if (lowerFileName.startsWith("index.") || lowerFileName.startsWith("main.")) {
      score += 60;
    }

    if (lowerFileName.includes("service") || lowerFileName.includes("controller")) {
      score += 70;
    }

    if (lowerFileName.includes("app") || lowerFileName.includes("page")) {
      score += 45;
    }
  } else {
    if (lowerFileName.startsWith("license") || lowerFileName.startsWith("todo")) {
      score += 30;
    }
  }

  return score;
};

const getReportFileSizeScore = (size: number) => {
  if (size <= 0) {
    return 0;
  }

  const sizeKb = size / 1024;

  if (sizeKb <= 2) {
    return 10;
  }

  if (sizeKb <= 12) {
    return 40;
  }

  if (sizeKb <= 48) {
    return 55;
  }

  if (sizeKb <= 128) {
    return 30;
  }

  return 10;
};

const getReportFileDepthScore = (file: ScannedFile, category: ReportContextCategory) => {
  const depth = getFilePathDepth(file.relative_path);
  const depthPenalty = depth * (category === "source" ? 7 : 10);
  return Math.max(0, 70 - depthPenalty);
};

const getReportContextExcerpt = (content: string, maxLength = REPORT_CONTEXT_EXCERPT_LIMIT) => {
  const normalizedContent = content.replace(/\r\n/g, "\n").trim();

  if (!normalizedContent) {
    return "";
  }

  return normalizedContent.length > maxLength
    ? `${normalizedContent.slice(0, maxLength)}...`
    : normalizedContent;
};

const getReportFileBaseScore = (file: ScannedFile, category: ReportContextCategory) =>
  getReportFileTypeScore(category) +
  getReportFileNameScore(file, category) +
  getReportFileDepthScore(file, category) +
  getReportFileSizeScore(file.size);

const getReportCandidateReferenceScore = (
  currentFile: ScannedFile,
  currentContent: string,
  candidateFiles: ScannedFile[],
) => {
  const normalizedContent = currentContent.toLowerCase();
  const currentFileStem = getFileStem(currentFile.name);
  const currentRelativeStem = getFileStem(currentFile.relative_path);
  const currentPathLower = currentFile.relative_path.toLowerCase();
  let score = 0;

  for (const candidate of candidateFiles) {
    if (candidate.relative_path === currentFile.relative_path) {
      continue;
    }

    const candidateStem = getFileStem(candidate.name);
    const candidateRelativeStem = getFileStem(candidate.relative_path);
    const candidateName = candidate.name.toLowerCase();
    const candidatePath = candidate.relative_path.toLowerCase();

    if (!candidateStem) {
      continue;
    }

    const isMentioned =
      normalizedContent.includes(candidateStem) ||
      normalizedContent.includes(candidateRelativeStem) ||
      normalizedContent.includes(candidateName) ||
      normalizedContent.includes(candidatePath);

    if (isMentioned) {
      score += 1;
    }
  }

  if (normalizedContent.includes(currentFileStem)) {
    score += 2;
  }

  if (normalizedContent.includes(currentRelativeStem)) {
    score += 1;
  }

  if (normalizedContent.includes(currentPathLower)) {
    score += 2;
  }

  return score;
};

const sortReportContextCandidates = (left: ReportContextFile, right: ReportContextFile) => {
  if (right.finalScore !== left.finalScore) {
    return right.finalScore - left.finalScore;
  }

  if (right.referenceScore !== left.referenceScore) {
    return right.referenceScore - left.referenceScore;
  }

  if (right.baseScore !== left.baseScore) {
    return right.baseScore - left.baseScore;
  }

  return left.relative_path.localeCompare(right.relative_path);
};

const findSourceFile = (files: ScannedFile[], sourceLabel: string) => {
  const normalizedSourceLabel = sourceLabel.trim();
  const sourceLabelBasename = getFileBasename(normalizedSourceLabel).toLowerCase();

  const exactRelativePathMatch = files.find(
    (file) => file.relative_path === normalizedSourceLabel,
  );

  if (exactRelativePathMatch) {
    return exactRelativePathMatch;
  }

  const exactNameMatch = files.find((file) => file.name === normalizedSourceLabel);

  if (exactNameMatch) {
    return exactNameMatch;
  }

  const basenameMatches = files.filter(
    (file) => getFileBasename(file.relative_path).toLowerCase() === sourceLabelBasename,
  );

  if (basenameMatches.length === 1) {
    return basenameMatches[0];
  }

  return null;
};

const getCodeLanguage = (fileName: string) => {
  const lowerFileName = fileName.toLowerCase();

  if (lowerFileName.endsWith(".ts") || lowerFileName.endsWith(".tsx")) {
    return "typescript";
  }

  if (lowerFileName.endsWith(".js") || lowerFileName.endsWith(".jsx")) {
    return "javascript";
  }

  if (lowerFileName.endsWith(".json")) {
    return "json";
  }

  if (lowerFileName.endsWith(".py")) {
    return "python";
  }

  if (lowerFileName.endsWith(".java")) {
    return "java";
  }

  if (lowerFileName.endsWith(".go")) {
    return "go";
  }

  if (lowerFileName.endsWith(".rs")) {
    return "rust";
  }

  return "plaintext";
};

const getCodeLanguageTag = (fileName: string) => {
  const lowerFileName = fileName.toLowerCase();

  if (lowerFileName.endsWith(".ts") || lowerFileName.endsWith(".tsx")) {
    return "ts";
  }

  if (lowerFileName.endsWith(".js") || lowerFileName.endsWith(".jsx")) {
    return "js";
  }

  if (lowerFileName.endsWith(".py")) {
    return "py";
  }

  if (lowerFileName.endsWith(".java")) {
    return "java";
  }

  if (lowerFileName.endsWith(".go")) {
    return "go";
  }

  if (lowerFileName.endsWith(".rs")) {
    return "rs";
  }

  return "code";
};

const codeCallIgnoreWords = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "throw",
  "await",
  "new",
  "typeof",
  "console",
  "print",
  "log",
  "map",
  "filter",
  "reduce",
  "split",
  "join",
  "parseInt",
  "parseFloat",
  "setTimeout",
  "setInterval",
  "Promise",
  "Math",
]);

const extractCodeSymbolFromLine = (line: string) => {
  const trimmedLine = line.trim();

  if (!trimmedLine || trimmedLine.startsWith("//") || trimmedLine.startsWith("/*")) {
    return null;
  }

  const patternCandidates: Array<{ type: string; pattern: RegExp }> = [
    {
      type: "function",
      pattern: /^\s*(?:export\s+default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
    },
    {
      type: "class",
      pattern: /^\s*(?:export\s+default\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
    },
    {
      type: "interface",
      pattern: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
    },
    {
      type: "type",
      pattern: /^\s*(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
    },
    {
      type: "struct",
      pattern: /^\s*(?:pub\s+)?struct\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
    },
    {
      type: "function",
      pattern: /^\s*(?:pub\s+)?fn\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
    },
    {
      type: "function",
      pattern: /^\s*def\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
    },
    {
      type: "function",
      pattern: /^\s*func\s*(?:\([^)]*\)\s*)?([A-Za-z_$][A-Za-z0-9_$]*)\b/,
    },
    {
      type: "function",
      pattern:
        /^\s*(?:public|private|protected|static|final|synchronized|abstract|sealed|\s)*[\w<>\[\], ?]+\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^;]*\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/,
    },
    {
      type: "function",
      pattern:
        /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/,
    },
    {
      type: "function",
      pattern: /^\s*(?:export\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
    },
  ];

  for (const candidate of patternCandidates) {
    const match = trimmedLine.match(candidate.pattern);

    if (match?.[1]) {
      return {
        type: candidate.type,
        name: match[1],
      };
    }
  }

  return null;
};

const getLocalDefinitionsFromContent = (content: string) => {
  const localDefinitions = new Set<string>();

  content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line) => {
      const symbol = extractCodeSymbolFromLine(line);

      if (symbol?.name) {
        localDefinitions.add(symbol.name.trim().toLowerCase());
      }
    });

  return localDefinitions;
};

const stripCodeNoiseForCalls = (content: string) =>
  content
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/#.*$/gm, " ")
    .replace(/`(?:\\.|[^`])*`/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ")
    .replace(/'(?:\\.|[^'\\])*'/g, " ");

const extractCodeCalls = (
  content: string,
  selfName: string,
  localDefinitions: Set<string>,
) => {
  const cleanedContent = stripCodeNoiseForCalls(content);
  const callPattern = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  const collectedCalls: CodeCallRef[] = [];
  const seenCalls = new Set<string>();

  for (const match of cleanedContent.matchAll(callPattern)) {
    const callName = match[1]?.trim();
    const normalizedCallName = callName?.toLowerCase() ?? "";

    if (!normalizedCallName) {
      continue;
    }

    if (
      codeCallIgnoreWords.has(normalizedCallName) ||
      codeCallIgnoreWords.has(callName) ||
      normalizedCallName === selfName ||
      seenCalls.has(normalizedCallName)
    ) {
      continue;
    }

    seenCalls.add(normalizedCallName);
    collectedCalls.push({
      name: callName,
      inSameFile: localDefinitions.has(normalizedCallName),
    });

    if (collectedCalls.length >= 8) {
      break;
    }
  }

  return collectedCalls;
};

const deriveCodePreviewChunk = (
  fileName: string,
  content: string,
  focusKeyword = "",
): CodePreviewChunk | null => {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const lines = normalizedContent.split("\n");
  const normalizedFocusKeyword = focusKeyword.trim().toLowerCase();
  const localDefinitions = getLocalDefinitionsFromContent(normalizedContent);

  if (lines.length === 0) {
    return null;
  }

  const keywordIndex =
    normalizedFocusKeyword.length > 0
      ? lines.findIndex((line) =>
          line.toLowerCase().includes(normalizedFocusKeyword),
        )
      : -1;

  const symbolIndex = lines.findIndex(
    (line) => extractCodeSymbolFromLine(line) !== null,
  );

  const anchorIndex =
    keywordIndex >= 0 ? keywordIndex : symbolIndex >= 0 ? symbolIndex : 0;

  let startIndex = anchorIndex;

  for (let currentIndex = anchorIndex; currentIndex >= 0; currentIndex -= 1) {
    if (extractCodeSymbolFromLine(lines[currentIndex])) {
      startIndex = currentIndex;
      break;
    }
  }

  let endIndex = lines.length;

  for (
    let currentIndex = startIndex + 1;
    currentIndex < lines.length;
    currentIndex += 1
  ) {
    if (currentIndex - startIndex > 120) {
      endIndex = currentIndex;
      break;
    }

    if (extractCodeSymbolFromLine(lines[currentIndex])) {
      endIndex = currentIndex;
      break;
    }
  }

  const chunkLines = lines.slice(startIndex, endIndex);
  const chunkContent = chunkLines.join("\n").trim();
  const fallbackSymbol: { type: string; name: string } = {
    type: "function",
    name:
      normalizedFocusKeyword ||
      getFileBasename(fileName).replace(/\.[^.]+$/, "") ||
      "unknown",
  };
  const symbol = extractCodeSymbolFromLine(lines[startIndex]) ?? fallbackSymbol;

  if (!chunkContent) {
    return null;
  }

  return {
    type: symbol.type,
    name: symbol.name,
    language: getCodeLanguageTag(fileName),
    calls: extractCodeCalls(chunkContent, symbol.name.toLowerCase(), localDefinitions),
    content: chunkContent,
    startLine: startIndex + 1,
    endLine: Math.max(startIndex + 1, endIndex),
  };
};

const highlightCode = (fileName: string, content: string) => {
  if (!content) {
    return "文件内容为空";
  }

  try {
    return hljs.highlight(content, {
      ignoreIllegals: true,
      language: getCodeLanguage(fileName),
    }).value;
  } catch {
    return content;
  }
};

function App() {
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [activeSection, setActiveSection] = useState<AppSection>("projects");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    null,
  );
  const [projectFilesById, setProjectFilesById] = useState<
    Record<number, ScannedFile[]>
  >({});
  const [scanningProjectId, setScanningProjectId] = useState<number | null>(
    null,
  );
  const [scanError, setScanError] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState("");
  const [selectedFileError, setSelectedFileError] = useState("");
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [answer, setAnswer] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportStatus, setReportStatus] = useState<
    "idle" | "loading" | "success" | "failure"
  >("idle");
  const [reportError, setReportError] = useState("");
  const [reportCopyStatus, setReportCopyStatus] =
    useState<MarkdownCopyStatus>("idle");
  const [reportExportStatus, setReportExportStatus] =
    useState<MarkdownExportStatus>("idle");
  const [weeklyReportLoading, setWeeklyReportLoading] = useState(false);
  const [weeklyReportData, setWeeklyReportData] =
    useState<ReportData | null>(null);
  const [weeklyReportStatus, setWeeklyReportStatus] = useState<
    "idle" | "loading" | "success" | "failure"
  >("idle");
  const [weeklyReportError, setWeeklyReportError] = useState("");
  const [weeklyReportCopyStatus, setWeeklyReportCopyStatus] =
    useState<MarkdownCopyStatus>("idle");
  const [weeklyReportExportStatus, setWeeklyReportExportStatus] =
    useState<MarkdownExportStatus>("idle");
  const [progressAnalysisCopyStatus, setProgressAnalysisCopyStatus] =
    useState<MarkdownCopyStatus>("idle");
  const [progressAnalysisExportStatus, setProgressAnalysisExportStatus] =
    useState<MarkdownExportStatus>("idle");
  const [reportFavoritesByProjectId, setReportFavoritesByProjectId] =
    useState<ReportFavoritesByProjectId>(loadReportFavorites);
  const [projectReportsById, setProjectReportsById] =
    useState<ProjectReportsById>(loadProjectReports);
  const [projectFactsById, setProjectFactsById] = useState<ProjectFactsById>(
    {},
  );
  const [projectProgressAnalysesById, setProjectProgressAnalysesById] =
    useState<ProjectProgressAnalysesById>(loadProjectProgressAnalyses);
  const [projectWeeklyReportsById, setProjectWeeklyReportsById] =
    useState<ProjectWeeklyReportsById>(loadProjectWeeklyReports);
  const [expandedReportProjectId, setExpandedReportProjectId] = useState<
    number | null
  >(null);
  const [expandedWeeklyReportProjectId, setExpandedWeeklyReportProjectId] =
    useState<number | null>(null);
  const [reportBoardMode, setReportBoardMode] = useState<ReportBoardMode>(
    () => {
      if (typeof window === "undefined") {
        return "project";
      }

      const storedMode = window.localStorage.getItem(
        reportBoardModeStorageKey,
      );

      return storedMode === "weekly" ? "weekly" : "project";
    },
  );
  const [isReportHistoryExpanded, setIsReportHistoryExpanded] = useState(true);
  const [isAnswerDetailsExpanded, setIsAnswerDetailsExpanded] = useState(false);
  const [answerMode, setAnswerMode] = useState<AnswerMode>(() => {
    if (typeof window === "undefined") {
      return "strict";
    }

    const storedMode = window.localStorage.getItem(answerModeStorageKey);
    return storedMode === "explain" ? "explain" : "strict";
  });
  const [conversationHistory, setConversationHistory] = useState<
    ConversationTurn[]
  >([]);
  const [isQuestionLoading, setIsQuestionLoading] = useState(false);
  const [questionLoadingStage, setQuestionLoadingStage] = useState(0);
  const [questionPlaceholderIndex, setQuestionPlaceholderIndex] = useState(0);
  const [isProjectTimelineExpanded, setIsProjectTimelineExpanded] =
    useState(false);
  const [previewSearchKeyword, setPreviewSearchKeyword] = useState("");
  const [lastQuestionFocusKeyword, setLastQuestionFocusKeyword] = useState("");
  const [lastQuestionSemanticChunks, setLastQuestionSemanticChunks] = useState<
    SemanticChunkMatch[]
  >([]);
  const [apiKey, setApiKey] = useState(loadLocalApiKey);
  const [apiKeyMessage, setApiKeyMessage] = useState("");
  const [mimoApiKey, setMimoApiKey] = useState("");
  const [mimoKeyStatus, setMimoKeyStatus] = useState<MimoKeyStatus | null>(
    null,
  );
  const [mimoSettingsMessage, setMimoSettingsMessage] = useState("");
  const [mimoSettingsError, setMimoSettingsError] = useState("");
  const [mimoSettingsLoading, setMimoSettingsLoading] = useState(false);
  const [mimoSettingsSaving, setMimoSettingsSaving] = useState(false);
  const [mimoSettingsMigrating, setMimoSettingsMigrating] = useState(false);
  const previewContentRef = useRef<HTMLElement | null>(null);
  const questionInputRef = useRef<HTMLInputElement | null>(null);
  const questionRequestSequenceRef = useRef(0);
  const questionRequestProjectIdRef = useRef<number | null>(null);
  const reportPanelRef = useRef<HTMLElement | null>(null);
  const progressAnalysisPanelRef = useRef<HTMLElement | null>(null);
  const weeklyReportPanelRef = useRef<HTMLElement | null>(null);
  const [fileContentsByPath, setFileContentsByPath] = useState<
    Record<string, string>
  >({});
  const [fileSummariesByPath, setFileSummariesByPath] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    localStorage.setItem(projectsStorageKey, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem(answerModeStorageKey, answerMode);
  }, [answerMode]);

  useEffect(() => {
    localStorage.setItem(
      reportFavoritesStorageKey,
      JSON.stringify(reportFavoritesByProjectId),
    );
  }, [reportFavoritesByProjectId]);

  useEffect(() => {
    localStorage.setItem(
      projectReportsStorageKey,
      JSON.stringify(projectReportsById),
    );
  }, [projectReportsById]);

  useEffect(() => {
    localStorage.setItem(
      projectProgressAnalysesStorageKey,
      JSON.stringify(projectProgressAnalysesById),
    );
  }, [projectProgressAnalysesById]);

  useEffect(() => {
    localStorage.setItem(
      projectWeeklyReportsStorageKey,
      JSON.stringify(projectWeeklyReportsById),
    );
  }, [projectWeeklyReportsById]);

  useEffect(() => {
    localStorage.setItem(reportBoardModeStorageKey, reportBoardMode);
  }, [reportBoardMode]);

  useEffect(() => {
    setReportData(null);
    setReportLoading(false);
    setReportStatus("idle");
    setReportError("");
    setQuestionLoadingStage(0);
  }, [selectedProjectId]);

  useEffect(() => {
    setWeeklyReportData(null);
    setWeeklyReportLoading(false);
    setWeeklyReportStatus("idle");
    setWeeklyReportError("");
    setWeeklyReportCopyStatus("idle");
    setWeeklyReportExportStatus("idle");
  }, [selectedProjectId]);

  useEffect(() => {
    setIsReportHistoryExpanded(true);
  }, [selectedProjectId]);

  useEffect(() => {
    console.log("🔥 app mounted");

    if (!localStorage.getItem(hasTrackedOpenStorageKey)) {
      track("app_open");
      localStorage.setItem(hasTrackedOpenStorageKey, "1");
    }

    console.log("🔥 debug: force track");
    track("debug_test");
  }, []);

  useEffect(() => {
    if (!apiKeyMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setApiKeyMessage("");
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [apiKeyMessage]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuestionPlaceholderIndex(
        (currentIndex) => (currentIndex + 1) % QUESTION_PLACEHOLDERS.length,
      );
    }, 4500);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isQuestionLoading) {
      setQuestionLoadingStage(0);
      return;
    }

    setQuestionLoadingStage(0);

    const stageOneTimer = window.setTimeout(() => {
      setQuestionLoadingStage(1);
    }, 700);

    const stageTwoTimer = window.setTimeout(() => {
      setQuestionLoadingStage(2);
    }, 1600);

    return () => {
      window.clearTimeout(stageOneTimer);
      window.clearTimeout(stageTwoTimer);
    };
  }, [isQuestionLoading]);

  useEffect(() => {
    const runtimeWindow = window as Window & {
      setAnswerMode?: (mode: AnswerMode) => void;
    };

    runtimeWindow.setAnswerMode = setAnswerMode;

    return () => {
      if (runtimeWindow.setAnswerMode === setAnswerMode) {
        delete runtimeWindow.setAnswerMode;
      }
    };
  }, []);

  useEffect(() => {
    const previewContent = previewContentRef.current;
    const keyword = previewSearchKeyword.trim();

    if (!previewContent || !keyword || loadingFilePath || selectedFileError) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const keywordPattern = new RegExp(escapedKeyword, "gi");
      const textNodes: Text[] = [];
      const textWalker = document.createTreeWalker(
        previewContent,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parentElement = node.parentElement;

            if (
              !node.textContent?.toLowerCase().includes(keyword.toLowerCase())
            ) {
              return NodeFilter.FILTER_REJECT;
            }

            if (parentElement?.closest("[data-preview-search-hit]")) {
              return NodeFilter.FILTER_REJECT;
            }

            return NodeFilter.FILTER_ACCEPT;
          },
        },
      );

      let currentNode = textWalker.nextNode();

      while (currentNode) {
        textNodes.push(currentNode as Text);
        currentNode = textWalker.nextNode();
      }

      let isFirstPreviewHit = true;

      textNodes.forEach((textNode) => {
        const text = textNode.textContent ?? "";
        const fragment = document.createDocumentFragment();
        let currentIndex = 0;

        text.replace(keywordPattern, (match, matchIndex: number) => {
          if (matchIndex > currentIndex) {
            fragment.append(text.slice(currentIndex, matchIndex));
          }

          const mark = document.createElement("mark");
          mark.className = isFirstPreviewHit
            ? "searchHighlight currentSearchHighlight"
            : "searchHighlight";
          mark.dataset.previewSearchHit = "true";
          mark.textContent = match;
          fragment.append(mark);
          isFirstPreviewHit = false;
          currentIndex = matchIndex + match.length;

          return match;
        });

        if (currentIndex < text.length) {
          fragment.append(text.slice(currentIndex));
        }

        textNode.replaceWith(fragment);
      });

      previewContent
        .querySelector(".currentSearchHighlight")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    loadingFilePath,
    previewSearchKeyword,
    selectedFileContent,
    selectedFileError,
    selectedFilePath,
  ]);

  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null;

  const selectedProjectFiles = selectedProject
    ? projectFilesById[selectedProject.id] ?? []
    : [];

  const projectTimeline = useMemo<ProjectTimelineEntry[]>(
    () => buildProjectTimeline(selectedProjectFiles),
    [selectedProjectFiles],
  );

  const projectTimelineSummary = useMemo(() => {
    if (projectTimeline.length === 0) {
      return null;
    }

    const totalModifiedFiles = projectTimeline.reduce(
      (sum, entry) => sum + entry.modifiedCount,
      0,
    );
    const latestEntry = projectTimeline[0];
    const busiestEntry = projectTimeline.reduce((currentBest, entry) => {
      if (entry.modifiedCount > currentBest.modifiedCount) {
        return entry;
      }

      return currentBest;
    }, latestEntry);

    return {
      activeDays: projectTimeline.length,
      totalModifiedFiles,
      latestDate: latestEntry.date,
      latestActivityType: latestEntry.activityType,
      busiestDate: busiestEntry.date,
      busiestCount: busiestEntry.modifiedCount,
      busiestActivityType: busiestEntry.activityType,
    };
  }, [projectTimeline]);

  const projectTimelineSections = useMemo<ProjectTimelineSection[]>(
    () => groupProjectTimelineEntries(projectTimeline),
    [projectTimeline],
  );

  const selectedFile =
    selectedProject && selectedFilePath
      ? selectedProjectFiles.find(
          (file) => file.relative_path === selectedFilePath,
        ) ?? null
      : null;

  const selectedProjectHasScanResult = selectedProject
    ? Object.prototype.hasOwnProperty.call(projectFilesById, selectedProject.id)
    : false;

  useEffect(() => {
    setSelectedFilePath(null);
    setSelectedFileContent("");
    setSelectedFileError("");
    setLoadingFilePath(null);
    setFileSearchQuery("");
    setQuestionText("");
    setAnswer("");
    setIsAnswerDetailsExpanded(false);
    setIsQuestionLoading(false);
    setQuestionLoadingStage(0);
    setLastQuestionSemanticChunks([]);
    setLastQuestionFocusKeyword("");
    setConversationHistory([]);
    setIsProjectTimelineExpanded(false);
    questionRequestProjectIdRef.current = null;
    questionRequestSequenceRef.current += 1;
  }, [selectedProjectId]);

  useEffect(() => {
    if (
      selectedProject &&
      selectedFilePath &&
      !selectedProjectFiles.some(
        (file) => file.relative_path === selectedFilePath,
      )
    ) {
      setSelectedFilePath(null);
      setSelectedFileContent("");
      setSelectedFileError("");
      setLoadingFilePath(null);
    }
  }, [selectedProject, selectedProjectFiles, selectedFilePath]);

  useEffect(() => {
    setLastQuestionSemanticChunks([]);
    setLastQuestionFocusKeyword("");
  }, [selectedProjectId]);

  useEffect(() => {
    if (activeSection !== "settings") {
      return;
    }

    let isCancelled = false;

    const loadMimoKeyStatus = async () => {
      setMimoSettingsLoading(true);
      setMimoSettingsError("");

      try {
        const status = await runTauriCommand<MimoKeyStatus>(
          "get_mimo_api_key_status",
          {},
        );

        if (!isCancelled) {
          setMimoKeyStatus(status);
        }
      } catch (error) {
        if (!isCancelled) {
          setMimoSettingsError(
            `读取 MiMo 状态失败：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } finally {
        if (!isCancelled) {
          setMimoSettingsLoading(false);
        }
      }
    };

    void loadMimoKeyStatus();

    return () => {
      isCancelled = true;
    };
  }, [activeSection]);

  useEffect(() => {
    if (!mimoSettingsMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setMimoSettingsMessage("");
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [mimoSettingsMessage]);

  const refreshMimoKeyStatus = async () => {
    try {
      const status = await runTauriCommand<MimoKeyStatus>(
        "get_mimo_api_key_status",
        {},
      );
      setMimoKeyStatus(status);
    } catch (error) {
      setMimoSettingsError(
        `读取 MiMo 状态失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const saveMimoApiKey = async () => {
    const trimmedKey = mimoApiKey.trim();

    if (!trimmedKey) {
      setMimoSettingsError("请输入 MiMo API Key");
      return;
    }

    setMimoSettingsSaving(true);
    setMimoSettingsError("");
    setMimoSettingsMessage("");

    try {
      await runTauriCommand<void>("store_mimo_api_key", { apiKey: trimmedKey });
      setMimoApiKey("");
      setMimoSettingsMessage("已经保存到钥匙串。下次会优先从钥匙串读取。");
      await refreshMimoKeyStatus();
    } catch (error) {
      setMimoSettingsError(
        `保存到钥匙串失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setMimoSettingsSaving(false);
    }
  };

  const migrateMimoApiKey = async () => {
    setMimoSettingsMigrating(true);
    setMimoSettingsError("");
    setMimoSettingsMessage("");

    try {
      await runTauriCommand<void>("migrate_mimo_api_key_to_keychain", {});
      setMimoSettingsMessage("已把当前环境变量里的 MiMo Key 迁移到钥匙串。");
      await refreshMimoKeyStatus();
    } catch (error) {
      setMimoSettingsError(
        `迁移失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setMimoSettingsMigrating(false);
    }
  };

  const saveLocalApiKey = () => {
    const trimmedKey = apiKey.trim();
    window.localStorage.setItem(localApiKeyStorageKey, trimmedKey);
    setApiKey(trimmedKey);
    setApiKeyMessage(trimmedKey ? "API Key 已保存到本地。" : "已清空本地 API Key。");
  };

  const openCreateModal = () => {
    setErrorMessage("");
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    setErrorMessage("");
    setForm(emptyForm);
  };

  const updateForm = (field: keyof ProjectForm, value: string) => {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
    setErrorMessage("");
  };

  const selectProjectFolder = async () => {
    if (!isTauriRuntime) {
      setErrorMessage("当前不在 Tauri 桌面环境中，无法打开文件夹选择器，请直接手动输入路径。");
      return;
    }

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "选择项目文件夹",
        defaultPath: form.path.trim() || undefined,
      });

      if (typeof selectedPath === "string") {
        updateForm("path", selectedPath);
      }
    } catch (error) {
      setErrorMessage(
        `文件夹选择器打开失败，请直接手动输入路径。${error instanceof Error ? `(${error.message})` : ""}`,
      );
    }
  };

  const openProjectDetail = (projectId: number) => {
    setSelectedProjectId(projectId);
    setScanError("");
    setSelectedFilePath(null);
    setSelectedFileContent("");
    setSelectedFileError("");
    setLoadingFilePath(null);
  };

  const closeProjectDetail = () => {
    setSelectedProjectId(null);
    setScanError("");
    setSelectedFilePath(null);
    setSelectedFileContent("");
    setSelectedFileError("");
    setLoadingFilePath(null);
  };

  const removeScannedFiles = (projectId: number) => {
    setProjectFilesById((currentFiles) => {
      const nextFiles = { ...currentFiles };
      delete nextFiles[projectId];
      return nextFiles;
    });

    setProjectFactsById((currentFacts) => {
      const nextFacts = { ...currentFacts };
      delete nextFacts[projectId];
      return nextFacts;
    });
  };

  const scanProjectFiles = async (project: Project) => {
    setScanningProjectId(project.id);
    setScanError("");

    try {
      const files = await runTauriCommand<ScannedFile[]>("scan_project_files", {
        path: project.path,
      });

      setProjectFilesById((currentFiles) => ({
        ...currentFiles,
        [project.id]: files,
      }));

      const projectFacts = analyzeProject(files);
      console.log("🔥 projectFacts", projectFacts);
      setProjectFactsById((currentFacts) => ({
        ...currentFacts,
        [project.id]: projectFacts,
      }));

      if (!localStorage.getItem(hasTrackedScanStorageKey)) {
        console.log("🔥 scan complete trigger");
        track("scan_complete");
        localStorage.setItem(hasTrackedScanStorageKey, "1");
      }
    } catch (error) {
      setScanError(getErrorMessage(error));
    } finally {
      setScanningProjectId(null);
    }
  };

  const openFilePreview = async (
    file: ScannedFile,
    focusKeyword: string = fileSearchQuery.trim(),
  ) => {
    setSelectedFilePath(file.relative_path);
    setSelectedFileContent("");
    setSelectedFileError("");
    setPreviewSearchKeyword(focusKeyword);

    if (file.size > MAX_PREVIEW_FILE_SIZE) {
      setSelectedFileError("文件过大，不展示");
      return;
    }

    if (!selectedProject) {
      return;
    }

    setLoadingFilePath(file.relative_path);

    try {
      const content = await runTauriCommand<string>("read_project_file", {
        filePath: file.relative_path,
        projectRoot: selectedProject.path,
      });
      const fileCacheKey = getFileCacheKey(
        selectedProject.id,
        file.relative_path,
      );

      setSelectedFileContent(content);
      setFileContentsByPath((currentContents) => ({
        ...currentContents,
        [fileCacheKey]: content,
      }));
      setFileSummariesByPath((currentSummaries) => ({
        ...currentSummaries,
        [fileCacheKey]: summarizeFileContent(content),
      }));
    } catch (error) {
      setSelectedFileError(getErrorMessage(error));
    } finally {
      setLoadingFilePath(null);
    }
  };

  const createProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = form.name.trim();
    const path = form.path.trim();
    const description = form.description.trim();

    if (!name) {
      setErrorMessage("请输入项目名称");
      return;
    }

    if (!path) {
      setErrorMessage("请输入本地路径");
      return;
    }

    setProjects((currentProjects) => [
      ...currentProjects,
      {
        id: Date.now(),
        name,
        path,
        description,
      },
    ]);
    closeCreateModal();
  };

  const submitQuestion = async (
    questionOverride?: string,
    options?: SubmitQuestionOptions,
  ) => {
    const trimmedQuestionText = (questionOverride ?? questionText).trim();
    const storedApiKey = loadLocalApiKey().trim();
    const requestProjectId = selectedProject?.id ?? null;
    const requestSequence = questionRequestSequenceRef.current + 1;
    const answerModeType = options?.mode ?? "replace";

    if (!trimmedQuestionText || isQuestionLoading) {
      return;
    }

    if (!storedApiKey) {
      setAnswer("请先在设置中填写 API Key");
      return;
    }

    if (!localStorage.getItem(hasTrackedStorageKey)) {
      console.log("🔥 first question trigger");
      track("first_question");
      localStorage.setItem(hasTrackedStorageKey, "1");
    }

    setIsQuestionLoading(true);
    setQuestionLoadingStage(0);
    setAnswer("");
    setIsAnswerDetailsExpanded(false);

    questionRequestSequenceRef.current = requestSequence;
    questionRequestProjectIdRef.current = requestProjectId;

    if (questionOverride) {
      setQuestionText(questionOverride);
    }

    try {
      const previousTurn =
        conversationHistory[conversationHistory.length - 1] ?? null;
      const searchQuery = buildSearchQuery(trimmedQuestionText, previousTurn);
      setLastQuestionFocusKeyword(searchQuery);
      const semanticChunkMatches = selectedProject
        ? await runTauriCommand<SemanticChunkMatch[]>(
            "semantic_search_project_files",
            {
              path: selectedProject.path,
              query: searchQuery,
              limit: QUESTION_CONTEXT_FILE_LIMIT,
            },
          ).catch(() => [])
        : [];
      setLastQuestionSemanticChunks(semanticChunkMatches);

      const semanticQuestionChunks = semanticChunkMatches.map((match) => ({
        chunkId: match.chunk_id,
        relativePath: match.relative_path,
        startOffset: match.start_offset,
        endOffset: match.end_offset,
        content: match.content,
      }));

      const relatedFileContents: string[] = [];
      let relatedFileContentLength = 0;

      if (selectedProject) {
        for (const chunk of semanticQuestionChunks) {
          const chunkBody = chunk.content.trim();
          if (!chunkBody) {
            continue;
          }

          const chunkBlock = `来源：${chunk.relativePath}｜片段：${chunk.startOffset}-${chunk.endOffset}\n${chunkBody}`;
          const separatorLength = relatedFileContents.length > 0 ? 2 : 0;
          const availableLength =
            QUESTION_CONTEXT_TOTAL_LIMIT -
            relatedFileContentLength -
            separatorLength;

          if (availableLength <= 0) {
            break;
          }

          const boundedChunkBlock =
            chunkBlock.length > availableLength
              ? `${chunkBlock.slice(0, availableLength)}...`
              : chunkBlock;

          relatedFileContents.push(boundedChunkBlock);
          relatedFileContentLength += boundedChunkBlock.length + separatorLength;
        }

        if (relatedFileContents.length === 0) {
          const fallbackFiles = pickReadmeFallbackFiles(selectedProjectFiles);

          for (const file of fallbackFiles) {
            const fileCacheKey = getFileCacheKey(
              selectedProject.id,
              file.relative_path,
            );

            const cachedContent = fileContentsByPath[fileCacheKey];
            const content =
              cachedContent ??
              (await runTauriCommand<string>("read_project_file", {
                filePath: file.relative_path,
                projectRoot: selectedProject.path,
              }).catch(() => ""));

            if (!content) {
              continue;
            }

            const excerpt = buildReadmeFallbackExcerpt(content);
            const fileBlock = `来源：${file.relative_path}\n${excerpt}`;
            const separatorLength = relatedFileContents.length > 0 ? 2 : 0;
            const availableLength =
              QUESTION_CONTEXT_TOTAL_LIMIT -
              relatedFileContentLength -
              separatorLength;

            if (availableLength <= 0) {
              break;
            }

            const boundedFileBlock =
              fileBlock.length > availableLength
                ? `${fileBlock.slice(0, availableLength)}...`
                : fileBlock;

            relatedFileContents.push(boundedFileBlock);
            relatedFileContentLength += boundedFileBlock.length + separatorLength;
          }

          if (
            relatedFileContents.length === 0 &&
            selectedProjectFiles.length > 0
          ) {
            const fallbackFile = [...selectedProjectFiles]
              .sort((current, next) =>
                current.relative_path.localeCompare(next.relative_path),
              )[0];

            if (fallbackFile) {
              const fileCacheKey = getFileCacheKey(
                selectedProject.id,
                fallbackFile.relative_path,
              );

              const cachedContent = fileContentsByPath[fileCacheKey];
              const content =
                cachedContent ??
                (await runTauriCommand<string>("read_project_file", {
                  filePath: fallbackFile.relative_path,
                  projectRoot: selectedProject.path,
                }).catch(() => ""));

              if (content) {
                const excerpt = buildReadmeFallbackExcerpt(content);
                const fileBlock = `来源：${fallbackFile.relative_path}\n${excerpt}`;
                const separatorLength = relatedFileContents.length > 0 ? 2 : 0;
                const availableLength =
                  QUESTION_CONTEXT_TOTAL_LIMIT -
                  relatedFileContentLength -
                  separatorLength;

                if (availableLength > 0) {
                  const boundedFileBlock =
                    fileBlock.length > availableLength
                      ? `${fileBlock.slice(0, availableLength)}...`
                      : fileBlock;

                  relatedFileContents.push(boundedFileBlock);
                  relatedFileContentLength +=
                    boundedFileBlock.length + separatorLength;
                }
              }
            }
          }
        }
      }

      const historyBlock =
        conversationHistory.length > 0
          ? conversationHistory
              .map(
                (turn) => `Q: ${turn.question}\nA: ${turn.answer.trim() || "（空回答）"}`,
              )
              .join("\n\n")
          : "暂无历史对话";

const sharedAnswerRules = `【回答规则】
只能基于提供的文件内容回答，不得引入文件外信息
每一段内容后必须标注来源，例如：【来源：xxx】
若无法从当前文件确定，必须回答：“根据当前提供的内容无法确定”
禁止编造函数、文件、逻辑或配置
来源优先级：
1. 最高优先：README.md、PRD.md、主入口代码（App.tsx / main.py 等）
2. 中优先：services / api / 业务逻辑代码
3. 低优先：config / json / 配置文件
4. 最低优先：gen/、schemas/、自动生成文件（如 acl-manifests.json）
gen/schemas 下文件不能作为“核心逻辑”来源，不能单独支撑总结结论，只能作为“补充说明存在的配置/权限”

输出必须严格分为三段：
1. 总结：
   用一句话概括整体结论或核心流程
2. 关键依据：
   按文件列出核心证据（函数 / 模块 / 片段）
3. 详细说明：
   展开解释流程或实现细节

当问题涉及以下类型：
流程 / 实现方式 / 怎么工作 / 调用关系 / 核心逻辑
必须使用“函数名 + 作用”的表达方式：
1. 每一步必须绑定函数名，例如：
   parse_intent（解析用户意图）
   search_nearby_many（并发搜索候选餐厅）
   recommend（生成最终推荐）
2. 如果能确认调用关系，优先写成：
   parse_intent → search_nearby_many → recommend
3. 禁止只写纯文字流程，例如：
   “先解析，再搜索，再推荐”
4. 如果只有模块名，尽量补充入口函数或关键函数名
5. 目标：既让用户理解流程，又能定位代码位置

详细说明部分必须：
1 → 2 → 3 按流程顺序展开
每一步继续使用“函数名 + 作用”格式
可以补充关键字段（如 keyword / radius / score 等）
可以解释“为什么这么做”

示例参考：
总结：
主流程是 parse_intent → search_nearby_many → recommend，先解析意图，再搜索候选，最后生成推荐。

关键依据：
【来源：backend/app/services/ai.py】parse_intent（解析用户意图）
【来源：backend/app/services/search.py】search_nearby_many（并发搜索候选餐厅）
【来源：backend/app/services/recommend.py】recommend（生成最终推荐）

详细说明：
parse_intent（解析用户意图）将用户一句话拆分为关键词、预算、距离等结构化字段；
search_nearby_many（并发搜索候选餐厅）根据关键词调用多地图服务获取候选；
recommend（生成最终推荐）对候选结果打分并应用约束，输出最终推荐列表。`;

const strictAnswerRules = `${sharedAnswerRules}

严格模式补充：
禁止任何推断、联想或补充解释
若信息不足，必须回答：“根据当前提供的内容无法确定”
如果证据不足，要说明“不确定”或“无法完全确认”
来源优先级：
1. 最高优先：README.md、PRD.md、主入口代码（App.tsx / main.py 等）
2. 中优先：services / api / 业务逻辑代码
3. 低优先：config / json / 配置文件
4. 最低优先：gen/、schemas/、自动生成文件（如 acl-manifests.json）
gen/schemas 下文件不能作为“核心逻辑”来源，不能单独支撑总结结论，只能作为“补充说明存在的配置/权限”

配置 / 权限 / schema 只描述存在，不得推断用途`;

const explainAnswerRules = `${sharedAnswerRules}

解释模式补充：
允许基于已有内容做合理推断，但必须明确标注这是推测或解释
可使用“可能”“推测”“从结构看”等表达，但推断必须有文件依据
如果证据不足，要说明“不确定”或“根据当前提供的内容无法完全确认”`;

    const selectedAnswerRules =
      answerMode === "strict" ? strictAnswerRules : explainAnswerRules;

    const prompt = `【问题】
${trimmedQuestionText}

【相关文件内容】
${relatedFileContents.join("\n\n") || "暂无已加载的相关文件内容"}

【历史对话】
${historyBlock}

【要求】
请根据以上内容回答问题，只写文件中能直接确认的事实，不要把模板说明、配置文件或生成文件推断成具体业务功能。

【回答模式】
${answerMode === "strict" ? "Strict" : "Explain"}

${selectedAnswerRules}`;

      const modelAnswer = await runTauriCommand<string>("ask_mimo", {
        prompt,
        apiKey: storedApiKey,
      });

      if (
        questionRequestSequenceRef.current !== requestSequence ||
        questionRequestProjectIdRef.current !== requestProjectId
      ) {
        return;
      }

      setAnswer((currentAnswer) =>
        answerModeType === "append" && currentAnswer.trim()
          ? `${currentAnswer.trimEnd()}${answerAppendSeparator}${modelAnswer}`
          : modelAnswer,
      );
      setConversationHistory((currentHistory) => [
        ...currentHistory,
        {
          question: trimmedQuestionText,
          answer: modelAnswer,
        },
      ].slice(-QUESTION_HISTORY_LIMIT));
    } catch (error) {
      if (
        questionRequestSequenceRef.current !== requestSequence ||
        questionRequestProjectIdRef.current !== requestProjectId
      ) {
        return;
      }

      setAnswer(
        `请求失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (
        questionRequestSequenceRef.current === requestSequence &&
        questionRequestProjectIdRef.current === requestProjectId
      ) {
        questionRequestProjectIdRef.current = null;
      }

      setIsQuestionLoading(false);
    }
  };

  const answerQuestionTerms = getQuestionTerms(questionText);

  const resolveAnswerEntryContext = (entry: AnswerSourceEntry) => {
    const sourceFile = selectedProject
      ? findSourceFile(selectedProjectFiles, entry.fileLabel)
      : null;
    const normalizedSegmentLabel = entry.segmentLabel.trim();
    const matchingChunk = lastQuestionSemanticChunks.find((chunk) => {
      const chunkRelativePath = chunk.relative_path.toLowerCase();
      const chunkFileName = getFileBasename(chunk.relative_path).toLowerCase();
      const sourceFileName = getFileBasename(entry.fileLabel).toLowerCase();
      const segmentMatch =
        !normalizedSegmentLabel ||
        `${chunk.start_offset}-${chunk.end_offset}` === normalizedSegmentLabel ||
        `${chunk.start_offset} - ${chunk.end_offset}` === normalizedSegmentLabel;

      return (
        segmentMatch &&
        (chunkRelativePath === entry.fileLabel.toLowerCase() ||
          chunkFileName === sourceFileName ||
          chunkRelativePath.endsWith(`/${entry.fileLabel.toLowerCase()}`))
      );
    });
    const chunkSummary = matchingChunk
      ? buildChunkSummary(matchingChunk.content, [
          lastQuestionFocusKeyword.trim(),
          ...answerQuestionTerms,
        ])
      : "";
    const displayLabel = normalizedSegmentLabel
      ? `【来源：${entry.fileLabel}｜片段：${normalizedSegmentLabel}】`
      : `【来源：${entry.fileLabel}】`;

    return {
      sourceFile,
      matchingChunk,
      chunkSummary,
      displayLabel,
      focusKeyword:
        getChunkFocusKeyword(
          matchingChunk?.content ?? "",
          [lastQuestionFocusKeyword.trim(), ...answerQuestionTerms].filter(
            (term) => term.length >= 2,
          ),
        ) ||
        lastQuestionFocusKeyword.trim() ||
        fileSearchQuery.trim() ||
        answerQuestionTerms[0] ||
        questionText.trim(),
    };
  };

  const openAnswerSource = (entry: AnswerSourceEntry) => {
    const context = resolveAnswerEntryContext(entry);

    if (!context.sourceFile) {
      return;
    }

    void openFilePreview(context.sourceFile, context.focusKeyword);
  };

  const getCachedCodeFileContent = async (file: ScannedFile) => {
    if (!selectedProject) {
      return "";
    }

    const cacheKey = getFileCacheKey(selectedProject.id, file.relative_path);
    const cachedContent = fileContentsByPath[cacheKey];

    if (typeof cachedContent === "string" && cachedContent.length > 0) {
      return cachedContent;
    }

    if (file.size > MAX_PREVIEW_FILE_SIZE) {
      return "";
    }

    const content = await runTauriCommand<string>("read_project_file", {
      filePath: file.relative_path,
      projectRoot: selectedProject.path,
    }).catch(() => "");

    if (content) {
      setFileContentsByPath((currentContents) => ({
        ...currentContents,
        [cacheKey]: content,
      }));
      setFileSummariesByPath((currentSummaries) => ({
        ...currentSummaries,
        [cacheKey]: summarizeFileContent(content),
      }));
    }

    return content;
  };

  const doesFileContentDefineCall = (content: string, callName: string) => {
    const normalizedCallName = callName.trim().toLowerCase();

    if (!normalizedCallName) {
      return false;
    }

    return content
      .replace(/\r\n/g, "\n")
      .split("\n")
      .some((line) => {
        const symbol = extractCodeSymbolFromLine(line);
        return symbol?.name.trim().toLowerCase() === normalizedCallName;
      });
  };

  const resolveCallTargetFile = async (
    callName: string,
    inSameFile: boolean,
  ) => {
    if (!selectedProject) {
      return null;
    }

    const normalizedCallName = callName.trim().toLowerCase();

    if (!normalizedCallName) {
      return null;
    }

    const basenameMatch =
      selectedProjectFiles.find((file) => {
        const fileBaseName = getFileBasename(file.relative_path)
          .replace(/\.[^.]+$/, "")
          .toLowerCase();

        return (
          file.name.toLowerCase() === normalizedCallName ||
          fileBaseName === normalizedCallName
        );
      }) ?? null;

    const priorityFiles = [
      selectedFile,
      ...selectedProjectFiles,
    ].filter((file): file is ScannedFile => file !== null);
    const uniqueFiles = Array.from(
      new Map(priorityFiles.map((file) => [file.relative_path, file])).values(),
    );

    const searchByDefinition = async () => {
      for (const file of uniqueFiles) {
        if (!isCodeFile(file.name)) {
          continue;
        }

        const content =
          file.relative_path === selectedFilePath && selectedFileContent
            ? selectedFileContent
            : await getCachedCodeFileContent(file);

        if (content && doesFileContentDefineCall(content, normalizedCallName)) {
          return file;
        }
      }

      return null;
    };

    if (inSameFile) {
      const definitionMatch = await searchByDefinition();

      if (definitionMatch) {
        return definitionMatch;
      }

      if (basenameMatch) {
        return basenameMatch;
      }

      return null;
    }

    if (basenameMatch) {
      return basenameMatch;
    }

    const definitionMatch = await searchByDefinition();

    if (definitionMatch) {
      return definitionMatch;
    }

    return null;
  };

  const openCallTarget = async (call: CodeCallRef) => {
    if (!selectedProject || !call.name.trim()) {
      return;
    }

    const targetFile = await resolveCallTargetFile(call.name, call.inSameFile);

    if (!targetFile) {
      void submitQuestion(
        `${call.name} 是做什么的？它在当前流程中起什么作用？`,
        { mode: "append" },
      );
      return;
    }

    void openFilePreview(targetFile, call.name);
    void submitQuestion(
      `${call.name} 是做什么的？它在当前流程中起什么作用？`,
      { mode: "append" },
    );
  };

  const openAnswerFunctionReference = (functionName: string) => {
    const trimmedFunctionName = functionName.trim();

    if (!trimmedFunctionName) {
      return;
    }

    void openCallTarget({
      name: trimmedFunctionName,
      inSameFile: true,
    });
  };

  const buildReportContext = async (project?: Project) => {
    const targetProject = project ?? selectedProject;

    if (!targetProject) {
      return "暂无已加载的项目文件内容";
    }

    const targetProjectFiles = projectFilesById[targetProject.id] ?? [];
    if (targetProjectFiles.length === 0) {
      return "暂无已加载的项目文件内容";
    }

    const scoredFiles = targetProjectFiles.map((file) => {
      const category = classifyReportFile(file);
      const baseScore = getReportFileBaseScore(file, category);

      return {
        ...file,
        category,
        baseScore,
        referenceScore: 0,
        finalScore: baseScore,
        content: "",
      };
    });

    const candidatePool = [...scoredFiles]
      .sort((current, next) => {
        if (next.baseScore !== current.baseScore) {
          return next.baseScore - current.baseScore;
        }

        if (current.category !== next.category) {
          const categoryRank: Record<ReportContextCategory, number> = {
            documentation: 0,
            config: 1,
            source: 2,
            other: 3,
            generated: 4,
          };

          return categoryRank[current.category] - categoryRank[next.category];
        }

        return current.relative_path.localeCompare(next.relative_path);
      })
      .slice(0, Math.min(REPORT_CONTEXT_CANDIDATE_POOL, scoredFiles.length));

    const loadedCandidateFiles = await Promise.all(
      candidatePool.map(async (file) => {
        const cacheKey = getFileCacheKey(targetProject.id, file.relative_path);
        const cachedContent = fileContentsByPath[cacheKey];
        const content =
          cachedContent ??
          (await runTauriCommand<string>("read_project_file", {
            filePath: file.relative_path,
            projectRoot: targetProject.path,
          }).catch(() => ""));

        return {
          ...file,
          content: content.replace(/\r\n/g, "\n").trim(),
        };
      }),
    );

    const referenceScoredFiles = loadedCandidateFiles.map((currentFile) => {
      const referenceScore = getReportCandidateReferenceScore(
        currentFile,
        currentFile.content,
        loadedCandidateFiles,
      );

      return {
        ...currentFile,
        referenceScore,
        finalScore: currentFile.baseScore + referenceScore * 120,
      };
    });

    const rankedCandidates = [...referenceScoredFiles].sort(
      sortReportContextCandidates,
    );
    const selectedFiles: ReportContextFile[] = [];
    const selectedPaths = new Set<string>();
    const categoryRank: Record<ReportContextCategory, number> = {
      documentation: 0,
      config: 1,
      source: 2,
      other: 3,
      generated: 4,
    };
    const pickByCategory = (
      category: ReportContextCategory,
      limit: number,
    ) => {
      let selectedCount = 0;

      for (const file of rankedCandidates) {
        if (file.category !== category || selectedPaths.has(file.relative_path)) {
          continue;
        }

        selectedFiles.push(file);
        selectedPaths.add(file.relative_path);
        selectedCount += 1;

        if (selectedCount >= limit) {
          break;
        }
      }
    };

    pickByCategory("documentation", REPORT_CONTEXT_DOC_LIMIT);
    pickByCategory("config", REPORT_CONTEXT_CONFIG_LIMIT);
    pickByCategory("source", REPORT_CONTEXT_SOURCE_LIMIT);
    pickByCategory("other", REPORT_CONTEXT_OTHER_LIMIT);

    for (const file of rankedCandidates) {
      if (selectedPaths.has(file.relative_path)) {
        continue;
      }

      selectedFiles.push(file);
      selectedPaths.add(file.relative_path);

      if (selectedFiles.length >= REPORT_CONTEXT_FILE_LIMIT) {
        break;
      }
    }

    const finalSelection = [...selectedFiles]
      .sort((current, next) => {
        if (categoryRank[current.category] !== categoryRank[next.category]) {
          return categoryRank[current.category] - categoryRank[next.category];
        }

        return sortReportContextCandidates(current, next);
      })
      .slice(0, REPORT_CONTEXT_FILE_LIMIT);

    if (finalSelection.length === 0) {
      return "暂无已加载的项目文件内容";
    }

    const reportBlocks: string[] = [];
    let reportContentLength = 0;

    for (const file of finalSelection) {
      if (!file.content) {
        continue;
      }

      const excerptLimit =
        file.category === "documentation"
          ? 1000
          : file.category === "config"
            ? 900
            : file.category === "source"
              ? 850
              : 700;
      const excerpt = getReportContextExcerpt(file.content, excerptLimit);

      if (!excerpt) {
        continue;
      }

      const fileBlock = `【文件：${file.relative_path}｜类别：${reportContextCategoryLabels[file.category]}】\n${excerpt}`;
      const separatorLength = reportBlocks.length > 0 ? 2 : 0;
      const availableLength =
        REPORT_CONTEXT_TOTAL_LIMIT - reportContentLength - separatorLength;

      if (availableLength <= 0) {
        break;
      }

      const boundedBlock =
        fileBlock.length > availableLength
          ? `${fileBlock.slice(0, availableLength)}...`
          : fileBlock;

      reportBlocks.push(boundedBlock);
      reportContentLength += boundedBlock.length + separatorLength;
    }

    return reportBlocks.join("\n\n") || "暂无已加载的项目文件内容";
  };

  const buildReportPrompt = (
    project: Project,
    reportContext: string,
    projectFacts: ProjectFacts,
  ) => {
    return `你是一名资深软件架构师。

请根据提供的项目文件内容生成项目状态报告。

输出必须是 Markdown，并严格包含以下标题：

# 项目概述

一句话说明项目是做什么的。

# 当前状态

说明项目目前大致处于什么阶段。

# 核心模块

列出主要模块以及它们的职责。

# 关键技术

识别框架、语言、工具和基础设施。

# 已完成内容

根据文件内容推断当前已经完成了哪些内容。

# 下一步建议

给出 3 个最合理、最可执行的下一步方向。

# 风险与缺口

指出当前信息缺失、潜在风险或未覆盖的部分。

要求：

1. 仅依据提供的文件内容回答，不得引入文件外信息。
2. 禁止编造不存在的功能、模块、技术或阶段判断。
3. 如果证据不足，必须明确写出“不确定”或“根据当前提供的内容无法完全确认”。
4. 语言简洁，尽量用项目中的真实文件和模块名称。
5. 以下 ProjectFacts 是程序基于文件结构提取的事实，可信度高于模型推断。
   如果 ProjectFacts 没有提供某项证据，请回答“当前无法确认”，不要自行推断。
   value 为 null 或空数组表示当前扫描结果无法确认，不要把无法确认写成不存在。
   不要根据文件名强行推断业务目标。

【项目名称】
${project.name}

【项目路径】
${project.path}

【ProjectFacts】
${formatProjectFactsForPrompt(projectFacts)}

【项目文件内容】
${reportContext}`;
  };

  const updateProjectReportRecord = (
    projectId: number,
    record: ProjectReportRecord,
  ) => {
    setProjectReportsById((currentReports) => ({
      ...currentReports,
      [projectId]: record,
    }));
  };

  const updateProjectProgressAnalysisRecord = (
    projectId: number,
    record: ProjectProgressAnalysisRecord,
  ) => {
    setProjectProgressAnalysesById((currentAnalyses) => ({
      ...currentAnalyses,
      [projectId]: record,
    }));
  };

  const updateProjectWeeklyReportRecord = (
    projectId: number,
    record: ProjectWeeklyReportRecord,
  ) => {
    setProjectWeeklyReportsById((currentReports) => ({
      ...currentReports,
      [projectId]: record,
    }));
  };

  const generateReport = async (projectOverride?: Project) => {
    const storedApiKey = loadLocalApiKey().trim();
    const targetProject = projectOverride ?? selectedProject;

    if (!targetProject) {
      return;
    }

    if (!storedApiKey) {
      setAnswer("请先在设置中填写 API Key");
      return;
    }

    if (!projectOverride || selectedProject?.id === targetProject.id) {
      setReportLoading(true);
      setReportData(null);
      setReportError("");
      setReportStatus("loading");
    }

    updateProjectReportRecord(targetProject.id, {
      content: "",
      status: "loading",
      error: "",
      updatedAt: Date.now(),
    });

    try {
      const reportContext = await buildReportContext(targetProject);
      const projectFacts = getProjectFactsForProject(targetProject.id);
      const prompt = buildReportPrompt(
        targetProject,
        reportContext,
        projectFacts,
      );

      const reportText = await runTauriCommand<string>("ask_mimo", {
        apiKey: storedApiKey,
        prompt,
      });

      const nextRecord = {
        content: reportText,
        status: "success" as const,
        error: "",
        updatedAt: Date.now(),
      };

      updateProjectReportRecord(targetProject.id, nextRecord);

      if (!projectOverride || selectedProject?.id === targetProject.id) {
        setReportData({
          summary: reportText,
          flow: "",
          code: "",
        });
        setReportStatus("success");
      }
    } catch (error) {
      console.error("generateReport failed", error);
      const message = `生成失败：${
        error instanceof Error ? error.message : String(error)
      }`;

      updateProjectReportRecord(targetProject.id, {
        content: "",
        status: "failure",
        error: message,
        updatedAt: Date.now(),
      });

      if (!projectOverride || selectedProject?.id === targetProject.id) {
        setReportError(message);
        setReportStatus("failure");
      }
    } finally {
      if (!projectOverride || selectedProject?.id === targetProject.id) {
        setReportLoading(false);
      }
    }
  };

  const generateProgressAnalysis = async (projectOverride?: Project) => {
    const storedApiKey = loadLocalApiKey().trim();
    const targetProject = projectOverride ?? selectedProject;

    if (!targetProject) {
      return;
    }

    if (!storedApiKey) {
      setAnswer("请先在设置中填写 API Key");
      return;
    }

    updateProjectProgressAnalysisRecord(targetProject.id, {
      content: "",
      status: "loading",
      error: "",
      updatedAt: Date.now(),
    });

    try {
      const reportRecord = projectReportsById[targetProject.id] ?? null;
      const projectFacts = getProjectFactsForProject(targetProject.id);
      const progressInput = await buildProgressAnalysisInput({
        projectName: targetProject.name,
        projectPath: targetProject.path,
        files: projectFilesById[targetProject.id] ?? [],
        projectFacts,
        reportContent: reportRecord?.content ?? "",
        timelineEntries:
          targetProject.id === selectedProject?.id
            ? projectTimeline
            : buildProjectTimeline(projectFilesById[targetProject.id] ?? []),
        fileContentsByPath,
        getFileCacheKey,
        projectId: targetProject.id,
      });

      const prompt = buildProgressAnalysisPromptFromInput(progressInput);
      const analysisText = await runTauriCommand<string>("ask_mimo", {
        apiKey: storedApiKey,
        prompt,
      });

      const nextRecord = {
        content: analysisText,
        status: "success" as const,
        error: "",
        updatedAt: Date.now(),
      };

      updateProjectProgressAnalysisRecord(targetProject.id, nextRecord);
    } catch (error) {
      console.error("generateProgressAnalysis failed", error);
      const message = `生成失败：${
        error instanceof Error ? error.message : String(error)
      }`;

      updateProjectProgressAnalysisRecord(targetProject.id, {
        content: "",
        status: "failure",
        error: message,
        updatedAt: Date.now(),
      });
    }
  };

  const generateWeeklyReport = async (projectOverride?: Project) => {
    const storedApiKey = loadLocalApiKey().trim();
    const targetProject = projectOverride ?? selectedProject;

    if (!targetProject) {
      return;
    }

    if (!storedApiKey) {
      setAnswer("请先在设置中填写 API Key");
      return;
    }

    if (!projectOverride || selectedProject?.id === targetProject.id) {
      setWeeklyReportLoading(true);
      setWeeklyReportData(null);
      setWeeklyReportError("");
      setWeeklyReportStatus("loading");
    }

    updateProjectWeeklyReportRecord(targetProject.id, {
      content: "",
      status: "loading",
      error: "",
      updatedAt: Date.now(),
    });

    try {
      const reportRecord = projectReportsById[targetProject.id] ?? null;
      const progressRecord =
        projectProgressAnalysesById[targetProject.id] ?? null;
      const projectFacts = getProjectFactsForProject(targetProject.id);
      const weeklyInput = await buildWeeklyReportInput({
        projectName: targetProject.name,
        projectPath: targetProject.path,
        files: projectFilesById[targetProject.id] ?? [],
        projectFacts,
        reportContent: reportRecord?.content ?? "",
        progressAnalysisContent: progressRecord?.content ?? "",
        timelineEntries:
          targetProject.id === selectedProject?.id
            ? projectTimeline
            : buildProjectTimeline(projectFilesById[targetProject.id] ?? []),
        fileContentsByPath,
        getFileCacheKey,
        projectId: targetProject.id,
      });

      const prompt = buildWeeklyReportPromptFromInput(weeklyInput);
      const weeklyReportText = await runTauriCommand<string>("ask_mimo", {
        apiKey: storedApiKey,
        prompt,
      });

      const nextRecord = {
        content: weeklyReportText,
        status: "success" as const,
        error: "",
        updatedAt: Date.now(),
      };

      updateProjectWeeklyReportRecord(targetProject.id, nextRecord);

      if (!projectOverride || selectedProject?.id === targetProject.id) {
        setWeeklyReportData({
          summary: weeklyReportText,
          flow: "",
          code: "",
        });
        setWeeklyReportStatus("success");
      }
    } catch (error) {
      console.error("generateWeeklyReport failed", error);
      const message = `生成失败：${
        error instanceof Error ? error.message : String(error)
      }`;

      updateProjectWeeklyReportRecord(targetProject.id, {
        content: "",
        status: "failure",
        error: message,
        updatedAt: Date.now(),
      });

      if (!projectOverride || selectedProject?.id === targetProject.id) {
        setWeeklyReportError(message);
        setWeeklyReportStatus("failure");
      }
    } finally {
      if (!projectOverride || selectedProject?.id === targetProject.id) {
        setWeeklyReportLoading(false);
      }
    }
  };

  const currentReportFavorites = selectedProject
    ? reportFavoritesByProjectId[selectedProject.id] ?? []
    : [];

  const getProjectReportRecord = (projectId: number) =>
    projectReportsById[projectId] ?? null;

  const getProjectWeeklyReportRecord = (projectId: number) =>
    projectWeeklyReportsById[projectId] ?? null;

  const getProjectFactsForProject = (projectId: number) => {
    const currentFiles = projectFilesById[projectId] ?? [];
    return projectFactsById[projectId] ?? analyzeProject(currentFiles);
  };

  const formatRelativeReportTime = (updatedAt?: number | null) => {
    if (typeof updatedAt !== "number" || Number.isNaN(updatedAt)) {
      return "暂无记录";
    }

    const diffMs = Date.now() - updatedAt;
    if (diffMs < 60 * 1000) {
      return "刚刚";
    }

    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    if (diffMinutes < 60) {
      return `${diffMinutes} 分钟前`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} 小时前`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
      return `${diffDays} 天前`;
    }

    return new Date(updatedAt).toLocaleDateString("zh-CN");
  };

  const scrollToInsightPanel = (panelRef: { current: HTMLElement | null }) => {
    panelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const saveReportFavoriteTurn = (turn: ConversationTurn) => {
    if (!selectedProject) {
      return;
    }

    const question = turn.question.trim();
    const answerText = turn.answer.trim();

    if (!question && !answerText) {
      return;
    }

    setReportFavoritesByProjectId((currentFavorites) => {
      const existingFavorites = currentFavorites[selectedProject.id] ?? [];
      const duplicate = existingFavorites.some(
        (item) =>
          item.question.trim() === question &&
          item.answer.trim() === answerText,
      );

      if (duplicate) {
        return currentFavorites;
      }

      const nextFavorites: ReportFavoriteTurn[] = [
        {
          question,
          answer: answerText,
          savedAt: Date.now(),
        },
        ...existingFavorites,
      ].slice(0, 20);

      return {
        ...currentFavorites,
        [selectedProject.id]: nextFavorites,
      };
    });
  };

  const renderFlowChainChips = (chainText: string) => {
    const chainFunctionNames = chainText
      .split(/\s*→\s*/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (chainFunctionNames.length === 0) {
      return chainText;
    }

    return (
      <span className="answerFlowChain" key={chainText}>
        {chainFunctionNames.map((name, index) => (
          <span className="answerFlowChainItem" key={`${name}-${index}`}>
            {index > 0 ? <span className="answerFlowChainArrow">→</span> : null}
            <button
              className="answerSourceButton answerSourceButtonCompact"
              type="button"
              title={`跳转到 ${name}`}
              onClick={() => openAnswerFunctionReference(name)}
            >
              <span className="answerSourceLabel">{name}</span>
            </button>
          </span>
        ))}
      </span>
    );
  };

  const renderAnswerTextWithFunctionLinks = (text: string) => {
    const normalizedText = text ?? "";
    const functionPattern =
      /([A-Za-z_$][A-Za-z0-9_$]*)[（(]([^）()]+)[）)]|([A-Za-z_$][A-Za-z0-9_$]*(?:\s*→\s*[A-Za-z_$][A-Za-z0-9_$]*){1,})/g;
    const renderedParts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while ((match = functionPattern.exec(normalizedText)) !== null) {
      const matchIndex = match.index ?? 0;

      if (matchIndex > lastIndex) {
        renderedParts.push(normalizedText.slice(lastIndex, matchIndex));
      }

      const functionName = match[1] ?? "";
      const functionDescription = match[2] ?? "";
      const functionChain = match[3] ?? "";

      if (functionName && functionDescription) {
        renderedParts.push(
          <button
            className="answerSourceButton answerSourceButtonCompact"
            key={`${functionName}-${matchIndex}`}
            type="button"
            title={`跳转到 ${functionName}`}
            onClick={() => openAnswerFunctionReference(functionName)}
          >
            <span className="answerSourceLabel">{functionName}</span>
            <span className="answerSourceSummary">
              （{functionDescription}）
            </span>
          </button>,
        );
      } else if (functionChain) {
        renderedParts.push(renderFlowChainChips(functionChain));
      }

      lastIndex = matchIndex + match[0].length;
    }

    if (lastIndex < normalizedText.length) {
      renderedParts.push(normalizedText.slice(lastIndex));
    }

    return renderedParts.length > 0 ? renderedParts : normalizedText;
  };

  const renderReportFavoritesPanel = () => {
    if (currentReportFavorites.length === 0) {
      return null;
    }

    return (
      <section className="reportFavoritesPanel">
        <div className="answerSectionHeader">
          <div>
            <h3>报告收藏</h3>
            <span>把你觉得最有代表性的问答固定下来，后面写总结会更省心。</span>
          </div>
          <span className="reportFavoritesCount">
            共 {currentReportFavorites.length} 条
          </span>
        </div>

        <div className="reportHistoryList">
          {currentReportFavorites.map((turn, index) => (
            <article className="reportHistoryItem" key={`${turn.question}-${turn.savedAt}-${index}`}>
              <div className="reportHistoryQuestion">
                <span className="reportHistoryLabel">☆</span>
                <p>{turn.question}</p>
              </div>
              <div className="reportHistoryAnswer">
                <span className="reportHistoryLabel">A</span>
                <div className="reportMarkdown reportHistoryMarkdown">
                  <ReactMarkdown components={markdownComponents}>
                    {turn.answer || "（空回答）"}
                  </ReactMarkdown>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  };

  const renderReportHistoryPanel = () => {
    if (conversationHistory.length === 0) {
      return null;
    }

    return (
      <section className="reportHistoryPanel">
        <div className="answerSectionHeader">
          <div>
            <h3>问答历史</h3>
            <span>当前项目最近的提问记录，可展开或收起查看。</span>
          </div>

          <button
            className="reportHistoryToggle"
            type="button"
            onClick={() =>
              setIsReportHistoryExpanded((current) => !current)
            }
          >
            {isReportHistoryExpanded ? "收起" : "展开"}
          </button>
        </div>

        {isReportHistoryExpanded ? (
          <div className="reportHistoryList">
            {conversationHistory.map((turn, index) => (
              <article
                className="reportHistoryItem"
                key={`${turn.question}-${index}`}
              >
                <div className="reportHistoryItemHeader">
                  <div className="reportHistoryQuestion">
                    <span className="reportHistoryLabel">Q</span>
                    <p className="reportHistoryQuestionText">{turn.question}</p>
                  </div>

                  <button
                    className="reportHistorySaveButton"
                    type="button"
                    onClick={() => saveReportFavoriteTurn(turn)}
                  >
                    收藏
                  </button>
                </div>

                <div className="reportHistoryAnswer">
                  <span className="reportHistoryLabel">A</span>
                  <div className="reportMarkdown reportHistoryMarkdown">
                    <ReactMarkdown components={markdownComponents}>
                      {turn.answer || "（空回答）"}
                    </ReactMarkdown>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    );
  };

  const renderMarkdownExportActions = ({
    content,
    updatedAt,
    filenamePrefix,
    copyStatus,
    exportStatus,
    setCopyStatus,
    setExportStatus,
    logLabel,
  }: {
    content: string;
    updatedAt?: number | null;
    filenamePrefix: string;
    copyStatus: MarkdownCopyStatus;
    exportStatus: MarkdownExportStatus;
    setCopyStatus: (status: MarkdownCopyStatus) => void;
    setExportStatus: (status: MarkdownExportStatus) => void;
    logLabel: string;
  }) => {
    const handleCopy = async () => {
      if (!content) {
        return;
      }

      setCopyStatus("copying");

      try {
        await copyMarkdownToClipboard(content);
        setCopyStatus("copied");
      } catch (error) {
        console.error(`copy ${logLabel} failed`, error);
        setCopyStatus("copy failed");
      }
    };

    const handleExport = () => {
      if (!content) {
        return;
      }

      setExportStatus("exporting");

      try {
        const fileName = buildMarkdownFilename(updatedAt, filenamePrefix);
        downloadMarkdownFile(content, fileName);
        setExportStatus("exported");
      } catch (error) {
        console.error(`export ${logLabel} failed`, error);
        setExportStatus("export failed");
      }
    };

    return (
      <div className="reportExportActions">
        <button
          className="reportHistoryToggle reportExportActionButton"
          type="button"
          onClick={() => void handleCopy()}
          disabled={!content || copyStatus === "copying"}
        >
          {copyStatus === "copying"
            ? "Copying..."
            : copyStatus === "copied"
              ? "Copied"
              : copyStatus === "copy failed"
                ? "Copy failed"
                : "Copy Markdown"}
        </button>
        <button
          className="reportHistoryToggle reportExportActionButton"
          type="button"
          onClick={() => handleExport()}
          disabled={!content || exportStatus === "exporting"}
        >
          {exportStatus === "exporting"
            ? "Exporting..."
            : exportStatus === "exported"
              ? "Exported"
              : exportStatus === "export failed"
                ? "Export failed"
                : "Export .md"}
        </button>
        {copyStatus !== "idle" ? (
          <span className="reportExportActionStatus">{copyStatus}</span>
        ) : exportStatus !== "idle" ? (
          <span className="reportExportActionStatus">{exportStatus}</span>
        ) : null}
      </div>
    );
  };

  const renderReportPanel = () => {
    const selectedProjectReport = selectedProject
      ? projectReportsById[selectedProject.id] ?? null
      : null;
    const reportContent =
      reportData?.summary ?? selectedProjectReport?.content ?? "";
    const reportUpdatedAt =
      selectedProjectReport?.updatedAt ??
      (reportData?.summary ? Date.now() : undefined);
    const reportStatusText =
      reportLoading || selectedProjectReport?.status === "loading"
        ? "生成中..."
        : reportStatus === "success" || selectedProjectReport?.status === "success"
          ? "生成成功"
          : reportStatus === "failure" || selectedProjectReport?.status === "failure"
            ? reportError || selectedProjectReport?.error || "生成失败"
            : "";

    const hasReportActivity =
      reportLoading ||
      reportStatus === "failure" ||
      selectedProjectReport?.status === "failure" ||
      Boolean(reportContent) ||
      conversationHistory.length > 0 ||
      currentReportFavorites.length > 0;

    if (!hasReportActivity) {
      return null;
    }

    return (
      <section className="reportPanel" id="project-report-panel" ref={reportPanelRef}>
        <div className="answerSectionHeader">
          <div>
            <h3>项目报告</h3>
            <span>基于项目说明、配置、源码和最近问答自动生成的项目总结。</span>
          </div>
          {renderMarkdownExportActions({
            content: reportContent,
            updatedAt: reportUpdatedAt,
            filenamePrefix: "project-report",
            copyStatus: reportCopyStatus,
            exportStatus: reportExportStatus,
            setCopyStatus: setReportCopyStatus,
            setExportStatus: setReportExportStatus,
            logLabel: "project report",
          })}
        </div>

        {reportStatusText ? (
          <p className="reportStatusText">{reportStatusText}</p>
        ) : null}

        {reportContent ? (
          <section className="reportBlock reportBlockSingle">
            <div className="reportMarkdown reportMarkdownLarge">
              <ReactMarkdown components={markdownComponents}>
                {reportContent}
              </ReactMarkdown>
            </div>
          </section>
        ) : null}

        {renderReportHistoryPanel()}

        {renderReportFavoritesPanel()}
      </section>
    );
  };

  const renderProgressAnalysisPanel = () => {
    const selectedProjectProgressAnalysis = selectedProject
      ? projectProgressAnalysesById[selectedProject.id] ?? null
      : null;
    const analysisContent = selectedProjectProgressAnalysis?.content ?? "";
    const analysisUpdatedAt = selectedProjectProgressAnalysis?.updatedAt ?? null;
    const analysisStatusText =
      selectedProjectProgressAnalysis?.status === "loading"
        ? "生成中..."
        : selectedProjectProgressAnalysis?.status === "success"
          ? "生成成功"
          : selectedProjectProgressAnalysis?.status === "failure"
            ? selectedProjectProgressAnalysis.error || "生成失败"
            : "";

    const hasAnalysisActivity =
      selectedProjectProgressAnalysis?.status === "loading" ||
      selectedProjectProgressAnalysis?.status === "failure" ||
      Boolean(analysisContent);

    if (!hasAnalysisActivity) {
      return null;
    }

    return (
      <section
        className="progressAnalysisPanel"
        id="project-progress-analysis-panel"
        ref={progressAnalysisPanelRef}
      >
        <div className="answerSectionHeader">
          <div>
            <h3>项目进展分析</h3>
            <span>
              结合项目报告、项目时间线和项目文件内容自动生成的进展分析。
            </span>
          </div>
          {renderMarkdownExportActions({
            content: analysisContent,
            updatedAt: analysisUpdatedAt,
            filenamePrefix: "progress-analysis",
            copyStatus: progressAnalysisCopyStatus,
            exportStatus: progressAnalysisExportStatus,
            setCopyStatus: setProgressAnalysisCopyStatus,
            setExportStatus: setProgressAnalysisExportStatus,
            logLabel: "progress analysis",
          })}
        </div>

        {analysisStatusText ? (
          <p className="reportStatusText">{analysisStatusText}</p>
        ) : null}

        {analysisContent ? (
          <section className="reportBlock reportBlockSingle">
            <div className="reportMarkdown reportMarkdownLarge">
              <ReactMarkdown components={markdownComponents}>
                {analysisContent}
              </ReactMarkdown>
            </div>
          </section>
        ) : null}
      </section>
    );
  };

  const renderWeeklyReportPanel = () => {
    const selectedProjectWeeklyReport = selectedProject
      ? projectWeeklyReportsById[selectedProject.id] ?? null
      : null;
    const reportContent =
      weeklyReportData?.summary ?? selectedProjectWeeklyReport?.content ?? "";
    const reportUpdatedAt =
      selectedProjectWeeklyReport?.updatedAt ??
      (weeklyReportData?.summary ? Date.now() : undefined);
    const reportStatusText =
      weeklyReportLoading || selectedProjectWeeklyReport?.status === "loading"
        ? "生成中..."
        : weeklyReportStatus === "success" ||
            selectedProjectWeeklyReport?.status === "success"
          ? "生成成功"
          : weeklyReportStatus === "failure" ||
              selectedProjectWeeklyReport?.status === "failure"
            ? weeklyReportError || selectedProjectWeeklyReport?.error || "生成失败"
            : "";

    const hasWeeklyReportActivity =
      weeklyReportLoading ||
      weeklyReportStatus === "failure" ||
      selectedProjectWeeklyReport?.status === "failure" ||
      Boolean(reportContent);

    if (!hasWeeklyReportActivity) {
      return null;
    }

    return (
      <section
        className="weeklyReportPanel"
        id="project-weekly-report-panel"
        ref={weeklyReportPanelRef}
      >
        <div className="answerSectionHeader">
          <div>
            <h3>周报</h3>
            <span>
              基于项目报告、项目时间线、进展分析和项目文件内容自动生成的周报。
            </span>
          </div>
          {renderMarkdownExportActions({
            content: reportContent,
            updatedAt: reportUpdatedAt,
            filenamePrefix: "weekly-report",
            copyStatus: weeklyReportCopyStatus,
            exportStatus: weeklyReportExportStatus,
            setCopyStatus: setWeeklyReportCopyStatus,
            setExportStatus: setWeeklyReportExportStatus,
            logLabel: "weekly report",
          })}
        </div>

        {reportStatusText ? (
          <p className="reportStatusText">{reportStatusText}</p>
        ) : null}

        {reportContent ? (
          <section className="reportBlock reportBlockSingle">
            <div className="reportMarkdown reportMarkdownLarge">
              <ReactMarkdown components={markdownComponents}>
                {reportContent}
              </ReactMarkdown>
            </div>
          </section>
        ) : null}
      </section>
    );
  };

  const renderProjectInsightEntryBoard = () => {
    if (!selectedProject) {
      return null;
    }

    const selectedProjectReport = projectReportsById[selectedProject.id] ?? null;
    const selectedProjectProgressAnalysis =
      projectProgressAnalysesById[selectedProject.id] ?? null;
    const selectedProjectWeeklyReport =
      projectWeeklyReportsById[selectedProject.id] ?? null;

    const entries = [
      {
        key: "report",
        title: "项目报告",
        description: "看项目整体是什么、做到了哪一步、有哪些关键模块。",
        status:
          reportLoading || selectedProjectReport?.status === "loading"
            ? "生成中"
            : reportStatus === "success" ||
                selectedProjectReport?.status === "success"
              ? "已生成"
              : reportStatus === "failure" ||
                  selectedProjectReport?.status === "failure"
                ? "生成失败"
                : "未生成",
        buttonText: reportLoading
          ? "生成中..."
          : selectedProjectReport?.status === "success"
            ? "重新生成"
            : "生成项目报告",
        onClick: () => void generateReport(),
        tone: "neutral",
        lastUpdated: selectedProjectReport?.updatedAt ?? null,
        hasResult:
          reportLoading ||
          reportStatus === "failure" ||
          selectedProjectReport?.status === "failure" ||
          Boolean(selectedProjectReport?.content ?? reportData?.summary) ||
          conversationHistory.length > 0 ||
          currentReportFavorites.length > 0,
        panelRef: reportPanelRef,
        panelId: "project-report-panel",
        jumpLabel: "跳到报告结果",
      },
      {
        key: "progress",
        title: "项目进展分析",
        description: "看最近发生了什么变化、当前缺口和下一步方向。",
        status:
          selectedProjectProgressAnalysis?.status === "loading"
            ? "生成中"
            : selectedProjectProgressAnalysis?.status === "success"
              ? "已生成"
              : selectedProjectProgressAnalysis?.status === "failure"
                ? "生成失败"
                : "未生成",
        buttonText:
          selectedProjectProgressAnalysis?.status === "loading"
            ? "生成中..."
            : selectedProjectProgressAnalysis?.status === "success"
              ? "重新生成"
              : "生成进展分析",
        onClick: () => void generateProgressAnalysis(),
        tone: "blue",
        lastUpdated: selectedProjectProgressAnalysis?.updatedAt ?? null,
        hasResult:
          selectedProjectProgressAnalysis?.status === "loading" ||
          selectedProjectProgressAnalysis?.status === "failure" ||
          Boolean(selectedProjectProgressAnalysis?.content),
        panelRef: progressAnalysisPanelRef,
        panelId: "project-progress-analysis-panel",
        jumpLabel: "跳到分析结果",
      },
      {
        key: "weekly",
        title: "周报",
        description: "看本周完成、最近活动、存在问题和下周计划建议。",
        status:
          weeklyReportLoading ||
          selectedProjectWeeklyReport?.status === "loading"
            ? "生成中"
            : weeklyReportStatus === "success" ||
                selectedProjectWeeklyReport?.status === "success"
              ? "已生成"
              : weeklyReportStatus === "failure" ||
                  selectedProjectWeeklyReport?.status === "failure"
                ? "生成失败"
                : "未生成",
        buttonText:
          weeklyReportLoading ||
          selectedProjectWeeklyReport?.status === "loading"
            ? "生成中..."
            : selectedProjectWeeklyReport?.status === "success"
            ? "重新生成"
            : "生成周报",
        onClick: () => void generateWeeklyReport(),
        tone: "purple",
        lastUpdated: selectedProjectWeeklyReport?.updatedAt ?? null,
        hasResult:
          weeklyReportLoading ||
          weeklyReportStatus === "failure" ||
          selectedProjectWeeklyReport?.status === "failure" ||
          Boolean(selectedProjectWeeklyReport?.content ?? weeklyReportData?.summary),
        panelRef: weeklyReportPanelRef,
        panelId: "project-weekly-report-panel",
        jumpLabel: "跳到周报结果",
      },
    ] as const;

    return (
      <section className="projectInsightBoard">
        <div className="answerSectionHeader">
          <div>
            <h3>报告与分析入口</h3>
            <span>三个入口放在一起，先看要生成什么，再看下方结果。</span>
          </div>
        </div>

        <div className="projectInsightGrid">
          {entries.map((entry) => (
            <article
              key={entry.key}
              className={`projectInsightCard projectInsightCard-${entry.tone}`}
            >
              <div className="projectInsightCardHeader">
                <div>
                  <h4>{entry.title}</h4>
                  <p>{entry.description}</p>
                </div>
                <span className="projectInsightStatus">{entry.status}</span>
              </div>

              <div className="projectInsightMeta">
                <span>最近生成：{formatRelativeReportTime(entry.lastUpdated)}</span>
                <span>{entry.hasResult ? "已有结果" : "暂无结果"}</span>
              </div>

              <div className="projectInsightCardActions">
                <button
                  className="primaryButton projectInsightButton"
                  type="button"
                  onClick={entry.onClick}
                  disabled={
                    entry.key === "report"
                      ? reportLoading
                    : entry.key === "progress"
                        ? selectedProjectProgressAnalysis?.status === "loading"
                        : weeklyReportLoading
                  }
                >
                  {entry.buttonText}
                </button>
                <button
                  className="reportProjectToggle projectInsightJumpLink"
                  type="button"
                  onClick={() => scrollToInsightPanel(entry.panelRef)}
                  disabled={!entry.hasResult}
                  aria-controls={entry.panelId}
                >
                  {entry.jumpLabel}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  };

  const renderProjectTimelinePanel = () => {
    if (!selectedProject || !isProjectTimelineExpanded) {
      return null;
    }

    return (
      <section className="timelinePanel">
        <div className="answerSectionHeader">
          <div>
            <h3>Project Timeline</h3>
            <span>按文件最后修改时间聚合项目活动，最新日期优先。</span>
          </div>

          <button
            className="reportHistoryToggle"
            type="button"
            onClick={() => setIsProjectTimelineExpanded(false)}
          >
            收起
          </button>
        </div>

        {projectTimelineSummary ? (
          <div className="timelineOverview">
            <article className="timelineOverviewCard">
              <span className="timelineOverviewLabel">活跃天数</span>
              <strong>{projectTimelineSummary.activeDays}</strong>
            </article>
            <article className="timelineOverviewCard">
              <span className="timelineOverviewLabel">修改文件</span>
              <strong>{projectTimelineSummary.totalModifiedFiles}</strong>
            </article>
            <article className="timelineOverviewCard">
              <span className="timelineOverviewLabel">最近更新</span>
              <strong>{projectTimelineSummary.latestDate}</strong>
              <p>{projectTimelineSummary.latestActivityType}</p>
            </article>
            <article className="timelineOverviewCard">
              <span className="timelineOverviewLabel">最活跃日</span>
              <strong>{projectTimelineSummary.busiestDate}</strong>
              <p>
                {projectTimelineSummary.busiestCount} 个文件 ·{" "}
                {projectTimelineSummary.busiestActivityType}
              </p>
            </article>
          </div>
        ) : null}

        {!projectTimelineSummary ? (
          <div className="timelineEmptyState">
            <div className="emptyIcon">🕒</div>
            <h3>暂无足够的项目活动记录。</h3>
            <p>扫描项目后，我们会根据文件修改时间自动整理时间线。</p>
          </div>
        ) : (
          <div className="timelineSections">
            {projectTimelineSections.map((section) => (
              <details
                className="timelineSection"
                key={section.key}
                open={section.key !== "older"}
              >
                <summary className="timelineSectionSummary">
                  <div>
                    <h4>{section.title}</h4>
                    <span>{section.subtitle}</span>
                  </div>
                  <span className="timelineSectionCount">
                    {section.entries.length} 天
                  </span>
                </summary>

                <div className="timelineList">
                  {section.entries.map((entry, index) => (
                    <article className="timelineItem" key={entry.date}>
                      <div className="timelineItemHeader">
                        <div>
                          <h4>
                            {entry.date}
                            {index === 0 && section.key === "today" ? (
                              <span className="timelineDateBadge">最新</span>
                            ) : null}
                          </h4>
                          <span>修改文件：{entry.modifiedCount}</span>
                        </div>

                        <span className="timelineActivityBadge">
                          {entry.activityType}
                        </span>
                      </div>

                      <div className="timelineFiles">
                        <span className="timelineFilesLabel">主要涉及：</span>
                        <div className="timelineFileChips">
                          {entry.representativeFiles.map((file) => (
                            <span
                              className="timelineFileChip"
                              key={`${section.key}-${entry.date}-${file.relative_path}`}
                              title={file.relative_path}
                            >
                              {file.relative_path}
                            </span>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    );
  };

  const renderReportsList = (mode: ReportBoardMode = reportBoardMode) => {
    if (projects.length === 0) {
      return (
        <section className="emptyState">
          <div className="emptyIcon">📊</div>
          <h3>还没有项目</h3>
          <p>先创建或导入一个项目，再生成它的报告。</p>
        </section>
      );
    }

    const modeMeta =
      mode === "weekly"
        ? {
            emptyLabel: "生成周报",
            successLabel: "重新生成",
            expandLabel: "展开周报",
            collapseLabel: "收起周报",
          }
        : {
            emptyLabel: "生成项目报告",
            successLabel: "重新生成",
            expandLabel: "展开报告",
            collapseLabel: "收起报告",
          };

    const getModeReportRecord =
      mode === "weekly" ? getProjectWeeklyReportRecord : getProjectReportRecord;

    const sortedProjects = [...projects].sort((current, next) => {
      const currentReport = getModeReportRecord(current.id);
      const nextReport = getModeReportRecord(next.id);
      const currentUpdatedAt = currentReport?.updatedAt ?? 0;
      const nextUpdatedAt = nextReport?.updatedAt ?? 0;

      if (nextUpdatedAt !== currentUpdatedAt) {
        return nextUpdatedAt - currentUpdatedAt;
      }

      return current.name.localeCompare(next.name);
    });

    return (
      <section className="reportProjectList">
        {sortedProjects.map((project) => {
          const reportRecord = getModeReportRecord(project.id);
          const isExpanded =
            mode === "weekly"
              ? expandedWeeklyReportProjectId === project.id
              : expandedReportProjectId === project.id;
          const statusLabel =
            reportRecord?.status === "loading"
              ? "生成中"
              : reportRecord?.status === "success"
                ? "生成成功"
                : reportRecord?.status === "failure"
                  ? "生成失败"
                  : "未生成";

          return (
            <article className="reportProjectCard" key={project.id}>
              <div className="reportProjectCardHeader">
                <div>
                  <h3>{project.name}</h3>
                  <p>{project.path}</p>
                </div>

                <div className="reportProjectActions">
                  <span className={`reportProjectStatus reportProjectStatus-${reportRecord?.status ?? "idle"}`}>
                    {statusLabel}
                  </span>
                  <button
                    className="secondaryButton reportProjectButton"
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      setActiveSection("projects");
                    }}
                  >
                    打开项目
                  </button>
                  <button
                    className="primaryButton reportProjectButton"
                    type="button"
                    onClick={() =>
                      void (mode === "weekly"
                        ? generateWeeklyReport(project)
                        : generateReport(project))
                    }
                    disabled={reportRecord?.status === "loading"}
                  >
                    {reportRecord?.status === "loading"
                      ? "生成中..."
                      : reportRecord?.status === "success"
                        ? modeMeta.successLabel
                        : modeMeta.emptyLabel}
                  </button>
                </div>
              </div>

              {reportRecord?.status === "failure" ? (
                <p className="reportProjectError">{reportRecord.error}</p>
              ) : null}

              {reportRecord?.status === "success" && reportRecord.content ? (
                <button
                  className="reportProjectToggle"
                  type="button"
                  onClick={() =>
                    mode === "weekly"
                      ? setExpandedWeeklyReportProjectId((current) =>
                          current === project.id ? null : project.id,
                        )
                      : setExpandedReportProjectId((current) =>
                          current === project.id ? null : project.id,
                        )
                  }
                >
                  {isExpanded ? modeMeta.collapseLabel : modeMeta.expandLabel}
                </button>
              ) : null}

              {reportRecord?.status === "loading" ? (
                <p className="reportStatusText">生成中...</p>
              ) : null}

              {reportRecord?.status === "success" &&
              reportRecord.content &&
              isExpanded ? (
                <div className="reportMarkdown reportProjectMarkdown">
                  <ReactMarkdown components={markdownComponents}>
                    {reportRecord.content}
                  </ReactMarkdown>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    );
  };

  const applyRecommendedQuestion = (nextQuestion: string) => {
    setQuestionText(nextQuestion);
    window.requestAnimationFrame(() => {
      questionInputRef.current?.focus();
    });
  };

  const deleteProject = (projectId: number) => {
    const shouldDelete = window.confirm("确定要删除这个项目吗？");

    if (!shouldDelete) {
      return;
    }

    setProjects((currentProjects) =>
      currentProjects.filter((project) => project.id !== projectId),
    );
    removeScannedFiles(projectId);

    if (selectedProjectId === projectId) {
      closeProjectDetail();
    }

    if (scanningProjectId === projectId) {
      setScanningProjectId(null);
    }
  };

  const handleProjectCardKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    projectId: number,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openProjectDetail(projectId);
    }
  };

  const isSelectedFile = (file: ScannedFile) =>
    file.relative_path === selectedFilePath;

  const normalizedFileSearchQuery = fileSearchQuery.trim().toLowerCase();

  const countSearchMatches = (text: string) => {
    if (!normalizedFileSearchQuery) {
      return 0;
    }

    return text.toLowerCase().split(normalizedFileSearchQuery).length - 1;
  };

  const getFileSearchScore = (file: ScannedFile) => {
    const fileNameMatchCount = countSearchMatches(file.name);
    const contentMatchCount = countSearchMatches(
      selectedProject
        ? fileContentsByPath[
            getFileCacheKey(selectedProject.id, file.relative_path)
          ] ?? ""
        : "",
    );
    let score = 0;

    if (fileNameMatchCount > 0) {
      score += 1000000;
      score += fileNameMatchCount * 100;
    }

    if (contentMatchCount > 0) {
      score += contentMatchCount;
    }

    if (file.name.toLowerCase().includes(normalizedFileSearchQuery)) {
      score += 10000;
    }

    return score;
  };

  const filteredProjectFiles = selectedProjectFiles
    .filter((file) => {
      if (!normalizedFileSearchQuery) {
        return true;
      }

      return getFileSearchScore(file) > 0;
    })
    .sort((currentFile, nextFile) => {
      if (!normalizedFileSearchQuery) {
        return 0;
      }

      return getFileSearchScore(nextFile) - getFileSearchScore(currentFile);
  });

  const answerBlocks = useMemo(() => splitAnswerBlocks(answer), [answer]);
  const shouldShowAnswerGuide =
    !isQuestionLoading &&
    (!selectedProjectHasScanResult || answerBlocks.length === 0);

  const renderDetailEntries = (
    items: DetailItem[],
    blockIndex: number,
    entryKeyPrefix = "detail",
  ) => {
    if (items.length === 0) {
      return <p className="answerEmptyState">👉 当前问题没有更多可展开的信息</p>;
    }

    return (
      <div className="answerDetailsList answerDetailsListSequential">
        {items.map((entry, entryIndex) => {
          const context = resolveAnswerEntryContext(entry);

          return (
            <article
              className="answerDetailsCard"
              key={`${entryKeyPrefix}-${blockIndex}-${entry.sourceLabel}-${entryIndex}`}
            >
              <div className="answerDetailsCardHeader">
                {context.sourceFile ? (
                  <button
                    className="answerEvidenceTitleButton"
                    type="button"
                    title={
                      context.chunkSummary
                        ? `${context.displayLabel} · ${context.chunkSummary}`
                        : context.displayLabel
                    }
                    onClick={() => openAnswerSource(entry)}
                  >
                    {context.displayLabel}
                  </button>
                ) : (
                  <h4>{context.displayLabel}</h4>
                )}
              </div>

              <p className="answerDetailsText">
                {renderAnswerTextWithFunctionLinks(entry.content || "（无内容）")}
              </p>
            </article>
          );
        })}
      </div>
    );
  };

  const renderAnswerBlock = (blockAnswer: string, blockIndex: number) => {
    const parsedBlockAnswer = parseAnswerContent(blockAnswer);
    const isAppendBlock = blockIndex > 0;
    const groupedEvidenceItems = groupAnswerItemsByFile(
      parsedBlockAnswer.evidences,
    );
    const evidenceSnippetLookup = new Map<string, Set<string>>();

    for (const item of parsedBlockAnswer.evidences) {
      const normalizedFileLabel = item.fileLabel.toLowerCase();
      const existingSet = evidenceSnippetLookup.get(normalizedFileLabel) ?? new Set<string>();
      existingSet.add(normalizeAnswerSnippet(item.summary));
      evidenceSnippetLookup.set(normalizedFileLabel, existingSet);
    }

    const filteredDetailItems = parsedBlockAnswer.details.filter((item) => {
      const normalizedFileLabel = item.fileLabel.toLowerCase();
      const evidenceSnippets = evidenceSnippetLookup.get(normalizedFileLabel);

      if (!evidenceSnippets) {
        return true;
      }

      return !evidenceSnippets.has(normalizeAnswerSnippet(item.content));
    });

    if (isAppendBlock) {
      return (
        <section className="answerPanel" key={`answer-block-${blockIndex}`}>
          <article className="answerSummaryCard">
            <div className="answerSectionHeader">
              <div>
                <h3>📖 解释</h3>
                <span>补充的实现说明</span>
              </div>
            </div>
          </article>

          <div className="answerDetailsBody">
            {renderDetailEntries(filteredDetailItems, blockIndex, "append-detail")}
          </div>
        </section>
      );
    }

    return (
      <section className="answerPanel" key={`answer-block-${blockIndex}`}>
        <article className="answerSummaryCard">
          <div className="answerSectionHeader">
            <div>
              <h3>{blockIndex === 0 ? "🧠 结论" : "📖 解释"}</h3>
              <span>
                {blockIndex === 0
                  ? "这段代码在做什么"
                  : "补充的实现说明"}
              </span>
            </div>
          </div>
          <p className="answerSummaryText">
            {renderAnswerTextWithFunctionLinks(
              parsedBlockAnswer.summary || "根据当前提供的内容无法确定",
            )}
          </p>
          <p className="answerTrustNote">基于本地代码生成，可点击查看来源</p>
        </article>

        <section className="answerEvidenceSection">
          <div className="answerSectionHeader">
            <div>
              <h3>📎 依据</h3>
              <span>来自哪些文件</span>
            </div>
          </div>

          {groupedEvidenceItems.length > 0 ? (
            <div className="answerEvidenceList">
              {groupedEvidenceItems.map((section) => {
                const firstEntry = section.items[0];
                const firstContext = resolveAnswerEntryContext(firstEntry);

                return (
                  <article
                    className="answerEvidenceCard"
                    key={`${blockIndex}-${section.fileLabel}`}
                  >
                    <div className="answerEvidenceCardHeader">
                      {firstContext.sourceFile ? (
                        <button
                          className="answerEvidenceTitleButton"
                          type="button"
                          title={
                            firstContext.chunkSummary
                              ? `${firstContext.displayLabel} · ${firstContext.chunkSummary}`
                              : firstContext.displayLabel
                          }
                          onClick={() => openAnswerSource(firstEntry)}
                        >
                          {section.fileLabel}
                        </button>
                      ) : (
                        <h4>{section.fileLabel}</h4>
                      )}
                      <span className="answerEvidenceCount">
                        {section.items.length} 段
                      </span>
                    </div>

                    <div className="answerEvidenceItems">
                      {section.items.map((entry, entryIndex) => {
                        const context = resolveAnswerEntryContext(entry);
                        const fallbackText =
                          context.matchingChunk?.content ?? entry.summary ?? "";
                        const evidenceSummary = buildReadableEvidenceSummary(
                          entry.summary,
                          fallbackText,
                          [lastQuestionFocusKeyword.trim(), ...answerQuestionTerms],
                        );

                        return (
                          <div
                            className="answerEvidenceItem"
                            key={`${blockIndex}-${section.fileLabel}-${entry.sourceLabel}-${entryIndex}`}
                          >
                            <div className="answerEvidenceItemMeta">
                              {context.sourceFile ? (
                                <button
                                  className="answerSourceButton answerSourceButtonCompact"
                                  type="button"
                                  title={
                                    context.chunkSummary
                                      ? `${context.displayLabel} · ${context.chunkSummary}`
                                      : context.displayLabel
                                  }
                                  onClick={() => openAnswerSource(entry)}
                                >
                                  <span className="answerSourceLabel">
                                    {context.displayLabel}
                                  </span>
                                  {context.chunkSummary ? (
                                    <span className="answerSourceSummary">
                                      {context.chunkSummary}
                                    </span>
                                  ) : null}
                                </button>
                              ) : (
                                <span className="answerSourceLabel">
                                  {context.displayLabel}
                                </span>
                              )}
                            </div>

                            <p className="answerEvidenceSummary">
                              {renderAnswerTextWithFunctionLinks(evidenceSummary)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>

        <details
          className="answerDetails"
          open={isAnswerDetailsExpanded}
          onToggle={(event) => setIsAnswerDetailsExpanded(event.currentTarget.open)}
        >
          <summary className="answerDetailsSummary">📖 解释</summary>

          <div className="answerDetailsBody">
            {renderDetailEntries(filteredDetailItems, blockIndex)}
          </div>
        </details>
      </section>
    );
  };
  const currentPreviewChunk = useMemo(() => {
    if (!selectedFile || !isCodeFile(selectedFile.name)) {
      return null;
    }

    if (!selectedFileContent.trim()) {
      return null;
    }

    return deriveCodePreviewChunk(
      selectedFile.name,
      selectedFileContent,
      previewSearchKeyword,
    );
  }, [
    previewSearchKeyword,
    selectedFile,
    selectedFileContent,
  ]);

  function summarizeFileContent(content: string) {
    const singleLineContent = content.replace(/\s+/g, " ").trim();

    if (!singleLineContent) {
      return "文件内容为空";
    }

    const previewText = singleLineContent.slice(0, 160);

    return singleLineContent.length > 160 ? `${previewText}...` : previewText;
  }

  function getContentMatchPreviews(content: string) {
    const query = fileSearchQuery.trim();

    if (!query) {
      return [];
    }

    const singleLineContent = content.replace(/\s+/g, " ").trim();
    const lowerContent = singleLineContent.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const previews: string[] = [];
    const previewRadius = 40;
    let searchIndex = 0;
    let lastPreviewEnd = -1;

    while (previews.length < 3) {
      const matchIndex = lowerContent.indexOf(lowerQuery, searchIndex);

      if (matchIndex === -1) {
        break;
      }

      const previewStart = Math.max(0, matchIndex - previewRadius);
      const previewEnd = Math.min(
        singleLineContent.length,
        matchIndex + query.length + previewRadius,
      );

      if (previewStart > lastPreviewEnd) {
        const prefix = previewStart > 0 ? "..." : "";
        const suffix = previewEnd < singleLineContent.length ? "..." : "";

        previews.push(
          `${prefix}${singleLineContent.slice(previewStart, previewEnd)}${suffix}`,
        );
        lastPreviewEnd = previewEnd;
      }

      searchIndex = matchIndex + lowerQuery.length;
    }

    return previews;
  }

  function getFileSummaryTexts(file: ScannedFile) {
    if (!selectedProject) {
      return ["点击文件后生成摘要"];
    }

    const fileCacheKey = getFileCacheKey(selectedProject.id, file.relative_path);
    const contentMatchPreviews = getContentMatchPreviews(
      fileContentsByPath[fileCacheKey] ?? "",
    );

    return contentMatchPreviews.length > 0
      ? contentMatchPreviews
      : [fileSummariesByPath[fileCacheKey] || "点击文件后生成摘要"];
  }

  function renderHighlightedText(text: string) {
    const query = fileSearchQuery.trim();

    if (!query) {
      return text;
    }

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const parts = [];
    let currentIndex = 0;
    let matchIndex = lowerText.indexOf(lowerQuery);

    while (matchIndex !== -1) {
      if (matchIndex > currentIndex) {
        parts.push(text.slice(currentIndex, matchIndex));
      }

      parts.push(
        <mark className="searchHighlight" key={`${matchIndex}-${parts.length}`}>
          {text.slice(matchIndex, matchIndex + query.length)}
        </mark>,
      );

      currentIndex = matchIndex + query.length;
      matchIndex = lowerText.indexOf(lowerQuery, currentIndex);
    }

    if (currentIndex < text.length) {
      parts.push(text.slice(currentIndex));
    }

    return parts;
  }

  const isProjectsSection = activeSection === "projects";
  const isReportsSection = activeSection === "reports";
  const isSettingsSection = activeSection === "settings";

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandIcon">L</div>
          <div>
            <h1>Local Project Memory</h1>
            <p>本地项目记忆助手</p>
          </div>
        </div>

        <nav className="nav">
          <button
            className={`navItem${isProjectsSection ? " active" : ""}`}
            type="button"
            onClick={() => setActiveSection("projects")}
          >
            项目
          </button>
          <button
            className={`navItem${isReportsSection ? " active" : ""}`}
            type="button"
            onClick={() => setActiveSection("reports")}
          >
            报告
          </button>
          <button
            className={`navItem${isSettingsSection ? " active" : ""}`}
            type="button"
            onClick={() => setActiveSection("settings")}
          >
            设置
          </button>
        </nav>
      </aside>

      <section className="content">
        {isSettingsSection ? (
          <section className="settingsPage">
            <header className="pageHeader">
              <div>
                <h2>设置</h2>
                <p>MiMo Key 会优先从钥匙串读取，环境变量作为后备。</p>
              </div>
            </header>

            <section className="settingsGrid">
              <div className="detailPanel">
                <div className="detailPanelHeader">
                  <div>
                    <h3>本地 API Key</h3>
                    <span>轻量模式：保存到当前浏览器本地存储。</span>
                  </div>
                </div>

                <div className="settingsField">
                  <label htmlFor="local-api-key-input">API Key</label>
                  <input
                    id="local-api-key-input"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="请输入你的 API Key"
                    autoComplete="off"
                  />
                </div>

                <div className="settingsActions">
                  <button
                    className="primaryButton"
                    type="button"
                    onClick={saveLocalApiKey}
                  >
                    保存
                  </button>
                </div>

                {apiKeyMessage ? (
                  <p className="settingsSuccess">{apiKeyMessage}</p>
                ) : null}

                <p className="settingsHint">
                  提问时会优先读取这里保存的 Key。
                </p>
              </div>

              <div className="detailPanel">
                <div className="detailPanelHeader">
                  <div>
                    <h3>当前状态</h3>
                    <span>优先级：钥匙串 → 环境变量</span>
                  </div>
                </div>

                <div className="settingsStatusGrid">
                  <div className="settingsStatusCard">
                    <span>当前生效来源</span>
                    <strong>{mimoKeyStatus?.active_source || "未检测"}</strong>
                  </div>
                  <div className="settingsStatusCard">
                    <span>钥匙串</span>
                    <strong>
                      {mimoKeyStatus?.has_keychain_key ? "已保存" : "未保存"}
                    </strong>
                  </div>
                  <div className="settingsStatusCard">
                    <span>环境变量</span>
                    <strong>{mimoKeyStatus?.has_env_key ? "已配置" : "未配置"}</strong>
                  </div>
                </div>

                {mimoSettingsLoading ? (
                  <p className="settingsHint">正在检测当前配置...</p>
                ) : null}
                {mimoSettingsError ? <p className="formError">{mimoSettingsError}</p> : null}
                {mimoSettingsMessage ? (
                  <p className="settingsSuccess">{mimoSettingsMessage}</p>
                ) : null}
              </div>

              <div className="detailPanel">
                <div className="detailPanelHeader">
                  <div>
                    <h3>保存到钥匙串</h3>
                    <span>适合以后直接在本机使用，不依赖浏览器里的环境变量。</span>
                  </div>
                </div>

                <div className="settingsField">
                  <label htmlFor="mimo-api-key-input">MiMo API Key</label>
                  <input
                    id="mimo-api-key-input"
                    type="password"
                    value={mimoApiKey}
                    onChange={(event) => setMimoApiKey(event.target.value)}
                    placeholder="粘贴你的 MiMo API Key"
                    autoComplete="off"
                  />
                </div>

                <div className="settingsActions">
                  <button
                    className="primaryButton"
                    type="button"
                    onClick={() => void saveMimoApiKey()}
                    disabled={mimoSettingsSaving}
                  >
                    {mimoSettingsSaving ? "保存中..." : "保存到钥匙串"}
                  </button>
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => void migrateMimoApiKey()}
                    disabled={mimoSettingsMigrating || !mimoKeyStatus?.has_env_key}
                  >
                    {mimoSettingsMigrating
                      ? "迁移中..."
                      : "从环境变量迁移到钥匙串"}
                  </button>
                </div>

                <p className="settingsHint">
                  保存后，应用会优先读取钥匙串里的 Key；如果没有，再回退到 `src-tauri/.env.local`。
                </p>
              </div>
            </section>
          </section>
        ) : isReportsSection ? (
          projects.length > 0 ? (
            <section className="reportPage">
              <div className="pageHeader">
                <div>
                  <h2>报告页</h2>
                  <p>在这里切换项目报告和周报入口，按项目统一管理。</p>
                </div>
              </div>
              <div className="reportPageToolbar">
                <div className="reportPageTabs" role="tablist" aria-label="报告页入口切换">
                  <button
                    className={`reportPageTab${reportBoardMode === "project" ? " active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={reportBoardMode === "project"}
                    onClick={() => setReportBoardMode("project")}
                  >
                    项目报告
                  </button>
                  <button
                    className={`reportPageTab${reportBoardMode === "weekly" ? " active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={reportBoardMode === "weekly"}
                    onClick={() => setReportBoardMode("weekly")}
                  >
                    周报
                  </button>
                </div>
                <p className="reportPageHint">
                  {reportBoardMode === "project"
                    ? "项目报告更适合看整体总结和关键依据。"
                    : "周报更适合看近期变化、活动集中点和下一步建议。"}
                </p>
              </div>
              {renderReportsList(reportBoardMode)}
            </section>
          ) : (
            <section className="emptyState">
              <div className="emptyIcon">📊</div>
              <h3>报告页还在路上</h3>
              <p>
                现在可以先创建一个项目，之后就能在这里按项目查看报告。
              </p>
            </section>
          )
        ) : selectedProject ? (
          <section className="projectDetail">
            <header className="detailHeader">
              <button
                className="secondaryButton"
                type="button"
                onClick={closeProjectDetail}
              >
                ← 返回项目列表
              </button>

              <div className="detailHeaderMain">
                <div>
                  <h2>{selectedProject.name}</h2>
                  <p>{selectedProject.description || "暂无项目描述"}</p>
                </div>

                <div className="detailHeaderActions">
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => void scanProjectFiles(selectedProject)}
                    disabled={scanningProjectId === selectedProject.id}
                  >
                    {scanningProjectId === selectedProject.id
                      ? "扫描中..."
                      : "扫描文件"}
                  </button>
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() =>
                      setIsProjectTimelineExpanded((current) => !current)
                    }
                  >
                    {isProjectTimelineExpanded
                      ? "收起时间线"
                      : "时间线"}
                  </button>
                  <button
                    className="dangerButton"
                    type="button"
                    onClick={() => deleteProject(selectedProject.id)}
                  >
                    删除项目
                  </button>
                </div>
              </div>
            </header>

            <section className="detailSummary">
              <div className="detailStat detailStatusBar">
                <strong>
                  已加载 {selectedProjectFiles.length} 个文件 · 当前项目：
                  {selectedProject.name}
                </strong>
                <span>{selectedProject.path}</span>
              </div>
            </section>

            {renderProjectInsightEntryBoard()}

            {renderProjectTimelinePanel()}

            <div className="questionBox">
              <input
                ref={questionInputRef}
                aria-label="提问内容"
                placeholder={QUESTION_PLACEHOLDERS[questionPlaceholderIndex]}
                value={questionText}
                onChange={(event) => setQuestionText(event.target.value)}
              />
              <button
                className="primaryButton"
                type="button"
                onClick={() => void submitQuestion()}
                disabled={isQuestionLoading}
              >
                {isQuestionLoading ? "提问中..." : "提问"}
              </button>
              {isQuestionLoading ? (
                <div className="answerLoadingCard">
                  <div className="answerLoadingPulse" />
                  <div>
                    <strong>
                      {questionLoadingStage === 0
                        ? "正在分析项目结构…"
                        : questionLoadingStage === 1
                          ? "正在查找相关代码…"
                          : "正在生成回答…"}
                    </strong>
                    <p>
                      {questionLoadingStage === 0
                        ? "我们会先整理当前项目的文件和上下文。"
                        : questionLoadingStage === 1
                          ? "正在从相关文件里找出最匹配的内容。"
                        : "马上把结论、依据和解释整理给你。"}
                    </p>
                  </div>
                </div>
              ) : shouldShowAnswerGuide ? (
                <section className="answerEmptyGuide">
                  <div className="answerEmptyGuideBody">
                    <h3>这个项目还没有被理解</h3>
                    <p>
                      {selectedProjectHasScanResult
                        ? "项目内容已经准备好，你可以直接点下面的问题开始。"
                        : "我可以帮你一步步看懂这个项目"}
                    </p>

                    {!selectedProjectHasScanResult ? (
                      <div className="answerEmptyGuideTips">
                        <span>先点击「扫描文件」</span>
                      </div>
                    ) : null}
                    {selectedProjectHasScanResult ? (
                      <div className="answerSuggestionsInline">
                        <div className="answerSectionHeader">
                          <div>
                            <span>（点一下，自动填入输入框）</span>
                          </div>
                        </div>

                        <div className="answerSuggestionList">
                          {EMPTY_STATE_QUESTIONS.map((item) => (
                            <button
                              key={item}
                              className="answerSuggestionButton"
                              type="button"
                              onClick={() => applyRecommendedQuestion(item)}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {!selectedProjectHasScanResult ? (
                    <div className="answerSuggestions answerSuggestionsStatic">
                      <div className="answerSectionHeader">
                        <div>
                          <h3>或者你可以从这里开始</h3>
                          <span>点一下，自动填入输入框</span>
                        </div>
                      </div>

                      <div className="answerSuggestionList">
                        {EMPTY_STATE_QUESTIONS.map((item) => (
                          <button
                            key={item}
                            className="answerSuggestionButton"
                            type="button"
                            onClick={() => applyRecommendedQuestion(item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : answerBlocks.length > 0 ? (
                <div className="answerPanelStack">
                  {answerBlocks.map((block, blockIndex) =>
                    renderAnswerBlock(block, blockIndex),
                  )}

                  <section className="answerSuggestions">
                    <div className="answerSectionHeader">
                      <div>
                        <h3>继续看看</h3>
                        <span>点一下，自动填入输入框</span>
                      </div>
                    </div>

                    <div className="answerSuggestionList">
                      {FOLLOW_UP_QUESTIONS.map((item) => (
                        <button
                          key={item}
                          className="answerSuggestionButton"
                          type="button"
                          onClick={() => applyRecommendedQuestion(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              ) : null}
            </div>

            {renderProgressAnalysisPanel()}

            {renderWeeklyReportPanel()}

            {renderReportPanel()}

            <section className="detailWorkspace">
              <section className="detailPanel">
                <div className="detailPanelHeader">
                  <div>
                    <h3>文件列表</h3>
                    <span>
                      仅扫描 `.md`、`.txt`、`.ts`、`.tsx`、`.js`、`.jsx`、`.json`、
                      `.py`
                    </span>
                  </div>
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => void scanProjectFiles(selectedProject)}
                    disabled={scanningProjectId === selectedProject.id}
                  >
                    {scanningProjectId === selectedProject.id
                      ? "扫描中..."
                      : "重新扫描"}
                  </button>
                </div>

                {scanError && <p className="formError">{scanError}</p>}

                <div style={{ marginBottom: 12 }}>
                  <input
                    aria-label="搜索文件"
                    placeholder="搜索文件名"
                    value={fileSearchQuery}
                    onChange={(event) => setFileSearchQuery(event.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #d1d5db",
                      fontSize: 14,
                    }}
                  />
                </div>

                {selectedProjectFiles.length === 0 ? (
                  <div className="detailEmptyState">
                    <div className="emptyIcon">🗂️</div>
                    <h3>
                      {selectedProjectHasScanResult
                        ? "未找到匹配文件"
                        : "还没有扫描结果"}
                    </h3>
                    <p>
                      {selectedProjectHasScanResult
                        ? "目录里没有符合扫描条件的文件。你可以再扫描一次，或检查目录路径。"
                        : "点击“扫描文件”读取项目目录中的代码和文档文件。"}
                    </p>
                    <button
                      className="primaryButton"
                      type="button"
                      onClick={() => void scanProjectFiles(selectedProject)}
                      disabled={scanningProjectId === selectedProject.id}
                    >
                      {scanningProjectId === selectedProject.id
                        ? "扫描中..."
                        : "开始扫描"}
                    </button>
                  </div>
                ) : filteredProjectFiles.length === 0 ? (
                  <div className="detailEmptyState">
                    <div className="emptyIcon">🔎</div>
                    <h3>未找到匹配文件</h3>
                    <p>试试换个关键词，或者清空搜索框查看全部文件。</p>
                  </div>
                ) : (
                  <div className="fileList" role="list">
                    <div className="fileListHeader">
                      <span>文件名</span>
                      <span>相对路径</span>
                      <span>文件大小</span>
                    </div>

                    {filteredProjectFiles.map((file) => {
                      const fileSummaryTexts = getFileSummaryTexts(file);

                      return (
                        <button
                          className={`fileRow fileRowButton${
                            isSelectedFile(file) ? " active" : ""
                          }`}
                          key={file.relative_path}
                          type="button"
                          onClick={() => void openFilePreview(file)}
                        >
                          <div className="fileNameBlock">
                            <span className="fileName" title={file.name}>
                              {renderHighlightedText(file.name)}
                            </span>
                            <span
                              className="fileSummary"
                              title={fileSummaryTexts.join("\n")}
                            >
                              {fileSummaryTexts.map((fileSummaryText) => (
                                <span
                                  className="fileSummaryLine"
                                  key={fileSummaryText}
                                >
                                  {renderHighlightedText(fileSummaryText)}
                                </span>
                              ))}
                            </span>
                          </div>
                          <code
                            className="fileRelativePath"
                            title={file.relative_path}
                          >
                            {file.relative_path}
                          </code>
                          <span className="fileSize">
                            {formatFileSize(file.size)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="detailPanel detailPreviewPanel">
                <div className="detailPanelHeader">
                  <div>
                    <h3>文件内容</h3>
                    <span>
                      点击左侧文件后在这里查看内容，支持切换文件即时更新
                    </span>
                  </div>
                </div>

                {!selectedFile ? (
                  <div className="detailEmptyState">
                    <div className="emptyIcon">📄</div>
                    <h3>尚未选择文件</h3>
                    <p>
                      在左侧文件列表中点一个文件，我们会在这里展示它的内容。
                    </p>
                  </div>
                ) : (
                  <div className="filePreview">
                    <div className="filePreviewMeta">
                      <div>
                        <h4 title={selectedFile.name}>{selectedFile.name}</h4>
                        <p title={selectedFile.relative_path}>
                          {selectedFile.relative_path}
                        </p>
                      </div>
                      <span>{formatFileSize(selectedFile.size)}</span>
                    </div>

                    {currentPreviewChunk?.calls?.length ? (
                      <section className="codeChunkRelations">
                        <div className="codeChunkInfoLine">
                          <span className="codeChunkInfoLabel">函数：</span>
                          <span className="codeChunkInfoValue">
                            {currentPreviewChunk.name || "unknown"}
                          </span>
                          <span className="codeChunkInfoTag">
                            {currentPreviewChunk.type}
                          </span>
                          <span className="codeChunkInfoTag">
                            {currentPreviewChunk.language}
                          </span>
                        </div>

                        <div className="codeChunkCallLine">
                          <span className="codeChunkInfoLabel">调用：</span>
                          <div className="codeChunkCallChips">
                            {currentPreviewChunk.calls.slice(0, 8).map(
                              (call, callIndex) => (
                                <span
                                  className="codeChunkCallItem"
                                  key={`${currentPreviewChunk.name}-${call.name}`}
                                >
                                  {callIndex > 0 ? (
                                    <span className="codeChunkCallArrow">→</span>
                                  ) : null}
                                  <button
                                    className={`codeChunkCallChip${call.inSameFile ? "" : " codeChunkCallChipCrossFile"}`}
                                    type="button"
                                    onClick={() => void openCallTarget(call)}
                                    title={`跳转到 ${call.name}`}
                                  >
                                    <span className="codeChunkCallChipText">
                                      {call.name}
                                    </span>
                                    {call.inSameFile ? null : (
                                      <span className="codeChunkCallBadge">
                                        跨文件
                                      </span>
                                    )}
                                  </button>
                                </span>
                              ),
                            )}
                          </div>
                        </div>
                      </section>
                    ) : null}

                    {loadingFilePath === selectedFile.relative_path ? (
                      <div className="detailEmptyState detailPreviewLoading">
                        <div className="emptyIcon">⏳</div>
                        <h3>正在读取内容</h3>
                        <p>请稍等，马上就好。</p>
                      </div>
                    ) : selectedFileError ? (
                      <div className="detailEmptyState detailPreviewError">
                        <div className="emptyIcon">⚠️</div>
                        <h3>无法展示文件</h3>
                        <p>{selectedFileError}</p>
                      </div>
                    ) : isMarkdownFile(selectedFile.name) ? (
                      <div
                        className="fileContent"
                        ref={(element) => {
                          previewContentRef.current = element;
                        }}
                        style={markdownPreviewStyle}
                      >
                        <ReactMarkdown components={markdownComponents}>
                          {selectedFileContent || "文件内容为空"}
                        </ReactMarkdown>
                      </div>
                    ) : isCodeFile(selectedFile.name) ? (
                      <pre
                        className="fileContent hljs"
                        ref={(element) => {
                          previewContentRef.current = element;
                        }}
                        aria-label="文件内容"
                        dangerouslySetInnerHTML={{
                          __html: highlightCode(
                            selectedFile.name,
                            selectedFileContent,
                          ),
                        }}
                      />
                    ) : (
                      <pre
                        className="fileContent"
                        ref={(element) => {
                          previewContentRef.current = element;
                        }}
                        aria-label="文件内容"
                      >
                        {selectedFileContent || "文件内容为空"}
                      </pre>
                    )}
                  </div>
                )}
              </section>
            </section>
          </section>
        ) : (
          <>
            <header className="pageHeader">
              <div>
                <h2>项目列表</h2>
                <p>创建一个项目，让 AI 读取本地资料、回答问题并生成周报。</p>
              </div>

              <button className="primaryButton" onClick={openCreateModal}>
                新建项目
              </button>
            </header>

            {projects.length === 0 ? (
              <section className="emptyState">
                <div className="emptyIcon">📁</div>
                <h3>还没有项目</h3>
                <p>
                  点击“新建项目”，选择一个本地文件夹开始建立项目记忆。
                </p>
                <button className="primaryButton" onClick={openCreateModal}>
                  创建第一个项目
                </button>
              </section>
            ) : (
              <section className="projectGrid" aria-label="项目列表">
                {projects.map((project) => {
                  const scannedCount = projectFilesById[project.id]?.length ?? 0;
                  const hasScanResult = Object.prototype.hasOwnProperty.call(
                    projectFilesById,
                    project.id,
                  );

                  return (
                    <article
                      className="projectCard"
                      key={project.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openProjectDetail(project.id)}
                      onKeyDown={(event) =>
                        handleProjectCardKeyDown(event, project.id)
                      }
                    >
                      <div className="projectCardHeader">
                        <div className="projectAvatar">
                          {project.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <h3>{project.name}</h3>
                          <p>{project.description || "暂无项目描述"}</p>
                        </div>
                      </div>

                      <div className="projectPath">
                        <span>本地路径</span>
                        <code>{project.path}</code>
                      </div>

                      <div className="projectCardMeta">
                        <span>
                          {hasScanResult
                            ? scannedCount > 0
                              ? `已扫描 ${scannedCount} 个文件`
                              : "扫描完成，未找到匹配文件"
                            : "尚未扫描文件"}
                        </span>
                      </div>

                      <div className="projectCardActions">
                        <button
                          className="secondaryButton"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void scanProjectFiles(project);
                          }}
                          disabled={scanningProjectId === project.id}
                        >
                          {scanningProjectId === project.id
                            ? "扫描中..."
                            : "扫描文件"}
                        </button>
                        <button
                          className="dangerButton"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteProject(project.id);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </>
        )}
      </section>

      {isCreateModalOpen && (
        <div className="modalOverlay" role="presentation">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-title"
          >
            <header className="modalHeader">
              <div>
                <h2 id="create-project-title">新建项目</h2>
                <p>先记录项目信息，后续再接入本地索引和记忆能力。</p>
              </div>
              <button
                className="iconButton"
                onClick={closeCreateModal}
                aria-label="关闭弹窗"
              >
                ×
              </button>
            </header>

            <form className="projectForm" onSubmit={createProject}>
              <label>
                <span>项目名称</span>
                <input
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                  placeholder="例如：Local Project Memory"
                />
              </label>

              <label>
                <span>本地路径</span>
                <div className="pathInputRow">
                  <input
                    value={form.path}
                    onChange={(event) => updateForm("path", event.target.value)}
                    placeholder="/Users/mike/Desktop/my-project"
                  />
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={selectProjectFolder}
                  >
                    选择文件夹
                  </button>
                </div>
              </label>

              <label>
                <span>项目描述</span>
                <textarea
                  value={form.description}
                  onChange={(event) =>
                    updateForm("description", event.target.value)
                  }
                  placeholder="补充这个项目的用途、资料范围或团队背景"
                  rows={4}
                />
              </label>

              {errorMessage && <p className="formError">{errorMessage}</p>}

              <div className="modalActions">
                <button
                  className="secondaryButton"
                  type="button"
                  onClick={closeCreateModal}
                >
                  取消
                </button>
                <button className="primaryButton" type="submit">
                  创建项目
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
