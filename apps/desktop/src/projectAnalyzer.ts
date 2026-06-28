export type AnalyzerFile = {
  name: string;
  relative_path: string;
  size: number;
  modified_time: number;
  has_test_marker?: boolean | null;
};

export type ProjectFactField<T> = {
  value: T;
  evidence: string[];
};

export type ProjectModule = {
  name: string;
  path: string;
  category: string;
  fileCount: number;
  evidence: string[];
};

export type ProjectEntryPoint = {
  path: string;
  type: string;
  evidence: string[];
};

export type ProjectCoreFile = {
  path: string;
  reason: string;
  score: number;
  evidence: string[];
};

export type ProjectFacts = {
  scannedFileCount: ProjectFactField<number>;
  languages: ProjectFactField<string[]>;
  frameworks: ProjectFactField<string[]>;
  hasReadme: ProjectFactField<boolean | null>;
  hasDocs: ProjectFactField<boolean | null>;
  hasTests: ProjectFactField<boolean | null>;
  hasCI: ProjectFactField<boolean | null>;
  hasDocker: ProjectFactField<boolean | null>;
  hasLicense: ProjectFactField<boolean | null>;
  hasConfig: ProjectFactField<boolean | null>;
  modules: ProjectFactField<ProjectModule[]>;
  entryPoints: ProjectFactField<ProjectEntryPoint[]>;
  coreFiles: ProjectFactField<ProjectCoreFile[]>;
  structureSummary: ProjectFactField<string>;
  importantFiles: ProjectFactField<string[]>;
  recentlyModifiedFiles: ProjectFactField<string[]>;
  evidence: string[];
};

const languageExtensionMap: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  rs: "Rust",
  py: "Python",
  go: "Go",
  java: "Java",
};

const documentationNamePatterns = [
  /^readme(?:[._-].*)?$/i,
  /^changelog(?:[._-].*)?$/i,
  /^changes(?:[._-].*)?$/i,
  /^overview(?:[._-].*)?$/i,
  /^architecture(?:[._-].*)?$/i,
  /^roadmap(?:[._-].*)?$/i,
  /^spec(?:[._-].*)?$/i,
  /^requirements(?:[._-].*)?$/i,
];

const docsPathSegments = new Set([
  "docs",
  "doc",
  "documentation",
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

const testPathSegments = new Set(["test", "tests", "__tests__", "spec", "specs"]);

const ciPathIndicators = [
  ".github/workflows",
  ".gitlab-ci.yml",
  "circleci",
  "travis",
];

const dockerNamePatterns = [/^dockerfile$/i, /^docker-compose\.(ya?ml)$/i];

const licensePatterns = [/^license(?:[._-].*)?$/i, /^copying(?:[._-].*)?$/i];

const configExactNames = new Set([
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
  "tauri.conf.toml",
  "app.json",
  "project.config.json",
  "project.private.config.json",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
]);

const configExtensions = new Set([
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

const sourcePathHints = new Set([
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
]);

const moduleCategoryBySegment: Record<string, string> = {
  src: "source",
  app: "source",
  pages: "source",
  components: "source",
  services: "source",
  api: "source",
  routes: "source",
  lib: "source",
  utils: "source",
  hooks: "source",
  models: "source",
  database: "database",
  db: "database",
  auth: "auth",
  commands: "cli",
  cli: "cli",
  server: "backend",
  backend: "backend",
  frontend: "frontend",
  docs: "documentation",
  doc: "documentation",
  documentation: "documentation",
  tests: "tests",
  test: "tests",
  __tests__: "tests",
  "src-tauri": "backend",
};

const generatedPathHints = new Set([
  "gen",
  "generated",
  "schemas",
  "schema",
  ".fastembed_cache",
  "dist",
  "build",
  "target",
  "coverage",
  "node_modules",
]);

const importantSourceFileNames = new Set(["app", "main", "index", "lib"]);
const importantConfigNames = new Set([
  "package.json",
  "cargo.toml",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "tauri.conf.json",
  "tauri.conf.toml",
  "app.json",
  "project.config.json",
  "project.private.config.json",
]);

const manifestEntryNames = new Set([
  "package.json",
  "cargo.toml",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
]);

const frameworkRules = [
  {
    name: "Vite",
    match: (file: AnalyzerFile) =>
      /^vite\.config\.(ts|js|mjs|cjs)$/i.test(file.name) ||
      file.name.toLowerCase() === "package.json",
    evidenceLabel: "vite.config.* / package.json",
  },
  {
    name: "Next.js",
    match: (file: AnalyzerFile) => /^next\.config\.(js|mjs|ts|cjs)$/i.test(file.name),
    evidenceLabel: "next.config.*",
  },
  {
    name: "Tauri",
    match: (file: AnalyzerFile) =>
      /^tauri\.conf\.(json|toml)$/i.test(file.name) ||
      file.relative_path.toLowerCase().includes("src-tauri"),
    evidenceLabel: "tauri.conf.* / src-tauri",
  },
  {
    name: "Rust project",
    match: (file: AnalyzerFile) =>
      file.name.toLowerCase() === "cargo.toml" || file.relative_path.toLowerCase().includes("cargo.toml"),
    evidenceLabel: "Cargo.toml",
  },
  {
    name: "Python project",
    match: (file: AnalyzerFile) =>
      file.name.toLowerCase() === "pyproject.toml" ||
      file.name.toLowerCase() === "requirements.txt",
    evidenceLabel: "pyproject.toml / requirements.txt",
  },
  {
    name: "Go project",
    match: (file: AnalyzerFile) => file.name.toLowerCase() === "go.mod",
    evidenceLabel: "go.mod",
  },
  {
    name: "Java project",
    match: (file: AnalyzerFile) => file.name.toLowerCase() === "pom.xml",
    evidenceLabel: "pom.xml",
  },
] as const;

function getFileExtension(name: string) {
  const lowerName = name.toLowerCase();
  const lastDot = lowerName.lastIndexOf(".");

  if (lastDot <= 0) {
    return "";
  }

  return lowerName.slice(lastDot + 1);
}

function getFileStem(name: string) {
  const lowerName = name.toLowerCase();
  const lastDot = lowerName.lastIndexOf(".");

  if (lastDot <= 0) {
    return lowerName;
  }

  return lowerName.slice(0, lastDot);
}

function getPathSegments(relativePath: string) {
  return relativePath
    .split(/[\\/]+/)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
}

function hasPathSegment(relativePath: string, allowedSegments: Set<string>) {
  return getPathSegments(relativePath).some((segment) => allowedSegments.has(segment));
}

function hasPathIndicator(relativePath: string, indicators: string[]) {
  const lowerPath = relativePath.toLowerCase();
  return indicators.some((indicator) => lowerPath.includes(indicator));
}

function getNormalizedPath(relativePath: string) {
  return relativePath.toLowerCase().replace(/\\/g, "/");
}

function isGeneratedLikeFile(file: AnalyzerFile) {
  const lowerName = file.name.toLowerCase();
  const normalizedPath = getNormalizedPath(file.relative_path);

  return (
    hasPathSegment(file.relative_path, generatedPathHints) ||
    normalizedPath.includes("/gen/") ||
    normalizedPath.includes("/generated/") ||
    normalizedPath.includes("/schemas/") ||
    /(^|[._-])(schema|schemas|generated)([._-]|$)/.test(lowerName) ||
    lowerName.includes(".schema.")
  );
}

function isLockLikeFile(file: AnalyzerFile) {
  const lowerName = file.name.toLowerCase();

  return (
    /(^|[._-])(lock|lockfile)([._-]|$)/.test(lowerName) ||
    lowerName === "cargo.lock" ||
    lowerName === "pnpm-lock.yaml" ||
    lowerName === "package-lock.json" ||
    lowerName === "yarn.lock" ||
    lowerName === "poetry.lock"
  );
}

function getModuleCategory(segment: string) {
  return moduleCategoryBySegment[segment] ?? "other";
}

function findModulePath(relativePath: string) {
  const segments = getPathSegments(relativePath);

  if (segments.length === 0) {
    return null;
  }

  let bestIndex = -1;
  let bestSegment = "";

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];

    if (!moduleCategoryBySegment[segment]) {
      continue;
    }

    bestIndex = index;
    bestSegment = segment;
    break;
  }

  if (bestIndex < 0) {
    return null;
  }

  return {
    path: segments.slice(0, bestIndex + 1).join("/"),
    segment: bestSegment,
    category: getModuleCategory(bestSegment),
  };
}

function isEntryPointFile(file: AnalyzerFile) {
  const lowerName = file.name.toLowerCase();
  const stem = getFileStem(file.name);

  const isConfigEntry =
    manifestEntryNames.has(lowerName) ||
    manifestEntryNames.has(stem);

  const isExplicitEntryName = [
    /^main\.(ts|tsx|js|jsx|py|go|rs|java)$/i,
    /^index\.(ts|tsx|js|jsx|py|go|java)$/i,
    /^app\.(ts|tsx|js|jsx|py|go|java)$/i,
    /^server\.(ts|tsx|js|jsx|py|go|java)$/i,
    /^cli\.(ts|tsx|js|jsx|py|go|java)$/i,
    /^lib\.(ts|tsx|js|jsx|rs)$/i,
    /^app\/main\.(ts|tsx|js|jsx|py|go|rs|java)$/i,
    /^server\/main\.(ts|tsx|js|jsx|py|go|rs|java)$/i,
    /^src\/main\.(ts|tsx|js|jsx|py|go|rs|java)$/i,
    /^src\/index\.(ts|tsx|js|jsx|py|go|java)$/i,
    /^src\/app\.(ts|tsx|js|jsx|py|go|java)$/i,
    /^src\/server\.(ts|tsx|js|jsx|py|go|java)$/i,
    /^src\/cli\.(ts|tsx|js|jsx|py|go|java)$/i,
    /^src\/lib\.(ts|tsx|js|jsx|rs)$/i,
    /^main\.rs$/i,
    /^src\/App\.[^.]+$/i,
  ].some((pattern) => pattern.test(file.relative_path) || pattern.test(file.name));

  return {
    isConfigEntry,
    isExplicitEntryName,
  };
}

function makeEntryPointType(file: AnalyzerFile) {
  const lowerName = file.name.toLowerCase();

  if (
    lowerName === "package.json" ||
    lowerName === "cargo.toml" ||
    lowerName === "pyproject.toml" ||
    lowerName === "go.mod" ||
    lowerName === "pom.xml"
  ) {
    return "manifest-entry";
  }

  const isMain = /^main\.[^.]+$/i.test(lowerName) || /^main\.rs$/i.test(lowerName) || /src\/main\.[^.]+$/i.test(file.relative_path);
  if (isMain) {
    return "main-entry";
  }

  const isPythonOrAppMain =
    /^app\/main\.(py|go|rs|ts|tsx|js|jsx|java)$/i.test(file.relative_path) ||
    /^server\/main\.(py|go|rs|ts|tsx|js|jsx|java)$/i.test(file.relative_path) ||
    /^src\/main\.(py|go|rs|ts|tsx|js|jsx|java)$/i.test(file.relative_path);
  if (isPythonOrAppMain) {
    return "main-entry";
  }

  const isIndex = /^index\.[^.]+$/i.test(lowerName);
  if (isIndex) {
    return "index-entry";
  }

  const isApp = /^app\.[^.]+$/i.test(lowerName) || /src\/App\.[^.]+$/i.test(file.relative_path);
  if (isApp) {
    return "app-entry";
  }

  const isServer = /^server\.[^.]+$/i.test(lowerName);
  if (isServer) {
    return "server-entry";
  }

  const isCli = /^cli\.[^.]+$/i.test(lowerName);
  if (isCli) {
    return "cli-entry";
  }

  const isLibrary = /^lib\.[^.]+$/i.test(lowerName) || /^src\/lib\.rs$/i.test(file.relative_path) || /^mod\.rs$/i.test(lowerName);
  if (isLibrary) {
    return "library-entry";
  }

  return "module-entry";
}

function isEntryPointCandidate(file: AnalyzerFile) {
  const lowerName = file.name.toLowerCase();
  const stem = getFileStem(file.name);
  const normalizedPath = getNormalizedPath(file.relative_path);
  const entryInfo = isEntryPointFile(file);

  return (
    entryInfo.isConfigEntry ||
    entryInfo.isExplicitEntryName ||
    ["main", "index", "app", "server", "cli", "lib"].includes(lowerName) ||
    ["main", "index", "app", "server", "cli", "lib"].includes(stem) ||
    normalizedPath.endsWith("/main.rs")
  );
}


function detectReadmeFiles(files: AnalyzerFile[]) {
  return files.filter((file) =>
    documentationNamePatterns.some((pattern) => {
      const lowerName = file.name.toLowerCase();
      const stem = getFileStem(file.name);
      return pattern.test(lowerName) || pattern.test(stem);
    }),
  );
}

function detectDocumentationFiles(files: AnalyzerFile[]) {
  return files.filter((file) => {
    const extension = getFileExtension(file.name);
    return (
      extension === "md" ||
      extension === "mdx" ||
      hasPathSegment(file.relative_path, docsPathSegments) ||
      detectReadmeFiles([file]).length > 0
    );
  });
}

function detectTestFiles(files: AnalyzerFile[]) {
  return files.filter((file) => {
    const lowerName = file.name.toLowerCase();
    const stem = getFileStem(file.name);
    const hasRustTestMarker = file.has_test_marker === true;
    return (
      hasPathSegment(file.relative_path, testPathSegments) ||
      /\.test\./.test(lowerName) ||
      /\.spec\./.test(lowerName) ||
      /\.test\./.test(stem) ||
      /\.spec\./.test(stem) ||
      hasRustTestMarker
    );
  });
}

function detectCIFiles(files: AnalyzerFile[]) {
  return files.filter((file) =>
    hasPathIndicator(file.relative_path, ciPathIndicators) ||
    file.name.toLowerCase() === ".gitlab-ci.yml",
  );
}

function detectDockerFiles(files: AnalyzerFile[]) {
  return files.filter((file) =>
    dockerNamePatterns.some((pattern) => pattern.test(file.name.toLowerCase())),
  );
}

function detectLicenseFiles(files: AnalyzerFile[]) {
  return files.filter((file) =>
    licensePatterns.some((pattern) => pattern.test(file.name.toLowerCase()) || pattern.test(getFileStem(file.name))),
  );
}

function detectConfigFiles(files: AnalyzerFile[]) {
  return files.filter((file) => {
    if (isGeneratedLikeFile(file) || isLockLikeFile(file)) {
      return false;
    }

    const lowerName = file.name.toLowerCase();
    const stem = getFileStem(file.name);
    const extension = getFileExtension(file.name);

    return (
      configExactNames.has(lowerName) ||
      configExactNames.has(stem) ||
      configExtensions.has(extension) ||
      hasPathSegment(
        file.relative_path,
        new Set([
          "config",
          "configs",
          "configuration",
          "settings",
          "setting",
          "manifest",
          "manifests",
          "env",
          "envs",
        ]),
      )
    );
  });
}

function detectLanguages(files: AnalyzerFile[]) {
  const languageEvidence = new Map<string, string[]>();

  for (const file of files) {
    const extension = getFileExtension(file.name);
    const lowerName = file.name.toLowerCase();
    let language = languageExtensionMap[extension];

    if (!language) {
      if (lowerName === "cargo.toml") {
        language = "Rust";
      } else if (lowerName === "pyproject.toml" || lowerName === "requirements.txt") {
        language = "Python";
      } else if (lowerName === "go.mod") {
        language = "Go";
      } else if (lowerName === "pom.xml") {
        language = "Java";
      }
    }

    if (!language) {
      continue;
    }

    const currentEvidence = languageEvidence.get(language) ?? [];
    currentEvidence.push(file.relative_path);
    languageEvidence.set(language, currentEvidence);
  }

  return Array.from(languageEvidence.entries())
    .map(([language, evidence]) => ({
      language,
      evidence: Array.from(new Set(evidence)),
    }))
    .sort((current, next) => current.language.localeCompare(next.language));
}

function detectFrameworks(files: AnalyzerFile[]) {
  const frameworkEvidence = new Map<string, string[]>();

  for (const file of files) {
    if (isGeneratedLikeFile(file) || isLockLikeFile(file)) {
      continue;
    }

    for (const rule of frameworkRules) {
      if (!rule.match(file)) {
        continue;
      }

      const currentEvidence = frameworkEvidence.get(rule.name) ?? [];
      currentEvidence.push(file.relative_path);
      frameworkEvidence.set(rule.name, currentEvidence);
    }
  }

  return Array.from(frameworkEvidence.entries())
    .map(([framework, evidence]) => ({
      framework,
      evidence: Array.from(new Set(evidence)),
    }))
    .sort((current, next) => current.framework.localeCompare(next.framework));
}

function detectModules(files: AnalyzerFile[]) {
  type ModuleBucket = {
    name: string;
    path: string;
    category: string;
    filePaths: Set<string>;
  };

  const buckets = new Map<string, ModuleBucket>();

  for (const file of files) {
    if (isGeneratedLikeFile(file) || isLockLikeFile(file)) {
      continue;
    }

    const moduleMatch = findModulePath(file.relative_path);

    if (!moduleMatch) {
      continue;
    }

    const key = `${moduleMatch.path}|${moduleMatch.category}`;
    const currentBucket =
      buckets.get(key) ??
      ({
        name: moduleMatch.path.split("/")[moduleMatch.path.split("/").length - 1] ?? moduleMatch.path,
        path: moduleMatch.path,
        category: moduleMatch.category,
        filePaths: new Set<string>(),
      } as ModuleBucket);

    currentBucket.filePaths.add(file.relative_path);
    buckets.set(key, currentBucket);
  }

  return Array.from(buckets.values())
    .map((bucket) => ({
      name: bucket.name,
      path: bucket.path,
      category: bucket.category,
      fileCount: bucket.filePaths.size,
      evidence: Array.from(bucket.filePaths).slice(0, 8),
    }))
    .filter((module) => module.fileCount >= 2)
    .sort((current, next) => {
      if (next.fileCount !== current.fileCount) {
        return next.fileCount - current.fileCount;
      }

      const categoryOrder: Record<string, number> = {
        source: 0,
        backend: 1,
        frontend: 2,
        documentation: 3,
        tests: 4,
        database: 5,
        auth: 6,
        cli: 7,
        other: 8,
      };

      if (categoryOrder[current.category] !== categoryOrder[next.category]) {
        return categoryOrder[current.category] - categoryOrder[next.category];
      }

      return current.path.localeCompare(next.path);
    })
    .slice(0, 12);
}

function detectEntryPoints(files: AnalyzerFile[]) {
  const entryPoints = files
    .filter((file) => isEntryPointCandidate(file))
    .map((file) => {
      const type = makeEntryPointType(file);
      const evidence = [file.relative_path];

      if (
        file.name.toLowerCase() === "package.json" ||
        file.name.toLowerCase() === "cargo.toml" ||
        file.name.toLowerCase() === "pyproject.toml" ||
        file.name.toLowerCase() === "go.mod" ||
        file.name.toLowerCase() === "pom.xml"
      ) {
        evidence.push(`manifest: ${file.name}`);
      }

      return {
        path: file.relative_path,
        type,
        evidence: Array.from(new Set(evidence)),
        score:
          (file.relative_path.startsWith("src/") ? 200 : 0) +
          (/^main\./i.test(file.name) || /^main\.rs$/i.test(file.name) ? 180 : 0) +
          (/^(app|server|cli)\/main\.(ts|tsx|js|jsx|py|go|rs|java)$/i.test(file.relative_path) ? 180 : 0) +
          (/^app\./i.test(file.name) || /^src\/App\./i.test(file.relative_path) ? 160 : 0) +
          (/^server\.[^.]+$/i.test(file.name) ? 150 : 0) +
          (/^cli\.[^.]+$/i.test(file.name) ? 140 : 0) +
          (file.name.toLowerCase() === "package.json" || file.name.toLowerCase() === "cargo.toml" ? 140 : 0),
      };
    })
    .filter((item, index, array) => array.findIndex((current) => current.path === item.path) === index)
    .sort((current, next) => {
      if (next.score !== current.score) {
        return next.score - current.score;
      }

      return current.path.localeCompare(next.path);
    })
    .slice(0, 10)
    .map(({ score, ...item }) => ({
      ...item,
      score,
    }));

  return entryPoints;
}

function detectCoreFiles(
  files: AnalyzerFile[],
  importantFiles: AnalyzerFile[],
  modules: ProjectModule[],
  entryPoints: ProjectEntryPoint[],
) {
  const entryPointPaths = new Set(entryPoints.map((entryPoint) => entryPoint.path));
  const importantFilePaths = new Set(importantFiles.map((file) => file.relative_path));
  const modulePaths = modules.map((module) => module.path);
  const recentlyModifiedPaths = new Set(
    [...files]
      .filter((file) => Number.isFinite(file.modified_time))
      .sort((current, next) => {
        if (next.modified_time !== current.modified_time) {
          return next.modified_time - current.modified_time;
        }

        return current.relative_path.localeCompare(next.relative_path);
      })
      .slice(0, 5)
      .map((file) => file.relative_path),
  );

  const ranked = [...files]
    .filter((file) => !isGeneratedLikeFile(file) && !isLockLikeFile(file))
    .map((file) => {
      const lowerName = file.name.toLowerCase();
      const stem = getFileStem(file.name);
      const normalizedPath = getNormalizedPath(file.relative_path);
      const pathSegments = getPathSegments(file.relative_path);
      const reasons: string[] = [];
      let score = 0;

      if (entryPointPaths.has(file.relative_path)) {
        score += 500;
        reasons.push("入口文件");
      }

      if (importantFilePaths.has(file.relative_path)) {
        score += 220;
        reasons.push("importantFiles 命中");
      }

      if (recentlyModifiedPaths.has(file.relative_path)) {
        score += 160;
        reasons.push("最近修改");
      }

      if (
        pathSegments.some((segment) =>
          ["src", "app", "backend", "frontend", "server", "lib", "api", "services", "routes", "models", "utils", "hooks"].includes(segment),
        )
      ) {
        score += 120;
        reasons.push("核心目录");
      }

      if (
        /(^|[._-])(main|index|app|server|lib|service|api|router|route)([._-]|$)/.test(lowerName) ||
        /(^|[._-])(main|index|app|server|lib|service|api|router|route)([._-]|$)/.test(stem)
      ) {
        score += 140;
        reasons.push("核心文件名");
      }

      if (modulePaths.some((modulePath) => normalizedPath === modulePath || normalizedPath.startsWith(`${modulePath}/`))) {
        score += 80;
        reasons.push("属于核心模块");
      }

      if (
        manifestEntryNames.has(lowerName) ||
        configExactNames.has(lowerName) ||
        configExactNames.has(stem) ||
        configExtensions.has(getFileExtension(file.name))
      ) {
        score -= 320;
        reasons.push("配置文件");
      }

      if (hasPathSegment(file.relative_path, docsPathSegments)) {
        score -= 80;
        reasons.push("文档文件");
      }

      if (hasPathSegment(file.relative_path, testPathSegments) || file.has_test_marker === true) {
        score += 20;
        reasons.push("测试相关");
      }

      score += Math.max(0, 18 - Math.min(pathSegments.length, 18));
      score += Math.min(Math.floor(file.size / 4096), 25);

      return {
        path: file.relative_path,
        reason: reasons.length > 0 ? Array.from(new Set(reasons)).join("，") : "结构核心候选",
        score,
        evidence: Array.from(
          new Set([
            ...(entryPointPaths.has(file.relative_path) ? ["entryPoint"] : []),
            ...(importantFilePaths.has(file.relative_path) ? ["importantFiles"] : []),
            ...(recentlyModifiedPaths.has(file.relative_path) ? ["recentlyModified"] : []),
            ...(modulePaths.some((modulePath) => normalizedPath === modulePath || normalizedPath.startsWith(`${modulePath}/`))
              ? ["module"] : []),
            file.relative_path,
          ]),
        ),
      };
    })
    .filter((file) => file.score >= 120)
    .sort((current, next) => {
      if (next.score !== current.score) {
        return next.score - current.score;
      }

      return current.path.localeCompare(next.path);
    })
    .slice(0, 10)
    .map(({ score, ...item }) => ({
      ...item,
      score,
    }));

  return ranked;
}

function pickImportantFiles(files: AnalyzerFile[]) {
  const isHighPriorityFile = (file: AnalyzerFile) => {
    const lowerName = file.name.toLowerCase();
    const stem = getFileStem(file.name);
    const normalizedPath = getNormalizedPath(file.relative_path);

    if (documentationNamePatterns.some((pattern) => pattern.test(lowerName) || pattern.test(stem))) {
      return true;
    }

    if (importantConfigNames.has(lowerName) || importantConfigNames.has(stem)) {
      return true;
    }

    if (hasPathSegment(file.relative_path, docsPathSegments)) {
      return true;
    }

    if (
      /^src\/(app|main|index|lib)\.[^.]+$/.test(normalizedPath) ||
      /^src\/(app|main|index|lib)\/.+$/.test(normalizedPath)
    ) {
      return true;
    }

    if (normalizedPath.startsWith("src/") && importantSourceFileNames.has(stem)) {
      return true;
    }

    return false;
  };

  const ranked = [...files]
    .map((file) => {
    const lowerName = file.name.toLowerCase();
    const stem = getFileStem(file.name);
    const extension = getFileExtension(file.name);
      const generatedLike = isGeneratedLikeFile(file);
      const lockLike = isLockLikeFile(file);
      const highPriority = isHighPriorityFile(file);
      const normalizedPath = getNormalizedPath(file.relative_path);
      const pathDepth = getPathSegments(file.relative_path).length;
      const isSourceFile =
        languageExtensionMap[extension] ||
        normalizedPath.includes("/src/") ||
        hasPathSegment(file.relative_path, sourcePathHints);
      let score = 0;

      if (generatedLike) {
        score -= 2000;
      } else if (lockLike) {
        score -= 1200;
      } else if (highPriority) {
        score += 1000;
      } else {
        score += 320;
      }

      if (documentationNamePatterns.some((pattern) => pattern.test(lowerName) || pattern.test(stem))) {
        score += 260;
      }

      if (importantConfigNames.has(lowerName) || importantConfigNames.has(stem)) {
        score += 240;
      }

      if (hasPathSegment(file.relative_path, docsPathSegments)) {
        score += 180;
      }

      if (hasPathSegment(file.relative_path, testPathSegments)) {
        score += 150;
      }

      if (hasPathIndicator(file.relative_path, ciPathIndicators)) {
        score += 140;
      }

      if (dockerNamePatterns.some((pattern) => pattern.test(lowerName))) {
        score += 130;
      }

      if (licensePatterns.some((pattern) => pattern.test(lowerName) || pattern.test(stem))) {
        score += 120;
      }

      if (isSourceFile) {
        score += 220;
      }

      if (configExactNames.has(lowerName) || configExactNames.has(stem) || configExtensions.has(extension)) {
        score += 80;
      }

      score += Math.max(0, 25 - Math.min(pathDepth, 25));
      score += Math.min(Math.floor(file.size / 4096), 20);

      if (/^src\/(app|main|index|lib)\.[^.]+$/.test(normalizedPath)) {
        score += 240;
      }

      return {
        ...file,
        priority: generatedLike ? 3 : lockLike ? 2 : highPriority ? 0 : 1,
        score,
      };
    })
    .sort((current, next) => {
      if (current.priority !== next.priority) {
        return current.priority - next.priority;
      }

      if (next.score !== current.score) {
        return next.score - current.score;
      }

      if (next.modified_time !== current.modified_time) {
        return next.modified_time - current.modified_time;
      }

      return current.relative_path.localeCompare(next.relative_path);
    });

  return ranked.slice(0, 8);
}

function getShortPathName(path: string) {
  const segments = getPathSegments(path);
  return segments[segments.length - 1] ?? path;
}

function buildStructureSummary(
  modules: ProjectModule[],
  entryPoints: ProjectEntryPoint[],
  coreFiles: ProjectCoreFile[],
  languages: string[],
  frameworks: string[],
) {
  const evidence = collectEvidence([
    ...modules.slice(0, 3).flatMap((item) => item.evidence),
    ...entryPoints.slice(0, 3).flatMap((item) => item.evidence),
    ...coreFiles.slice(0, 3).flatMap((item) => item.evidence),
  ]);

  const moduleNames = modules.slice(0, 3).map((item) => item.path);
  const entryNames = entryPoints.slice(0, 3).map((item) => getShortPathName(item.path));
  const coreNames = coreFiles.slice(0, 3).map((item) => getShortPathName(item.path));
  const languageText = languages.length > 0 ? languages.join("、") : "当前无法确认";
  const frameworkText = frameworks.length > 0 ? frameworks.join("、") : "当前无法确认";

  const summaryParts: string[] = [];

  if (modules.length > 0) {
    summaryParts.push(`识别到 ${modules.length} 个主要模块`);
  } else {
    summaryParts.push("当前扫描结果未能稳定识别主要模块");
  }

  if (entryPoints.length > 0) {
    summaryParts.push(`找到 ${entryPoints.length} 个入口文件`);
  } else {
    summaryParts.push("入口文件暂未能完整确认");
  }

  if (coreFiles.length > 0) {
    summaryParts.push(`确认 ${coreFiles.length} 个核心文件`);
  } else {
    summaryParts.push("核心文件暂未能完整确认");
  }

  const detailParts: string[] = [];

  if (moduleNames.length > 0) {
    detailParts.push(`主要模块包括 ${moduleNames.join("、")}`);
  }

  if (entryNames.length > 0) {
    detailParts.push(`入口文件包括 ${entryNames.join("、")}`);
  }

  if (coreNames.length > 0) {
    detailParts.push(`核心文件包括 ${coreNames.join("、")}`);
  }

  detailParts.push(`主要语言包括 ${languageText}`);
  detailParts.push(`框架包括 ${frameworkText}`);

  const summary = `该项目${summaryParts.join("，")}。结构上${detailParts.join("，")}。`;

  return {
    value: summary,
    evidence,
  };
}

function collectEvidence(strings: string[]) {
  return Array.from(new Set(strings.filter(Boolean)));
}

function toField<T>(value: T, evidence: string[]): ProjectFactField<T> {
  return {
    value,
    evidence: collectEvidence(evidence),
  };
}

export function analyzeProject(files: AnalyzerFile[]): ProjectFacts {
  const readmeFiles = detectReadmeFiles(files);
  const docsFiles = detectDocumentationFiles(files);
  const testFiles = detectTestFiles(files);
  const rustTestMarkerFiles = files.filter((file) => file.has_test_marker === true);
  const ciFiles = detectCIFiles(files);
  const dockerFiles = detectDockerFiles(files);
  const licenseFiles = detectLicenseFiles(files);
  const configFiles = detectConfigFiles(files);
  const languages = detectLanguages(files);
  const frameworks = detectFrameworks(files);
  const importantFiles = pickImportantFiles(files);
  const modules = detectModules(files);
  const entryPoints = detectEntryPoints(files);
  const coreFiles = detectCoreFiles(files, importantFiles, modules, entryPoints);
  const recentlyModifiedFiles = [...files]
    .filter((file) => Number.isFinite(file.modified_time))
    .sort((current, next) => {
      if (next.modified_time !== current.modified_time) {
        return next.modified_time - current.modified_time;
      }

      return current.relative_path.localeCompare(next.relative_path);
    })
    .slice(0, 5);

  const languageValues = languages.map((item) => item.language);
  const frameworkValues = frameworks.map((item) => item.framework);
  const structureSummary = buildStructureSummary(
    modules,
    entryPoints,
    coreFiles,
    languageValues,
    frameworkValues,
  );

  const overallEvidence = collectEvidence([
    `scannedFileCount=${files.length}`,
    ...readmeFiles.map((file) => file.relative_path),
    ...docsFiles.slice(0, 5).map((file) => file.relative_path),
    ...testFiles.slice(0, 5).map((file) => file.relative_path),
    ...rustTestMarkerFiles.slice(0, 5).map((file) => file.relative_path),
    ...ciFiles.slice(0, 5).map((file) => file.relative_path),
    ...dockerFiles.slice(0, 5).map((file) => file.relative_path),
    ...licenseFiles.slice(0, 5).map((file) => file.relative_path),
    ...configFiles.slice(0, 5).map((file) => file.relative_path),
    ...languages.flatMap((item) => item.evidence.slice(0, 3)),
    ...frameworks.flatMap((item) => item.evidence.slice(0, 3)),
    ...importantFiles.slice(0, 5).map((file) => file.relative_path),
    ...modules.flatMap((item) => item.evidence.slice(0, 5)),
    ...entryPoints.flatMap((item) => item.evidence.slice(0, 5)),
    ...coreFiles.flatMap((item) => item.evidence.slice(0, 5)),
    ...structureSummary.evidence,
    ...recentlyModifiedFiles.slice(0, 5).map((file) => file.relative_path),
  ]);

  return {
    scannedFileCount: toField(files.length, [`扫描到 ${files.length} 个文件`]),
    languages: toField(
      languageValues,
      languages.flatMap((item) => item.evidence),
    ),
    frameworks: toField(
      frameworkValues,
      frameworks.flatMap((item) => item.evidence),
    ),
    hasReadme: toField(
      readmeFiles.length > 0 ? true : null,
      readmeFiles.map((file) => file.relative_path),
    ),
    hasDocs: toField(
      docsFiles.length > 0 ? true : null,
      docsFiles.slice(0, 8).map((file) => file.relative_path),
    ),
    hasTests: toField(
      testFiles.length > 0 || rustTestMarkerFiles.length > 0 ? true : null,
      [...testFiles, ...rustTestMarkerFiles].slice(0, 8).map((file) => file.relative_path),
    ),
    hasCI: toField(
      ciFiles.length > 0 ? true : null,
      ciFiles.slice(0, 8).map((file) => file.relative_path),
    ),
    hasDocker: toField(
      dockerFiles.length > 0 ? true : null,
      dockerFiles.slice(0, 8).map((file) => file.relative_path),
    ),
    hasLicense: toField(
      licenseFiles.length > 0 ? true : null,
      licenseFiles.slice(0, 8).map((file) => file.relative_path),
    ),
    hasConfig: toField(
      configFiles.length > 0 ? true : null,
      configFiles.slice(0, 10).map((file) => file.relative_path),
    ),
    modules: toField(
      modules,
      modules.flatMap((item) => item.evidence),
    ),
    entryPoints: toField(
      entryPoints,
      entryPoints.flatMap((item) => item.evidence),
    ),
    coreFiles: toField(
      coreFiles,
      coreFiles.flatMap((item) => item.evidence),
    ),
    structureSummary: toField(
      structureSummary.value,
      structureSummary.evidence,
    ),
    importantFiles: toField(
      importantFiles.map((file) => file.relative_path),
      importantFiles.map((file) => file.relative_path),
    ),
    recentlyModifiedFiles: toField(
      recentlyModifiedFiles.map((file) => file.relative_path),
      recentlyModifiedFiles.map((file) => file.relative_path),
    ),
    evidence: overallEvidence,
  };
}

function formatFieldValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join("、") : "[]";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function formatEvidenceLines(evidence: string[]) {
  if (evidence.length === 0) {
    return "    - 无";
  }

  return evidence.map((item) => `    - ${item}`).join("\n");
}

function formatObjectList(items: Record<string, unknown>[]) {
  if (items.length === 0) {
    return "[]";
  }

  return items.map((item) => `  - ${JSON.stringify(item)}`).join("\n");
}

export function formatProjectFactsForPrompt(projectFacts: ProjectFacts) {
  return `scannedFileCount:
  value: ${projectFacts.scannedFileCount.value}
  evidence:
${formatEvidenceLines(projectFacts.scannedFileCount.evidence)}
languages:
  value: ${formatFieldValue(projectFacts.languages.value)}
  evidence:
${formatEvidenceLines(projectFacts.languages.evidence)}
frameworks:
  value: ${formatFieldValue(projectFacts.frameworks.value)}
  evidence:
${formatEvidenceLines(projectFacts.frameworks.evidence)}
hasReadme:
  value: ${formatFieldValue(projectFacts.hasReadme.value)}
  evidence:
${formatEvidenceLines(projectFacts.hasReadme.evidence)}
hasDocs:
  value: ${formatFieldValue(projectFacts.hasDocs.value)}
  evidence:
${formatEvidenceLines(projectFacts.hasDocs.evidence)}
hasTests:
  value: ${formatFieldValue(projectFacts.hasTests.value)}
  evidence:
${formatEvidenceLines(projectFacts.hasTests.evidence)}
hasCI:
  value: ${formatFieldValue(projectFacts.hasCI.value)}
  evidence:
${formatEvidenceLines(projectFacts.hasCI.evidence)}
hasDocker:
  value: ${formatFieldValue(projectFacts.hasDocker.value)}
  evidence:
${formatEvidenceLines(projectFacts.hasDocker.evidence)}
hasLicense:
  value: ${formatFieldValue(projectFacts.hasLicense.value)}
  evidence:
${formatEvidenceLines(projectFacts.hasLicense.evidence)}
hasConfig:
  value: ${formatFieldValue(projectFacts.hasConfig.value)}
  evidence:
${formatEvidenceLines(projectFacts.hasConfig.evidence)}
modules:
  value: ${formatObjectList(projectFacts.modules.value)}
  evidence:
${formatEvidenceLines(projectFacts.modules.evidence)}
entryPoints:
  value: ${formatObjectList(projectFacts.entryPoints.value)}
  evidence:
${formatEvidenceLines(projectFacts.entryPoints.evidence)}
coreFiles:
  value: ${formatObjectList(projectFacts.coreFiles.value)}
  evidence:
${formatEvidenceLines(projectFacts.coreFiles.evidence)}
structureSummary:
  value: ${projectFacts.structureSummary.value}
  evidence:
${formatEvidenceLines(projectFacts.structureSummary.evidence)}
importantFiles:
  value: ${formatFieldValue(projectFacts.importantFiles.value)}
  evidence:
${formatEvidenceLines(projectFacts.importantFiles.evidence)}
recentlyModifiedFiles:
  value: ${formatFieldValue(projectFacts.recentlyModifiedFiles.value)}
  evidence:
${formatEvidenceLines(projectFacts.recentlyModifiedFiles.evidence)}
evidence:
${formatEvidenceLines(projectFacts.evidence)}`;
}
