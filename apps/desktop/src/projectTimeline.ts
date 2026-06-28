export type ProjectTimelineFile = {
  name: string;
  relative_path: string;
  modified_time?: number;
};

export type ProjectTimelineActivityType =
  | "文档活动"
  | "开发活动"
  | "配置活动"
  | "混合活动";

export type ProjectTimelineRepresentativeFile = {
  name: string;
  relative_path: string;
  category: "文档" | "开发" | "配置" | "其他";
};

export type ProjectTimelineEntry = {
  date: string;
  modifiedCount: number;
  activityType: ProjectTimelineActivityType;
  representativeFiles: ProjectTimelineRepresentativeFile[];
};

export type ProjectTimelineSectionKey = "today" | "thisWeek" | "older";

export type ProjectTimelineSection = {
  key: ProjectTimelineSectionKey;
  title: string;
  subtitle: string;
  entries: ProjectTimelineEntry[];
};

type FileCategory = ProjectTimelineRepresentativeFile["category"];

const documentationExtensions = new Set(["md", "markdown", "txt"]);
const sourceExtensions = new Set(["ts", "tsx", "js", "jsx", "py", "java", "go", "rs"]);
const configExtensions = new Set(["json", "yaml", "yml", "toml", "xml", "ini", "env"]);
const documentationNames = new Set(["readme", "readme_cn", "changelog", "changes"]);
const configNames = new Set([
  "package.json",
  "cargo.toml",
  "pyproject.toml",
  "go.mod",
  "go.sum",
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
const documentationSegments = new Set([
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
const sourceSegments = new Set([
  "src",
  "app",
  "lib",
  "server",
  "client",
  "pages",
  "components",
  "services",
  "utils",
  "routes",
  "api",
  "backend",
  "frontend",
  "core",
]);
const ignoredTimelineSegments = new Set([
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
  "cache",
  "temp",
  "tmp",
  ".turbo",
  ".fastembed_cache",
  ".playwright-cli",
]);

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

function classifyFile(file: ProjectTimelineFile): FileCategory {
  const lowerName = file.name.toLowerCase();
  const fileStem = getFileStem(file.name);
  const extension = getFileExtension(file.name);
  const pathSegments = getPathSegments(file.relative_path);

  if (
    documentationNames.has(fileStem) ||
    lowerName.startsWith("readme") ||
    lowerName.startsWith("changelog") ||
    documentationExtensions.has(extension) ||
    pathSegments.some((segment) => documentationSegments.has(segment))
  ) {
    return "文档";
  }

  if (
    configNames.has(lowerName) ||
    configNames.has(fileStem) ||
    configExtensions.has(extension) ||
    pathSegments.some((segment) =>
      /(^|[-_.])(config|configs|configuration|settings|setting|manifest|manifests|env|envs)([-_.]|$)/.test(
        segment,
      ),
    )
  ) {
    return "配置";
  }

  if (
    sourceExtensions.has(extension) ||
    pathSegments.some((segment) => sourceSegments.has(segment))
  ) {
    return "开发";
  }

  return "其他";
}

function shouldIgnoreTimelineFile(relativePath: string) {
  return getPathSegments(relativePath).some((segment) =>
    ignoredTimelineSegments.has(segment),
  );
}

function formatLocalDate(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateText: string) {
  const [yearText, monthText, dayText] = dateText.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(0);
  }

  return new Date(year, month - 1, day);
}

function startOfLocalDay(date: Date) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  return dayStart;
}

function startOfLocalWeek(date: Date) {
  const weekStart = startOfLocalDay(date);
  const dayIndex = weekStart.getDay();
  const offset = (dayIndex + 6) % 7;
  weekStart.setDate(weekStart.getDate() - offset);
  return weekStart;
}

export function buildProjectTimeline(
  files: ProjectTimelineFile[],
): ProjectTimelineEntry[] {
  const validFiles = files.filter(
    (file) =>
      typeof file.modified_time === "number" &&
      file.modified_time > 0 &&
      !shouldIgnoreTimelineFile(file.relative_path),
  );

  if (validFiles.length === 0) {
    return [];
  }

  const groupedByDate = new Map<
    string,
    Array<ProjectTimelineFile & { category: FileCategory }>
  >();

  for (const file of validFiles) {
    const category = classifyFile(file);
    const date = formatLocalDate(file.modified_time ?? 0);
    const existing = groupedByDate.get(date) ?? [];

    existing.push({
      ...file,
      category,
    });
    groupedByDate.set(date, existing);
  }

  const categoryOrder: FileCategory[] = ["文档", "配置", "开发", "其他"];

  return [...groupedByDate.entries()]
    .sort((current, next) => next[0].localeCompare(current[0]))
    .map(([date, groupedFiles]) => {
      const categoryCounts = new Map<FileCategory, number>();

      for (const file of groupedFiles) {
        categoryCounts.set(
          file.category,
          (categoryCounts.get(file.category) ?? 0) + 1,
        );
      }

      const activeCategories = categoryOrder.filter(
        (category) => (categoryCounts.get(category) ?? 0) > 0,
      );
      const activityType =
        activeCategories.length > 1
          ? "混合活动"
          : activeCategories[0] === "文档"
            ? "文档活动"
            : activeCategories[0] === "配置"
              ? "配置活动"
              : activeCategories[0] === "开发"
                ? "开发活动"
                : "混合活动";

      const representativeFiles = [...groupedFiles]
        .sort((current, next) => {
          if ((next.modified_time ?? 0) !== (current.modified_time ?? 0)) {
            return (next.modified_time ?? 0) - (current.modified_time ?? 0);
          }

          const currentRank = categoryOrder.indexOf(current.category);
          const nextRank = categoryOrder.indexOf(next.category);

          if (currentRank !== nextRank) {
            return currentRank - nextRank;
          }

          return current.relative_path.localeCompare(next.relative_path);
        })
        .slice(0, 5)
        .map((file) => ({
          name: file.name,
          relative_path: file.relative_path,
          category: file.category,
        }));

      return {
        date,
        modifiedCount: groupedFiles.length,
        activityType,
        representativeFiles,
      };
    });
}

export function groupProjectTimelineEntries(
  entries: ProjectTimelineEntry[],
  now = Date.now(),
): ProjectTimelineSection[] {
  if (entries.length === 0) {
    return [];
  }

  const todayStart = startOfLocalDay(new Date(now));
  const weekStart = startOfLocalWeek(new Date(now));
  const buckets: Record<ProjectTimelineSectionKey, ProjectTimelineEntry[]> = {
    today: [],
    thisWeek: [],
    older: [],
  };

  for (const entry of entries) {
    const entryDate = startOfLocalDay(parseLocalDate(entry.date));

    if (entryDate.getTime() === todayStart.getTime()) {
      buckets.today.push(entry);
    } else if (entryDate >= weekStart) {
      buckets.thisWeek.push(entry);
    } else {
      buckets.older.push(entry);
    }
  }

  const sections: ProjectTimelineSection[] = [
    {
      key: "today",
      title: "今天",
      subtitle: "今天发生的文件活动",
      entries: buckets.today,
    },
    {
      key: "thisWeek",
      title: "本周",
      subtitle: "最近一周的文件活动",
      entries: buckets.thisWeek,
    },
    {
      key: "older",
      title: "更早",
      subtitle: "更早之前的历史活动",
      entries: buckets.older,
    },
  ];

  return sections.filter((section) => section.entries.length > 0);
}
