// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use fastembed::{similarity::top_k, EmbeddingModel, TextEmbedding, TextInitOptions};
use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use std::sync::{Mutex, OnceLock};

#[tauri::command]
fn greet(name: &str) -> String {
  format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Clone, Serialize)]
struct ScannedFile {
    name: String,
    relative_path: String,
    size: u64,
    modified_time: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    has_test_marker: Option<bool>,
}

#[derive(Serialize)]
struct SemanticChunkMatch {
    chunk_id: String,
    relative_path: String,
    start_offset: usize,
    end_offset: usize,
    score: f32,
    content: String,
}

#[derive(Serialize)]
struct MimoKeyStatus {
    has_env_key: bool,
    has_keychain_key: bool,
    active_source: String,
}

struct IndexedSemanticChunk {
    chunk_id: String,
    relative_path: String,
    start_offset: usize,
    end_offset: usize,
    content: String,
    embedding: Vec<f32>,
}

struct ProjectSemanticIndex {
    chunks: Vec<IndexedSemanticChunk>,
}

const ALLOWED_EXTENSIONS: [&str; 14] = [
    "md",
    "txt",
    "ts",
    "tsx",
    "js",
    "jsx",
    "json",
    "py",
    "java",
    "go",
    "rs",
    "toml",
    "yaml",
    "yml",
];
const ALLOWED_FILENAMES: [&str; 10] = [
    "cargo.toml",
    "pyproject.toml",
    "go.mod",
    "go.sum",
    "pom.xml",
    "dockerfile",
    "makefile",
    "pnpm-lock.yaml",
    "yarn.lock",
    "poetry.lock",
];
const IGNORED_DIRECTORIES: [&str; 5] = ["node_modules", ".git", "dist", "build", "target"];
const MAX_PREVIEW_FILE_SIZE: u64 = 1024 * 1024;
const MIN_CHUNK_CHARS: usize = 300;
const MAX_CHUNK_CHARS: usize = 800;
const TARGET_CHUNK_CHARS: usize = 650;
const CHUNK_WINDOW_STEP: usize = 500;
const MAX_EMBEDDING_TEXT_CHARS: usize = 4000;
const MIMO_KEYCHAIN_SERVICE: &str = "appsdesktop";
const MIMO_KEYCHAIN_ACCOUNT: &str = "mimo_api_key";

static SEMANTIC_INDEX: OnceLock<Mutex<HashMap<String, ProjectSemanticIndex>>> = OnceLock::new();
static SEMANTIC_MODEL: OnceLock<Mutex<Option<TextEmbedding>>> = OnceLock::new();

fn load_backend_env() {
    let backend_env_path = Path::new(env!("CARGO_MANIFEST_DIR")).join(".env.local");
    dotenvy::from_path(&backend_env_path).ok();
}

#[tauri::command]
fn scan_project_files(path: String) -> Result<Vec<ScannedFile>, String> {
    let root = PathBuf::from(path);

    if !root.exists() {
        return Err(format!("目录不存在：{}", root.display()));
    }

    if !root.is_dir() {
        return Err(format!("不是有效目录：{}", root.display()));
    }

    let mut files = Vec::new();
    scan_directory(&root, &root, &mut files)?;
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    if let Ok(canonical_root) = fs::canonicalize(&root) {
        let canonical_root_key = canonical_root.to_string_lossy().to_string();
        let files_for_index = files.clone();

        std::thread::spawn(move || {
            if let Ok(index) = build_semantic_index(&canonical_root, &files_for_index) {
                if let Ok(mut store) = semantic_index_store().lock() {
                    store.insert(canonical_root_key, index);
                }
            }
        });
    }

    Ok(files)
}

#[tauri::command]
fn read_project_file(project_root: String, file_path: String) -> Result<String, String> {
    let root = PathBuf::from(project_root);

    if !root.exists() {
        return Err(format!("目录不存在：{}", root.display()));
    }

    if !root.is_dir() {
        return Err(format!("不是有效目录：{}", root.display()));
    }

    let canonical_root = fs::canonicalize(&root)
        .map_err(|error| format!("无法解析项目目录 {}：{}", root.display(), error))?;

    let requested_path = PathBuf::from(file_path);
    let joined_path = if requested_path.is_absolute() {
        requested_path
    } else {
        root.join(requested_path)
    };

    let canonical_file = fs::canonicalize(&joined_path)
        .map_err(|error| format!("无法读取文件 {}：{}", joined_path.display(), error))?;

    if !canonical_file.starts_with(&canonical_root) {
        return Err("禁止访问项目目录之外的文件".to_string());
    }

    let metadata = fs::metadata(&canonical_file)
        .map_err(|error| format!("无法读取文件信息 {}：{}", canonical_file.display(), error))?;

    if metadata.len() > MAX_PREVIEW_FILE_SIZE {
        return Err("文件过大，不展示".to_string());
    }

    fs::read_to_string(&canonical_file)
        .map_err(|error| format!("无法读取文本内容 {}：{}", canonical_file.display(), error))
}

#[tauri::command]
fn semantic_search_project_files(
    path: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SemanticChunkMatch>, String> {
    let root = PathBuf::from(path);

    if !root.exists() {
        return Err(format!("目录不存在：{}", root.display()));
    }

    if !root.is_dir() {
        return Err(format!("不是有效目录：{}", root.display()));
    }

    let canonical_root = fs::canonicalize(&root)
        .map_err(|error| format!("无法解析项目目录 {}：{}", root.display(), error))?;
    let canonical_key = canonical_root.to_string_lossy().to_string();
    let query = query.trim();

    if query.is_empty() {
        return Ok(vec![]);
    }

    let store = semantic_index_store()
        .lock()
        .map_err(|error| format!("语义索引读取失败：{}", error))?;

    let index = match store.get(&canonical_key) {
        Some(index) => index,
        None => return Ok(vec![]),
    };

    if index.chunks.is_empty() {
        return Ok(vec![]);
    }

    let mut model_guard = semantic_model_guard()?;
    let model = model_guard
        .as_mut()
        .ok_or_else(|| "初始化语义模型失败".to_string())?;
    let query_input = format!("query: {}", query);
    let query_embeddings = model
        .embed(vec![query_input.as_str()], None)
        .map_err(|error| format!("生成查询语义向量失败：{}", error))?;

    let query_embedding = match query_embeddings.into_iter().next() {
        Some(embedding) if !embedding.is_empty() => embedding,
        _ => return Ok(vec![]),
    };

    let corpus: Vec<Vec<f32>> = index
        .chunks
        .iter()
        .map(|chunk| chunk.embedding.clone())
        .collect();
    let top_n = limit.unwrap_or(5).max(1).min(corpus.len());
    let ranked_chunks: Vec<SemanticChunkMatch> = top_k(&query_embedding, &corpus, top_n)
        .into_iter()
        .filter_map(|(index_position, score)| {
            index.chunks.get(index_position).map(|chunk| SemanticChunkMatch {
                chunk_id: chunk.chunk_id.clone(),
                relative_path: chunk.relative_path.clone(),
                start_offset: chunk.start_offset,
                end_offset: chunk.end_offset,
                score,
                content: chunk.content.clone(),
            })
        })
        .collect();
    Ok(ranked_chunks)
}

#[tauri::command]
fn ask_mimo(prompt: String, api_key: Option<String>) -> Result<String, String> {
    load_backend_env();

    let api_url = normalize_mimo_api_url(
        &env::var("MIMO_API_URL").map_err(|_| "缺少 MIMO_API_URL".to_string())?,
    );
    let model = env::var("MIMO_MODEL").unwrap_or_else(|_| "mimo-v2.5".to_string());
    let api_key = api_key
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
        .map(Ok)
        .unwrap_or_else(load_mimo_api_key)?;

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("MiMo 客户端初始化失败：{}", error))?;
    let response = client
        .post(&api_url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .json(&serde_json::json!({
            "model": model,
            "messages": [
                { "role": "user", "content": prompt }
            ]
        }))
        .send()
        .map_err(|error| format!("MiMo 请求失败：{}", error))?;

    if !response.status().is_success() {
        return Err(format!("MiMo 请求失败：{}", response.status()));
    }

    let data: serde_json::Value = response
        .json()
        .map_err(|error| format!("MiMo 响应解析失败：{}", error))?;

    let answer = data
        .get("answer")
        .and_then(|value| value.as_str())
        .or_else(|| data.get("text").and_then(|value| value.as_str()))
        .or_else(|| data.get("content").and_then(|value| value.as_str()))
        .or_else(|| {
            data.get("choices")
                .and_then(|value| value.get(0))
                .and_then(|value| value.get("message"))
                .and_then(|value| value.get("content"))
                .and_then(|value| value.as_str())
        })
        .or_else(|| {
            data.get("choices")
                .and_then(|value| value.get(0))
                .and_then(|value| value.get("text"))
                .and_then(|value| value.as_str())
        })
        .unwrap_or("")
        .trim()
        .to_string();

    if answer.is_empty() {
        Err("MiMo 没有返回回答内容".to_string())
    } else {
        Ok(answer)
    }
}

fn normalize_mimo_api_url(raw_url: &str) -> String {
    let trimmed = raw_url.trim().trim_end_matches('/');

    if trimmed.ends_with("/chat/completions") || trimmed.ends_with("/responses") {
        return trimmed.to_string();
    }

    if trimmed.ends_with("/v1") {
        return format!("{trimmed}/chat/completions");
    }

    trimmed.to_string()
}

#[tauri::command]
fn store_mimo_api_key(api_key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(MIMO_KEYCHAIN_SERVICE, MIMO_KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("无法初始化钥匙串：{}", error))?;

    entry
        .set_password(&api_key)
        .map_err(|error| format!("保存 MiMo Key 失败：{}", error))
}

#[tauri::command]
fn migrate_mimo_api_key_to_keychain() -> Result<(), String> {
    load_backend_env();

    let api_key = env::var("MIMO_API_KEY")
        .map_err(|_| "当前没有 MIMO_API_KEY，无法迁移到钥匙串".to_string())?;

    store_mimo_api_key(api_key)
}

#[tauri::command]
fn get_mimo_api_key_status() -> Result<MimoKeyStatus, String> {
    load_backend_env();

    let has_env_key = env::var("MIMO_API_KEY").is_ok();
    let entry = keyring::Entry::new(MIMO_KEYCHAIN_SERVICE, MIMO_KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("无法初始化钥匙串：{}", error))?;
    let has_keychain_key = entry.get_password().is_ok();

    let active_source = if has_keychain_key {
        "keychain"
    } else if has_env_key {
        "env"
    } else {
        "missing"
    };

    Ok(MimoKeyStatus {
        has_env_key,
        has_keychain_key,
        active_source: active_source.to_string(),
    })
}

fn load_mimo_api_key() -> Result<String, String> {
    load_backend_env();

    let entry = keyring::Entry::new(MIMO_KEYCHAIN_SERVICE, MIMO_KEYCHAIN_ACCOUNT)
        .map_err(|error| format!("无法初始化钥匙串：{}", error))?;

    if let Ok(key) = entry.get_password() {
        return Ok(key);
    }

    if let Ok(key) = env::var("MIMO_API_KEY") {
        return Ok(key);
    }

    Err("读取 MiMo Key 失败：本机请先保存到钥匙串，云端请设置 MIMO_API_KEY 环境变量".to_string())
}

fn semantic_index_store() -> &'static Mutex<HashMap<String, ProjectSemanticIndex>> {
    SEMANTIC_INDEX.get_or_init(|| Mutex::new(HashMap::new()))
}

fn semantic_model_guard(
) -> Result<std::sync::MutexGuard<'static, Option<TextEmbedding>>, String> {
    let model_lock = SEMANTIC_MODEL.get_or_init(|| Mutex::new(None));
    let mut guard = model_lock
        .lock()
        .map_err(|error| format!("语义模型锁定失败：{}", error))?;

    if guard.is_none() {
        let model = TextEmbedding::try_new(TextInitOptions::new(EmbeddingModel::MultilingualE5Base))
            .map_err(|error| format!("初始化语义模型失败：{}", error))?;
        *guard = Some(model);
    }

    Ok(guard)
}

fn build_semantic_index(
    root: &Path,
    files: &[ScannedFile],
) -> Result<ProjectSemanticIndex, String> {
    let mut model_guard = semantic_model_guard()?;
    let model = model_guard
        .as_mut()
        .ok_or_else(|| "初始化语义模型失败".to_string())?;
    let mut chunk_specs = Vec::new();
    let mut documents = Vec::new();

    for file in files {
        if let Ok(content) = read_project_file_for_embedding(root, &file.relative_path) {
            for chunk in split_file_into_chunks(&file.relative_path, &content) {
                if chunk.content.trim().is_empty() {
                    continue;
                }

                let chunk_id = build_chunk_id(
                    &file.relative_path,
                    chunk.start_offset,
                    chunk.end_offset,
                );
                let embedding_text = build_chunk_embedding_text(file, &chunk);

                chunk_specs.push(IndexedSemanticChunkDraft {
                    chunk_id,
                    relative_path: file.relative_path.clone(),
                    start_offset: chunk.start_offset,
                    end_offset: chunk.end_offset,
                    content: chunk.content,
                });
                documents.push(embedding_text);
            }
        }
    }

    if documents.is_empty() {
        return Ok(ProjectSemanticIndex { chunks: Vec::new() });
    }

    let document_refs: Vec<&str> = documents.iter().map(|document| document.as_str()).collect();
    let embeddings = model
        .embed(document_refs, None)
        .map_err(|error| format!("生成文件语义向量失败：{}", error))?;

    let chunks = chunk_specs
        .into_iter()
        .zip(embeddings.into_iter())
        .map(|(draft, embedding)| IndexedSemanticChunk {
            chunk_id: draft.chunk_id,
            relative_path: draft.relative_path,
            start_offset: draft.start_offset,
            end_offset: draft.end_offset,
            content: draft.content,
            embedding,
        })
        .collect();

    Ok(ProjectSemanticIndex { chunks })
}

fn read_project_file_for_embedding(root: &Path, file_path: &str) -> Result<String, String> {
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("无法解析项目目录 {}：{}", root.display(), error))?;

    let requested_path = PathBuf::from(file_path);
    let joined_path = if requested_path.is_absolute() {
        requested_path
    } else {
        root.join(requested_path)
    };

    let canonical_file = fs::canonicalize(&joined_path)
        .map_err(|error| format!("无法读取文件 {}：{}", joined_path.display(), error))?;

    if !canonical_file.starts_with(&canonical_root) {
        return Err("禁止访问项目目录之外的文件".to_string());
    }

    let metadata = fs::metadata(&canonical_file)
        .map_err(|error| format!("无法读取文件信息 {}：{}", canonical_file.display(), error))?;

    if metadata.len() > MAX_PREVIEW_FILE_SIZE {
        return Err("文件过大，跳过 embedding".to_string());
    }

    fs::read_to_string(&canonical_file)
        .map_err(|error| format!("无法读取文本内容 {}：{}", canonical_file.display(), error))
}

struct IndexedSemanticChunkDraft {
    chunk_id: String,
    relative_path: String,
    start_offset: usize,
    end_offset: usize,
    content: String,
}

struct TextBlock {
    start_offset: usize,
    end_offset: usize,
    content: String,
}

fn build_chunk_id(relative_path: &str, start_offset: usize, end_offset: usize) -> String {
    format!("{relative_path}:{start_offset}-{end_offset}")
}

fn build_chunk_embedding_text(
    file: &ScannedFile,
    chunk: &TextBlock,
) -> String {
    let normalized_content = chunk
        .content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let truncated_content = normalized_content
        .chars()
        .take(MAX_EMBEDDING_TEXT_CHARS)
        .collect::<String>();

    format!(
        "passage: 文件名：{file_name}\n相对路径：{relative_path}\n片段范围：{start_offset}-{end_offset}\n内容：{content}",
        file_name = file.name,
        relative_path = file.relative_path,
        start_offset = chunk.start_offset,
        end_offset = chunk.end_offset,
        content = truncated_content
    )
}

fn split_file_into_chunks(file_path: &str, content: &str) -> Vec<TextBlock> {
    let normalized = content.replace("\r\n", "\n");
    let is_code_file = is_code_file_path(file_path);

    if is_code_file {
        return split_code_file_into_chunks(&normalized);
    }

    let blocks = split_content_into_blocks(&normalized);
    let mut chunks = Vec::new();
    let mut current_chunk: Option<TextBlock> = None;

    for block in blocks {
        let block_len = block.content.chars().count();

        if block_len > MAX_CHUNK_CHARS {
            if let Some(current) = current_chunk.take() {
                chunks.push(current);
            }

            chunks.extend(split_large_block(block));
            continue;
        }

        match current_chunk.as_mut() {
            None => {
                current_chunk = Some(block);
            }
            Some(current) => {
                let current_len = current.content.chars().count();
                let candidate_len = current_len + 2 + block_len;

                if candidate_len > MAX_CHUNK_CHARS && current_len >= MIN_CHUNK_CHARS {
                    if let Some(current) = current_chunk.take() {
                        chunks.push(current);
                    }
                    current_chunk = Some(block);
                } else {
                    current.content.push_str("\n\n");
                    current.content.push_str(&block.content);
                    current.end_offset = block.end_offset;
                }
            }
        }
    }

    if let Some(current) = current_chunk {
        chunks.push(current);
    }

    chunks
}

fn split_code_file_into_chunks(content: &str) -> Vec<TextBlock> {
    const CODE_TARGET_CHARS: usize = 420;
    const CODE_MAX_CHARS: usize = 620;

    let boundaries = find_code_boundaries(content);
    let mut chunks = Vec::new();

    if boundaries.is_empty() {
        return split_large_block(TextBlock {
            start_offset: 0,
            end_offset: content.chars().count(),
            content: content.to_string(),
        });
    }

    let mut current_start = boundaries[0].start_offset;
    let mut current_content = String::new();
    let mut current_len = 0usize;

    for block in boundaries {
        let block_len = block.content.chars().count();
        let candidate_len = if current_content.is_empty() {
            block_len
        } else {
            current_len + 2 + block_len
        };

        if !current_content.is_empty() && candidate_len > CODE_MAX_CHARS && current_len >= CODE_TARGET_CHARS {
            chunks.push(TextBlock {
                start_offset: current_start,
                end_offset: block.start_offset,
                content: current_content.trim().to_string(),
            });
            current_start = block.start_offset;
            current_content = block.content;
            current_len = current_content.chars().count();
            continue;
        }

        if current_content.is_empty() {
            current_content = block.content;
            current_len = current_content.chars().count();
            continue;
        }

        current_content.push_str("\n\n");
        current_content.push_str(&block.content);
        current_len = current_content.chars().count();
    }

    if !current_content.trim().is_empty() {
        chunks.push(TextBlock {
            start_offset: current_start,
            end_offset: content.chars().count(),
            content: current_content,
        });
    }

    if chunks.is_empty() {
        return split_large_block(TextBlock {
            start_offset: 0,
            end_offset: content.chars().count(),
            content: content.to_string(),
        });
    }

    chunks
}

fn find_code_boundaries(content: &str) -> Vec<TextBlock> {
    let mut blocks = Vec::new();
    let mut current_content = String::new();
    let mut current_start_offset = 0usize;
    let mut cursor = 0usize;
    let mut block_open = false;

    for segment in content.split_inclusive('\n') {
        let segment_start = cursor;
        let segment_len = segment.chars().count();
        cursor += segment_len;
        let line = segment.trim_end_matches('\n');
        let normalized = normalize_code_signature_line(line);
        let is_boundary = is_code_signature_line(&normalized);

        if is_boundary && block_open && !current_content.trim().is_empty() {
            blocks.push(TextBlock {
                start_offset: current_start_offset,
                end_offset: segment_start,
                content: current_content.clone(),
            });
            current_content.clear();
            block_open = false;
        }

        if !block_open {
            current_start_offset = segment_start;
            block_open = true;
        }

        current_content.push_str(segment);
    }

    if block_open && !current_content.trim().is_empty() {
        blocks.push(TextBlock {
            start_offset: current_start_offset,
            end_offset: cursor,
            content: current_content,
        });
    }

    blocks
}

fn normalize_code_signature_line(line: &str) -> String {
    line.trim().to_string()
}

fn is_code_signature_line(line: &str) -> bool {
    let trimmed = line.trim();

    if trimmed.is_empty() {
        return false;
    }

    let signature_patterns = [
        r"^(?:export\s+default\s+)?(?:async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*\b",
        r"^(?:export\s+default\s+)?class\s+[A-Za-z_$][A-Za-z0-9_$]*\b",
        r"^(?:export\s+)?interface\s+[A-Za-z_$][A-Za-z0-9_$]*\b",
        r"^(?:export\s+)?type\s+[A-Za-z_$][A-Za-z0-9_$]*\b",
        r"^(?:pub\s+)?struct\s+[A-Za-z_$][A-Za-z0-9_$]*\b",
        r"^(?:pub\s+)?fn\s+[A-Za-z_$][A-Za-z0-9_$]*\b",
        r"^def\s+[A-Za-z_$][A-Za-z0-9_$]*\b",
        r"^func\b",
        r"^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)",
    ];

    signature_patterns
        .iter()
        .any(|pattern| regex::Regex::new(pattern).map(|re| re.is_match(trimmed)).unwrap_or(false))
}

fn split_content_into_blocks(content: &str) -> Vec<TextBlock> {
    let mut blocks = Vec::new();
    let mut current_content = String::new();
    let mut current_start_offset = 0usize;
    let mut cursor = 0usize;
    let mut block_open = false;

    for segment in content.split_inclusive('\n') {
        let segment_start = cursor;
        let segment_len = segment.chars().count();
        cursor += segment_len;
        let line = segment.trim_end_matches('\n');

        if line.trim().is_empty() {
            if block_open && !current_content.trim().is_empty() {
                blocks.push(TextBlock {
                    start_offset: current_start_offset,
                    end_offset: segment_start,
                    content: current_content.clone(),
                });
            }

            current_content.clear();
            block_open = false;
            continue;
        }

        if !block_open {
            current_start_offset = segment_start;
            block_open = true;
        }

        current_content.push_str(segment);
    }

    if block_open && !current_content.trim().is_empty() {
        blocks.push(TextBlock {
            start_offset: current_start_offset,
            end_offset: cursor,
            content: current_content,
        });
    }

    blocks
}

fn split_large_block(block: TextBlock) -> Vec<TextBlock> {
    let total_len = block.content.chars().count();
    if total_len <= MAX_CHUNK_CHARS {
        return vec![block];
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;

    while start < total_len {
        let end = (start + TARGET_CHUNK_CHARS).min(total_len);
        let chunk_content = slice_chars(&block.content, start, end);
        let chunk_end = block.start_offset + end;

        if !chunk_content.trim().is_empty() {
            chunks.push(TextBlock {
                start_offset: block.start_offset + start,
                end_offset: chunk_end,
                content: chunk_content,
            });
        }

        if end >= total_len {
            break;
        }

        start += CHUNK_WINDOW_STEP;
    }

    chunks
}

fn slice_chars(text: &str, start: usize, end: usize) -> String {
    text.chars()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect()
}

fn is_code_file_path(path: &str) -> bool {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    matches!(
        extension.as_deref(),
        Some("ts" | "tsx" | "js" | "jsx" | "py" | "java" | "go" | "rs")
    )
}

fn scan_directory(root: &Path, current_dir: &Path, files: &mut Vec<ScannedFile>) -> Result<(), String> {
    let entries = fs::read_dir(current_dir)
        .map_err(|error| format!("读取目录失败 {}：{}", current_dir.display(), error))?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("读取目录项失败 {}：{}", current_dir.display(), error))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("读取文件类型失败 {}：{}", entry.path().display(), error))?;
        let entry_path = entry.path();

        if file_type.is_dir() {
            let directory_name = entry.file_name();
            let directory_name = directory_name.to_string_lossy();

            if IGNORED_DIRECTORIES
                .iter()
                .any(|ignored| *ignored == directory_name)
            {
                continue;
            }

            scan_directory(root, &entry_path, files)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        if !should_include_file(&entry_path) {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|error| format!("读取文件大小失败 {}：{}", entry_path.display(), error))?;
        let modified_time = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        let has_test_marker = detect_rust_test_marker(&entry_path, &metadata);
        let relative_path = entry_path
            .strip_prefix(root)
            .unwrap_or(&entry_path)
            .to_string_lossy()
            .replace('\\', "/");
        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();

        files.push(ScannedFile {
            name,
            relative_path,
            size: metadata.len(),
            modified_time,
            has_test_marker,
        });
    }

    Ok(())
}

fn detect_rust_test_marker(path: &Path, metadata: &fs::Metadata) -> Option<bool> {
    let is_rust_file = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("rs"))
        .unwrap_or(false);

    if !is_rust_file || metadata.len() > MAX_PREVIEW_FILE_SIZE {
        return None;
    }

    let content = fs::read_to_string(path).ok()?;

    if content.contains("#[cfg(test)]") {
        return Some(true);
    }

    None
}

fn should_include_file(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    if file_name
        .as_deref()
        .map(|name| ALLOWED_FILENAMES.iter().any(|allowed| *allowed == name))
        .unwrap_or(false)
    {
        return true;
    }

    path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            let extension = extension.to_ascii_lowercase();
            ALLOWED_EXTENSIONS.iter().any(|allowed| *allowed == extension)
        })
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            scan_project_files,
            read_project_file,
            semantic_search_project_files,
            ask_mimo,
            store_mimo_api_key,
            migrate_mimo_api_key_to_keychain,
            get_mimo_api_key_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{read_project_file, scan_project_files, MAX_PREVIEW_FILE_SIZE};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn scans_supported_files_and_ignores_common_build_dirs() {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("appsdesktop-scan-{unique_suffix}"));

        fs::create_dir_all(root.join("src")).expect("create src");
        fs::create_dir_all(root.join("nested/child")).expect("create nested");
        fs::create_dir_all(root.join("node_modules/ignored")).expect("create node_modules");
        fs::create_dir_all(root.join(".git/hooks")).expect("create git");
        fs::create_dir_all(root.join("dist")).expect("create dist");
        fs::create_dir_all(root.join("build")).expect("create build");
        fs::create_dir_all(root.join("target")).expect("create target");

        fs::write(root.join("README.md"), "# hello").expect("write markdown");
        fs::write(root.join("notes.txt"), "notes").expect("write text");
        fs::write(root.join("Cargo.toml"), "[package]\nname = \"demo\"").expect("write toml");
        fs::write(root.join("go.mod"), "module demo").expect("write gomod");
        fs::write(root.join("pyproject.toml"), "[project]\nname = \"demo\"").expect("write pyproject");
        fs::write(root.join("src/main.tsx"), "export const main = true;").expect("write tsx");
        fs::write(root.join("nested/child/script.js"), "console.log('hi');").expect("write js");
        fs::write(root.join("data.json"), "{\"value\":1}").expect("write json");
        fs::write(root.join("node_modules/ignored/file.ts"), "ignored").expect("write ignored");
        fs::write(root.join(".git/hooks/pre-commit"), "ignored").expect("write ignored");
        fs::write(root.join("dist/bundle.js"), "ignored").expect("write ignored");
        fs::write(root.join("build/output.py"), "ignored").expect("write ignored");
        fs::write(root.join("target/compiled.jsx"), "ignored").expect("write ignored");
        fs::write(root.join("nested/image.png"), "ignored").expect("write ignored");

        let files = scan_project_files(root.to_string_lossy().to_string())
            .expect("scan should succeed");

        assert_eq!(files.len(), 8);
        assert_eq!(files[0].relative_path, "Cargo.toml");
        assert_eq!(files[1].relative_path, "README.md");
        assert_eq!(files[2].relative_path, "data.json");
        assert_eq!(files[3].relative_path, "go.mod");
        assert_eq!(files[4].relative_path, "nested/child/script.js");
        assert_eq!(files[5].relative_path, "notes.txt");
        assert_eq!(files[6].relative_path, "pyproject.toml");
        assert_eq!(files[7].relative_path, "src/main.tsx");
        assert_eq!(files[1].size, 7);
        assert_eq!(files[5].size, 5);
        assert!(files.iter().all(|file| file.modified_time > 0));
    }

    #[test]
    fn reads_file_content_only_inside_project_root() {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("appsdesktop-read-{unique_suffix}"));
        let outside_file = root
            .parent()
            .expect("temp dir parent")
            .join(format!("outside-{unique_suffix}.ts"));

        fs::create_dir_all(root.join("src")).expect("create src");
        fs::write(root.join("src/main.ts"), "export const value = 1;").expect("write file");
        fs::write(&outside_file, "export const outside = true;").expect("write outside file");

        let content = read_project_file(
            root.to_string_lossy().to_string(),
            "src/main.ts".to_string(),
        )
        .expect("read should succeed");

        assert_eq!(content, "export const value = 1;");

        let blocked = read_project_file(
            root.to_string_lossy().to_string(),
            format!("../{}", outside_file.file_name().unwrap().to_string_lossy()),
        )
        .expect_err("should block traversal");

        assert!(blocked.contains("禁止访问项目目录之外的文件"));

        let _ = fs::remove_file(outside_file);
    }

    #[test]
    fn rejects_large_preview_files() {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("appsdesktop-large-{unique_suffix}"));

        fs::create_dir_all(&root).expect("create root");
        let large_file = root.join("huge.txt");
        fs::write(&large_file, vec![b'a'; (MAX_PREVIEW_FILE_SIZE + 1) as usize])
            .expect("write large file");

        let error = read_project_file(
            root.to_string_lossy().to_string(),
            "huge.txt".to_string(),
        )
        .expect_err("should reject large file");

        assert!(error.contains("文件过大，不展示"));
    }
}
