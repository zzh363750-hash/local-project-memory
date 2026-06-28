import type { ProjectTimelineEntry } from "./projectTimeline";
import type { ProjectFacts } from "./projectAnalyzer";
import { formatProjectFactsForPrompt } from "./projectAnalyzer";

type WeeklyReportFile = {
  name: string;
  relative_path: string;
  size: number;
  modified_time: number;
};

type WeeklyReportSource = {
  projectFacts: ProjectFacts;
  reportContent: string;
  progressAnalysisContent: string;
  timelineEntries: ProjectTimelineEntry[];
  fileContext: string;
  timeframeNote: string;
};

const weeklyDocumentationNames = new Set([
  "readme",
  "readme_cn",
  "changelog",
  "changes",
  "prd",
  "requirements",
  "overview",
  "architecture",
  "roadmap",
]);

const weeklyDocumentationSegments = new Set([
  "docs",
  "doc",
  "wiki",
  "design",
  "spec",
  "specs",
  "requirements",
  "guide",
  "guides",
  "manual",
  "notes",
]);

const weeklyConfigExactNames = new Set([
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
  "dockerfile",
  "makefile",
]);

const weeklyConfigExtensions = new Set([
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "ini",
  "env",
  "conf",
  "cfg",
]);

const weeklySourceExtensions = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "java",
  "go",
  "rs",
  "cpp",
  "cc",
  "cxx",
  "c",
  "h",
  "hpp",
  "swift",
  "kt",
  "kts",
  "rb",
  "php",
  "mdx",
]);

const weeklyIgnoredSegments = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".vite",
  ".cache",
  ".turbo",
  ".fastembed_cache",
]);

const weeklyContextCategoryLabels = {
  documentation: "项目说明文件",
  config: "配置文件",
  source: "核心源码文件",
  other: "补充文件",
} as const;

type WeeklyContextCategory = keyof typeof weeklyContextCategoryLabels;

export type WeeklyReportInput = {
  projectName: string;
  projectPath: string;
  files: WeeklyReportFile[];
  projectFacts: ProjectFacts;
  reportContent?: string;
  progressAnalysisContent?: string;
  timelineEntries?: ProjectTimelineEntry[];
  fileContentsByPath: Record<string, string>;
  getFileCacheKey: (projectId: number, relativePath: string) => string;
  projectId: number;
};

function getFileStem(name: string) {
  const lowerName = name.toLowerCase();
  const lastDot = lowerName.lastIndexOf(".");

  if (lastDot <= 0) {
    return lowerName;
  }

  return lowerName.slice(0, lastDot);
}

function getFileExtension(name: string) {
  const lowerName = name.toLowerCase();
  const lastDot = lowerName.lastIndexOf(".");

  if (lastDot <= 0) {
    return "";
  }

  return lowerName.slice(lastDot + 1);
}

function getPathSegments(relativePath: string) {
  return relativePath
    .split(/[\\/]+/)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
}

function shouldIgnoreWeeklyFile(relativePath: string) {
  return getPathSegments(relativePath).some((segment) =>
    weeklyIgnoredSegments.has(segment),
  );
}

function classifyWeeklyFile(file: WeeklyReportFile): WeeklyContextCategory {
  const lowerName = file.name.toLowerCase();
  const fileStem = getFileStem(file.name);
  const extension = getFileExtension(file.name);
  const pathSegments = getPathSegments(file.relative_path);

  if (
    weeklyDocumentationNames.has(fileStem) ||
    lowerName.startsWith("readme") ||
    lowerName.startsWith("changelog") ||
    weeklyDocumentationSegments.has(fileStem) ||
    pathSegments.some((segment) => weeklyDocumentationSegments.has(segment))
  ) {
    return "documentation";
  }

  if (
    weeklyConfigExactNames.has(lowerName) ||
    weeklyConfigExactNames.has(fileStem) ||
    weeklyConfigExtensions.has(extension) ||
    pathSegments.some((segment) =>
      /(^|[-_.])(config|configs|configuration|settings|setting|manifest|manifests|env|envs)([-_.]|$)/.test(
        segment,
      ),
    )
  ) {
    return "config";
  }

  if (
    weeklySourceExtensions.has(extension) ||
    pathSegments.some((segment) =>
      [
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
      ].includes(segment),
    )
  ) {
    return "source";
  }

  return "other";
}

function getFileCacheContent(
  projectId: number,
  file: WeeklyReportFile,
  fileContentsByPath: Record<string, string>,
  getFileCacheKey: (projectId: number, relativePath: string) => string,
) {
  const cacheKey = getFileCacheKey(projectId, file.relative_path);
  return fileContentsByPath[cacheKey] ?? "";
}

function truncateContent(content: string, limit: number) {
  const normalized = content.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return "";
  }

  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function getReadableExcerpt(content: string, limit = 900) {
  const normalized = content.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return "";
  }

  const firstParagraph = normalized.split(/\n{2,}/)[0].trim();
  const firstLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");

  const candidate = firstParagraph.length >= 120 ? firstParagraph : firstLines;
  return truncateContent(candidate || normalized, limit);
}

function summarizeTimeline(entries: ProjectTimelineEntry[]) {
  if (entries.length === 0) {
    return "暂无时间线数据";
  }

  const recentEntries = entries.slice(0, 5);

  return recentEntries
    .map((entry) => {
      const representativeFiles = entry.representativeFiles
        .slice(0, 5)
        .map((file) => file.relative_path)
        .join("、");

      return [
        `日期：${entry.date}`,
        `活动类型：${entry.activityType}`,
        `修改文件数：${entry.modifiedCount}`,
        `主要涉及：${representativeFiles || "暂无代表性文件"}`,
      ].join("\n");
    })
    .join("\n\n");
}

function selectWeeklyFiles(files: WeeklyReportFile[]) {
  const filtered = files.filter(
    (file) => !shouldIgnoreWeeklyFile(file.relative_path),
  );

  const ranked = filtered
    .map((file) => {
      const category = classifyWeeklyFile(file);
      const fileStem = getFileStem(file.name);
      const lowerName = file.name.toLowerCase();
      const pathSegments = getPathSegments(file.relative_path);
      let score = 0;

      if (category === "documentation") {
        score += 300;
        if (lowerName.startsWith("readme")) score += 120;
        if (weeklyDocumentationNames.has(fileStem)) score += 80;
      } else if (category === "config") {
        score += 220;
        if (weeklyConfigExactNames.has(lowerName)) score += 120;
        if (lowerName.includes("lock")) score -= 80;
      } else if (category === "source") {
        score += 160;
        if (pathSegments.some((segment) => segment === "src" || segment === "app")) {
          score += 100;
        }
      } else {
        score += 40;
      }

      score -= Math.min(file.relative_path.split(/[\\/]+/).length * 3, 30);
      score -= Math.min(Math.floor(file.size / 4096), 20);

      return {
        ...file,
        category,
        score,
      };
    })
    .sort((current, next) => {
      if (next.score !== current.score) {
        return next.score - current.score;
      }

      const categoryOrder: Record<WeeklyContextCategory, number> = {
        documentation: 0,
        config: 1,
        source: 2,
        other: 3,
      };

      if (current.category !== next.category) {
        return categoryOrder[current.category] - categoryOrder[next.category];
      }

      return current.relative_path.localeCompare(next.relative_path);
    });

  const selected: Array<(typeof ranked)[number]> = [];
  const selectedPaths = new Set<string>();
  const categoryLimit: Record<WeeklyContextCategory, number> = {
    documentation: 4,
    config: 3,
    source: 4,
    other: 2,
  };

  for (const category of ["documentation", "config", "source", "other"] as const) {
    let count = 0;

    for (const file of ranked) {
      if (file.category !== category || selectedPaths.has(file.relative_path)) {
        continue;
      }

      selected.push(file);
      selectedPaths.add(file.relative_path);
      count += 1;

      if (count >= categoryLimit[category]) {
        break;
      }
    }
  }

  for (const file of ranked) {
    if (selectedPaths.has(file.relative_path)) {
      continue;
    }

    selected.push(file);
    selectedPaths.add(file.relative_path);

    if (selected.length >= 10) {
      break;
    }
  }

  return selected.slice(0, 10);
}

function buildFileContext(
  projectId: number,
  files: WeeklyReportFile[],
  fileContentsByPath: Record<string, string>,
  getFileCacheKey: (projectId: number, relativePath: string) => string,
) {
  const selectedFiles = selectWeeklyFiles(files);

  if (selectedFiles.length === 0) {
    return "暂无已加载的项目文件内容";
  }

  const blocks: string[] = [];
  let totalLength = 0;

  for (const file of selectedFiles) {
    const content = getFileCacheContent(
      projectId,
      file,
      fileContentsByPath,
      getFileCacheKey,
    );
    const excerpt = getReadableExcerpt(content, 1000);

    if (!excerpt) {
      continue;
    }

    const block = `【文件：${file.relative_path}｜类别：${weeklyContextCategoryLabels[classifyWeeklyFile(file)]}】\n${excerpt}`;
    const separatorLength = blocks.length > 0 ? 2 : 0;
    const availableLength = 9000 - totalLength - separatorLength;

    if (availableLength <= 0) {
      break;
    }

    const boundedBlock =
      block.length > availableLength
        ? `${block.slice(0, availableLength)}...`
        : block;

    blocks.push(boundedBlock);
    totalLength += boundedBlock.length + separatorLength;
  }

  return blocks.join("\n\n") || "暂无已加载的项目文件内容";
}

export function buildWeeklyReportInput(
  input: WeeklyReportInput,
): WeeklyReportSource {
  const reportContent = input.reportContent?.trim() || "";
  const progressAnalysisContent = input.progressAnalysisContent?.trim() || "";
  const fileContext = buildFileContext(
    input.projectId,
    input.files,
    input.fileContentsByPath,
    input.getFileCacheKey,
  );

  return {
    projectFacts: input.projectFacts,
    reportContent,
    progressAnalysisContent,
    timelineEntries: input.timelineEntries ?? [],
    fileContext,
    timeframeNote: "当前周报基于已扫描项目内容生成，未包含精确时间范围。",
  };
}

export function buildWeeklyReportPromptFromInput(input: WeeklyReportSource) {
  return `你是一名资深项目分析师。

请根据提供的项目上下文生成一份“项目周报”。

输出必须是 Markdown，并严格包含以下标题：

# 本周完成

列出能够从项目内容中确认的进展。

# 当前进展

简要说明项目当前状态。

# 最近活动

基于 Timeline 总结最近活跃区域。

# 存在问题

列出可观察到的缺口。

# 下周计划建议

最多 3 条。每条包含：
- 建议
- 依据
- 预期价值

# 风险提醒

列出信息不足、测试不足、文档不足、结构不清晰等风险。

要求：
1. 只基于提供的文件、项目报告、项目时间线和进展分析回答。
2. 不要编造具体日期。
3. 不要假设项目使用任何特定技术栈。
4. 不要编造没有证据的功能、路线或商业目标。
5. 本周完成只包含可确认内容；最近活动基于 Timeline；下周建议必须有依据。
6. 如果无法确认时间范围，必须明确写出：“当前周报基于已扫描项目内容生成，未包含精确时间范围。”

以下 ProjectFacts 是程序基于文件结构提取的事实，可信度高于模型推断。
如果 ProjectFacts 没有提供某项证据，请回答“当前无法确认”，不要自行推断。
value 为 null 或空数组表示当前扫描结果无法确认，不要把无法确认写成不存在。
不要根据文件名强行推断业务目标。

【ProjectFacts】
${formatProjectFactsForPrompt(input.projectFacts)}

【项目报告】
${input.reportContent || "暂无项目报告"}

【进展分析】
${input.progressAnalysisContent || "暂无进展分析"}

【项目时间线】
${input.timelineEntries.length > 0 ? summarizeTimeline(input.timelineEntries) : "暂无时间线数据"}

【项目文件内容】
${input.fileContext}

【时间范围说明】
${input.timeframeNote}`;
}
