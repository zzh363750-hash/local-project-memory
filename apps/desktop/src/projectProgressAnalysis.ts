import type { ProjectTimelineEntry } from "./projectTimeline";
import type { ProjectFacts } from "./projectAnalyzer";
import { formatProjectFactsForPrompt } from "./projectAnalyzer";

type ProgressAnalysisFile = {
  name: string;
  relative_path: string;
  size: number;
  modified_time: number;
};

type ProgressAnalysisReportSource = {
  projectFacts: ProjectFacts;
  reportContent: string;
  timelineEntries: ProjectTimelineEntry[];
  fileContext: string;
};

const progressDocumentationNames = new Set([
  "readme",
  "readme_cn",
  "changelog",
  "changes",
  "prd",
  "requirements",
]);

const progressDocumentationSegments = new Set([
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

const progressConfigExactNames = new Set([
  "package.json",
  "cargo.toml",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
  "requirements.txt",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "tauri.conf.json",
  "app.json",
  "project.config.json",
]);

const progressConfigExtensions = new Set([
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "ini",
  "env",
]);

const progressSourceExtensions = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "java",
  "go",
  "rs",
]);

const progressIgnoredSegments = new Set([
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

const progressContextCategoryLabels = {
  documentation: "项目说明文件",
  config: "配置文件",
  source: "核心源码文件",
  other: "补充文件",
  generated: "生成文件",
} as const;

type ProgressContextCategory = keyof typeof progressContextCategoryLabels;

export type ProgressAnalysisInput = {
  projectName: string;
  projectPath: string;
  files: ProgressAnalysisFile[];
  projectFacts: ProjectFacts;
  reportContent?: string;
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

function shouldIgnoreProgressFile(relativePath: string) {
  return getPathSegments(relativePath).some((segment) =>
    progressIgnoredSegments.has(segment),
  );
}

function classifyProgressFile(file: ProgressAnalysisFile): ProgressContextCategory {
  const lowerName = file.name.toLowerCase();
  const fileStem = getFileStem(file.name);
  const extension = getFileExtension(file.name);
  const pathSegments = getPathSegments(file.relative_path);

  if (
    progressDocumentationNames.has(fileStem) ||
    lowerName.startsWith("readme") ||
    lowerName.startsWith("changelog") ||
    progressDocumentationSegments.has(fileStem) ||
    pathSegments.some((segment) => progressDocumentationSegments.has(segment))
  ) {
    return "documentation";
  }

  if (
    progressConfigExactNames.has(lowerName) ||
    progressConfigExactNames.has(fileStem) ||
    progressConfigExtensions.has(extension) ||
    pathSegments.some((segment) =>
      /(^|[-_.])(config|configs|configuration|settings|setting|manifest|manifests|env|envs)([-_.]|$)/.test(
        segment,
      ),
    )
  ) {
    return "config";
  }

  if (
    progressSourceExtensions.has(extension) ||
    pathSegments.some((segment) =>
      ["src", "app", "lib", "server", "client", "pages", "components", "services", "utils", "routes", "api", "backend", "frontend", "core"].includes(
        segment,
      ),
    )
  ) {
    return "source";
  }

  return "other";
}

function getFileCacheContent(
  projectId: number,
  file: ProgressAnalysisFile,
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

function selectProgressFiles(files: ProgressAnalysisFile[]) {
  const filtered = files.filter(
    (file) => !shouldIgnoreProgressFile(file.relative_path),
  );

  const ranked = filtered
    .map((file) => {
      const category = classifyProgressFile(file);
      const fileStem = getFileStem(file.name);
      const lowerName = file.name.toLowerCase();
      const pathSegments = getPathSegments(file.relative_path);
      let score = 0;

      if (category === "documentation") {
        score += 300;
        if (lowerName.startsWith("readme")) score += 120;
        if (progressDocumentationNames.has(fileStem)) score += 80;
      } else if (category === "config") {
        score += 220;
        if (progressConfigExactNames.has(lowerName)) score += 120;
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

      if (current.category !== next.category) {
        const categoryOrder: Record<ProgressContextCategory, number> = {
          documentation: 0,
          config: 1,
          source: 2,
          other: 3,
          generated: 4,
        } as const;

        return categoryOrder[current.category] - categoryOrder[next.category];
      }

      return current.relative_path.localeCompare(next.relative_path);
    });

  const selected: Array<(typeof ranked)[number]> = [];
  const selectedPaths = new Set<string>();
  const categoryLimit: Record<Exclude<ProgressContextCategory, "generated">, number> = {
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
  files: ProgressAnalysisFile[],
  fileContentsByPath: Record<string, string>,
  getFileCacheKey: (projectId: number, relativePath: string) => string,
) {
  const selectedFiles = selectProgressFiles(files);

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

    const block = `【文件：${file.relative_path}｜类别：${progressContextCategoryLabels[classifyProgressFile(file)]}】\n${excerpt}`;
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

function summarizeTimeline(entries: ProjectTimelineEntry[]) {
  if (entries.length === 0) {
    return "暂无时间线数据";
  }

  const recentEntries = entries.slice(0, 5);
  const totalModifiedFiles = recentEntries.reduce(
    (sum, entry) => sum + entry.modifiedCount,
    0,
  );

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
    .concat(`\n最近 5 天合计修改文件数：${totalModifiedFiles}`)
    .join("\n\n");
}

function buildProgressAnalysisPrompt(input: ProgressAnalysisReportSource) {
  return `你是一名资深项目分析师。

请基于提供的项目内容，生成一份“项目进展分析”。

输出必须是 Markdown，并严格包含以下标题：

# 当前状态

根据现有内容描述项目现状。

# 已确认完成内容

列出能够明确确认的能力。

# 最近活动摘要

结合 Timeline，总结最近最活跃的部分。

# 发现的缺口

仅列出能够合理观察到的问题。

# 候选改进方向

根据已发现缺口生成，最多 3 条，每条包含：
- 建议内容
- 依据
- 预期价值

# 风险与不确定性

列出信息不足部分、无法确认部分、潜在风险。

要求：
1. 只基于提供的文件、项目报告、项目时间线回答。
2. 不要使用固定生命周期标签。
3. 不要假设项目使用任何特定技术栈。
4. 不要编造产品路线、商业模式或用户目标。
5. 区分事实与推断，信息不足时明确说明。

以下 ProjectFacts 是程序基于文件结构提取的事实，可信度高于模型推断。
如果 ProjectFacts 没有提供某项证据，请回答“当前无法确认”，不要自行推断。
value 为 null 或空数组表示当前扫描结果无法确认，不要把无法确认写成不存在。
不要根据文件名强行推断业务目标。

【ProjectFacts】
${formatProjectFactsForPrompt(input.projectFacts)}

【项目报告】
${input.reportContent || "暂无项目报告"}

【项目时间线】
${input.timelineEntries.length > 0 ? summarizeTimeline(input.timelineEntries) : "暂无时间线数据"}

【项目文件内容】
${input.fileContext}`;
}

export async function buildProgressAnalysisInput(
  input: ProgressAnalysisInput,
): Promise<ProgressAnalysisReportSource> {
  const reportContent = input.reportContent?.trim() || "";
  const fileContext = buildFileContext(
    input.projectId,
    input.files,
    input.fileContentsByPath,
    input.getFileCacheKey,
  );

  return {
    projectFacts: input.projectFacts,
    reportContent,
    timelineEntries: input.timelineEntries ?? [],
    fileContext,
  };
}

export function buildProgressAnalysisPromptFromInput(
  input: ProgressAnalysisReportSource,
) {
  return buildProgressAnalysisPrompt(input);
}
